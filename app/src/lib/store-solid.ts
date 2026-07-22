// Solid <-> Zustand adapter: bridges the vanilla store into Solid reactivity.
import { createSignal, onCleanup } from 'solid-js';
import type { StoreApi } from 'zustand/vanilla';
import { appStore, type AppState } from './store';

export { appStore };
export type { AppState };

// subscribe to a slice of a vanilla store as a Solid accessor
function useSelector<T, S>(
  store: StoreApi<T>,
  selector: (state: T) => S,
  equals: (a: S, b: S) => boolean = Object.is,
): () => S {
  const [value, setValue] = createSignal<S>(selector(store.getState()));
  const unsub = store.subscribe((state) => {
    const next = selector(state);
    setValue((prev) => (equals(prev as S, next) ? (prev as S) : next));
  });
  onCleanup(unsub);
  return value;
}

// useSelector bound to the app store
export function useApp<S>(
  selector: (state: AppState) => S,
  equals?: (a: S, b: S) => boolean,
): () => S {
  return useSelector(appStore, selector, equals);
}

// access the store's actions without subscribing
export function actions(): AppState {
  return appStore.getState();
}
