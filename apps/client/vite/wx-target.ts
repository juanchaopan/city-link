import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const YOGA_DIR = path.resolve('node_modules/yoga-layout');
const YOGA_WASM_GLUE = 'yoga-wasm-base64-esm.js';
const YOGA_BASE64 = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/;
const YOGA_LOAD_WX = path.resolve('vite/yoga-load.wx.js');

export interface WxTargetOptions {
  appId: string;
  projectName: string;
  mainPackageLimitBytes: number;
}

function yogaGluePath(): string {
  return path.join(YOGA_DIR, 'dist/binaries', YOGA_WASM_GLUE);
}

function yogaWasm(): Buffer {
  const base64 = YOGA_BASE64.exec(readFileSync(yogaGluePath(), 'utf8'))?.[1];
  if (!base64) throw new Error('yoga-layout 的 wasm 数据没有找到，升级 yoga-layout 后要重新适配');
  return Buffer.from(base64, 'base64');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 微信只允许从代码包路径实例化 wasm，所以把 yoga 的 base64 拆成独立文件，
 * 再写出小游戏目录需要的配置文件，并检查主包大小。
 */
export function wxTarget({ appId, projectName, mainPackageLimitBytes }: WxTargetOptions): Plugin {
  let outDir = 'dist/wx';

  return {
    name: 'city-link:wx-target',
    enforce: 'pre',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    resolveId(source) {
      if (source === 'yoga-layout/load') return YOGA_LOAD_WX;
      if (source.startsWith('yoga-layout/dist/')) {
        return path.join(YOGA_DIR, source.slice('yoga-layout/'.length));
      }
      return null;
    },
    load(id) {
      if (!id.endsWith(YOGA_WASM_GLUE)) return null;
      return readFileSync(id, 'utf8')
        .replace(YOGA_BASE64, 'data:application/octet-stream;base64,')
        .replace('import.meta.url', '""');
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'wasm/yoga.wasm', source: yogaWasm() });
      this.emitFile({
        type: 'asset',
        fileName: 'game.json',
        source: json({
          deviceOrientation: 'portrait',
          iOSHighPerformance: true,
          showStatusBar: false,
        }),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'project.config.json',
        source: json({
          appid: appId,
          compileType: 'game',
          projectname: projectName,
          setting: { es6: false, minified: false, urlCheck: false },
        }),
      });
    },
    writeBundle() {
      const bytes = ['game.js', 'game.json', 'wasm/yoga.wasm']
        .map((file) => statSync(path.join(outDir, file)).size)
        .reduce((total, size) => total + size, 0);
      if (bytes > mainPackageLimitBytes) {
        throw new Error(
          `主包 ${String(bytes)} 字节，超过上限 ${String(mainPackageLimitBytes)} 字节`,
        );
      }
      console.log(`微信主包：${(bytes / 1024 / 1024).toFixed(2)} MB`);
    },
  };
}
