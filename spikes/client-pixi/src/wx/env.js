// 微信环境没有 DOM。这里只补 Pixi 运行所需的最小全局对象，必须最先执行。
const info = wx.getWindowInfo();
const screen = wx.createCanvas();
screen.width = info.windowWidth * info.pixelRatio;
screen.height = info.windowHeight * info.pixelRatio;
screen.style = screen.style ?? {};
screen.addEventListener = screen.addEventListener ?? (() => {});
screen.removeEventListener = screen.removeEventListener ?? (() => {});
// 没有 isConnected 时 Pixi 把触摸坐标按物理像素换算，点击位置会缩小 pixelRatio 倍。
screen.isConnected = true;
screen.getBoundingClientRect = () => ({
  left: 0, top: 0, x: 0, y: 0, width: info.windowWidth, height: info.windowHeight,
  right: info.windowWidth, bottom: info.windowHeight,
});

const wxPerformance = wx.getPerformance();
const root = globalThis;

if (typeof root.performance === 'undefined') {
  // 官方文档：wx.getPerformance().now() 以微秒为单位。
  root.performance = { now: () => wxPerformance.now() / 1000 };
}
if (typeof root.navigator === 'undefined') {
  // @pixi/ui 在导入时用 userAgent 判断移动端，不是移动端时只监听鼠标事件，触摸点不到按钮。
  root.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13; Mobile) wechat-minigame', gpu: null };
}
if (typeof root.document === 'undefined') {
  root.document = { addEventListener() {}, removeEventListener() {} };
}
root.addEventListener = root.addEventListener ?? (() => {});
root.removeEventListener = root.removeEventListener ?? (() => {});
if (typeof root.WebAssembly === 'undefined' && typeof root.WXWebAssembly !== 'undefined') {
  root.WebAssembly = root.WXWebAssembly;
}

export { info, screen };
