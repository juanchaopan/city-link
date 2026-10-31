import type { CallGame, Platform } from '../types';

export function createWebPlatform(canvas: HTMLCanvasElement, callGame: CallGame): Platform {
  const size = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    resolution: window.devicePixelRatio,
  });

  const { width, height } = size();
  canvas.style.width = `${String(width)}px`;
  canvas.style.height = `${String(height)}px`;

  return {
    canvas,
    viewport: size,
    safeInsets: () => ({ top: 0, bottom: 0 }),
    callGame,
    connectInput: () => undefined,
  };
}
