import { describe, expect, it } from 'vitest';
import {
  gameRequestSchema,
  gameResponseSchema,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  requestEnvelopeSchema,
} from './index';

describe('游戏协议', () => {
  it('当前版本不低于最低兼容版本', () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(MIN_PROTOCOL_VERSION);
  });

  it('接受带协议版本的 ping', () => {
    const request = { action: 'ping', protocolVersion: PROTOCOL_VERSION };
    expect(gameRequestSchema.parse(request)).toEqual(request);
  });

  it('拒绝未知 action 和缺少版本的请求', () => {
    expect(gameRequestSchema.safeParse({ action: 'drop', protocolVersion: 1 }).success).toBe(false);
    expect(gameRequestSchema.safeParse({ action: 'ping' }).success).toBe(false);
  });

  it('不认识的 action 也能读出协议版本', () => {
    const envelope = requestEnvelopeSchema.parse({ action: 'removed', protocolVersion: 0 });
    expect(envelope.protocolVersion).toBe(0);
  });

  it('区分成功和失败的响应', () => {
    const success = { ok: true, data: { serverTime: 1 }, requestId: 'a' };
    const failure = { ok: false, code: 'INTERNAL', requestId: 'b' };

    expect(gameResponseSchema.parse(success)).toEqual(success);
    expect(gameResponseSchema.parse(failure)).toEqual(failure);
    expect(gameResponseSchema.safeParse({ ok: false, requestId: 'c' }).success).toBe(false);
  });
});
