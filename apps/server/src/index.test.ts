import { PROTOCOL_VERSION } from '@city-link/protocol';
import { describe, expect, it, vi } from 'vitest';
import { main } from './index';

vi.mock('wx-server-sdk', () => ({
  default: {
    DYNAMIC_CURRENT_ENV: 'current',
    init: vi.fn(),
    getWXContext: () => ({ OPENID: 'player-openid' }),
  },
}));

describe('云函数入口', () => {
  it('响应 ping 并带上平台的请求编号', async () => {
    const response = await main(
      { action: 'ping', protocolVersion: PROTOCOL_VERSION },
      { request_id: 'request-1' },
    );

    expect(response).toMatchObject({ ok: true, requestId: 'request-1' });
  });
});
