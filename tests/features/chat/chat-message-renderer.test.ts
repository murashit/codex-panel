// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { ChatMessageRenderer } from "../../../src/features/chat/chat-message-renderer";
import { chatReducer, createChatState, type ChatAction, type ChatState, type ChatStateStore } from "../../../src/features/chat/chat-state";
import { bindRenderedWikiLinks, type RenderedMarkdownLinkContext } from "../../../src/features/chat/markdown-message-renderer";
import { installObsidianDomShims } from "./ui/dom-test-helpers";
import { notices } from "../../mocks/obsidian";

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
    state.activeThreadId = "thread";
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Streaming message", turnId: "turn" }];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 920;

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    renderer.render(messages);
    await settleMessageRender(messages);

    expect(messages.scrollTop).toBe(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(state.messagesPinnedToBottom).toBe(true);
  });

  it("does not force the bottom into view when the user is reading older messages", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Initial message", turnId: "turn" }];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    renderer.render(messages);
    await settleMessageRender(messages);

    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    expect(state.messagesPinnedToBottom).toBe(false);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Updated streaming message", turnId: "turn" }];
    renderer.render(messages);
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(state.messagesPinnedToBottom).toBe(false);
  });

  it("does not run a pending bottom pin after the user scrolls away", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Streaming message", turnId: "turn" }];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 920;
    renderer.render(messages);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(state.messagesPinnedToBottom).toBe(false);
  });

  it("unmounts the React message stream root on dispose", () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Rendered message", turnId: "turn" }];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    const messages = parent.createDiv({ cls: "codex-panel__messages" });
    renderer.render(messages);
    expect(messages.querySelector('[data-codex-panel-block-key="item:message"]')).not.toBeNull();

    renderer.dispose();

    expect(messages.querySelector('[data-codex-panel-block-key="item:message"]')).toBeNull();
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
): ChatMessageRenderer {
  const files = new Map(vaultFiles.map((path) => [path, tFile(path)]));
  return new ChatMessageRenderer({
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
    stateStore: testStoreForState(state),
    vaultPath,
    consumeScrollIntent: () => "auto",
    loadOlderTurns: vi.fn(),
    rollbackThread: vi.fn(),
    forkThreadFromTurn: vi.fn(),
    implementPlan: vi.fn(),
    openTurnDiff: vi.fn(),
    pendingRequestsSignature: () => "",
    renderPendingRequests: () => null,
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

async function settleMessageRender(element: HTMLElement): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    element.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}
