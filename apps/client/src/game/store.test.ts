import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('状态容器', () => {
  it('写入后通知订阅者', () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(2);

    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledWith(2);
  });

  it('取消订阅后不再通知', () => {
    const store = createStore(1);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set(2);

    expect(listener).not.toHaveBeenCalled();
  });
});
