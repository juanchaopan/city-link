import { defineConfig } from 'vitest/config';
import wechat from './config/wechat.json' with { type: 'json' };
import { wxTarget } from './vite/wx-target.ts';

const MAIN_PACKAGE_LIMIT_BYTES = 4 * 1024 * 1024;

// 网页版用于本地开发、PR 预览和截图回归；--mode wx 打出微信开发者工具能打开的小游戏目录。
export default defineConfig(({ mode }) => {
  if (mode === 'wx') {
    return {
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        __CLOUD_ENV__: JSON.stringify(wechat.cloudEnv),
      },
      plugins: [wxTarget({ ...wechat, mainPackageLimitBytes: MAIN_PACKAGE_LIMIT_BYTES })],
      build: {
        outDir: 'dist/wx',
        target: 'es2018',
        lib: {
          entry: 'src/main.wx.ts',
          formats: ['iife' as const],
          name: 'cityLink',
          fileName: () => 'game.js',
        },
      },
    };
  }

  return {
    build: {
      outDir: 'dist/web',
      target: 'es2022',
      rolldownOptions: { input: { main: 'index.html', gallery: 'gallery.html' } },
    },
    test: { include: ['src/**/*.test.ts'] },
  };
});
