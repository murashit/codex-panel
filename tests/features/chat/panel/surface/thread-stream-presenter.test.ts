// @vitest-environment jsdom

import { MarkdownRenderer, TFile } from "obsidian";
import { h } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatAction, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { ThreadStreamPresenter } from "../../../../../src/features/chat/panel/surface/thread-stream-presenter";
import {
  type ChatThreadStreamSurfaceContext,
  threadStreamSurfaceProjectionFromModel,
} from "../../../../../src/features/chat/panel/surface/thread-stream-projection";
import {
  type ChatThreadStreamScrollBinding,
  createChatThreadStreamScrollBinding,
} from "../../../../../src/features/chat/panel/thread-stream-scroll-binding";
import { ThreadStreamMarkdownRenderer } from "../../../../../src/features/chat/ui/thread-stream/markdown-renderer.obsidian";
import { ThreadStreamViewport } from "../../../../../src/features/chat/ui/thread-stream/stream-blocks";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";
import { threadStreamReadModelFromChatState } from "../../support/shell-read-model";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateThreadStreamItems } from "../../support/thread-stream";
import { installThreadStreamViewportMetrics, pendingApproval } from "../../ui/thread-stream/test-helpers";

const ESTIMATED_MESSAGE_BLOCK_HEIGHT = 96;

installObsidianDomShims();

function renderThreadStreamPresenter(parent: HTMLElement, presenter: ThreadStreamPresenter, state: ChatState): void {
  renderUiRoot(parent, h(ThreadStreamViewport, { state: presenter.renderState(threadStreamReadModelFromChatState(state)) }));
}

