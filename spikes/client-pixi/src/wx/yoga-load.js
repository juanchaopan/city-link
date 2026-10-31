// 微信只允许从代码包路径实例化 wasm，这里替换 yoga-layout/load 的 base64 加载方式。
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
