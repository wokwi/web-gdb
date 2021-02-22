const imageName = 'gdb-10.1-bzImage.bin';

importScripts('../build/libv86.js');

console.log('Worker starting...');

const gdb_sh = `
#!/bin/sh
while true; do
  eval \`resize\`
  gdb -ex "dir /mnt" -ex "symbol-file /mnt/sketch.elf" -ex "target remote /dev/ttyS1"
done
`;

class GDBServer {
  constructor(messagePort) {
    this.messagePort = messagePort;
    this.elf = null;
    this.sources = null;
    this.onResponse = null;
    this.onELFUpdated = null;
    this.gdbBuf = '';
    messagePort.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'gdb':
          if (this.onResponse) {
            this.onResponse(msg.data);
          }
          break;
        case 'elf':
          this.elf = msg.data;
          if (this.onELFUpdated) {
            this.onELFUpdated();
          }
          break;
        case 'sources':
          this.sources = msg.data;
          if (this.onELFUpdated) {
            this.onELFUpdated();
          }
          break;
      }
    };
  }

  requestElf() {
    const { messagePort } = this;
    messagePort.postMessage({ type: 'downloadSources' });
    messagePort.postMessage({ type: 'downloadElf' });
  }

  send(chr) {
    const { messagePort } = this;
    // Handle break
    if (messagePort && chr === '\x03') {
      console.log('BREAK');
      messagePort.postMessage({ type: 'break' });
      return;
    }

    this.gdbBuf += chr;
    for (;;) {
      const dolla = this.gdbBuf.indexOf('$');
      const hash = this.gdbBuf.indexOf('#', dolla + 1);
      if (dolla < 0 || hash < 0 || hash + 2 > this.gdbBuf.length) {
        return;
      }
      const cmd = this.gdbBuf.substr(dolla + 1, hash - dolla - 1);
      this.gdbBuf = this.gdbBuf.substr(hash + 2);
      if (messagePort) {
        if (this.onResponse) {
          this.onResponse('+');
        }
        messagePort.postMessage({ type: 'gdb', data: cmd });
      }
    }
  }
}

class GDBRunner {
  constructor() {
    this.settings = {
      wasm_path: '../build/v86.wasm',
      bios: { url: '../bios/seabios.bin' },
      bzimage: { url: `../images/${imageName}` },
      cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
      autostart: false,
      disable_speaker: true,
      filesystem: {},
      uart1: true,
    };
    this.cache = null;
    this.cachedData = null;
    this.ready = false;
    this.slashFound = false;
    this.gdbServer = null;
    this.cacheSaved = false;
    this.bootMessageDisplayed = false;
    this.emulator = null;
  }

  reportProgress(message) {
    postMessage({ type: 'progress', data: message });
  }

  async init() {
    const { settings } = this;
    this.cache = typeof caches !== 'undefined' ? await caches.open('gdb-state-v2') : null;
    this.cachedData = this.cache ? await this.cache.match(imageName) : null;
    if (this.cachedData) {
      this.reportProgress('✅  System loaded from cache');
      delete settings.bios;
      delete settings.bzimage;
      this.cacheSaved = true;
      this.bootMessageDisplayed = true;
    }
    const emulator = new V86Starter(settings);
    emulator.add_listener('serial0-output-char', this.onSerial0Output);
    emulator.add_listener('serial1-output-char', this.onSerial1Output);
    emulator.add_listener('emulator-loaded', this.onEmulatorLoaded);
    emulator.add_listener('emulator-ready', this.onEmulatorReady);

    this.emulator = emulator;
  }

  loadElf() {
    const { gdbServer, emulator } = this;
    const { elf, sources } = this.gdbServer;
    if (elf) {
      const data = Uint8Array.from(atob(elf), (c) => c.charCodeAt(0));
      emulator.create_file('/sketch.elf', data);
      if (sources) {
        for (const [path, content] of sources) {
          const pathParts = path.split('/');
          const filename = pathParts[pathParts.length - 1];
          emulator.create_file(filename, new TextEncoder().encode(content));
        }
      }
    } else if (gdbServer) {
      gdbServer.requestElf();
    }
  }

  attachGDBServer(gdbServer) {
    this.gdbServer = gdbServer;
    gdbServer.onELFUpdated = () => {
      this.loadElf();
    };
    gdbServer.onResponse = (response) => {
      this.serial1Write(response);
    };
  }

  startGDB() {
    this.emulator.serial0_send('. /mnt/gdb.sh\n');
  }

  input(chars) {
    this.emulator.serial0_send(chars);
  }

  async cacheState() {
    if (this.cacheSaved) {
      return;
    }
    const frozenState = await new Promise((resolve, reject) =>
      this.emulator.save_state((err, result) => (err != null ? reject(err) : resolve(result)))
    );
    if (!this.cache) {
      return;
    }
    this.cacheSaved = true;
    await this.cache.put(
      imageName,
      new Response(frozenState, {
        headers: { 'Content-type': 'application/binary' },
      })
    );
    console.log('emulator: state saved to cache.');
  }

  onEmulatorLoaded = async () => {
    if (this.cachedData) {
      this.reportProgress('✅  Emulator initialized');
      this.emulator.restore_state(await this.cachedData.arrayBuffer());
      this.slashFound = true;
      this.ready = true;
      setTimeout(() => {
        this.loadElf();
      }, 0);
    } else {
      this.reportProgress(
        '👷‍♀️ Installing GDB... This only happens once and can take up to 1 minute.'
      );
    }
    this.emulator.run();
    this.emulator.create_file('gdb.sh', new TextEncoder().encode(gdb_sh));
  };

  onEmulatorReady = () => {
    console.log('emulator: ready');
    this.gdbServer.requestElf();
  };

  onSerial0Output = (chr) => {
    if (!this.bootMessageDisplayed) {
      this.reportProgress('✅  System booting...');
      this.bootMessageDisplayed = true;
    }
    if (chr === '/' && !this.ready) {
      this.loadElf();
      if (this.slashFound) {
        this.cacheState();
        this.ready = true;
        for (const char of '\r\n') {
          self.postMessage({ type: 'serial', data: char });
        }
        this.startGDB();
      }
      this.slashFound = true;
    }
    if (!this.ready) {
      return;
    }
    self.postMessage({ type: 'serial', data: chr });
  };

  serial1Write(msg) {
    this.emulator.serial_send_bytes(
      1,
      msg.split('').map((ch) => ch.charCodeAt(0))
    );
  }

  onSerial1Output = (chr) => {
    if (this.ready) {
      this.gdbServer.send(chr);
    }
  };
}

const runner = new GDBRunner();
onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    runner.attachGDBServer(new GDBServer(msg.data));
    runner.init().catch(console.error);
    console.log('GDBServer ready!');
  }
  if (msg.type === 'serial') {
    runner.input(msg.data);
  }
};
