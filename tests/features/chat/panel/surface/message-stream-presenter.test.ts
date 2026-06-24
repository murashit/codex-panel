// @vitest-environment jsdom

import { MarkdownRenderer, TFile } from "obsidian";
import { h } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatAction, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { MessageStreamPresenter } from "../../../../../src/features/chat/panel/surface/message-stream-presenter";
import {
  type ChatMessageStreamSurfaceContext,
  messageStreamSurfaceProjectionFromState,
} from "../../../../../src/features/chat/panel/surface/message-stream-projection";
import {
  type ChatMessageScrollController,
  createChatMessageScrollController,
} from "../../../../../src/features/chat/panel/surface/message-stream-scroll";
import { MESSAGE_CONTENT_RENDERED_EVENT } from "../../../../../src/features/chat/ui/message-stream/content-events";
import { MarkdownMessageRenderer } from "../../../../../src/features/chat/ui/message-stream/markdown-renderer";
import { MessageStreamViewport } from "../../../../../src/features/chat/ui/message-stream/stream-blocks";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";
import { withChatStateMessageStreamItems } from "../../support/message-stream";
import { messageStreamShellStateFromChatState } from "../../support/shell-state";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { installMessageViewportMetrics, pendingApproval } from "../../ui/message-stream/test-helpers";

const ESTIMATED_MESSAGE_BLOCK_HEIGHT = 96;

installObsidianDomShims();

function renderMessageStreamPresenter(parent: HTMLElement, presenter: MessageStreamPresenter, state: ChatState): void {
  renderUiRoot(parent, h(MessageStreamViewport, { state: presenter.renderState(messageStreamShellStateFromChatState(state)) }));
}

