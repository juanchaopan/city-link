import { createRouter, type GameHandler } from './handler/router';
import { createOpsService } from './modules/ops';

export interface AppDependencies {
  now: () => number;
}

/** 组装全部模块。云函数和内存后端共用这里，只是传入的依赖不同。 */
export function createGameHandler({ now }: AppDependencies): GameHandler {
  return createRouter({ ops: createOpsService(now) });
}
