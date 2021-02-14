importScripts('../build/libv86.js');

console.log('Worker starting...');

const emulator = new V86Starter({
  wasm_path: '../build/v86.wasm',
  bios: { url: '../bios/seabios.bin' },
  bzimage: { url: '../images/gdb-7.11.1-bzImage.bin' },
  cmdline: 'tsc=reliable mitigations=off random.trust_cpu=on',
  autostart: true,
  disable_speaker: true,
  filesystem: {},
  uart1: true,
});

let gdbPort = null;

let ready = false;
let slashFound = false;
let bootMessage = false;

emulator.add_listener('emulator-ready', () => {
  self.postMessage({ type: 'progress', data: '✅  System image loaded' });
});

emulator.add_listener('serial0-output-char', (chr) => {
  if (!bootMessage) {
    self.postMessage({ type: 'progress', data: '✅  System booting...' });
    bootMessage = true;
  }
  if (chr === '/' && !ready) {
    emulator.create_file('/sketch.elf', new Uint8Array([]));
    if (slashFound) {
      ready = true;
      for (const char of '\r\n') {
        self.postMessage({ type: 'serial', data: char });
      }
      emulator.serial0_send('gdb -ex "target remote /dev/ttyS1"\n');
    }
    slashFound = true;
  }
  if (!ready) {
    return;
  }
  self.postMessage({ type: 'serial', data: chr });
});

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gdbPort = msg.data;
    gdbPort.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'gdb') {
        serial1Write(msg.data);
      }
    };
  }
  if (msg.type === 'serial') {
    emulator.serial0_send(msg.data);
  }
};

function serial1Write(msg) {
  emulator.serial_send_bytes(
    1,
    msg.split('').map((ch) => ch.charCodeAt(0))
  );
}

let gdbBuf = '';
emulator.add_listener('serial1-output-char', function (chr) {
  if (!ready) {
    return;
  }

  // Handle break
  if (chr === '\003') {
    console.log('BREAK');
    gdbPort.postMessage({ type: 'break' });
    return;
  }

  gdbBuf += chr;
  for (;;) {
    const dolla = gdbBuf.indexOf('$');
    const hash = gdbBuf.indexOf('#');
    if (dolla < 0 || hash < 0 || hash < dolla || hash + 2 > gdbBuf.length) {
      return;
    }
    const cmd = gdbBuf.substr(dolla + 1, hash - dolla - 1);
    gdbBuf = gdbBuf.substr(hash + 2);
    if (gdbPort) {
      serial1Write('+');
      gdbPort.postMessage({ type: 'gdb', data: cmd });
    }
  }
});
