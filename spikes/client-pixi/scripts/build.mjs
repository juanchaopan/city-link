import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { build } from 'esbuild';

const here = process.cwd();
const yogaDir = path.join(here, 'node_modules/.pnpm/yoga-layout@3.2.1/node_modules/yoga-layout');
const flags = new Set(process.argv.slice(2));
const noUnsafeEval = flags.has('--no-unsafe-eval');
const nativeYoga = flags.has('--native-yoga');
const outdir = noUnsafeEval ? 'dist/wx-no-eval' : nativeYoga ? 'dist/wx-native-yoga' : 'dist/wx';

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(`${outdir}/assets`, { recursive: true });
fs.mkdirSync(`${outdir}/wasm`, { recursive: true });
fs.mkdirSync('dist/web/assets', { recursive: true });

const yogaBinary = fs.readFileSync(`${yogaDir}/dist/binaries/yoga-wasm-base64-esm.js`, 'utf8');
const base64 = yogaBinary.match(/data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/);
if (!base64) throw new Error('yoga base64 not found');
fs.writeFileSync(`${outdir}/wasm/yoga.wasm`, Buffer.from(base64[1], 'base64'));

const aliases = {
  plugins: [{
    name: 'yoga',
    setup(b) {
      if (!nativeYoga) {
        b.onResolve({ filter: /^yoga-layout\/load$/ }, () => ({ path: path.join(here, 'src/wx/yoga-load.js') }));
      }
      b.onResolve({ filter: /^yoga-layout\/dist\// }, (args) => ({
        path: path.join(yogaDir, args.path.replace('yoga-layout/', '')),
      }));
      b.onLoad({ filter: /yoga-wasm-base64-esm\.js$/ }, () => ({
        contents: nativeYoga ? yogaBinary : yogaBinary.replace(base64[1], ''),
        loader: 'js',
      }));
    },
  }],
};

let entry = fs.readFileSync('src/wx/game-entry.js', 'utf8');
if (noUnsafeEval) {
  entry = entry.replace("import 'pixi.js/unsafe-eval';\n", '');
  fs.writeFileSync('src/wx/game-entry.no-eval.js', entry);
}
const result = await build({
  entryPoints: [noUnsafeEval ? 'src/wx/game-entry.no-eval.js' : 'src/wx/game-entry.js'],
  bundle: true,
  format: 'iife',
  target: 'es2018',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['import', 'default'],
  minify: true,
  outfile: `${outdir}/game.js`,
  loader: { '.json': 'json', '.frag': 'text', '.vert': 'text', '.wgsl': 'text' },
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  ...aliases,
});
if (noUnsafeEval) fs.rmSync('src/wx/game-entry.no-eval.js');

await build({
  entryPoints: ['src/web/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: false,
  outfile: 'dist/web/main.js',
  loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"' },
});

fs.copyFileSync('data/assets/atlas.png', `${outdir}/assets/atlas.png`);
fs.copyFileSync('data/assets/atlas.png', 'dist/web/assets/atlas.png');
fs.writeFileSync('dist/web/index.html', '<!doctype html><html><body style="margin:0;background:#000"><canvas id="game"></canvas><script src="main.js"></script></body></html>');

fs.writeFileSync(`${outdir}/game.json`, JSON.stringify({ deviceOrientation: 'portrait', iOSHighPerformance: true, showStatusBar: false }, null, 2));
fs.writeFileSync(`${outdir}/project.config.json`, JSON.stringify({
  appid: 'touristappid',
  compileType: 'game',
  projectname: 'city-link-spike',
  setting: { es6: false, minified: false, urlCheck: false },
}, null, 2));

const size = (file) => fs.statSync(file).size;
const js = fs.readFileSync(`${outdir}/game.js`);
const report = {
  outdir,
  gameJsBytes: js.length,
  gameJsGzip: gzipSync(js).length,
  gameJsBrotli: brotliCompressSync(js).length,
  yogaWasmBytes: size(`${outdir}/wasm/yoga.wasm`),
  atlasBytes: size(`${outdir}/assets/atlas.png`),
  cityJsonBytes: size('data/city.json'),
  mainPackageBytes: js.length + size(`${outdir}/wasm/yoga.wasm`) + size(`${outdir}/game.json`),
  mainPackageWithAtlasBytes: js.length + size(`${outdir}/wasm/yoga.wasm`) + size(`${outdir}/game.json`) + size(`${outdir}/assets/atlas.png`),
};
const inputs = Object.entries(result.metafile.outputs[`${outdir}/game.js`].inputs)
  .map(([name, v]) => ({ name, bytes: v.bytesInOutput }));
const group = (needle) => inputs.filter((i) => i.name.includes(needle)).reduce((a, b) => a + b.bytes, 0);
report.byPackage = {
  pixi: group('pixi.js@'),
  pixiUi: group('@pixi+ui'),
  pixiLayout: group('@pixi+layout'),
  yogaGlue: group('yoga-layout@'),
  cityData: group('data/city.json') + group('data/atlas.json'),
};
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(`out/size-${path.basename(outdir)}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
void execFileSync;
