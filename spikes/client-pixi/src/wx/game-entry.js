import './env.js';
import 'pixi.js/unsafe-eval';
import 'pixi.js/webworker';
import 'pixi.js/events';
import { DOMAdapter } from 'pixi.js';
import { connectTouches, WxAdapter, wxPlatform } from './adapter.js';
import { createGame } from '../game/game.js';

DOMAdapter.set(WxAdapter);

const options = globalThis.__spikeOptions ?? {};
createGame(wxPlatform, options).then((game) => {
  connectTouches(game.renderer);
  globalThis.__game = game;
  globalThis.__onGameReady?.(game);
}).catch((error) => {
  globalThis.__onGameError?.(error);
  console.error(error);
});
