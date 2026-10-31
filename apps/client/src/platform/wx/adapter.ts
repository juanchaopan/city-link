import type { Adapter, ICanvas, ICanvasRenderingContext2D } from 'pixi.js';

// Pixi 用 instanceof 判断 WebGL 版本；微信的上下文不一定是全局类的实例，所以按能力判断。
const webGl1Probe = {
  [Symbol.hasInstance]: (context: object) => !('createVertexArray' in context),
};

function toResponse(statusCode: number, body: ArrayBuffer): Response {
  const response = {
    ok: statusCode < 400,
    status: statusCode,
    arrayBuffer: () => Promise.resolve(body),
  };
  return response as unknown as Response;
}

function request(input: RequestInfo): Promise<Response> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: typeof input === 'string' ? input : input.url,
      responseType: 'arraybuffer',
      dataType: 'other',
      success: ({ statusCode, data }) => {
        resolve(toResponse(statusCode, data as ArrayBuffer));
      },
      fail: (error) => {
        reject(new Error(error.errMsg));
      },
    });
  });
}

/** Pixi 的 DOM 适配：画布、图片和网络都走微信接口。 */
export const wxAdapter: Adapter = {
  createCanvas(width, height) {
    const canvas = wx.createCanvas() as unknown as ICanvas;
    if (width) canvas.width = width;
    if (height) canvas.height = height;
    return canvas;
  },
  createImage: () => wx.createImage() as unknown as HTMLImageElement,
  getCanvasRenderingContext2D: () =>
    ({ prototype: {} }) as unknown as new () => ICanvasRenderingContext2D,
  getWebGLRenderingContext: () => webGl1Probe as unknown as typeof WebGLRenderingContext,
  getNavigator: () => navigator,
  getBaseUrl: () => '',
  getFontFaceSet: () => null,
  fetch: request,
  parseXML: () => {
    throw new Error('微信环境不支持解析 XML');
  },
};
