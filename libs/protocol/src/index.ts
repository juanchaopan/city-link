import { z } from 'zod';

// 微信禁止动态生成代码，zod 默认用 new Function 加速校验，在小游戏里会直接报错。
z.config({ jitless: true });

/** 当前协议版本。服务端兼容当前和上一版，更旧的客户端要提示更新。 */
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

export const errorCodeSchema = z.enum(['BAD_REQUEST', 'CLIENT_OUTDATED', 'INTERNAL']);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** 客户端只对这些错误自动重试，其余错误重试也不会成功。 */
export const RETRYABLE_ERRORS: readonly ErrorCode[] = ['INTERNAL'];

/** 每个请求都有的部分。先检查它，过旧的客户端才能收到更新提示，而不是格式错误。 */
export const requestEnvelopeSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
});

export const pingRequestSchema = requestEnvelopeSchema.extend({ action: z.literal('ping') });
export const pingResultSchema = z.object({ serverTime: z.number() });
export type PingResult = z.infer<typeof pingResultSchema>;

export const gameRequestSchema = z.discriminatedUnion('action', [pingRequestSchema]);
export type GameRequest = z.infer<typeof gameRequestSchema>;

export const gameResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown(), requestId: z.string() }),
  z.object({ ok: z.literal(false), code: errorCodeSchema, requestId: z.string() }),
]);
export type GameResponse = z.infer<typeof gameResponseSchema>;