describe("ThreadStreamPresenter scroll pinning", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("projects reducer state into thread stream view state", () => {
    const store = createChatStateStore(chatStateFixture());
    store.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: { id: "thread-1", preview: "", archived: false, createdAt: 1, updatedAt: 1, name: "Thread" },
      cwd: "/repo",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    const projection = threadStreamSurfaceProjectionFromModel(
      threadStreamReadModelFromChatState(store.getState()),
      testThreadStreamSurfaceContext({
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

  it("wires thread stream disclosure actions through the surface context", () => {
    const store = createChatStateStore(chatStateFixture());
    const surfaceContext = testThreadStreamSurfaceContext({
      vaultPath: "/vault",
      dispatch: (action) => {
        store.dispatch(action);
      },
    });

    const context = threadStreamSurfaceProjectionFromModel(threadStreamReadModelFromChatState(store.getState()), surfaceContext).context;
    if (!context.onDisclosureToggle) throw new Error("Expected thread stream disclosure action");
    context.onDisclosureToggle("textDetails", "message:details", true);

    expect(store.getState().ui.disclosures.textDetails.has("message:details")).toBe(true);
  });

  it("projects pending requests from the captured thread stream state", () => {
    let state = chatStateFixture();
    state = withChatStateThreadStreamItems(state, [{ id: "system", kind: "system", role: "system", text: "Waiting for approval." }]);
    state = chatStateWith(state, { requests: { approvals: [pendingApproval()] } });
    const projection = threadStreamSurfaceProjectionFromModel(
      threadStreamReadModelFromChatState(state),
      testThreadStreamSurfaceContext({
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

  it("uses Obsidian global search when rendered tags are clicked", async () => {
    const openGlobalSearch = vi.fn();
    const context = markdownLinkContext();
    Object.assign(context.app, {
      internalPlugins: {
        plugins: {
          "global-search": {
            instance: { openGlobalSearch },
          },
        },
      },
    });
    const { link, cleanup } = await renderedTag(context, {
      cls: "tag",
      text: "#project/codex",
      attr: { href: "#project/codex" },
    });

    link.click();
    await Promise.resolve();

    expect(openGlobalSearch).toHaveBeenCalledWith("tag:#project/codex", true);
    expect(context.app.workspace.getLeftLeaf).not.toHaveBeenCalled();
    cleanup();
  });

  it("pins to the scroll container bottom without aligning the last message element", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollPortBinding } = threadStreamPresenter(state);

    renderThreadStreamPresenter(parent, presenter, state);
    const messages = threadStreamViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installThreadStreamViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    scrollPortBinding.showLatest();
    await settleThreadStreamRender(messages);

    expect(messages.scrollTop).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("repins after composer growth has changed the scroll viewport height", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollPortBinding } = threadStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__thread-stream" });
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
    renderThreadStreamPresenter(messages, presenter, state);
    await settleThreadStreamRender(messages);
    expect(messages.scrollTop).toBe(0);

    scrollPortBinding.showLatest();
    expect(messages.scrollTop).toBe(0);

    layoutSettled = true;
    await settleThreadStreamRender(messages);

    expect(messages.scrollTop).toBe(0);
  });

  it("accepts scroll commands when no thread stream viewport is mounted", () => {
    const { presenter, scrollPortBinding } = threadStreamPresenter();

    expect(() => {
      scrollPortBinding.showLatest();
      scrollPortBinding.scrollFromComposer({ kind: "scroll-by", direction: 1, amount: "text-lines" });
      scrollPortBinding.scrollFromComposer({ kind: "scroll-by", direction: -1, amount: "page" });
      scrollPortBinding.scrollFromComposer({ kind: "scroll-to", edge: "start" });
      presenter.dispose();
      scrollPortBinding.showLatest();
    }).not.toThrow();
  });

  it("detaches the active scroll port when the thread stream unmounts", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollPortBinding } = threadStreamPresenter(state);
    renderThreadStreamPresenter(parent, presenter, state);
    const messages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(messages);
    await settleThreadStreamRender(messages);

    unmountUiRoot(parent);

    expect(() => {
      scrollPortBinding.showLatest();
      scrollPortBinding.scrollFromComposer({ kind: "scroll-by", direction: 1, amount: "page" });
    }).not.toThrow();
  });

  it("binds scroll commands to the currently mounted message viewport", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollPortBinding } = threadStreamPresenter(state);
    renderThreadStreamPresenter(parent, presenter, state);
    const oldMessages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(oldMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleThreadStreamRender(oldMessages);
    oldMessages.scrollTop = 125;

    unmountUiRoot(parent);

    renderThreadStreamPresenter(parent, presenter, state);
    const newMessages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(newMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleThreadStreamRender(newMessages);
    scrollPortBinding.showLatest();

    expect(newMessages.scrollTop).toBe(900);
    expect(oldMessages.scrollTop).toBe(125);
  });

  it("completes bottom pinning after the message viewport commits", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter, scrollPortBinding } = threadStreamPresenter(state, vi.fn(), "/vault");

    renderThreadStreamPresenter(parent, presenter, state);
    const messages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(messages, { clientHeight: 100, scrollHeight: 1000 });
    scrollPortBinding.showLatest();
    await settleThreadStreamRender(messages);

    expect(messages.scrollTop).toBe(900);
  });

  it("does not force the bottom into view when the user is reading older messages", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Initial message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = threadStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__thread-stream" });
    installThreadStreamViewportMetrics(messages);
    renderThreadStreamPresenter(messages, presenter, state);
    await settleThreadStreamRender(messages);

    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installThreadStreamViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Updated streaming message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    renderThreadStreamPresenter(messages, presenter, state);
    await settleThreadStreamRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not run a pending bottom pin after the user scrolls away", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = threadStreamPresenter(state);

    const messages = parent.createDiv({ cls: "codex-panel__thread-stream" });
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installThreadStreamViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;
    renderThreadStreamPresenter(messages, presenter, state);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    await settleThreadStreamRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the mounted thread stream content in place on dispose", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "message",
        kind: "dialogue",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ]);
    const parent = document.createElement("div");
    const { presenter } = threadStreamPresenter(state);

    renderThreadStreamPresenter(parent, presenter, state);
    let messages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(messages);
    renderThreadStreamPresenter(parent, presenter, state);
    messages = threadStreamViewport(parent);
    await settleThreadStreamRender(messages);
    expect(parent.querySelector(".codex-panel__thread-stream")).not.toBeNull();

    presenter.dispose();

    expect(parent.querySelector(".codex-panel__thread-stream")).not.toBeNull();
  });

  it("renders large thread streams through the flow viewport", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread" } });
    state = withChatStateThreadStreamItems(
      state,
      Array.from({ length: 200 }, (_value, index) => ({
        id: `message-${String(index)}`,
        kind: "dialogue",
        role: "assistant",
        text: `Message ${String(index)}`,
        turnId: "turn",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      })),
    );
    const parent = document.createElement("div");
    const { presenter } = threadStreamPresenter(state);

    renderThreadStreamPresenter(parent, presenter, state);
    const messages = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(messages, { clientHeight: 320, scrollHeight: 19_200 });
    await settleThreadStreamRender(messages);

    expect(parent.querySelector(".codex-panel__thread-stream-flow")).not.toBeNull();
    expect(parent.querySelectorAll("[data-codex-panel-block-key]").length).toBeGreaterThan(0);
  });
});

