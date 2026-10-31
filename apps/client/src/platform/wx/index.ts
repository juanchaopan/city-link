import type { ICanvas } from 'pixi.js';
import type { Platform, SafeInsets } from '../types';
import { screenCanvas, windowInfo } from './env';
import { connectTouches } from './touches';

declare const __CLOUD_ENV__: string;

const CLOUD_FUNCTION = 'game';

// 顶部要避开刘海和右上角的胶囊按钮，底部要避开 Home 指示条。
function safeInsets(): SafeInsets {
  const { safeArea, windowHeight } = windowInfo;
  return {
    top: Math.max(safeArea.top, wx.getMenuButtonBoundingClientRect().bottom),
    bottom: Math.max(0, windowHeight - safeArea.bottom),
  };
}

export function createWxPlatform(): Platform {
  wx.cloud.init({ env: __CLOUD_ENV__ });
  const canvas = screenCanvas as unknown as ICanvas;

  return {
    canvas,
    viewport: () => ({
      width: windowInfo.windowWidth,
      height: windowInfo.windowHeight,
      resolution: windowInfo.pixelRatio,
    }),
    safeInsets,
    callGame: async (request) => {
      const { result } = await wx.cloud.callFunction({ name: CLOUD_FUNCTION, data: request });
      return result;
    },
    connectInput: (renderer) => {
      connectTouches(renderer.events, canvas);
    },
  };
}
