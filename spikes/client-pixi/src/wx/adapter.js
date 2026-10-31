import { info, screen } from './env.js';

// Pixi 用 instanceof 判断 WebGL 版本；微信的上下文不一定是全局类的实例，所以按能力判断。
class WebGL1Probe {
  static [Symbol.hasInstance](gl) {
    return !('createVertexArray' in gl);
  }
}

export const WxAdapter = {
  createCanvas(width, height) {
    const canvas = wx.createCanvas();
    if (width) canvas.width = width;
    if (height) canvas.height = height;
    return canvas;
  },
  createImage: () => wx.createImage(),
  getCanvasRenderingContext2D: () => ({ prototype: {} }),
  getWebGLRenderingContext: () => WebGL1Probe,
  getNavigator: () => globalThis.navigator,
  getBaseUrl: () => '',
  getFontFaceSet: () => null,
  fetch: (url) => new Promise((resolve, reject) => {
    wx.request({
      url: String(url),
      responseType: 'arraybuffer',
      dataType: 'other',
      success: (res) => resolve({
        ok: res.statusCode < 400,
        status: res.statusCode,
        arrayBuffer: async () => res.data,
      }),
      fail: reject,
    });
  }),
  parseXML() {
    throw new Error('parseXML is not available on WeChat');
  },
};

export const wxPlatform = {
  size: () => ({ width: info.windowWidth, height: info.windowHeight, resolution: info.pixelRatio }),
  mainCanvas: () => screen,
  now: () => globalThis.performance.now(),
  raf: (fn) => requestAnimationFrame(fn),
  loadImage: (path) => new Promise((resolve, reject) => {
    const image = wx.createImage();
    image.onload = () => resolve(image);
    image.onerror = (e) => reject(new Error(`image failed: ${path} ${e?.errMsg ?? ''}`));
    image.src = path;
  }),
};

// 把微信触摸事件转成 Pixi 事件系统能识别的指针数据。
export function connectTouches(renderer) {
  const events = renderer.events;
  const toPointer = (touch, type, primary) => ({
    type,
    pointerId: touch.identifier,
    pointerType: 'touch',
    isPrimary: primary,
    clientX: touch.clientX,
    clientY: touch.clientY,
    pageX: touch.clientX,
    pageY: touch.clientY,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    width: 1,
    height: 1,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    movementX: 0,
    movementY: 0,
    composedPath: () => [],
    preventDefault() {},
    target: screen,
    cancelable: false,
  });
  const dispatch = (list, type, handler) => {
    for (const touch of list.changedTouches) {
      handler.call(events, toPointer(touch, type, list.touches.length <= 1));
    }
  };
  wx.onTouchStart((e) => dispatch(e, 'pointerdown', events._onPointerDown));
  wx.onTouchMove((e) => dispatch(e, 'pointermove', events._onPointerMove));
  wx.onTouchEnd((e) => dispatch(e, 'pointerup', events._onPointerUp));
  wx.onTouchCancel((e) => dispatch(e, 'pointerup', events._onPointerUp));
}
