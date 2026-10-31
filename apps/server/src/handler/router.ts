import {
  type ErrorCode,
  gameRequestSchema,
  type GameRequest,
  type GameResponse,
  MIN_PROTOCOL_VERSION,
  requestEnvelopeSchema,
} from '@city-link/protocol';
import type { OpsService } from '../modules/ops';

export interface Caller {
  openid: string;
  requestId: string;
}

export interface Services {
  ops: OpsService;
}

export type GameHandler = (event: unknown, caller: Caller) => Promise<GameResponse>;

type ActionHandlers = {
  [A in GameRequest['action']]: (
    request: Extract<GameRequest, { action: A }>,
    services: Services,
  ) => unknown;
};

const actions: ActionHandlers = {
  ping: (_request, { ops }) => ops.ping(),
};

function failure(code: ErrorCode, { requestId }: Caller): GameResponse {
  return { ok: false, code, requestId };
}

function logError(action: string, { requestId }: Caller, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      action,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** 校验请求、路由到模块，并把未知错误收敛成只带 requestId 的失败响应。 */
export function createRouter(services: Services): GameHandler {
  return async (event, caller) => {
    const envelope = requestEnvelopeSchema.safeParse(event);
    if (!envelope.success) return failure('BAD_REQUEST', caller);
    if (envelope.data.protocolVersion < MIN_PROTOCOL_VERSION) {
      return failure('CLIENT_OUTDATED', caller);
    }

    const request = gameRequestSchema.safeParse(event);
    if (!request.success) return failure('BAD_REQUEST', caller);

    try {
      const data = await actions[request.data.action](request.data, services);
      return { ok: true, data, requestId: caller.requestId };
    } catch (error) {
      logError(request.data.action, caller, error);
      return failure('INTERNAL', caller);
    }
  };
}
