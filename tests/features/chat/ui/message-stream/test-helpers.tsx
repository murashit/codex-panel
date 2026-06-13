import { vi } from "vitest";
import type { ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";

import type { PendingApproval } from "../../../../../src/features/chat/protocol/server-requests/approval";
import type { PendingUserInput } from "../../../../../src/features/chat/protocol/server-requests/user-input";
import { pendingRequestBlockSnapshotFromRequests } from "../../../../../src/features/chat/conversation/pending-requests/snapshot";
import type { PendingRequestBlockActions } from "../../../../../src/features/chat/conversation/pending-requests/view-model";
import { pendingRequestBlockNode } from "../../../../../src/features/chat/ui/message-stream/pending-request-block";
import type { ChatTurnLifecycleState } from "../../../../../src/features/chat/state/reducer";
import { messageStreamBlocks as rawMessageStreamBlocks } from "../../../../../src/features/chat/ui/message-stream/stream-blocks";
import type { MessageStreamBlock } from "../../../../../src/features/chat/ui/message-stream/context";
import { MessageStreamViewport } from "../../../../../src/features/chat/ui/message-stream/viewport";
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
  parent.addClass("codex-panel__messages");
  installMessageViewportMetrics(parent);
  if (!parent.isConnected) document.body.appendChild(parent);
  void act(() => {
    renderUiRoot(
      parent,
      <MessageStreamViewport
        state={{
          blocks,
          consumeScrollIntent: () => "auto",
        }}
      />,
    );
  });
}

export function installMessageViewportMetrics(
  element: HTMLElement,
  metrics: { clientHeight?: number; clientWidth?: number; scrollHeight?: number } = {},
): void {
  const clientHeight = metrics.clientHeight ?? 320;
  const clientWidth = metrics.clientWidth ?? 240;
  const scrollHeight = metrics.scrollHeight ?? element.scrollHeight;
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(element, "offsetWidth", { value: clientWidth, configurable: true });
  element.scrollTo = ((optionsOrX?: ScrollToOptions | number, y?: number) => {
    const top = typeof optionsOrX === "number" ? (y ?? element.scrollTop) : (optionsOrX?.top ?? element.scrollTop);
    element.scrollTop = Math.max(0, top);
  }) as typeof element.scrollTo;
}

function renderUiRootInAct(parent: HTMLElement, node: UiNode): void {
  void act(() => {
    renderUiRoot(parent, node);
  });
}

export function unmountUiRootInAct(parent: HTMLElement): void {
  void act(() => {
    unmountUiRoot(parent);
  });
}

export function renderPendingRequestNode(
  parent: HTMLElement,
  approvals: readonly PendingApproval[],
  pendingUserInputs: readonly PendingUserInput[],
  drafts: {
    values: ReadonlyMap<string, string>;
    draftKey?: (requestId: PendingUserInput["requestId"], questionId: string) => string;
    otherDraftKey?: (requestId: PendingUserInput["requestId"], questionId: string) => string;
  },
  openDetails: ReadonlySet<string>,
  actions: PendingRequestBlockActions,
  autoFocusRequested = false,
  consumeAutoFocus?: () => boolean,
  autoFocusSignature = "",
): void {
  const snapshot = pendingRequestBlockSnapshotFromRequests({
    approvals,
    pendingUserInputs,
    userInputDrafts: drafts.values,
    openDetails,
  });
  renderUiRootInAct(
    parent,
    pendingRequestBlockNode(
      snapshot.approvals,
      snapshot.pendingUserInputs,
      snapshot.userInputDrafts,
      snapshot.openDetails,
      actions,
      autoFocusRequested,
      consumeAutoFocus,
      autoFocusSignature,
    ),
  );
}

export function pendingRequestActions(overrides: Partial<PendingRequestBlockActions> = {}): PendingRequestBlockActions {
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
