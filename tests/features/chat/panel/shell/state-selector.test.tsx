// @vitest-environment jsdom

import type { ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import type { ChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  selectChatPanelComposer,
  selectChatPanelGoal,
  selectChatPanelThreadStream,
  selectChatPanelToolbar,
} from "../../../../../src/features/chat/panel/shell/selectors";
import { useChatSelector } from "../../../../../src/features/chat/panel/shell/state-selector";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { chatStateFixture, chatStateWith } from "../../support/state";

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

  it("isolates stream and composer updates to their subscribed regions", async () => {
    const store = createChatStateStore();
    const renders = { toolbar: vi.fn(), goal: vi.fn(), threadStream: vi.fn(), composer: vi.fn() };
    const parent = document.createElement("div");

    await act(async () => {
      renderUiRoot(parent, <SelectorRegions store={store} renders={renders} />);
    });
    clearRegionRenders(renders);

    await act(async () => {
      store.dispatch({
        type: "thread-stream/system-item-added",
        item: { id: "status", kind: "system", role: "system", text: "Status" },
      });
    });
    expect(renderedRegions(renders)).toEqual(["threadStream"]);
    clearRegionRenders(renders);

    await act(async () => {
      store.dispatch({ type: "composer/draft-set", draft: "draft" });
    });
    expect(renderedRegions(renders)).toEqual(["composer"]);
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

type RegionRenders = {
  toolbar: Mock<() => void>;
  goal: Mock<() => void>;
  threadStream: Mock<() => void>;
  composer: Mock<() => void>;
};

function clearRegionRenders(renders: RegionRenders): void {
  for (const rendered of Object.values(renders)) rendered.mockClear();
}

function renderedRegions(renders: RegionRenders): string[] {
  return Object.entries(renders).flatMap(([region, rendered]) => (rendered.mock.calls.length > 0 ? [region] : []));
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
