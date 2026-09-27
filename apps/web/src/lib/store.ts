import { useSyncExternalStore } from 'react';

/** Minimal observable value for React (useSyncExternalStore). */
export class Store<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of this.listeners) l();
  }

  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
