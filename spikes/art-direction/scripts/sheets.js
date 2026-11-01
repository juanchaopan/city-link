// 成品样张：play.html 的真实画面截下来拼成一张。node scripts/sheets.js [样张名...]，不写名字时全出；SIZE=64 出 64 城的。
// r8-viaduct-city：高架全景、上下匝道、高架跨路口、引道过渡、落地接干道，白天一排，夜里一排。
// r8-occlusion：匝道和灯杆、桥下的车、路口里的车和公交、车和建筑。
// r8-public：公共服务默认缩放和放大。r8-metro：地铁线路图和城市。r8-stations：地铁站厅和公交站。
// r8-traffic：交通视图全城、高架和选中一个物业。要先有 out/atlas-sunny.png。
// 市中心几处固定的取景位置按地图边长等比缩放，64 城和 128 城的布局是同一套比例。
// 每张样张单独开一次浏览器，截图一页一关，出完就退出，所以峰值内存只看一页游戏，和样张数量无关。
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { generateCity } from '../web/sim/city.js';
import { quote } from '../web/sim/expropriate.js';
import { startServer } from './serve.js';

const PORT = 4190;
const WIDTH = 520;
const HEIGHT = 640;
const N = Number(process.env.SIZE ?? 128);
const LOAD_TIMEOUT = 300000;
const CITY = `n=${String(N)}&controls=0`;
const BUSY = `${CITY}&warm=300&cars=300&full=1`;
const s = N / 64;
const at = (x, y) => `x=${String(Math.round(x * s))}&y=${String(Math.round(y * s))}`;
const wide = (zoom) => String(Math.round((zoom / s) * 1000) / 1000);

const city = generateCity(N);
const { x, row, top, terminal } = city.viaduct.route;
const { cx: teeX, cy: teeY } = city.plan.interchange;
const service = city.parcels.parcels.find(({ shape }) => shape === 'service');
const hall = city.metro.halls[Math.floor(city.metro.halls.length / 2)];
const stop = city.busStops[Math.floor(city.busStops.length / 2)];
const neighbor = city.parcels.parcels.find(
  ({ capacity, px, py }) => capacity > 0 && Math.hypot(px - hall.x, py - hall.y) < 4,
);
const bill = neighbor ? quote(neighbor.cells ?? [], city.parcels.parcels) : null;
const billText = bill
  ? `落到建筑上：拆 ${String(bill.buildings)} 栋，影响 ${String(bill.people)} 人，${String(bill.cost)}（临时值）`
  : '附近没有建筑';

const viaductShots = (hour) =>
  [
    ['全景', `zoom=0.2&x=${String(x + 1)}&y=${String(row - 3)}`],
    ['上下匝道', `zoom=0.55&x=${String(x + 1)}&y=${String(row)}`],
    ['高架跨路口', `zoom=0.6&x=${String(x)}&y=${String(row - 6)}`],
    ['引道过渡', `zoom=0.6&x=${String(x)}&y=${String(top + 3)}`],
    ['落地接横街', `zoom=0.6&x=${String(x)}&y=${String(terminal - 2)}`],
  ].map(([label, query]) => ({
    label: `${label} ${String(hour)} 点`,
    query: `${BUSY}&t=${String(hour)}&${query}`,
  }));

