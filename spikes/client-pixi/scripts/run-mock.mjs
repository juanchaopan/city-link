import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, port } = await serve(process.cwd());
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function run(name, query, screenshot) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text().slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/mock/index.html?${query}`);
  let last;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const messages = await page.evaluate(() => window.__messages);
    last = messages.find((m) => m.type === 'ready' || m.type === 'error');
    if (last) {
      const env = messages.find((m) => m.type === 'env');
      if (screenshot) await page.screenshot({ path: `out/${screenshot}` });
      await page.close();
      const { frames, ...rest } = last;
      const dts = (frames ?? []).map((f) => f.dt).sort((a, b) => a - b);
      return {
        name,
        env,
        ...rest,
        frameCount: dts.length,
        medianDt: dts[dts.length >> 1],
        console: consoleLines.slice(0, 10),
      };
    }
    await page.waitForTimeout(250);
  }
  await page.close();
  return { name, timeout: true, console: consoleLines.slice(0, 10) };
}

const results = [];
results.push(await run('webgl2-particle', 'webgl=2&mode=particle', 'mock-webgl2.png'));
results.push(await run('webgl1-particle', 'webgl=1&mode=particle', 'mock-webgl1.png'));
results.push(await run('webgl2-sprite', 'webgl=2&mode=sprite', 'mock-sprite.png'));
if (fs.existsSync('dist/wx-no-eval/game.js')) results.push(await run('control-no-unsafe-eval', 'dist=wx-no-eval'));
if (fs.existsSync('dist/wx-native-yoga/game.js')) results.push(await run('control-native-yoga', 'dist=wx-native-yoga'));

await browser.close();
server.close();
fs.writeFileSync('out/mock-results.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1).slice(0, 6000));
