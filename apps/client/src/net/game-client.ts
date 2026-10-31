import {
  type ErrorCode,
  gameResponseSchema,
  type GameRequest,
  type PingResult,
  pingResultSchema,
  PROTOCOL_VERSION,
} from '@city-link/protocol';
import type { CallGame } from '../platform/types';

export class GameRequestError extends Error {
  readonly code: ErrorCode;
  readonly requestId: string;

  constructor(code: ErrorCode, requestId: string) {
    super(`${code} (${requestId})`);
    this.name = 'GameRequestError';
    this.code = code;
    this.requestId = requestId;
  }
}

export interface GameClient {
  ping(): Promise<PingResult>;
}

async function send<T>(
  call: CallGame,
  request: GameRequest,
  parseResult: (data: unknown) => T,
): Promise<T> {
  const response = gameResponseSchema.parse(await call(request));
  if (!response.ok) throw new GameRequestError(response.code, response.requestId);
  return parseResult(response.data);
}

export function createGameClient(call: CallGame): GameClient {
  return {
    ping: () =>
      send(call, { action: 'ping', protocolVersion: PROTOCOL_VERSION }, (data) =>
        pingResultSchema.parse(data),
      ),
  };
}
