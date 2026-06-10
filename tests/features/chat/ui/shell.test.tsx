// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { useEffect } from "preact/hooks";

import { chatTurnBusy, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { renderChatPanelShell, unmountChatPanelShell } from "../../../../src/features/chat/ui/shell";
import { installObsidianDomShims } from "../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatPanelShell", () => {
  it("renders the panel regions on the existing view content element", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      renderChatPanelShell(container, shellRenderers(store));
      await settleShellEffects();
    });

    expect(container.classList.contains("codex-panel")).toBe(true);
    expect(container.textContent).toContain("Idle");
    expect(container.textContent).toContain("no goal");
    expect(container.textContent).toContain("0");
    expect(container.textContent).toContain("ready");
    expect(container.querySelector(".codex-panel__region--config")).toBeNull();
    expect(container.querySelector(".codex-panel__body > .codex-panel__region--messages")).toBe(
      container.querySelector(".codex-panel__body > .codex-panel__messages"),
    );

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("updates rendered panel content when the store changes", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    await act(async () => {
      store.dispatch({ type: "connection/status-set", status: "Working" });
      await settleShellEffects();
    });

    expect(container.textContent).toContain("Working");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("keeps panel content in its owning region after shell rerenders", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = nestedRootShellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    await act(async () => {
      store.dispatch({ type: "connection/status-set", status: "Working" });
      store.dispatch({ type: "ui/panel-set", panel: "status-panel" });
      store.dispatch({
        type: "transcript/system-message-added",
        item: { id: "system-1", kind: "system", role: "system", text: "Model set." },
      });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar .test-toolbar")?.textContent).toBe("Working");
    expect(container.querySelector(".codex-panel__region--goal .test-goal")?.textContent).toBe("no goal");
    expect(container.querySelector(".codex-panel__region--messages .test-messages")?.textContent).toBe("1");
    expect(container.querySelector<HTMLTextAreaElement>(".codex-panel__region--composer .test-composer textarea")?.value).toBe("ready");
    expect(container.querySelector(".codex-panel__region--composer .test-toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__region--composer .test-messages")).toBeNull();

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("renders region nodes inside the single shell root", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = nodeShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar .test-toolbar")?.textContent).toBe("Idle");
    expect(container.querySelector(".codex-panel__region--messages .test-messages")?.textContent).toBe("0");

    await act(async () => {
      unmountChatPanelShell(container);
      await settleShellEffects();
    });

    expect(cleanup).toHaveBeenCalledWith("toolbar");
    expect(cleanup).toHaveBeenCalledWith("goal");
    expect(cleanup).toHaveBeenCalledWith("messages");
    expect(cleanup).toHaveBeenCalledWith("composer");
  });

  it("rerenders shell regions when the state store updates", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = nodeShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });
    renderers.toolbarNode.mockClear();
    renderers.goalNode.mockClear();
    renderers.messagesNode.mockClear();
    renderers.composerNode.mockClear();

    await act(async () => {
      store.dispatch({ type: "connection/status-set", status: "Working" });
      await settleShellEffects();
    });

    expect(renderers.toolbarNode).toHaveBeenCalledTimes(1);
    expect(renderers.goalNode).toHaveBeenCalledTimes(1);
    expect(renderers.messagesNode).toHaveBeenCalledTimes(1);
    expect(renderers.composerNode).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("removes and restores the toolbar region from shell props", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, { ...renderers, showToolbar: false });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).toBeNull();
    expect(container.querySelector(".codex-panel__region--messages")).not.toBeNull();
    expect(container.querySelector(".codex-panel__region--composer")).not.toBeNull();

    await act(async () => {
      renderChatPanelShell(container, { ...renderers, showToolbar: true });
      await settleShellEffects();
    });

    expect(container.querySelector(".codex-panel__toolbar")).not.toBeNull();
    expect(container.firstElementChild?.classList.contains("codex-panel__toolbar")).toBe(true);

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("sets composer bottom clearance only for fixed visible Obsidian status bars", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    const statusBar = document.createElement("div");
    statusBar.className = "status-bar";
    document.body.appendChild(statusBar);
    document.body.appendChild(container);
    Object.defineProperty(statusBar, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 26, width: 100, top: 0, right: 100, bottom: 26, left: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });

    await act(async () => {
      statusBar.style.display = "flex";
      statusBar.style.position = "fixed";
      renderChatPanelShell(container, shellRenderers(store));
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("26px");

    await act(async () => {
      statusBar.style.position = "static";
      renderChatPanelShell(container, shellRenderers(store));
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("0px");

    await act(async () => {
      statusBar.style.display = "none";
      renderChatPanelShell(container, shellRenderers(store));
      await settleShellEffects();
    });
    expect(container.style.getPropertyValue("--codex-panel-status-bar-clearance")).toBe("0px");

    await act(async () => {
      unmountChatPanelShell(container);
    });
    statusBar.remove();
  });

  it("repairs a removed ui root without inspecting shell children", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = trackedRootShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    container.replaceChildren();

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    expect(cleanup).toHaveBeenCalledWith("toolbar");
    expect(container.textContent).toContain("toolbar");
    expect(container.textContent).toContain("goal");
    expect(container.textContent).toContain("messages");
    expect(container.textContent).toContain("composer");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("repairs damaged shell regions through the single root", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const cleanup = vi.fn();
    const renderers = nodeShellRenderers(store, cleanup);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    container.querySelector<HTMLElement>(":scope .codex-panel__messages")?.remove();

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });

    expect(cleanup).toHaveBeenCalledWith("messages");
    expect(container.querySelector(".codex-panel__messages .test-messages")?.textContent).toBe("0");

    await act(async () => {
      unmountChatPanelShell(container);
    });
  });

  it("unmounts every shell region when the shell unmounts", async () => {
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
    expect(cleanup).toHaveBeenCalledWith("goal");
    expect(cleanup).toHaveBeenCalledWith("messages");
    expect(cleanup).toHaveBeenCalledWith("composer");
  });

  it("stops subscribed region rendering after unmount", async () => {
    const store = createChatStateStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderers = shellRenderers(store);

    await act(async () => {
      renderChatPanelShell(container, renderers);
      await settleShellEffects();
    });
    renderers.toolbarNode.mockClear();

    await act(async () => {
      unmountChatPanelShell(container);
    });
    store.dispatch({ type: "connection/status-set", status: "Closed" });
    await settleShellEffects();

    expect(renderers.toolbarNode).not.toHaveBeenCalled();
  });
});

