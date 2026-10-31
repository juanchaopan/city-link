import { describe, expect, it } from 'vitest';
import { SETTLEMENT_INTERVAL_MS, SYNC_INTERVAL_MS } from './index';

describe('同步和结算周期', () => {
  it('结算周期是同步周期的整数倍', () => {
    expect(SETTLEMENT_INTERVAL_MS % SYNC_INTERVAL_MS).toBe(0);
  });
});
