import 'pixi.js/webworker';
import 'pixi.js/events';
import '@pixi/layout';
import { Application } from 'pixi.js';
import type { Platform } from '../platform/types';

/** 创建 Pixi 应用。画布和尺寸来自 platform，两端的绘制代码完全相同。 */
export async function createStage(platform: Platform, background: number): Promise<Application> {
  const { width, height, resolution } = platform.viewport();
  const app = new Application();

  await app.init({
    skipExtensionImports: true,
    canvas: platform.canvas,
    width,
    height,
    resolution,
    antialias: false,
    backgroundColor: background,
    preferWebGLVersion: 2,
    hello: false,
  });
  platform.connectInput(app.renderer);

  return app;
}