describe("MessageStreamPresenter scroll pinning", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("projects reducer state into message stream view state", () => {
    const store = createChatStateStore(chatStateFixture());
    store.dispatch({
      type: "active-thread/resumed",
      thread: { id: "thread-1", preview: "", archived: false, createdAt: 1, updatedAt: 1, name: "Thread" },
      cwd: "/repo",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    const projection = messageStreamSurfaceProjectionFromState(
      messageStreamShellStateFromChatState(store.getState()),
      messageStreamSurfaceContext({
        vaultPath: "/vault",
        dispatch: (action) => {
          store.dispatch(action);
        },
      }),
    );

    expect(projection.context.activeThreadId).toBe("thread-1");
    expect(projection.context.workspaceRoot).toBe("/repo");
    expect(projection.blocks).toEqual([{ kind: "empty", key: "empty" }]);
    expect(projection.context.disclosures.textDetails.size).toBe(0);
    expect(projection.context.forkMenuItemId).toBeNull();
  });

  it("wires message stream disclosure actions through the surface context", () => {
    const store = createChatStateStore(chatStateFixture());
    const surfaceContext = messageStreamSurfaceContext({
      vaultPath: "/vault",
      dispatch: (action) => {
        store.dispatch(action);
      },
    });

    const context = messageStreamSurfaceProjectionFromState(messageStreamShellStateFromChatState(store.getState()), surfaceContext).context;
    if (!context.onDisclosureToggle) throw new Error("Expected message stream disclosure action");
    context.onDisclosureToggle("textDetails", "message:details", true);

    expect(store.getState().ui.disclosures.textDetails.has("message:details")).toBe(true);
  });

  it("projects pending requests from the captured message stream state", () => {
    let state = chatStateFixture();
    state = withChatStateMessageStreamItems(state, [{ id: "system", kind: "system", role: "system", text: "Waiting for approval." }]);
    state = chatStateWith(state, { requests: { approvals: [pendingApproval()] } });
    const projection = messageStreamSurfaceProjectionFromState(
      messageStreamShellStateFromChatState(state),
      messageStreamSurfaceContext({
        vaultPath: "/vault",
        dispatch: () => undefined,
      }),
    );

    const pendingBlock = projection.blocks.find((block) => block.kind === "pendingRequests");
    expect(pendingBlock).toMatchObject({ kind: "pendingRequests", key: "pending-requests" });
    expect(projection.context.pendingRequests?.snapshot().approvals).toHaveLength(1);
  });

  it("normalizes rendered internal links that point at absolute vault paths", async () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault", ["docs/Guide.md"]);
    const { link, cleanup } = await renderedInternalLink(context, {
      cls: "internal-link",
      text: "Guide.md",
      attr: {
        "data-href": "/Users/showhey/Vault/docs/Guide.md",
        href: "/Users/showhey/Vault/docs/Guide.md",
      },
    });

    link.click();

    expect(openLinkText).toHaveBeenCalledWith("docs/Guide.md", "Inbox.md", false);
    cleanup();
  });

  it("normalizes rendered internal links for missing files inside the vault", async () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const { link, cleanup } = await renderedInternalLink(context, {
      cls: "internal-link",
      text: "Missing.md",
      attr: {
        "data-href": "/Users/showhey/Vault/docs/Missing.md",
        href: "/Users/showhey/Vault/docs/Missing.md",
      },
    });

    link.click();

    expect(openLinkText).toHaveBeenCalledWith("docs/Missing.md", "Inbox.md", false);
    cleanup();
  });

  it("keeps rendered internal links unchanged when they are not vault file paths", async () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText);
    const { link, cleanup } = await renderedInternalLink(context, {
      cls: "internal-link",
      text: "Project",
      attr: {
        "data-href": "Project",
        href: "Project",
      },
    });

    link.click();

    expect(openLinkText).toHaveBeenCalledWith("Project", "Inbox.md", false);
    cleanup();
  });

  it("does not open rendered internal links for absolute paths outside the vault", async () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const { link, cleanup } = await renderedInternalLink(context, {
      cls: "internal-link",
      text: "README.md",
      attr: {
        "data-href": "/Users/showhey/Repos/codex-panel/README.md",
        href: "/Users/showhey/Repos/codex-panel/README.md",
      },
    });

    link.click();

    expect(openLinkText).not.toHaveBeenCalled();
    expect(notices).toEqual(["Cannot open files outside the vault."]);
    cleanup();
  });

  it("does not open rendered internal links for vault config paths", async () => {
    const openLinkText = vi.fn();
    const context = markdownLinkContext(openLinkText, "/Users/showhey/Vault");
    const { link, cleanup } = await renderedInternalLink(context, {
      cls: "internal-link",
      text: "main.js",
      attr: {
        "data-href": "/Users/showhey/Vault/vault-config/plugins/foo/main.js",
        href: "/Users/showhey/Vault/vault-config/plugins/foo/main.js",
      },
    });

    link.click();

    expect(openLinkText).not.toHaveBeenCalled();
    expect(notices).toEqual(["Cannot open files outside the vault."]);
    cleanup();
  });

  it("pins to the scroll container bottom without aligning the last message element", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    scrollController.showLatest();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("can repin the current scroll container after composer growth shrinks the viewport", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 160 });
    messages.scrollTop = 1000;
    await settleMessageRender(messages);

    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 940;

    scrollController.showLatest();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
  });

  it("repins after composer growth has changed the scroll viewport height", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);

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

    scrollController.showLatest();
    expect(messages.scrollTop).toBe(0);

    layoutSettled = true;
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
  });

  it("accepts scroll commands when no message stream viewport is mounted", () => {
    const { presenter, scrollController } = messageStreamPresenter();

    expect(() => {
      scrollController.showLatest();
      scrollController.scrollFromComposer({ kind: "scroll-by", direction: 1, amount: "text-lines" });
      scrollController.scrollFromComposer({ kind: "scroll-by", direction: -1, amount: "page" });
      scrollController.scrollFromComposer({ kind: "scroll-to", edge: "start" });
      presenter.dispose();
      scrollController.showLatest();
    }).not.toThrow();
  });

  it("detaches the active scroll port when the message stream unmounts", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);
    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages);
    await settleMessageRender(messages);

    unmountUiRoot(parent);

    expect(() => {
      scrollController.showLatest();
      scrollController.scrollFromComposer({ kind: "scroll-by", direction: 1, amount: "page" });
    }).not.toThrow();
  });

  it("binds scroll commands to the currently mounted message viewport", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);
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
    scrollController.showLatest();

    expect(newMessages.scrollTop).toBe(900);
    expect(oldMessages.scrollTop).toBe(125);
  });

  it("completes bottom pinning after the message viewport commits", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state, vi.fn(), "/vault");

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 100, scrollHeight: 1000 });
    scrollController.showLatest();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(900);
  });

  it("keeps bottom pinning after markdown content changes message height", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    const { presenter, scrollController } = messageStreamPresenter(state);

    renderMessageStreamPresenter(parent, presenter, state);
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    let scrollHeight = 1000;
    Object.defineProperty(messages, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });

    scrollController.showLatest();
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
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    state = withChatStateMessageStreamItems(state, [
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
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(state, [
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

  it("renders large message streams through the flow viewport", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateMessageStreamItems(
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

    expect(parent.querySelector(".codex-panel__message-flow")).not.toBeNull();
    expect(parent.querySelectorAll("[data-codex-panel-block-key]").length).toBeGreaterThan(0);
  });
});

function messageStreamSurfaceContext(options: {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
}): ChatMessageStreamSurfaceContext {
  return {
    vaultPath: options.vaultPath,
    setDisclosureOpen: (bucket, id, open) => {
      options.dispatch({ type: "ui/disclosure-set", bucket, id, open });
    },
    setForkMenuItem: (itemId) => {
      options.dispatch({ type: "ui/message-fork-menu-set", itemId });
    },
    loadOlderTurns: vi.fn(),
    renderObsidianMarkdown: vi.fn(),
    renderStreamMarkdown: vi.fn(),
    copyMessageText: vi.fn(),
    actions: {
      rollbackThread: vi.fn(),
      forkThreadFromTurn: vi.fn(),
      implementPlan: vi.fn(),
      openTurnDiff: vi.fn(),
    },
    requests: {
      pendingActions: () => ({
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
        setUserInputDraft: vi.fn(),
        setMcpElicitationDraft: vi.fn(),
      }),
      consumePendingAutoFocus: () => false,
    },
  };
}

function markdownLinkContext(openLinkText = vi.fn(), vaultPath = "/vault", vaultFiles: string[] = []) {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  return {
    app: {
      workspace: {
        getActiveFile: vi.fn(() => tFile("Inbox.md")),
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

async function renderedInternalLink(
  context: ReturnType<typeof markdownLinkContext>,
  linkOptions: Parameters<HTMLElement["createEl"]>[1],
): Promise<{ link: HTMLAnchorElement; cleanup: () => void }> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const renderMarkdown = vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, _text, staging) => {
    staging.createEl("a", linkOptions);
    return Promise.resolve();
  });
  const markdownRenderer = new MarkdownMessageRenderer({
    app: context.app,
    owner: {} as never,
    vaultPath: context.vaultPath,
  });

  markdownRenderer.renderObsidianMarkdown(parent, "[[Link]]");
  await Promise.resolve();
  await Promise.resolve();
  renderMarkdown.mockRestore();

  const link = parent.querySelector<HTMLAnchorElement>("a.internal-link");
  if (!link) throw new Error("Expected rendered internal link");
  return {
    link,
    cleanup: () => {
      parent.remove();
    },
  };
}

interface TestMessageStreamPresenter {
  presenter: MessageStreamPresenter;
  scrollController: ChatMessageScrollController;
}

function messageStreamPresenter(
  state = chatStateFixture(),
  openLinkText = vi.fn(),
  vaultPath = "/vault",
  vaultFiles: string[] = [],
): TestMessageStreamPresenter {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  const scrollController = createChatMessageScrollController();
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
      controller: scrollController,
      dispose: () => {
        scrollController.dispose();
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
      pendingActions: () => ({
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
        setUserInputDraft: vi.fn(),
        setMcpElicitationDraft: vi.fn(),
      }),
      consumePendingAutoFocus: () => false,
    },
  });
  return { presenter, scrollController };
}

function testStoreForState(state: ChatState): ChatStateStore {
  let current = state;
  return {
    getState: () => current,
    dispatch(action: ChatAction) {
      current = chatReducer(current, action);
      return current;
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
