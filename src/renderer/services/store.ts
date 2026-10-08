import { useSyncExternalStore } from 'react';

/** Minimal observable value for useSyncExternalStore; updates are by identity. */
export class Store<T> {
  private readonly listeners = new Set<() => void>();
  constructor(private value: T) {}
  readonly get = (): T => this.value;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }
  update(change: (value: T) => T): void {
    this.set(change(this.value));
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