function shellRenderers(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    showToolbar: true,
    toolbarNode: vi.fn(() => <div>{store.getState().connection.status}</div>),

    goalNode: vi.fn(() => <div>{store.getState().activeThread.goal?.objective ?? "no goal"}</div>),

    messagesNode: vi.fn(() => (
      <div className="codex-panel__region codex-panel__region--messages codex-panel__messages">
        {String(store.getState().transcript.displayItems.length)}
      </div>
    )),

    composerNode: vi.fn(() => <div>{chatTurnBusy(store.getState()) ? "busy" : "ready"}</div>),
  };
}

function nestedRootShellRenderers(store: ReturnType<typeof createChatStateStore>) {
  return {
    stateStore: store,
    showToolbar: true,
    toolbarNode: vi.fn(() => (
      <>
        <div className="test-toolbar">{store.getState().connection.status}</div>
        <div className="test-toolbar-panel">panel</div>
      </>
    )),

    goalNode: vi.fn(() => <div className="test-goal">{store.getState().activeThread.goal?.objective ?? "no goal"}</div>),

    messagesNode: vi.fn(() => (
      <div className="codex-panel__region codex-panel__region--messages codex-panel__messages">
        <div className="test-messages">{String(store.getState().transcript.displayItems.length)}</div>
      </div>
    )),

    composerNode: vi.fn(() => (
      <div className="test-composer">
        <textarea value={chatTurnBusy(store.getState()) ? "busy" : "ready"} readOnly />
        <button type="button">Send</button>
      </div>
    )),
  };
}

function trackedRootShellRenderers(store: ReturnType<typeof createChatStateStore>, cleanup: (region: string) => void) {
  return {
    stateStore: store,
    showToolbar: true,
    toolbarNode: vi.fn(() => <TrackedSlot region="toolbar" cleanup={cleanup} />),

    goalNode: vi.fn(() => <TrackedSlot region="goal" cleanup={cleanup} />),

    messagesNode: vi.fn(() => (
      <div className="codex-panel__region codex-panel__region--messages codex-panel__messages">
        <TrackedSlot region="messages" cleanup={cleanup} />
      </div>
    )),

    composerNode: vi.fn(() => <TrackedSlot region="composer" cleanup={cleanup} />),
  };
}

function nodeShellRenderers(store: ReturnType<typeof createChatStateStore>, cleanup: (region: string) => void) {
  return {
    stateStore: store,
    showToolbar: true,
    toolbarNode: vi.fn(() => (
      <TrackedSlot region="toolbar" cleanup={cleanup} className="test-toolbar" text={store.getState().connection.status} />
    )),

    goalNode: vi.fn(() => (
      <TrackedSlot
        region="goal"
        cleanup={cleanup}
        className="test-goal"
        text={store.getState().activeThread.goal?.objective ?? "no goal"}
      />
    )),

    messagesNode: vi.fn(() => (
      <div className="codex-panel__region codex-panel__region--messages codex-panel__messages">
        <TrackedSlot
          region="messages"
          cleanup={cleanup}
          className="test-messages"
          text={String(store.getState().transcript.displayItems.length)}
        />
      </div>
    )),

    composerNode: vi.fn(() => (
      <TrackedSlot region="composer" cleanup={cleanup} className="test-composer" text={chatTurnBusy(store.getState()) ? "busy" : "ready"} />
    )),
  };
}

function TrackedSlot({
  region,
  cleanup,
  className,
  text = region,
}: {
  region: string;
  cleanup: (region: string) => void;
  className?: string;
  text?: string;
}) {
  useEffect(() => {
    return () => {
      cleanup(region);
    };
  }, [cleanup, region]);
  return <div className={className}>{text}</div>;
}

async function settleShellEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
