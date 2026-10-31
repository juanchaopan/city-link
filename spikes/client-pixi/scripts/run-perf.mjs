import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const RECORD_MS = 12000;
const { server, port } = await serve(process.cwd());

function stats(frames) {
  const dts = frames.map((f) => f.dt).filter((d) => d > 0).sort((a, b) => a - b);
  const pick = (list, q) => list[Math.min(list.length - 1, Math.floor(list.length * q))];
  const sims = frames.map((f) => f.sim).sort((a, b) => a - b);
  const renders = frames.map((f) => f.render).sort((a, b) => a - b);
  let worstSecond = Infinity;
  let elapsed = 0;
  let count = 0;
  for (const f of frames) {
    elapsed += f.dt;
    count++;
    if (elapsed >= 1000) {
      worstSecond = Math.min(worstSecond, (count * 1000) / elapsed);
      elapsed = 0;
      count = 0;
    }
  }
  return {
    frames: frames.length,
    fpsP50: +(1000 / pick(dts, 0.5)).toFixed(1),
    fpsP95Frame: +(1000 / pick(dts, 0.95)).toFixed(1),
    frameP95ms: +pick(dts, 0.95).toFixed(1),
    frameMaxMs: +dts[dts.length - 1].toFixed(1),
    worstOneSecondFps: +worstSecond.toFixed(1),
    jsSimP50ms: +pick(sims, 0.5).toFixed(2),
    jsSimP95ms: +pick(sims, 0.95).toFixed(2),
    jsRenderP50ms: +pick(renders, 0.5).toFixed(2),
    jsRenderP95ms: +pick(renders, 0.95).toFixed(2),
  };
}

const GPUS = {
  hardware: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

const cases = JSON.parse(process.argv[2] ?? 'null') ?? [
  { gpu: 'hardware', cpu: 1, mode: 'particle' },
  { gpu: 'hardware', cpu: 4, mode: 'particle' },
  { gpu: 'hardware', cpu: 6, mode: 'particle' },
  { gpu: 'hardware', cpu: 6, mode: 'sprite' },
  { gpu: 'software', cpu: 1, mode: 'particle' },
  { gpu: 'software', cpu: 4, mode: 'particle' },
  { gpu: 'software', cpu: 6, mode: 'particle' },
  { gpu: 'hardware', cpu: 1, mode: 'sprite' },
];

const outFile = process.argv[3] ?? 'out/perf-results.json';
const results = [];
for (const test of cases) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GPUS[test.gpu] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cdp = await page.context().newCDPSession(page);
  const query = `w=390&h=844&dpr=${test.dpr ?? 2}&mode=${test.mode}&flow=${test.flow ?? 64}`;
  await page.goto(`http://127.0.0.1:${port}/dist/web/index.html?${query}`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 30000 });
  const error = await page.evaluate(() => window.__error);
  if (error) throw new Error(error);
  await page.waitForTimeout(1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: test.cpu });
  await page.waitForTimeout(500);
  const probe = await page.evaluate(() => window.__game.probe());
  await page.evaluate(() => window.__game.startRecording());
  await page.waitForTimeout(RECORD_MS);
  const frames = await page.evaluate(() => window.__game.stopRecording());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const entry = { ...test, dpr: test.dpr ?? 2, glRenderer: probe.glRenderer, sprites: await page.evaluate(() => window.__game.count), ...stats(frames) };
  results.push(entry);
  console.log(JSON.stringify(entry));
  await browser.close();
}
server.close();
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
