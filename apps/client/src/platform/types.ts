import type { GameRequest } from '@city-link/protocol';
import type { ICanvas, Renderer } from 'pixi.js';

export interface Viewport {
  width: number;
  height: number;
  resolution: number;
}

export interface SafeInsets {
  top: number;
  bottom: number;
}

export type CallGame = (request: GameRequest) => Promise<unknown>;

/** 微信和网页各实现一份，上层只依赖这个接口。 */
export interface Platform {
  readonly canvas: ICanvas;
  viewport(): Viewport;
  safeInsets(): SafeInsets;
  callGame: CallGame;
  connectInput(renderer: Renderer): void;
}
