// @vitest-environment jsdom

import { MarkdownRenderer, TFile } from "obsidian";
import { h } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type ChatAction, type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { type ChatStateStore, createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/turns/web-submission";
import {
  type ChatThreadStreamSurfaceContext,
  threadStreamSurfaceProjectionFromModel,
} from "../../../../../src/features/chat/panel/surface/thread-stream-projection";
import { createChatThreadStreamSurfaceContext } from "../../../../../src/features/chat/panel/surface/thread-stream-surface.obsidian";
import {
  type ChatThreadStreamScrollBinding,
  createChatThreadStreamScrollBinding,
} from "../../../../../src/features/chat/panel/thread-stream-scroll-binding";
import { ThreadStreamMarkdownRenderer } from "../../../../../src/features/chat/ui/thread-stream/markdown-renderer.obsidian";
import { ThreadStreamViewport } from "../../../../../src/features/chat/ui/thread-stream/stream-blocks";
import { renderUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";
import { threadStreamModelFromChatState } from "../../support/shell-selectors";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateThreadStreamItems } from "../../support/thread-stream";
import { installThreadStreamViewportMetrics, pendingApproval } from "../../ui/thread-stream/test-helpers";

installObsidianDomShims();

function renderThreadStreamSurface(
  parent: HTMLElement,
  context: ChatThreadStreamSurfaceContext,
  scrollPortBinding: ChatThreadStreamScrollBinding,
  state: ChatState,
): void {
  const projection = threadStreamSurfaceProjectionFromModel(threadStreamModelFromChatState(state), context);
  renderUiRoot(
    parent,
    h(ThreadStreamViewport, {
      state: {
        blocks: projection.blocks,
        context: projection.context,
        scrollPortBinding,
      },
    }),
  );
}

describe("thread stream surface", () => {
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
      thread: {
        id: "thread-1",
        preview: "",
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        name: "Thread",
        provenance: { kind: "interactive" },
      },
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    const projection = threadStreamSurfaceProjectionFromModel(
      threadStreamModelFromChatState(store.getState()),
      testThreadStreamSurfaceContext({
        vaultPath: "/vault",
        dispatch: (action) => {
          store.dispatch(action);
        },
      }),
    );

    expect(projection.context.activeThreadId).toBe("thread-1");
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

    const context = threadStreamSurfaceProjectionFromModel(threadStreamModelFromChatState(store.getState()), surfaceContext).context;
    if (!context.onDisclosureToggle) throw new Error("Expected thread stream disclosure action");
    context.onDisclosureToggle("textDetails", "message:details", true);

    expect(store.getState().ui.disclosures.textDetails.has("message:details")).toBe(true);
  });

  it("binds reducer-owned disclosure and fork menu actions in the surface factory", () => {
    const { context, stateStore } = threadStreamSurface();

    context.setDisclosureOpen("activityGroups", "turn-1", true);
    context.setForkMenuItem("message-1");

    expect(stateStore.getState().ui.disclosures.activityGroups.has("turn-1")).toBe(true);
    expect(stateStore.getState().ui.threadStreamActionMenu.forkMenuItemId).toBe("message-1");
  });

  it("projects pending requests from the captured thread stream state", () => {
    let state = chatStateFixture();
    state = withChatStateThreadStreamItems(state, [{ id: "system", kind: "system", role: "system", text: "Waiting for approval." }]);
    state = chatStateWith(state, { requests: { approvals: [pendingApproval()] } });
    const projection = threadStreamSurfaceProjectionFromModel(
      threadStreamModelFromChatState(state),
      testThreadStreamSurfaceContext({
        vaultPath: "/vault",
        dispatch: () => undefined,
      }),
    );

    const pendingBlock = projection.blocks.find((block) => block.kind === "pendingRequests");
    expect(pendingBlock).toMatchObject({ kind: "pendingRequests", key: "pending-requests" });
    expect(projection.context.pendingRequests?.snapshot().approvals).toHaveLength(1);
  });

  it("keeps a pending web submission visible after the canonical turn completes", () => {
    const pending = pendingWebSubmissionItem("pending-web", "https://example.com", "Summarize");
    if (!pending) throw new Error("Expected pending web submission item");
    const store = createChatStateStore(
      withChatStateThreadStreamItems(chatStateFixture(), [
        {
          id: "assistant",
          kind: "dialogue",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          role: "assistant",
          text: "Previous answer",
          turnId: "turn",
        },
      ]),
    );
    store.dispatch({
      type: "web-submission/pending",
      submission: {
        id: pending.id,
        item: pending,
        targetThreadId: "thread",
        originalDraft: "/web https://example.com Summarize",
        phase: "cancellable",
      },
    });

    const projection = threadStreamSurfaceProjectionFromModel(
      threadStreamModelFromChatState(store.getState()),
      testThreadStreamSurfaceContext({ vaultPath: "/vault", dispatch: () => undefined }),
    );

    expect(JSON.stringify(projection.blocks)).toContain(pending.id);
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

  it("pins to the scroll container bottom", async () => {
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
    const { context, scrollPortBinding } = threadStreamSurface(state);

    renderThreadStreamSurface(parent, context, scrollPortBinding, state);
    const viewport = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000 });
    viewport.scrollTop = 100;

    scrollPortBinding.showLatest();
    await settleThreadStreamRender(viewport);

    expect(viewport.scrollTop).toBe(900);
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
    const { context, scrollPortBinding } = threadStreamSurface(state);
    renderThreadStreamSurface(parent, context, scrollPortBinding, state);
    const viewport = threadStreamViewport(parent);
    let scrollTop = 0;
    let layoutSettled = false;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 240, configurable: true },
      clientHeight: {
        get: () => (layoutSettled ? 100 : 160),
        configurable: true,
      },
      offsetHeight: {
        get: () => viewport.clientHeight,
        configurable: true,
      },
      clientWidth: { value: 240, configurable: true },
      offsetWidth: { value: 240, configurable: true },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(value, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
        },
        configurable: true,
      },
    });
    viewport.scrollTop = 1000;
    viewport.dispatchEvent(new Event("scroll"));
    expect(viewport.scrollTop).toBe(80);

    scrollPortBinding.showLatest();
    expect(viewport.scrollTop).toBe(80);

    layoutSettled = true;
    await settleThreadStreamRender(viewport);

    expect(viewport.scrollTop).toBe(140);
  });

  it("completes bottom pinning after the thread stream viewport commits", async () => {
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
    const { context, scrollPortBinding } = threadStreamSurface(state, vi.fn(), "/vault");

    renderThreadStreamSurface(parent, context, scrollPortBinding, state);
    const viewport = threadStreamViewport(parent);
    installThreadStreamViewportMetrics(viewport, { clientHeight: 100, scrollHeight: 1000 });
    scrollPortBinding.showLatest();
    await settleThreadStreamRender(viewport);

    expect(viewport.scrollTop).toBe(900);
  });

  it("does not force the bottom into view when the user is reading older viewport", async () => {
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
    const { context, scrollPortBinding } = threadStreamSurface(state);

    const viewport = parent.createDiv({ cls: "codex-panel__thread-stream" });
    installThreadStreamViewportMetrics(viewport);
    renderThreadStreamSurface(viewport, context, scrollPortBinding, state);
    await settleThreadStreamRender(viewport);

    Object.defineProperty(viewport, "scrollHeight", { value: 1000, configurable: true });
    installThreadStreamViewportMetrics(viewport, { clientHeight: 100 });
    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll"));

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
    renderThreadStreamSurface(viewport, context, scrollPortBinding, state);
    await settleThreadStreamRender(viewport);

    expect(viewport.scrollTop).toBe(100);
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
    const { context, scrollPortBinding } = threadStreamSurface(state);

    const viewport = parent.createDiv({ cls: "codex-panel__thread-stream" });
    Object.defineProperty(viewport, "scrollHeight", { value: 1000, configurable: true });
    installThreadStreamViewportMetrics(viewport, { clientHeight: 100 });
    viewport.scrollTop = 920;
    renderThreadStreamSurface(viewport, context, scrollPortBinding, state);

    viewport.scrollTop = 100;
    viewport.dispatchEvent(new Event("scroll"));
    await settleThreadStreamRender(viewport);

    expect(viewport.scrollTop).toBe(100);
  });
});

