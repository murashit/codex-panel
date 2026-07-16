// @vitest-environment jsdom

import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { ChatState } from "../../../../src/features/chat/application/state/root-reducer";
import type { ChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { useChatSelector } from "../../../../src/features/chat/panel/chat-state-selector";
import {
  selectChatPanelComposer,
  selectChatPanelGoal,
  selectChatPanelThreadStream,
  selectChatPanelToolbar,
} from "../../../../src/features/chat/panel/shell-selectors";
import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/dom/preact-root.dom";
import { chatStateFixture, chatStateWith } from "../support/state";

describe("useChatSelector", () => {
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

  it("rerenders only the region whose selected state changed", async () => {
    const store = createChatStateStore();
    const renders = { toolbar: vi.fn(), goal: vi.fn(), threadStream: vi.fn(), composer: vi.fn() };
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <SelectorRegions store={store} renders={renders} />);
    });
    expect(regionRenderCounts(renders)).toEqual([1, 1, 1, 1]);

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "draft" });
    });
    expect(regionRenderCounts(renders)).toEqual([1, 1, 1, 2]);

    await act(async () => {
      store.dispatch({ type: "ui/goal-editor-started", threadId: null, objective: "Goal", tokenBudget: null });
    });
    expect(regionRenderCounts(renders)).toEqual([1, 2, 1, 2]);

    await act(async () => {
      store.dispatch({ type: "ui/panel-set", panel: "history" });
    });
    expect(regionRenderCounts(renders)).toEqual([2, 2, 1, 2]);

    await act(async () => {
      store.dispatch({ type: "ui/disclosure-set", bucket: "details", id: "item", open: true });
    });
    expect(regionRenderCounts(renders)).toEqual([2, 2, 2, 2]);

    await act(async () => {
      store.dispatch({
        type: "thread-stream/system-item-added",
        item: { id: "status", kind: "system", role: "system", text: "Status" },
      });
    });
    expect(regionRenderCounts(renders)).toEqual([2, 2, 3, 2]);

    await act(async () => {
      store.dispatch({
        type: "thread-stream/items-replaced",
        historyCursor: null,
        items: [{ id: "user", kind: "dialogue", dialogueKind: "user", role: "user", text: "Hello", turnId: "turn" }],
      });
    });
    expect(regionRenderCounts(renders)).toEqual([2, 2, 4, 3]);
    unmountUiRoot(parent);
  });
});

function ComposerValue({ store }: { store: ChatStateStore }): ComponentChild {
  return useChatSelector(store, selectChatPanelComposer).draft;
}

function SelectorRegions({
  store,
  renders,
}: {
  store: ChatStateStore;
  renders: Record<"toolbar" | "goal" | "threadStream" | "composer", Mock<() => void>>;
}): ComponentChild {
  return (
    <>
      <Region store={store} selector={selectChatPanelToolbar} rendered={renders.toolbar} />
      <Region store={store} selector={selectChatPanelGoal} rendered={renders.goal} />
      <Region store={store} selector={selectChatPanelThreadStream} rendered={renders.threadStream} />
      <Region store={store} selector={selectChatPanelComposer} rendered={renders.composer} />
    </>
  );
}

function Region<Selection extends object>({
  store,
  selector,
  rendered,
}: {
  store: ChatStateStore;
  selector: (state: ChatState) => Selection;
  rendered: Mock<() => void>;
}): ComponentChild {
  useChatSelector(store, selector);
  rendered();
  return null;
}

function regionRenderCounts(renders: {
  toolbar: Mock<() => void>;
  goal: Mock<() => void>;
  threadStream: Mock<() => void>;
  composer: Mock<() => void>;
}): number[] {
  return [renders.toolbar, renders.goal, renders.threadStream, renders.composer].map((rendered) => rendered.mock.calls.length);
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
