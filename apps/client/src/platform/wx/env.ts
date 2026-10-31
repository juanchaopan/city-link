// 微信环境没有 DOM。这里只补 Pixi 运行所需的最小全局对象，必须在导入 Pixi 之前执行。
const root = globalThis as unknown as Record<string, unknown>;

export const windowInfo = wx.getWindowInfo();

const canvas = wx.createCanvas() as WechatMinigame.Canvas & Record<string, unknown>;
canvas.width = windowInfo.windowWidth * windowInfo.pixelRatio;
canvas.height = windowInfo.windowHeight * windowInfo.pixelRatio;
canvas.style ??= {};
canvas.addEventListener ??= () => undefined;
canvas.removeEventListener ??= () => undefined;
// 没有 isConnected 时 Pixi 把触摸坐标按物理像素换算，点击位置会缩小 pixelRatio 倍。
canvas.isConnected = true;
canvas.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  x: 0,
  y: 0,
  width: windowInfo.windowWidth,
  height: windowInfo.windowHeight,
  right: windowInfo.windowWidth,
  bottom: windowInfo.windowHeight,
});

export const screenCanvas = canvas;

const wxPerformance = wx.getPerformance();

// 官方文档：wx.getPerformance().now() 以微秒为单位。
root.performance ??= { now: () => wxPerformance.now() / 1000 };
// @pixi/ui 在导入时用 userAgent 判断移动端，不是移动端时只监听鼠标事件，触摸点不到按钮。
root.navigator ??= { userAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile) wechat-minigame' };
root.document ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
root.addEventListener ??= () => undefined;
root.removeEventListener ??= () => undefined;
root.WebAssembly ??= root.WXWebAssembly;
