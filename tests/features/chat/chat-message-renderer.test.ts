// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { ChatMessageRenderer } from "../../../src/features/chat/chat-message-renderer";
import { createChatState } from "../../../src/features/chat/chat-state";
import { installObsidianDomShims } from "./ui/dom-test-helpers";

installObsidianDomShims();

describe("ChatMessageRenderer scroll pinning", () => {
  it("does not force the bottom into view when the user is reading older messages", async () => {
    const state = createChatState();
    state.activeThreadId = "thread";
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Initial message", turnId: "turn" }];
    const parent = document.createElement("div");
    const renderer = chatMessageRenderer(state);

    renderer.render(parent);
    const messages = parent.querySelector<HTMLElement>(".codex-panel__messages");
    expect(messages).not.toBeNull();
    if (!messages) return;
    await settleMessageRender(messages);

    Object.defineProperty(messages, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 100, configurable: true });
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    expect(state.messagesPinnedToBottom).toBe(false);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    state.displayItems = [{ id: "message", kind: "message", role: "assistant", text: "Updated streaming message", turnId: "turn" }];
    renderer.render(parent);
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
    renderer.render(parent);

    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    scrollIntoView.mockClear();
    messages.scrollTop = 100;
    messages.dispatchEvent(new Event("scroll"));
    await settleMessageRender(messages);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(state.messagesPinnedToBottom).toBe(false);
  });
});

function chatMessageRenderer(state = createChatState()): ChatMessageRenderer {
  return new ChatMessageRenderer({
    app: {
      workspace: {
        getActiveFile: vi.fn(() => null),
        openLinkText: vi.fn(),
      },
    } as never,
    owner: {} as never,
    state,
    vaultPath: "/vault",
    blockSignatures: new Map(),
    consumeScrollIntent: () => "auto",
    loadOlderTurns: vi.fn(),
    rollbackThread: vi.fn(),
    implementPlan: vi.fn(),
    openTurnDiff: vi.fn(),
    pendingRequestsSignature: () => "",
    renderPendingRequests: () => null,
  });
}

async function settleMessageRender(element: HTMLElement): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    element.win.requestAnimationFrame(() => {
      resolve();
    });
  });
}
