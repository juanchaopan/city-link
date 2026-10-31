const params = new URLSearchParams(location.search);
const config = {
  width: Number(params.get('w') ?? 390),
  height: Number(params.get('h') ?? 844),
  dpr: Number(params.get('dpr') ?? 2),
  webgl: Number(params.get('webgl') ?? 2),
  mode: params.get('mode') ?? 'particle',
  base: `/dist/${params.get('dist') ?? 'wx'}/`,
  recordMs: Number(params.get('record') ?? 3000),
};
const canvas = document.getElementById('game');
canvas.style.width = `${config.width}px`;
canvas.style.height = `${config.height}px`;
const offscreen = canvas.transferControlToOffscreen();
offscreen.width = config.width * config.dpr;
offscreen.height = config.height * config.dpr;
window.__messages = [];
const worker = new Worker('/mock/wx-mock.js');
worker.onmessage = (e) => window.__messages.push(e.data);
worker.onerror = (e) => window.__messages.push({ type: 'error', message: `worker: ${e.message}` });
worker.postMessage({ type: 'boot', config, canvas: offscreen }, [offscreen]);
