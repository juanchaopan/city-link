import { type GameClient, GameRequestError } from '../net/game-client';
import type { Store } from './store';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'outdated';

/** 启动时检查服务端和协议版本。失败时仍可进入游戏，操作留在本地队列。 */
export async function checkConnection(
  client: GameClient,
  store: Store<ConnectionState>,
): Promise<void> {
  store.set('connecting');
  try {
    await client.ping();
    store.set('online');
  } catch (error) {
    console.warn('连接检查失败', error);
    const outdated = error instanceof GameRequestError && error.code === 'CLIENT_OUTDATED';
    store.set(outdated ? 'outdated' : 'offline');
  }
}
