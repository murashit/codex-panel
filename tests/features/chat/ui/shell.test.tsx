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
    vi.mocked(renderers.toolbar.render).mockClear();
    vi.mocked(renderers.messages.render).mockClear();
    vi.mocked(renderers.composer.render).mockClear();

    await act(async () => {
      store.dispatch({ type: "status/set", status: "Working" });
      await settleShellEffects();
    });

    expect(renderers.toolbar.render).toHaveBeenCalledTimes(1);
    expect(renderers.messages.render).not.toHaveBeenCalled();
    expect(renderers.composer.render).not.toHaveBeenCalled();
    expect(container.querySelector(".codex-panel__toolbar")?.textContent).toBe("Working");

    unmountChatPanelShell(container);
  });

  it("forces all slots to rerender when the render version changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });
    vi.mocked(renderers.toolbar.render).mockClear();
    vi.mocked(renderers.messages.render).mockClear();
    vi.mocked(renderers.composer.render).mockClear();

    await act(async () => {
      renderChatPanelShell(container, { ...renderers, renderVersion: 1 });
      await settleShellEffects();
    });

    expect(renderers.toolbar.render).toHaveBeenCalledTimes(1);
    expect(renderers.messages.render).toHaveBeenCalledTimes(1);
    expect(renderers.composer.render).toHaveBeenCalledTimes(1);

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
    vi.mocked(renderers.toolbar.render).mockClear();

    unmountChatPanelShell(container);
    store.dispatch({ type: "status/set", status: "Closed" });
    await settleShellEffects();

    expect(renderers.toolbar.render).not.toHaveBeenCalled();
  });
});

function shellRenderers(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    renderVersion: 0,
    toolbar: {
      render: vi.fn((toolbar: HTMLElement) => {
        toolbar.textContent = store.getState().status;
      }),
      snapshot: () => store.getState().status,
    },
    messages: {
      render: vi.fn((messages: HTMLElement) => {
        messages.textContent = String(store.getState().displayItems.length);
      }),
      snapshot: () => store.getState().displayItems.length,
    },
    composer: {
      render: vi.fn((composer: HTMLElement) => {
        composer.textContent = store.getState().busy ? "busy" : "ready";
      }),
      snapshot: () => store.getState().busy,
    },
  };
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