const SHEETS = {
  'r8-viaduct-city': { columns: 5, shots: [...viaductShots(12), ...viaductShots(22)] },
  'r8-occlusion': {
    columns: 3,
    shots: [
      { label: '灯杆和匝道', query: `${BUSY}&zoom=1&x=${String(teeX)}&y=${String(teeY + 4)}` },
      { label: '车在桥下穿过', query: `${BUSY}&zoom=1&x=${String(teeX)}&y=${String(teeY)}` },
      { label: '高架和桥下的车', query: `${BUSY}&zoom=1&x=${String(x)}&y=${String(row)}` },
      { label: '路口的车和公交', query: `${BUSY}&zoom=1.2&${at(23, 27)}` },
      { label: '车和建筑', query: `${BUSY}&zoom=1&${at(31, 27)}` },
      { label: '斜路路口', query: `${BUSY}&zoom=1&${at(29, 32)}` },
    ],
  },
  'r8-public': {
    columns: 3,
    shots: [
      { label: '默认缩放', query: `${CITY}&cars=0` },
      {
        label: '放大',
        query: `${CITY}&cars=0&zoom=0.5&x=${String(Math.round(service.px))}&y=${String(Math.round(service.py))}`,
      },
      {
        label: '公共服务视图',
        query: `${CITY}&cars=0&view=coverage&zoom=${wide(0.095)}&${at(31, 30)}`,
      },
    ],
  },
  'r8-metro': {
    columns: 2,
    shots: [
      { label: '线路图', query: `${CITY}&cars=0&view=metro&zoom=${wide(0.16)}&${at(31, 26)}` },
      { label: '环线转弯', query: `${CITY}&cars=0&view=metro&zoom=0.4&${at(34, 14)}` },
    ],
  },
  'r8-stations': {
    columns: 3,
    shots: [
      {
        label: '地铁站厅',
        query: `${BUSY}&zoom=0.9&x=${String(hall.x)}&y=${String(hall.y)}`,
      },
      {
        label: '公交站',
        query: `${BUSY}&zoom=1.1&x=${String(Math.round(stop.px))}&y=${String(Math.round(stop.py))}`,
      },
      {
        label: billText,
        query: `${BUSY}&zoom=0.6&x=${String(hall.x)}&y=${String(hall.y)}`,
      },
    ],
  },
  'r8-traffic': {
    columns: 3,
    shots: [
      { label: '全城', query: `${CITY}&cars=0&view=traffic&zoom=${wide(0.095)}&${at(31, 28)}` },
      {
        label: '高架和匝道',
        query: `${CITY}&cars=0&view=traffic&zoom=0.35&x=${String(x + 1)}&y=${String(row)}`,
      },
      {
        label: '点一个物业',
        query: `${CITY}&cars=0&view=traffic&zoom=0.2&${at(31, 30)}`,
        pick: [neighbor?.px ?? 30 * s, neighbor?.py ?? 30 * s],
      },
    ],
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(SHEETS);

async function capture(context, { query, pick }) {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('页面错误', error.message));
  await page.goto(`http://localhost:${String(PORT)}/web/play.html?${query}`, {
    timeout: LOAD_TIMEOUT,
  });
  await page.waitForSelector('html[data-ready="true"]', {
    state: 'attached',
    timeout: LOAD_TIMEOUT,
  });
  if (pick)
    console.log(
      '物业的车走的路段数',
      await page.evaluate((point) => window.pickParcel(...point), pick),
    );
  await page.waitForTimeout(900);
  const shot = await page.screenshot({ type: 'png' });
  await page.close();
  return shot.toString('base64');
}

async function assemble(context, images, columns) {
  const page = await context.newPage();
  const data = await page.evaluate(
    async ([list, across, width, height]) => {
      const canvas = document.createElement('canvas');
      canvas.width = across * (width + 8) + 8;
      canvas.height = Math.ceil(list.length / across) * (height + 8) + 8;
      const paint = canvas.getContext('2d');
      paint.fillStyle = '#20303a';
      paint.fillRect(0, 0, canvas.width, canvas.height);
      for (const [index, { label, data: base64 }] of list.entries()) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const x = 8 + (index % across) * (width + 8);
        const y = 8 + Math.floor(index / across) * (height + 8);
        paint.drawImage(image, x, y);
        paint.fillStyle = 'rgba(32, 48, 58, 0.8)';
        paint.fillRect(x, y, width, 34);
        paint.fillStyle = '#ffffff';
        paint.font = '700 20px "Microsoft YaHei"';
        paint.fillText(label, x + 8, y + 25);
      }
      return canvas.toDataURL('image/png');
    },
    [images, columns, WIDTH, HEIGHT],
  );
  await page.close();
  return data;
}

mkdirSync('out', { recursive: true });
const server = await startServer(PORT);
for (const name of names) {
  const { shots, columns } = SHEETS[name];
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const images = [];
  for (const shot of shots) images.push({ label: shot.label, data: await capture(context, shot) });
  const data = await assemble(context, images, columns);
  writeFileSync(`out/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(name, shots.length);
  await browser.close();
}
server.close();
