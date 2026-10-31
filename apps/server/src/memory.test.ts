import { PROTOCOL_VERSION } from '@city-link/protocol';
import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from './memory';

describe('内存后端', () => {
  it('每个请求有不同的编号', async () => {
    const call = createMemoryBackend();
    const request = { action: 'ping', protocolVersion: PROTOCOL_VERSION };

    const first = await call(request);
    const second = await call(request);

    expect(first.ok).toBe(true);
    expect(first.requestId).not.toBe(second.requestId);
  });
});
