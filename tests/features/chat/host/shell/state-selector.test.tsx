// @vitest-environment jsdom

import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import type { ChatState } from "../../../../../src/features/chat/application/state/model";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { RuntimeSnapshot } from "../../../../../src/features/chat/domain/runtime/snapshot";
import { selectChatPanelComposer } from "../../../../../src/features/chat/host/composer/view-projection";
import { useChatSelector } from "../../../../../src/features/chat/host/shell/state-selector";
import { selectChatPanelToolbar } from "../../../../../src/features/chat/host/toolbar/view-projection";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { chatSharedResourcesFixture, composerSharedValues, toolbarSharedValues } from "../../support/shared-display-values";
import { chatStateFixture, chatStateWith } from "../../support/state";

const shared = chatSharedResourcesFixture();
const composerSelector = (state: ChatState) => selectChatPanelComposer(state, composerSharedValues(shared));

describe("useChatSelector", () => {
  it.each([
    ["composer", composerSelector],
    ["toolbar", (state: ChatState) => selectChatPanelToolbar(state, toolbarSharedValues(shared))],
  ] as const)("keeps %s runtime selection stable until displayed values change", async (_area, selector) => {
    const store = controllableStore(chatStateFixture());
    const parent = document.createElement("div");
    let renders = 0;
    function RuntimeValue(): ComponentChild {
      renders += 1;
      return useChatSelector<RuntimeSnapshot>(store, selector).active.model;
    }
    await act(async () => renderUiRoot(parent, <RuntimeValue />));
    const initialRenders = renders;
    await act(async () => store.replace({ ...store.getState() }));
    expect(renders).toBe(initialRenders);
    const state = store.getState();
    await act(async () =>
      store.replace({ ...state, runtime: { ...state.runtime, active: { ...state.runtime.active, model: "updated-model" } } }),
    );
    expect(parent.textContent).toBe("updated-model");
    unmountUiRoot(parent);
  });

  it("catches an update between the render read and subscription", async () => {
    const initial = chatStateFixture();
    const updated = chatStateWith(initial, { composer: { draft: "after subscribe" } });
    const store = controllableStore(initial, (current) => {
      current.replaceWithoutNotification(updated);
    });
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <ComposerValue store={store} />);
    });

    expect(parent.textContent).toBe("after subscribe");
    unmountUiRoot(parent);
  });

  it("unsubscribes on unmount", async () => {
    const store = controllableStore(chatStateFixture());
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <ComposerValue store={store} />);
    });
    expect(store.listenerCount()).toBe(1);

    await act(async () => {
      unmountUiRoot(parent);
    });
    expect(store.listenerCount()).toBe(0);
  });

  it("moves the subscription when the store is replaced", async () => {
    const first = controllableStore(chatStateWith(chatStateFixture(), { composer: { draft: "first" } }));
    const second = controllableStore(chatStateWith(chatStateFixture(), { composer: { draft: "second" } }));
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <ComposerValue store={first} />);
      renderUiRoot(parent, <ComposerValue store={second} />);
    });

    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
    expect(parent.textContent).toBe("second");

    await act(async () => {
      first.replace(chatStateWith(first.getState(), { composer: { draft: "stale" } }));
      second.replace(chatStateWith(second.getState(), { composer: { draft: "current" } }));
    });
    expect(parent.textContent).toBe("current");
    unmountUiRoot(parent);
  });
});

function ComposerValue({ store }: { store: ChatStateStore }): ComponentChild {
  return useChatSelector(store, composerSelector).draft;
}

interface ControllableStore extends ChatStateStore {
  listenerCount(): number;
  replace(state: ChatState): void;
  replaceWithoutNotification(state: ChatState): void;
}

function controllableStore(initialState: ChatState, onSubscribe?: (store: ControllableStore) => void): ControllableStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  const store: ControllableStore = {
    getState: () => state,
    dispatch: () => state,
    subscribe(listener) {
      listeners.add(listener);
      onSubscribe?.(store);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    replace(nextState) {
      state = nextState;
      for (const listener of listeners) listener();
    },
    replaceWithoutNotification(nextState) {
      state = nextState;
    },
  };
  return store;
}
