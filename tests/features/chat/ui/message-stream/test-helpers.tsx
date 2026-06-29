import type { ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import type { PendingApproval, PendingUserInput } from "../../../../../src/domain/pending-requests/model";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import type { MessageStreamTextActionTargets } from "../../../../../src/features/chat/presentation/message-stream/text-view";
import {
  type MessageStreamViewBlock,
  messageStreamViewBlocks,
} from "../../../../../src/features/chat/presentation/message-stream/view-model";
import { pendingRequestBlockSnapshotFromState } from "../../../../../src/features/chat/presentation/pending-requests/view-model";
import type {
  MessageStreamContext,
  MessageStreamDisclosureState,
  PendingRequestBlockActions,
  PendingRequestBlockContext,
} from "../../../../../src/features/chat/ui/message-stream/context";
import type { MessageStreamScrollControllerBinding } from "../../../../../src/features/chat/ui/message-stream/flow-scroll.measure";
import { pendingRequestBlockNode } from "../../../../../src/features/chat/ui/message-stream/pending-request-block";
import { MessageStreamViewport } from "../../../../../src/features/chat/ui/message-stream/stream-blocks";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root.dom";

export function messageStreamBlocks(context: TestMessageStreamContext): [MessageStreamViewBlock, ...MessageStreamViewBlock[]] {
  const normalized = normalizeMessageStreamContext(context);
  const blocks = messageStreamViewBlocks({
    activeThreadId: normalized.activeThreadId,
    activeTurnId: activeTurnIdForMessageStream(normalized.turnLifecycle),
    historyCursor: normalized.historyCursor,
    loadingHistory: normalized.loadingHistory,
    items: normalized.items,
    stableItems: normalized.stableItems,
    activeItems: normalized.activeItems,
    workspaceRoot: normalized.workspaceRoot,
    turnDiffs: normalized.turnDiffs,
    textActionTargetsByItemId: normalized.textActionTargetsByItemId,
    pendingRequests: pendingRequestBlockInput(normalized),
  });
  if (blocks.length === 0) throw new Error("Expected at least one message stream block.");
  for (const block of blocks) messageStreamContextByBlock.set(block, normalized);
  return blocks as [MessageStreamViewBlock, ...MessageStreamViewBlock[]];
}

const messageStreamContextByBlock = new WeakMap<MessageStreamViewBlock, MessageStreamContext>();

function pendingRequestBlockInput(
  context: TestMessageStreamContext,
): { signature: string; snapshot: ReturnType<PendingRequestBlockContext["snapshot"]> } | null {
  if (messageStreamBlockItemsEmpty(context)) return null;
  const pendingRequests = context.pendingRequests;
  const signature = pendingRequests?.signature;
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequests.snapshot(),
  };
}

function messageStreamBlockItemsEmpty(context: TestMessageStreamContext): boolean {
  if (!context.stableItems && !context.activeItems) return context.items.length === 0;
  return (context.stableItems?.length ?? 0) === 0 && (context.activeItems?.length ?? 0) === 0;
}

type TestMessageStreamContext = Omit<
  MessageStreamContext,
  "activeThreadId" | "disclosures" | "forkMenuItemId" | "loadOlderTurns" | "renderObsidianMarkdown" | "renderStreamMarkdown"
> &
  Partial<
    Pick<
      MessageStreamContext,
      "activeThreadId" | "disclosures" | "forkMenuItemId" | "loadOlderTurns" | "renderObsidianMarkdown" | "renderStreamMarkdown"
    >
  > & {
    renderMarkdown?: (parent: HTMLElement, text: string) => void;
    turnLifecycle?: MessageStreamTurnLifecycleState;
    historyCursor?: string | null;
    loadingHistory?: boolean;
    items: readonly MessageStreamItem[];
    stableItems?: readonly MessageStreamItem[];
    activeItems?: readonly MessageStreamItem[];
    turnDiffs?: ReadonlyMap<string, string>;
    textActionTargetsByItemId?: ReadonlyMap<string, MessageStreamTextActionTargets>;
  };

type MessageStreamTurnLifecycleState =
  | { kind: "idle" }
  | { kind: "starting"; pendingTurnStart: unknown }
  | { kind: "running"; turnId: string };

type NormalizedTestMessageStreamContext = MessageStreamContext &
  Omit<TestMessageStreamContext, "activeThreadId" | "historyCursor" | "loadingHistory" | "loadOlderTurns" | "turnLifecycle"> & {
    activeThreadId: string | null;
    historyCursor: string | null;
    loadingHistory: boolean;
    loadOlderTurns: () => void;
    turnLifecycle: MessageStreamTurnLifecycleState;
  };

function emptyDisclosures(): MessageStreamDisclosureState {
  return testDisclosures();
}