function testThreadStreamSurfaceContext(options: {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
}): ChatThreadStreamSurfaceContext {
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
    copyDialogueText: vi.fn(),
    actions: {
      rollbackThread: vi.fn(),
      forkThreadFromTurn: vi.fn(),
      implementPlan: vi.fn(),
      openThreadInNewView: vi.fn(),
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
        getLeftLeaf: vi.fn((): unknown | null => null),
        revealLeaf: vi.fn().mockResolvedValue(undefined),
      },
      vault: {
        configDir: "vault-config",
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      },
    },
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
  const markdownRenderer = new ThreadStreamMarkdownRenderer({
    app: context.app as never,
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

async function renderedTag(
  context: ReturnType<typeof markdownLinkContext>,
  linkOptions: Parameters<HTMLElement["createEl"]>[1],
): Promise<{ link: HTMLAnchorElement; cleanup: () => void }> {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const renderMarkdown = vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce((_app, _text, staging) => {
    staging.createEl("a", linkOptions);
    return Promise.resolve();
  });
  const markdownRenderer = new ThreadStreamMarkdownRenderer({
    app: context.app as never,
    owner: {} as never,
    vaultPath: context.vaultPath,
  });

  markdownRenderer.renderObsidianMarkdown(parent, "#tag");
  await Promise.resolve();
  await Promise.resolve();
  renderMarkdown.mockRestore();

  const link = parent.querySelector<HTMLAnchorElement>("a.tag");
  if (!link) throw new Error("Expected rendered tag");
  return {
    link,
    cleanup: () => {
      parent.remove();
    },
  };
}

interface TestThreadStreamPresenter {
  presenter: ThreadStreamPresenter;
  scrollPortBinding: ChatThreadStreamScrollBinding;
}

function threadStreamPresenter(
  state = chatStateFixture(),
  openLinkText = vi.fn(),
  vaultPath = "/vault",
  vaultFiles: string[] = [],
): TestThreadStreamPresenter {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  const scrollPortBinding = createChatThreadStreamScrollBinding();
  const presenter = new ThreadStreamPresenter({
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
      portBinding: scrollPortBinding,
      dispose: () => {
        scrollPortBinding.dispose();
      },
    },
    history: {
      loadOlderTurns: vi.fn(),
    },
    actions: {
      rollbackThread: vi.fn(),
      forkThreadFromTurn: vi.fn(),
      implementPlan: vi.fn(),
      openThreadInNewView: vi.fn(),
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
  return { presenter, scrollPortBinding };
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

function threadStreamViewport(parent: HTMLElement): HTMLElement {
  const viewport = parent.querySelector<HTMLElement>(":scope > .codex-panel__thread-stream");
  if (!viewport) throw new Error("Expected message viewport to be mounted.");
  return viewport;
}

async function settleThreadStreamRender(element: HTMLElement): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    element.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}
