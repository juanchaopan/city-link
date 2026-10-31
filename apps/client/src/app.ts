import { checkConnection, type ConnectionState } from './game/connection';
import { createStore } from './game/store';
import { createGameClient } from './net/game-client';
import type { Platform } from './platform/types';
import { createStage } from './render/stage';
import { createBootScreen } from './ui/boot-screen';
import { tokens } from './ui/tokens';

/** 组装各层并启动。网页版和微信版共用这里，只是传入的 platform 不同。 */
export async function startApp(platform: Platform): Promise<void> {
  const app = await createStage(platform, tokens.color.background);
  const connection = createStore<ConnectionState>('connecting');
  const { width, height } = platform.viewport();
  const { top, bottom } = platform.safeInsets();

  app.stage.addChild(
    createBootScreen({ width, height, insetTop: top, insetBottom: bottom }, connection),
  );
  await checkConnection(createGameClient(platform.callGame), connection);
}
