import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from '@city-link/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { OpsService } from '../modules/ops';
import { createRouter } from './router';

const caller = { openid: 'player', requestId: 'request-1' };
const ops: OpsService = { ping: () => ({ serverTime: 42 }) };

describe('入口路由', () => {
  it('把 ping 路由到 ops 模块', async () => {
    const handle = createRouter({ ops });

    const response = await handle({ action: 'ping', protocolVersion: PROTOCOL_VERSION }, caller);

    expect(response).toEqual({ ok: true, data: { serverTime: 42 }, requestId: 'request-1' });
  });

  it('拒绝不合法的请求', async () => {
    const handle = createRouter({ ops });

    await expect(handle({ action: 'ping' }, caller)).resolves.toEqual({
      ok: false,
      code: 'BAD_REQUEST',
      requestId: 'request-1',
    });
    await expect(
      handle({ action: 'unknown', protocolVersion: PROTOCOL_VERSION }, caller),
    ).resolves.toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('要求过旧的客户端更新，即使它用的 action 已经不存在', async () => {
    const handle = createRouter({ ops });
    const protocolVersion = MIN_PROTOCOL_VERSION - 1;

    await expect(handle({ action: 'ping', protocolVersion }, caller)).resolves.toMatchObject({
      code: 'CLIENT_OUTDATED',
    });
    await expect(handle({ action: 'removed', protocolVersion }, caller)).resolves.toMatchObject({
      code: 'CLIENT_OUTDATED',
    });
  });

  it('未知错误不把细节返回给客户端', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: OpsService = {
      ping: () => {
        throw new Error('数据库密码是 123');
      },
    };
    const handle = createRouter({ ops: broken });

    const response = await handle({ action: 'ping', protocolVersion: PROTOCOL_VERSION }, caller);

    expect(response).toEqual({ ok: false, code: 'INTERNAL', requestId: 'request-1' });
    expect(log).toHaveBeenCalledOnce();
  });
});
