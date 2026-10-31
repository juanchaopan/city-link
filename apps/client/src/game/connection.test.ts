import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameRequestError } from '../net/game-client';
import { checkConnection, type ConnectionState } from './connection';
import { createStore } from './store';

const stateAfter = async (ping: () => Promise<{ serverTime: number }>) => {
  const store = createStore<ConnectionState>('connecting');
  await checkConnection({ ping }, store);
  return store.get();
};

describe('连接检查', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('ping 成功时在线', async () => {
    await expect(stateAfter(() => Promise.resolve({ serverTime: 1 }))).resolves.toBe('online');
  });

  it('网络失败时离线，并留下原因', async () => {
    const reason = new Error('超时');

    await expect(stateAfter(() => Promise.reject(reason))).resolves.toBe('offline');
    expect(console.warn).toHaveBeenCalledWith('连接检查失败', reason);
  });

  it('协议过旧时要求更新', async () => {
    const outdated = new GameRequestError('CLIENT_OUTDATED', 'a');
    await expect(stateAfter(() => Promise.reject(outdated))).resolves.toBe('outdated');
  });
});
