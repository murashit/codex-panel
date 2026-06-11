// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import {
  chatReducer,
  createChatState,
  type ChatAction,
  type ChatState,
  type ChatStateStore,
} from "../../../../../src/features/chat/state/reducer";
import {
  ChatMessageRenderer,
  bindRenderedWikiLinks,
  type RenderedMarkdownLinkContext,
} from "../../../../../src/features/chat/ui/message-stream";
import type { MessageStreamScrollIntent } from "../../../../../src/features/chat/ui/message-virtualizer";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";
import { installMessageViewportMetrics } from "./test-helpers";

const ESTIMATED_MESSAGE_BLOCK_HEIGHT = 96;

installObsidianDomShims();

describe("ChatMessageRenderer scroll pinning", () => {
  beforeEach(() => {
    notices.length = 0;
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
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    renderUiRoot(parent, renderer.renderNode());
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    renderer.forceMessagesToBottom();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("can repin the current scroll container after composer growth shrinks the viewport", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    renderUiRoot(parent, renderer.renderNode());
    const messages = messageViewport(parent);
    Object.defineProperty(messages, "scrollHeight", { value: ESTIMATED_MESSAGE_BLOCK_HEIGHT, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 160 });
    messages.scrollTop = 1000;
    await settleMessageRender(messages);

    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 940;

    renderer.forceMessagesToBottom();

    expect(messages.scrollTop).toBe(0);
  });

  it("repins after composer growth has changed the scroll viewport height", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

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
    renderUiRoot(messages, renderer.renderNode());
    await settleMessageRender(messages);
    expect(messages.scrollTop).toBe(0);

    renderer.forceMessagesToBottom();
    expect(messages.scrollTop).toBe(0);

    layoutSettled = true;
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(0);
  });

  it("treats scroll commands as no-ops when no message stream virtualizer is mounted", () => {
    const renderer = chatMessageRenderer();

    expect(() => {
      renderer.forceMessagesToBottom();
      renderer.repinMessagesToBottomIfPinned();
      renderer.scrollFromComposer({ direction: 1, amount: "text-lines" });
      renderer.scrollFromComposer({ direction: -1, amount: "page" });
      renderer.dispose();
      renderer.forceMessagesToBottom();
    }).not.toThrow();
  });

  it("detaches the active virtualizer when the message stream unmounts", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);
    renderUiRoot(parent, renderer.renderNode());
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages);
    await settleMessageRender(messages);

    unmountUiRoot(parent);

    expect(() => {
      renderer.forceMessagesToBottom();
      renderer.scrollFromComposer({ direction: 1, amount: "page" });
    }).not.toThrow();
  });

  it("binds scroll commands to the currently mounted message viewport", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);
    renderUiRoot(parent, renderer.renderNode());
    const oldMessages = messageViewport(parent);
    installMessageViewportMetrics(oldMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleMessageRender(oldMessages);

    unmountUiRoot(parent);

    renderUiRoot(parent, renderer.renderNode());
    const newMessages = messageViewport(parent);
    installMessageViewportMetrics(newMessages, { clientHeight: 100, scrollHeight: 1000 });
    await settleMessageRender(newMessages);
    renderer.forceMessagesToBottom();

    expect(newMessages.scrollTop).toBe(900);
  });

  it("completes bottom pinning after the message viewport commits", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state, vi.fn(), "/vault", [], () => "force-bottom");

    renderUiRoot(parent, renderer.renderNode());
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 100, scrollHeight: 1000 });
    renderer.forceMessagesToBottom();
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(900);
  });

  it("does not force the bottom into view when the user is reading older messages", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Initial message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    installMessageViewportMetrics(messages);
    renderUiRoot(messages, renderer.renderNode());
    await settleMessageRender(messages);

    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Updated streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    renderUiRoot(messages, renderer.renderNode());
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not run a pending bottom pin after the user scrolls away", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Streaming message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    installMessageViewportMetrics(messages, { clientHeight: 100 });
    messages.scrollTop = 920;
    renderUiRoot(messages, renderer.renderNode());

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
    state.transcript.displayItems = [
      {
        id: "message",
        kind: "message",
        role: "assistant",
        text: "Rendered message",
        turnId: "turn",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    renderUiRoot(parent, renderer.renderNode());
    let messages = messageViewport(parent);
    installMessageViewportMetrics(messages);
    renderUiRoot(parent, renderer.renderNode());
    messages = messageViewport(parent);
    await settleMessageRender(messages);
    expect(parent.querySelector(".codex-panel__messages")).not.toBeNull();

    renderer.dispose();

    expect(parent.querySelector(".codex-panel__messages")).not.toBeNull();
  });

  it("does not mount every block before the virtualizer attaches", async () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.transcript.displayItems = Array.from({ length: 200 }, (_value, index) => ({
      id: `message-${String(index)}`,
      kind: "message",
      role: "assistant",
      text: `Message ${String(index)}`,
      turnId: "turn",
      messageKind: "assistantResponse",
      messageState: "completed",
    }));
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    renderUiRoot(parent, renderer.renderNode());
    const messages = messageViewport(parent);
    installMessageViewportMetrics(messages, { clientHeight: 320, scrollHeight: 19_200 });
    await settleMessageRender(messages);

    expect(parent.querySelectorAll("[data-codex-panel-block-key]").length).toBeLessThan(state.transcript.displayItems.length);
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

function chatMessageRenderer(
  state = createChatState(),
  openLinkText = vi.fn(),
  vaultPath = "/vault",
  vaultFiles: string[] = [],
  consumeIntent: () => MessageStreamScrollIntent = () => "auto",
): ChatMessageRenderer {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  return new ChatMessageRenderer({
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
      pendingSnapshot: () => ({ approvals: [], pendingUserInputs: [], userInputDrafts: new Map(), openDetails: new Set() }),
      pendingActions: () => ({
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        setUserInputDraft: vi.fn(),
      }),
      consumePendingAutoFocus: () => false,
    },
  });
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
