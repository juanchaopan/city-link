import type { GameResponse } from '@city-link/protocol';
import { createGameHandler } from './app';

const LOCAL_OPENID = 'local-player';

export type MemoryBackend = (request: unknown) => Promise<GameResponse>;

/** 在浏览器进程里运行的内存后端，供本地开发、PR 预览和测试使用。 */
export function createMemoryBackend(): MemoryBackend {
  const handle = createGameHandler({ now: () => Date.now() });
  let requestCount = 0;

  return (request) => {
    requestCount += 1;
    return handle(request, { openid: LOCAL_OPENID, requestId: `local-${String(requestCount)}` });
  };
}
