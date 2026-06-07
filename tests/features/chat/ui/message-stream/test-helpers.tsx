import { vi } from "vitest";
import type { ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";

import type { PendingApproval } from "../../../../../src/features/chat/requests/approvals/model";
import type { PendingUserInput } from "../../../../../src/features/chat/requests/user-input/model";
import { pendingRequestMessageNode, type PendingRequestMessageActions } from "../../../../../src/features/chat/ui/pending-request-message";
import type { ChatTurnLifecycleState } from "../../../../../src/features/chat/chat-state";
import {
  type MessageStreamBlock,
  messageStreamBlocks as rawMessageStreamBlocks,
  renderMessageStreamBlocks,
} from "../../../../../src/features/chat/ui/message-stream";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";

export function messageStreamBlocks(
  ...args: Parameters<typeof rawMessageStreamBlocks>
): [ReturnType<typeof rawMessageStreamBlocks>[number], ...ReturnType<typeof rawMessageStreamBlocks>] {
  const blocks = rawMessageStreamBlocks(...args);
  if (blocks.length === 0) throw new Error("Expected at least one message stream block.");
  return blocks as [ReturnType<typeof rawMessageStreamBlocks>[number], ...ReturnType<typeof rawMessageStreamBlocks>];
}

export function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

export function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (!valueDescriptor?.set) throw new Error("Missing input value setter");
  valueDescriptor.set.call(input, value);
}

export function dispatchComposingInputValue(input: HTMLInputElement, value: string): void {
  setNativeInputValue(input, value);
  const event = new Event("input", { bubbles: true });
  Object.defineProperty(event, "isComposing", { value: true });
  input.dispatchEvent(event);
}

export function renderMessageBlockElement(block: ReturnType<typeof rawMessageStreamBlocks>[number]): HTMLElement {
  const parent = document.createElement("div");
  renderMessageStreamBlocksInAct(parent, [block]);
  const host = expectPresent(parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${block.key}"]`));
  return expectPresent(host.firstElementChild as HTMLElement | null);
}

export function actEvent(action: () => void): void {
  void act(action);
}

export function renderMessageStreamBlocksInAct(parent: HTMLElement, blocks: MessageStreamBlock[]): void {
  void act(() => {
    renderMessageStreamBlocks(parent, blocks);
  });
}

export function renderUiRootInAct(parent: HTMLElement, node: UiNode): void {
  void act(() => {
    renderUiRoot(parent, node);
  });
}

export function unmountUiRootInAct(parent: HTMLElement): void {
  void act(() => {
    unmountUiRoot(parent);
  });
}

export function renderPendingRequestNode(parent: HTMLElement, ...args: Parameters<typeof pendingRequestMessageNode>): void {
  renderUiRootInAct(parent, pendingRequestMessageNode(...args));
}

export function pendingRequestActions(overrides: Partial<PendingRequestMessageActions> = {}): PendingRequestMessageActions {
  return {
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    cancelUserInput: vi.fn(),
    setUserInputDraft: vi.fn(),
    ...overrides,
  };
}

export function idleTurnLifecycle(): ChatTurnLifecycleState {
  return { kind: "idle" };
}

export function runningTurnLifecycle(turnId = "turn"): ChatTurnLifecycleState {
  return { kind: "running", turnId };
}

export function startingTurnLifecycle(): ChatTurnLifecycleState {
  return { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] } };
}

export function withMessageContentScrollHeight<T>(scrollHeight: number, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.classList.contains("codex-panel__message-content") ? scrollHeight : 0;
    },
  });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  }
}

export function pendingUserInput(): PendingUserInput {
  return {
    requestId: 99,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "How broad?",
          isOther: false,
          isSecret: false,
          options: [{ label: "Narrow", description: "Small change" }],
        },
      ],
    },
  };
}

export function pendingOtherUserInput(): PendingUserInput {
  const input = pendingUserInput();
  return {
    ...input,
    params: {
      ...input.params,
      questions: [
        {
          ...expectPresent(input.params.questions[0]),
          isOther: true,
          options: [{ label: "Narrow", description: "Small change" }],
        },
      ],
    },
  };
}

export function pendingFreeformUserInput(): PendingUserInput {
  const input = pendingUserInput();
  return {
    ...input,
    params: {
      ...input.params,
      questions: [
        {
          ...expectPresent(input.params.questions[0]),
          options: null,
        },
      ],
    },
  };
}

export function pendingApproval(): PendingApproval {
  return {
    requestId: 42,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "permission",
      environmentId: null,
      startedAtMs: 1,
      cwd: "/vault",
      reason: "Need network",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  };
}