function testThreadStreamSurfaceContext(options: {
  vaultPath: string;
  dispatch: (action: ChatAction) => void;
}): ChatThreadStreamSurfaceContext {
  return {
    panelId: "test-panel",
    vaultPath: options.vaultPath,
    setDisclosureOpen: (bucket, id, open) => {
      options.dispatch({ type: "ui/disclosure-set", bucket, id, open });
    },
    setForkMenuItem: (itemId) => {
      options.dispatch({ type: "ui/thread-stream-fork-menu-set", itemId });
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

interface TestThreadStreamSurface {
  context: ChatThreadStreamSurfaceContext;
  scrollPortBinding: ChatThreadStreamScrollBinding;
  stateStore: ChatStateStore;
}

function threadStreamSurface(
  state = chatStateFixture(),
  openLinkText = vi.fn(),
  vaultPath = "/vault",
  vaultFiles: string[] = [],
): TestThreadStreamSurface {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  const scrollPortBinding = createChatThreadStreamScrollBinding();
  const stateStore = testStoreForState(state);
  const context = createChatThreadStreamSurfaceContext({
    panelId: "test-panel",
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
    stateStore,
    vaultPath,
    loadOlderTurns: vi.fn(),
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
  return { context, scrollPortBinding, stateStore };
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
  if (!viewport) throw new Error("Expected thread stream viewport to be mounted.");
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
