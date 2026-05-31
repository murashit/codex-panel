// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import { chatTurnBusy, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";
import { renderReactRoot } from "../../../../src/shared/ui/react-root";
import { installObsidianDomShims } from "../../../support/dom";

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
    expect(container.querySelector(".codex-panel__slot--messages > .codex-panel__messages")).not.toBeNull();
    expect(container.querySelector(".codex-panel__slot--composer")?.textContent).toBe("ready");

    await act(async () => {
      unmountChatPanelShell(container);
    });
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

    await act(async () => {
      unmountChatPanelShell(container);
    });
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

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps nested root content mounted in its owning slot after shell rerenders", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = nestedRootShellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    await act(async () => {
      store.dispatch({ type: "status/set", status: "Working" });
      store.dispatch({ type: "ui/panel-set", panel: "model" });
      store.dispatch({ type: "system/message-added", item: { id: "system-1", kind: "system", role: "system", text: "Model set." } });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar .test-toolbar")?.textContent).toBe("Working");
    expect(container.querySelector(".codex-panel__slot--messages .test-messages")?.textContent).toBe("1");
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__slot--composer .test-composer textarea")?.value).toBe("ready");
    expect(container.querySelector(".codex-panel__slot--composer .test-toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__slot--composer .test-messages")).toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
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

    await act(async () => {
      unmountChatPanelShell(container);
    });
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
        composer.textContent = chatTurnBusy(store.getState()) ? "busy" : "ready";
      }),
      snapshot: () => chatTurnBusy(store.getState()),
    },
  };
}

function nestedRootShellRenderers(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    renderVersion: 0,
    toolbar: {
      render: vi.fn((toolbar: HTMLElement) => {
        renderReactRoot(
          toolbar,
          <>
            <div className="test-toolbar">{store.getState().status}</div>
            <div className="test-toolbar-panel">panel</div>
          </>,
        );
      }),
      snapshot: () => store.getState().status,
    },
    messages: {
      render: vi.fn((messages: HTMLElement) => {
        renderReactRoot(messages, <div className="test-messages">{String(store.getState().displayItems.length)}</div>);
      }),
      snapshot: () => store.getState().displayItems.length,
    },
    composer: {
      render: vi.fn((composer: HTMLElement) => {
        renderReactRoot(
          composer,
          <div className="test-composer">
            <textarea value={chatTurnBusy(store.getState()) ? "busy" : "ready"} readOnly />
            <button type="button">Send</button>
          </div>,
        );
      }),
      snapshot: () => chatTurnBusy(store.getState()),
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
