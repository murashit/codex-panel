import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import type { ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { ChatSharedResources } from "./shared-resources";

type ChatSelector<Selection> = (state: ChatState) => Selection;
type SelectionEquality<Selection> = (left: Selection, right: Selection) => boolean;

interface SelectionCache<Selection> {
  store: ChatStateStore;
  selector: ChatSelector<Selection>;
  state: ChatState;
  selection: Selection;
}

export function useChatSelector<Selection extends object>(
  store: ChatStateStore,
  selector: ChatSelector<Selection>,
  equality: SelectionEquality<Selection> = shallowEqual,
): Selection {
  const cacheRef = useRef<SelectionCache<Selection> | null>(null);
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  const state = store.getState();
  const previous = cacheRef.current;
  const selection = selectionFor(previous, store, selector, state, equality);
  cacheRef.current = { store, selector, state, selection };

  useLayoutEffect(() => {
    let active = true;
    const update = (): void => {
      if (!active) return;
      const current = cacheRef.current;
      if (!current || current.store !== store || current.selector !== selector) return;
      const nextState = store.getState();
      if (nextState === current.state) return;
      const nextSelection = selector(nextState);
      if (equality(current.selection, nextSelection)) {
        cacheRef.current = { store, selector, state: nextState, selection: current.selection };
        return;
      }
      cacheRef.current = { store, selector, state: nextState, selection: nextSelection };
      rerender(undefined);
    };

    const unsubscribe = store.subscribe(update);
    update();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, selector, equality]);

  return selection;
}

export function useComposedChatSelector<Selection extends object>(
  store: ChatStateStore,
  shared: ChatSharedResources,
  selector: (state: ChatState, shared: ChatSharedResources) => Selection,
  equality: SelectionEquality<Selection> = shallowEqual,
): Selection {
  const sharedRef = useRef(shared);
  const selectorRef = useRef(selector);
  const selectionRef = useRef(selector(store.getState(), shared));
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  if (sharedRef.current !== shared || selectorRef.current !== selector) {
    sharedRef.current = shared;
    selectorRef.current = selector;
    const next = selector(store.getState(), shared);
    if (!equality(selectionRef.current, next)) selectionRef.current = next;
  }

  useLayoutEffect(() => {
    let active = true;
    const update = (): void => {
      if (!active) return;
      const next = selectorRef.current(store.getState(), sharedRef.current);
      if (equality(selectionRef.current, next)) return;
      selectionRef.current = next;
      rerender(undefined);
    };
    const unsubscribe = store.subscribe(update);
    update();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, equality]);

  return selectionRef.current;
}

function selectionFor<Selection extends object>(
  previous: SelectionCache<Selection> | null,
  store: ChatStateStore,
  selector: ChatSelector<Selection>,
  state: ChatState,
  equality: SelectionEquality<Selection>,
): Selection {
  if (previous?.store === store && previous.selector === selector) {
    if (previous.state === state) return previous.selection;
    const next = selector(state);
    return equality(previous.selection, next) ? previous.selection : next;
  }
  return selector(state);
}

function shallowEqual(left: object, right: object): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.is(left[key as keyof typeof left], right[key as keyof typeof right]));
}
