// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";

import { createChatStateStore } from "../../../../src/features/chat/chat-state";
import { renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";
import { installObsidianDomShims } from "./dom-test-helpers";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatPanelShell", () => {
  it("renders the panel slots on the existing view content element", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellRenderers(store));
      await settleShellEffects();
    });

    expect(container.classList.contains("codex-panel")).toBe(true);
    expect(container.querySelector(".codex-panel__toolbar")?.textContent).toBe("Idle");
    expect(container.querySelector(".codex-panel__body")).not.toBeNull();
    expect(container.querySelector(".codex-panel__slot--config")).not.toBeNull();
    expect(container.querySelector(".codex-panel__slot--messages")?.textContent).toBe("0");
    expect(container.querySelector(".codex-panel__slot--composer")?.textContent).toBe("ready");

    unmountChatPanelShell(container);
  });

  it("rerenders child slots when the subscribed store changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });
    vi.mocked(renderers.renderToolbar).mockClear();
    vi.mocked(renderers.renderMessages).mockClear();
    vi.mocked(renderers.renderComposer).mockClear();

    await act(async () => {
      store.dispatch({ type: "status/set", status: "Working" });
      await settleShellEffects();
    });

    expect(renderers.renderToolbar).toHaveBeenCalledTimes(1);
    expect(renderers.renderMessages).toHaveBeenCalledTimes(1);
    expect(renderers.renderComposer).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".codex-panel__toolbar")?.textContent).toBe("Working");

    unmountChatPanelShell(container);
  });

  it("stops subscribed slot rendering after unmount", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });
    vi.mocked(renderers.renderToolbar).mockClear();

    unmountChatPanelShell(container);
    store.dispatch({ type: "status/set", status: "Closed" });
    await settleShellEffects();

    expect(renderers.renderToolbar).not.toHaveBeenCalled();
  });
});

function shellRenderers(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    renderToolbar: vi.fn((toolbar: HTMLElement) => {
      toolbar.textContent = store.getState().status;
    }),
    renderMessages: vi.fn((messages: HTMLElement) => {
      messages.textContent = String(store.getState().displayItems.length);
    }),
    renderComposer: vi.fn((composer: HTMLElement) => {
      composer.textContent = store.getState().busy ? "busy" : "ready";
    }),
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
