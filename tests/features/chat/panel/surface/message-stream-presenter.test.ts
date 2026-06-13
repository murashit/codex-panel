// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { h } from "preact";

import {
  chatReducer,
  createChatState,
  createChatStateStore,
  type ChatAction,
  type ChatState,
  type ChatStateStore,
} from "../../../../../src/features/chat/state/reducer";
import {
  messageStreamContextFromState,
  messageStreamStateProjection,
  MessageStreamPresenter,
} from "../../../../../src/features/chat/panel/surface/message-stream-presenter";
import { MessageStreamScrollBridge } from "../../../../../src/features/chat/panel/surface/message-stream-scroll";
import { createMessageStreamContextPort } from "../../../../../src/features/chat/panel/surface/message-stream-ports";
import { MessageStreamViewport } from "../../../../../src/features/chat/ui/message-stream/viewport";
import {
  bindRenderedWikiLinks,
  type RenderedMarkdownLinkContext,
} from "../../../../../src/features/chat/ui/message-stream/markdown-renderer";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../../../../../src/features/chat/ui/message-stream/content-events";
import type { MessageStreamScrollIntent } from "../../../../../src/features/chat/ui/message-stream/virtualizer";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";
import { installMessageViewportMetrics } from "../../ui/message-stream/test-helpers";
import { chatStateDisplayItems, setChatStateDisplayItems } from "../../support/message-stream";

const ESTIMATED_MESSAGE_BLOCK_HEIGHT = 96;

installObsidianDomShims();

function renderMessageStreamPresenter(parent: HTMLElement, presenter: MessageStreamPresenter, state: ChatState): void {
  renderUiRoot(parent, h(MessageStreamViewport, { state: presenter.renderState(state) }));
}

