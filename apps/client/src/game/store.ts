export interface Store<S> {
  get(): S;
  set(next: S): void;
  subscribe(listener: (state: S) => void): () => void;
}

/** 状态容器。模拟循环控制写入频率，渲染和界面只读取或订阅。 */
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();

  return {
    get: () => state,
    set(next) {
      state = next;
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
