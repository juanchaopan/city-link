// 把 game 云函数打成一个文件。wx-server-sdk 由云端安装，所以不进包。
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const OUT_DIR = 'dist/game';
const { version, dependencies } = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: `${OUT_DIR}/index.js`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['wx-server-sdk'],
});

copyFileSync('cloud/config.json', `${OUT_DIR}/config.json`);
writeFileSync(
  `${OUT_DIR}/package.json`,
  `${JSON.stringify(
    {
      name: 'game',
      version,
      private: true,
      main: 'index.js',
      dependencies: { 'wx-server-sdk': dependencies['wx-server-sdk'] },
    },
    null,
    2,
  )}\n`,
);
