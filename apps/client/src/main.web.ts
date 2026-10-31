import { createMemoryBackend } from '@city-link/server/memory';
import { startApp } from './app';
import { createWebPlatform } from './platform/web';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('页面里没有 #game 画布');

await startApp(createWebPlatform(canvas, createMemoryBackend()));
document.documentElement.dataset.ready = 'true';
