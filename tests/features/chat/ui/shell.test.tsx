// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { useEffect } from "preact/hooks";

import { chatTurnBusy, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";
import { renderUiRoot } from "../../../../src/shared/ui/ui-root";
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
    expect(container.textContent).toContain("Idle");
    expect(container.textContent).toContain("0");
    expect(container.textContent).toContain("ready");
    expect(container.querySelector(".codex-panel__slot--config")).toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("updates rendered slot content when the store changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    await act(async () => {
      store.dispatch({ type: "status/set", status: "Working" });
      await settleShellEffects();
    });

    expect(container.textContent).toContain("Working");

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

  it("unmounts existing slot roots before rebuilding a damaged shell scaffold", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = trackedRootShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    container.querySelector<HTMLElement>(":scope > .codex-panel__body")?.remove();

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    expect(cleanup).toHaveBeenCalledWith("toolbar");
    expect(container.textContent).toContain("toolbar");
    expect(container.textContent).toContain("messages");
    expect(container.textContent).toContain("composer");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("unmounts every slot root when the shell unmounts", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = trackedRootShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    await act(async () => {
      unmountChatPanelShell(container);
      await settleShellEffects();
    });

    expect(cleanup).toHaveBeenCalledWith("toolbar");
    expect(cleanup).toHaveBeenCalledWith("messages");
    expect(cleanup).toHaveBeenCalledWith("composer");
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
        renderUiRoot(
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
        renderUiRoot(messages, <div className="test-messages">{String(store.getState().displayItems.length)}</div>);
      }),
      snapshot: () => store.getState().displayItems.length,
    },
    composer: {
      render: vi.fn((composer: HTMLElement) => {
        renderUiRoot(
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

function trackedRootShellRenderers(store: ReturnType<typeof createChatStateStore>, cleanup: (slot: string) => void) {
  return {
    stateStore: store,
    renderVersion: 0,
    toolbar: {
      render: vi.fn((toolbar: HTMLElement) => {
        renderUiRoot(toolbar, <TrackedSlot slot="toolbar" cleanup={cleanup} />);
      }),
      snapshot: () => store.getState().status,
    },
    messages: {
      render: vi.fn((messages: HTMLElement) => {
        renderUiRoot(messages, <TrackedSlot slot="messages" cleanup={cleanup} />);
      }),
      snapshot: () => store.getState().displayItems.length,
    },
    composer: {
      render: vi.fn((composer: HTMLElement) => {
        renderUiRoot(composer, <TrackedSlot slot="composer" cleanup={cleanup} />);
      }),
      snapshot: () => chatTurnBusy(store.getState()),
    },
  };
}

function TrackedSlot({ slot, cleanup }: { slot: string; cleanup: (slot: string) => void }) {
  useEffect(() => {
    return () => {
      cleanup(slot);
    };
  }, [cleanup, slot]);
  return <div>{slot}</div>;
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
