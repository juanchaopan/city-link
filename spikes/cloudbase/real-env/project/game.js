// 打开后自动跑完 ADR-0005 的真实环境探测，把结果写在屏幕和调试器里，用完连同云函数一起删除。
const ENV_ID = 'cloud1-d4g50k8p5a564b091';
const TERRAIN_ROUNDS = 5;

const info = wx.getWindowInfo();
const canvas = wx.createCanvas();
canvas.width = info.windowWidth * info.pixelRatio;
canvas.height = info.windowHeight * info.pixelRatio;
const ctx = canvas.getContext('2d');
const lines = [];

function show(text) {
  console.log(text);
  lines.push(text);
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = `${13 * info.pixelRatio}px sans-serif`;
  const top = (info.safeArea?.top ?? 40) + 60;
  lines.forEach((line, i) => ctx.fillText(line, 12 * info.pixelRatio, (top + i * 20) * info.pixelRatio));
}

const call = (data) => wx.cloud.callFunction({ name: 'spikeprobe', data });

async function step(data, render) {
  try {
    const { result } = await call(data);
    show(render(result));
  } catch (error) {
    show(`${data.action} 失败：${String(error?.errMsg ?? error).slice(0, 60)}`);
  }
}

async function main() {
  show('第二轮探测开始，请等待');
  wx.cloud.init({ env: ENV_ID, traceUser: false });
  await step({ action: 'read' }, (r) => `读 P50 ${r.read.p50} P95 ${r.read.p95} 最大 ${r.read.max} 毫秒`);
  await step({ action: 'write' }, (r) => `写 P50 ${r.write.p50} P95 ${r.write.p95} 最大 ${r.write.max} 毫秒`);
  await step({ action: 'query' }, (r) => `查 P50 ${r.query.p50} P95 ${r.query.p95} 最大 ${r.query.max} 毫秒`);
  for (let i = 0; i < TERRAIN_ROUNDS; i++) {
    const start = Date.now();
    await step({ action: 'terrain', count: 1 }, (r) => `地形 ${r.terrain.max} 毫秒，往返 ${Date.now() - start}，冷 ${r.cold}`);
  }
  show('探测完成');
}

main().catch((error) => show(`失败：${String(error?.errMsg ?? error).slice(0, 80)}`));
