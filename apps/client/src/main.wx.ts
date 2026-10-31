import './platform/wx/env';
import 'pixi.js/unsafe-eval';
import { DOMAdapter } from 'pixi.js';
import { startApp } from './app';
import { wxAdapter } from './platform/wx/adapter';
import { createWxPlatform } from './platform/wx';

DOMAdapter.set(wxAdapter);

startApp(createWxPlatform()).catch((error: unknown) => {
  console.error(error);
});
