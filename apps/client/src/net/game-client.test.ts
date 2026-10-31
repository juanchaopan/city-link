import { PROTOCOL_VERSION } from '@city-link/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createGameClient, GameRequestError } from './game-client';

describe('游戏接口客户端', () => {
  it('请求带协议版本，并返回校验过的结果', async () => {
    const call = vi.fn(() =>
      Promise.resolve({ ok: true, data: { serverTime: 7 }, requestId: 'a' }),
    );

    await expect(createGameClient(call).ping()).resolves.toEqual({ serverTime: 7 });
    expect(call).toHaveBeenCalledWith({ action: 'ping', protocolVersion: PROTOCOL_VERSION });
  });

  it('把失败响应转成带错误码的异常', async () => {
    const call = () => Promise.resolve({ ok: false, code: 'CLIENT_OUTDATED', requestId: 'b' });

    await expect(createGameClient(call).ping()).rejects.toMatchObject({
      constructor: GameRequestError,
      code: 'CLIENT_OUTDATED',
    });
  });

  it('拒绝不符合协议的响应', async () => {
    await expect(createGameClient(() => Promise.resolve({})).ping()).rejects.toThrow();
  });
});
