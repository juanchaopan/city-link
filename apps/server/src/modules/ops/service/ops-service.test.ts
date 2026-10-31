import { describe, expect, it } from 'vitest';
import { createOpsService } from './ops-service';

describe('运营服务', () => {
  it('ping 返回服务器时间', () => {
    expect(createOpsService(() => 1234).ping()).toEqual({ serverTime: 1234 });
  });
});
