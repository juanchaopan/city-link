// 替换 yoga-layout/load：微信不能从 base64 实例化 wasm，只能用 WXWebAssembly 从代码包路径加载。
import loadYogaImpl from 'yoga-layout/dist/binaries/yoga-wasm-base64-esm.js';
import wrapAssembly from 'yoga-layout/dist/src/wrapAssembly.js';

export async function loadYoga() {
  const assembly = await loadYogaImpl({
    instantiateWasm(imports, success) {
      WXWebAssembly.instantiate('wasm/yoga.wasm', imports).then((result) => {
        success(result.instance ?? result);
      });
      return {};
    },
  });
  return wrapAssembly(assembly);
}

export * from 'yoga-layout/dist/src/generated/YGEnums.js';
