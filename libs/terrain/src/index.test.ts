import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, MAP_SIZE } from './index';

describe('地图尺寸', () => {
  it('地图能被分块整除', () => {
    expect(MAP_SIZE % CHUNK_SIZE).toBe(0);
  });
});