export function testDisclosures(
  overrides: Partial<Record<keyof MessageStreamDisclosureState, readonly string[]>> = {},
): MessageStreamDisclosureState {
  return {
    details: new Set(overrides.details),
    activityGroups: new Set(overrides.activityGroups),
    textDetails: new Set(overrides.textDetails),
    userMessageExpanded: new Set(overrides.userMessageExpanded),
    approvalDetails: new Set(overrides.approvalDetails),
  };
}

function normalizeMessageStreamContext(context: TestMessageStreamContext): NormalizedTestMessageStreamContext {
  const renderObsidianMarkdown =
    context.renderObsidianMarkdown ??
    context.renderMarkdown ??
    ((parent: HTMLElement, text: string) => {
      parent.createDiv({ text });
    });
  const renderStreamMarkdown = context.renderStreamMarkdown ?? context.renderMarkdown ?? renderObsidianMarkdown;
  return {
    ...context,
    activeThreadId: context.activeThreadId ?? "thread",
    turnLifecycle: context.turnLifecycle ?? idleTurnLifecycle(),
    historyCursor: context.historyCursor ?? null,
    loadingHistory: context.loadingHistory ?? false,
    loadOlderTurns: context.loadOlderTurns ?? vi.fn(),
    disclosures: context.disclosures ?? emptyDisclosures(),
    forkMenuItemId: context.forkMenuItemId ?? null,
    renderObsidianMarkdown,
    renderStreamMarkdown,
  };
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

export function renderMessageBlockElement(block: MessageStreamViewBlock): HTMLElement {
  const parent = document.createElement("div");
  renderMessageStreamBlocksInAct(parent, [block]);
  const host = expectPresent(parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${block.key}"]`));
  return expectPresent(host.firstElementChild as HTMLElement | null);
}

export function actEvent(action: () => void): void {
  void act(action);
}

export function renderMessageStreamBlocksInAct(parent: HTMLElement, blocks: MessageStreamViewBlock[]): void {
  parent.addClass("codex-panel__messages");
  installMessageViewportMetrics(parent);
  if (!parent.isConnected) document.body.appendChild(parent);
  const context = messageStreamContextForBlocks(blocks);
  void act(() => {
    renderUiRoot(
      parent,
      <MessageStreamViewport
        state={{
          blocks,
          context,
          scrollController: noOpMessageStreamScrollController,
        }}
      />,
    );
  });
}

const noOpMessageStreamScrollController: MessageStreamScrollControllerBinding = {
  mountScrollPort: () => () => undefined,
};

function messageStreamContextForBlocks(blocks: readonly MessageStreamViewBlock[]): MessageStreamContext {
  const context = blocks.map((block) => messageStreamContextByBlock.get(block)).find((candidate) => candidate !== undefined);
  if (!context) throw new Error("Expected message stream blocks created by messageStreamBlocks().");
  return context;
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
  approvalDetails: ReadonlySet<string>,
  actions: PendingRequestBlockActions,
  autoFocusRequested = false,
  consumeAutoFocus?: () => boolean,
  autoFocusSignature = "",
): void {
  const snapshot = pendingRequestBlockSnapshotFromState({
    approvals,
    pendingUserInputs,
    pendingMcpElicitations: [],
    userInputDrafts: drafts.values,
    mcpElicitationDrafts: new Map(),
    approvalDetails,
  });
  renderUiRootInAct(
    parent,
    pendingRequestBlockNode(
      snapshot.approvals,
      snapshot.pendingUserInputs,
      snapshot.pendingMcpElicitations,
      snapshot.userInputDrafts,
      snapshot.mcpElicitationDrafts,
      snapshot.approvalDetails,
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
    resolveMcpElicitation: vi.fn(),
    setUserInputDraft: vi.fn(),
    setMcpElicitationDraft: vi.fn(),
    ...overrides,
  };
}

export function idleTurnLifecycle(): MessageStreamTurnLifecycleState {
  return { kind: "idle" };
}

export function runningTurnLifecycle(turnId = "turn"): MessageStreamTurnLifecycleState {
  return { kind: "running", turnId };
}

function activeTurnIdForMessageStream(lifecycle: MessageStreamTurnLifecycleState): string | null {
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
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
      autoResolutionMs: null,
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
    kind: "permission",
    turnId: "turn",
    title: "Permission approval",
    summary: "Need network\ncwd: /vault",
    resultSummary: "Need network",
    details: [
      { key: "reason", value: "Need network" },
      { key: "cwd", value: "/vault" },
      { key: "network", value: "enabled" },
    ],
    responses: {
      accept: { permissions: { network: { enabled: true } }, scope: "turn" },
      acceptSession: { permissions: { network: { enabled: true } }, scope: "session" },
      decline: { permissions: {}, scope: "turn" },
      cancel: { permissions: {}, scope: "turn" },
    },
    actionOptions: null,
  };
}