describe("MessageStreamPresenter scroll pinning", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("projects reducer state into message stream view state", () => {
    const store = createChatStateStore(createChatState());
    store.dispatch({
      type: "active-thread/resumed",
      thread: { id: "thread-1", preview: "", archived: false, createdAt: 1, updatedAt: 1, name: "Thread" },
      cwd: "/repo",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    const projection = messageStreamStateProjection(store.getState(), "/vault");

    expect(projection.activeThreadId).toBe("thread-1");
    expect(projection.workspaceRoot).toBe("/repo");
    expect(projection.displayItems).toEqual([]);
    expect(projection.disclosures.textDetails.size).toBe(0);
    expect(projection.forkActionsItemId).toBeNull();
  });

  it("wires message stream disclosure actions through the context port", () => {
    const store = createChatStateStore(createChatState());
    const port = createMessageStreamContextPort({
      vaultPath: "/vault",
      dispatch: (action) => {
        store.dispatch(action);
      },
      loadOlderTurns: vi.fn(),
      renderMarkdown: vi.fn(),
      copyMessageText: vi.fn(),
      actions: {
        rollbackThread: vi.fn(),
        forkThreadFromTurn: vi.fn(),
        implementPlan: vi.fn(),
        openTurnDiff: vi.fn(),
      },
      requests: {
        pendingSignature: () => "",
        pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), approvalDetails: new Set() }),
        pendingActions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumePendingAutoFocus: () => false,
      },
    });

    const context = messageStreamContextFromState(store.getState(), port);
    if (!context.onDisclosureToggle) throw new Error("Expected message stream disclosure action");
    context.onDisclosureToggle("textDetails", "message:details", true);

    expect(store.getState().ui.disclosures.textDetails.has("message:details")).toBe(true);
  });

  it("normalizes rendered internal links that point at absolute vault paths", () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault", ["docs/Guide.md"]);
    const parent = document.createElement("div");
    const link = parent.createEl("a", {
      cls: "internal-link",
      text: "Guide.md",
      attr: {
        "data-href": "/Users/showhey/Vault/docs/Guide.md",
        href: "/Users/showhey/Vault/docs/Guide.md",
      },
    });

    bindRenderedWikiLinks(parent, "Inbox.md", context);
    link.click();

    expect(openLinkText).toHaveBeenCalledWith("docs/Guide.md", "Inbox.md", false);
  });

  it("normalizes rendered internal links for missing files inside the vault", () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const parent = document.createElement("div");
    const link = parent.createEl("a", {
      cls: "internal-link",
      text: "Missing.md",
      attr: {
        "data-href": "/Users/showhey/Vault/docs/Missing.md",
        href: "/Users/showhey/Vault/docs/Missing.md",
      },
    });

    bindRenderedWikiLinks(parent, "Inbox.md", context);
    link.click();

    expect(openLinkText).toHaveBeenCalledWith("docs/Missing.md", "Inbox.md", false);
  });

  it("keeps rendered internal links unchanged when they are not vault file paths", () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText);
    const parent = document.createElement("div");
    const link = parent.createEl("a", {
      cls: "internal-link",
      text: "Project",
      attr: {
        "data-href": "Project",
        href: "Project",
      },
    });

    bindRenderedWikiLinks(parent, "Inbox.md", context);
    link.click();

    expect(openLinkText).toHaveBeenCalledWith("Project", "Inbox.md", false);
  });

  it("does not open rendered internal links for absolute paths outside the vault", () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const parent = document.createElement("div");
    const link = parent.createEl("a", {
      cls: "internal-link",
      text: "README.md",
      attr: {
        "data-href": "/Users/showhey/Repos/codex-panel/README.md",
        href: "/Users/showhey/Repos/codex-panel/README.md",
      },
    });

    bindRenderedWikiLinks(parent, "Inbox.md", context);
    link.click();

    expect(openLinkText).not.toHaveBeenCalled();
    expect(notices).toEqual(["Cannot open files outside the vault."]);
  });

  it("does not open rendered internal links for vault config paths", () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const parent = document.createElement("div");
    const link = parent.createEl("a", {
      cls: "internal-link",
      text: "main.js",
      attr: {
        "data-href": "/Users/showhey/Vault/vault-config/plugins/foo/main.js",
        href: "/Users/showhey/Vault/vault-config/plugins/foo/main.js",
      },
    });

    bindRenderedWikiLinks(parent, "Inbox.md", context);
    link.click();

    expect(openLinkText).not.toHaveBeenCalled();
    expect(notices).toEqual(["Cannot open files outside the vault."]);
  });

  it("pins to the scroll container bottom without aligning the last message element", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    scrollBridge.forceMessageStreamToBottom();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("can repin the current scroll container after composer growth shrinks the viewport", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 160 });
    messages.scrollTop = 1000;
    await settleMessageRender(messages);

    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 940;

    scrollBridge.forceMessageStreamToBottom();

    expect(messages.scrollTop).toBe(0);
  });

  it("repins after composer growth has changed the scroll viewport height", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    let scrollTop = 0;
    let layoutSettled = false;
    Object.defineProperties(messages, {
      scrollHeight: { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true },
      clientHeight: {
        get: () => (layoutSettled ? 100 : 160),
        configurable: true,
      },
      offsetHeight: {
        get: () => messages.clientHeight,
        configurable: true,
      },
      clientWidth: { value: 240, configurable: true },
      offsetWidth: { value: 240, configurable: true },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(value, Math.max(0, ESTIMATED_MESSAGE_BLOCK_HEIGHT - messages.clientHeight));
        },
        configurable: true,
      },
    });
    messages.scrollTop = 1000;
    renderMessageStreamPresenter(messages, presenter, state);
    await settleMessageRender(messages);
    expect(messages.scrollTop).toBe(0);

    scrollBridge.forceMessageStreamToBottom();
    expect(messages.scrollTop).toBe(0);

    layoutSettled = true;
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
  });

  it("treats scroll commands as no-ops when no message stream virtualizer is mounted", () => {
    const { presenter, scrollBridge } = messageStreamPresenter();

    expect(() => {
      scrollBridge.forceMessageStreamToBottom();
      scrollBridge.repinMessageStreamToBottomIfPinned();
      scrollBridge.scrollFromComposer({ direction: 1, amount: "text-lines" });
      scrollBridge.scrollFromComposer({ direction: -1, amount: "page" });
      presenter.dispose();
      scrollBridge.forceMessageStreamToBottom();
    }).not.toThrow();
  });

  it("detaches the active virtualizer when the message stream unmounts", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);
    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages);
    await settleMessageRender(messages);

    unmountUiRoot(parent);

    expect(() => {
      scrollBridge.forceMessageStreamToBottom();
      scrollBridge.scrollFromComposer({ direction: 1, amount: "page" });
    }).not.toThrow();
  });

  it("binds scroll commands to the currently mounted message viewport", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);
    renderMessageStreamPresenter(parent, presenter, state);
    const oldMessages = messageViewport(parent);
    installMessageViewportMetrics(oldMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleMessageRender(oldMessages);
    oldMessages.scrollTop = 125;

    unmountUiRoot(parent);

    renderMessageStreamPresenter(parent, presenter, state);
    const newMessages = messageViewport(parent);
    installMessageViewportMetrics(newMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleMessageRender(newMessages);
    scrollBridge.forceMessageStreamToBottom();

    expect(newMessages.scrollTop).toBe(900);
    expect(oldMessages.scrollTop).toBe(125);
  });

  it("completes bottom pinning after the message viewport commits", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state, vi.fn(), "/vault", [], () => "force-bottom");

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 100, scrollHeight: 1000 });
    scrollBridge.forceMessageStreamToBottom();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(900);
  });

  it("keeps bottom pinning after markdown content changes message height", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "**Rendered** message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollBridge } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    let scrollHeight = 1000;
    Object.defineProperty(messages, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });

    scrollBridge.forceMessageStreamToBottom();
    await settleMessageRender(messages);
    expect(messages.scrollTop).toBe(900);

    scrollHeight = 1200;
    const content = parent.querySelector<HTMLElement>(".codex-panel__message-content");
    if (!content) throw new Error("Expected rendered message content.");
    content.dispatchEvent(new Event(MESSAGE_CONTENT_RENDERED_EVENT, { bubbles: true }));
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(1100);
  });

  it("does not force the bottom into view when the user is reading older messages", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Initial message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = messageStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    installMessageViewportMetrics(messages);
    renderMessageStreamPresenter(messages, presenter, state);
    await settleMessageRender(messages);

    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Updated streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    renderMessageStreamPresenter(messages, presenter, state);
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not run a pending bottom pin after the user scrolls away", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = messageStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;
    renderMessageStreamPresenter(messages, presenter, state);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the mounted message stream content in place on dispose", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(state, [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    let messages = messageViewport(parent);
    installMessageViewportMetrics(messages);
    renderMessageStreamPresenter(parent, presenter, state);
    messages = messageViewport(parent);
    await settleMessageRender(messages);
    expect(parent.querySelector(".codex-panel__messages")).not.toBeNull();

    presenter.dispose();

    expect(parent.querySelector(".codex-panel__messages")).not.toBeNull();
  });

  it("does not mount every block before the virtualizer attaches", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    setChatStateDisplayItems(
      state,
      Array.from({ length: 200 }, (_value, index) => ({
        id: `message-${String(index)}`,
        kind: "message",
        role: "assistant",
        text: `Message ${String(index)}`,
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      })),
    );
    const parent = document.createElement("div");
    const { presenter } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 320, scrollHeight: 19_200 });
    await settleMessageRender(messages);

    expect(parent.querySelectorAll("[data-codex-panel-block-key]").length).toBeLessThan(chatStateDisplayItems(state).length);
  });
});

