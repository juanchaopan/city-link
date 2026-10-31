import type { PingResult } from '@city-link/protocol';

export interface OpsService {
  ping(): PingResult;
}

export function createOpsService(now: () => number): OpsService {
  return {
    ping: () => ({ serverTime: now() }),
  };
}
