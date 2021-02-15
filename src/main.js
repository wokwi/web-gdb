const worker = new Worker('src/worker.js?v=4');

const term = new Terminal({
  cursorBlink: true,
  logLevel: 'off',
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.querySelector('#terminal'));
fitAddon.fit();
window.addEventListener('resize', () => {
  fitAddon.fit();
});

term.write('Preparing your online GDB session...\r\n');

const pipe = new MessageChannel();
worker.postMessage({ type: 'init', data: pipe.port1 }, [pipe.port1]);
if (window.opener) {
  window.opener.postMessage({ type: 'gdbInit', data: pipe.port2 }, '*', [pipe.port2]);
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
