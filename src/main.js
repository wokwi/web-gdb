const worker = new Worker('src/worker.js');

const term = new Terminal({
  cursorBlink: true,
  logLevel: 'off',
  theme: { background: '#222' },
});
term.open(document.querySelector('#terminal'));
term.resize(100, 25);
term.write('Preparing your online GDB session...\r\n');

if (window.opener) {
  const pipe = new MessageChannel();

  worker.postMessage({ type: 'init', data: pipe.port1 }, [pipe.port1]);
  window.opener.postMessage({ type: 'gdbInit', data: pipe.port2 }, '*', [
    pipe.port2,
  ]);
}

term.onData((data) => {
  worker.postMessage({ type: 'serial', data });
});

worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'serial') {
    term.write(msg.data);
  }
  if (msg.type === 'progress') {
    term.write(`\x1b[1;33m${msg.data}\x1b[0m\r\n`);
  }
});