function markdownLinkContext(openLinkText = vi.fn(), vaultPath = "/vault", vaultFiles: string[] = []): RenderedMarkdownLinkContext {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  return {
    app: {
      workspace: {
        getActiveFile: vi.fn(() => null),
        openLinkText,
      },
      vault: {
        configDir: "vault-config",
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      },
    } as never,
    vaultPath,
  };
}

interface TestMessageStreamPresenter {
  presenter: MessageStreamPresenter;
  scrollBridge: MessageStreamScrollBridge;
}

function messageStreamPresenter(
  state = createChatState(),
  openLinkText = vi.fn(),
  vaultPath = "/vault",
  vaultFiles: string[] = [],
  consumeIntent: () => MessageStreamScrollIntent = () => "auto",
): TestMessageStreamPresenter {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  const scrollBridge = new MessageStreamScrollBridge();
  const presenter = new MessageStreamPresenter({
    obsidian: {
      app: {
        workspace: {
          getActiveFile: vi.fn(() => null),
          openLinkText,
        },
        vault: {
          configDir: "vault-config",
          getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        },
      } as never,
      owner: {} as never,
    },
    state: {
      store: testStoreForState(state),
    },
    workspace: {
      vaultPath,
    },
    scroll: {
      consumeIntent,
      registerVirtualizer: scrollBridge.registerVirtualizer,
      dispose: () => {
        scrollBridge.dispose();
      },
    },
    history: {
      loadOlderTurns: vi.fn(),
    },
    actions: {
      rollbackThread: vi.fn(),
      forkThreadFromTurn: vi.fn(),
      implementPlan: vi.fn(),
      openTurnDiff: vi.fn(),
    },
    requests: {
      pendingSignature: () => "",
      pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), approvalDetails: new Set() }),
      pendingActions: () => ({
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        setUserInputDraft: vi.fn(),
      }),
      consumePendingAutoFocus: () => false,
    },
  });
  return { presenter, scrollBridge };
}

function testStoreForState(state: ChatState): ChatStateStore {
  return {
    getState: () => state,
    dispatch(action: ChatAction) {
      const next = chatReducer(state, action);
      Object.assign(state, next);
      return state;
    },
    subscribe: () => () => undefined,
  };
}

function tFile(path: string): TFile {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return Object.assign(new TFile(), { path, basename });
}

function messageViewport(parent: HTMLElement): HTMLElement {
  const viewport = parent.querySelector<HTMLElement>(":scope > .codex-panel__messages");
  if (!viewport) throw new Error("Expected message viewport to be mounted.");
  return viewport;
}

async function settleMessageRender(element: HTMLElement): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    element.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}
