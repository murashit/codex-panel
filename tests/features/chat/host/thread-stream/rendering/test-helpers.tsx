import type { ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import type { PendingApproval, PendingUserInput } from "../../../../../../src/features/chat/domain/pending-requests/model";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamViewBlocks } from "../../../../../../src/features/chat/host/thread-stream/blocks";
import { pendingRequestBlockSnapshotFromState } from "../../../../../../src/features/chat/host/thread-stream/pending-requests";
import type {
  PendingRequestBlockActions,
  PendingRequestBlockContext,
  ThreadStreamContext,
  ThreadStreamDisclosureState,
} from "../../../../../../src/features/chat/ui/thread-stream/context";
import type { ThreadStreamScrollPortBinding } from "../../../../../../src/features/chat/ui/thread-stream/flow-scroll.measure";
import type {
  PendingRequestBlockSnapshot,
  ThreadStreamTextActionTargets,
  ThreadStreamViewBlock,
} from "../../../../../../src/features/chat/ui/thread-stream/model";
import { pendingRequestBlockNode } from "../../../../../../src/features/chat/ui/thread-stream/pending-request-block.dom";
import { ThreadStreamViewport } from "../../../../../../src/features/chat/ui/thread-stream/stream-blocks";
import { renderUiRoot, unmountUiRoot } from "../../../../../../src/shared/dom/preact-root.dom";

export function projectedThreadStreamBlocks(context: TestThreadStreamContext): [ThreadStreamViewBlock, ...ThreadStreamViewBlock[]] {
  const normalized = normalizeThreadStreamContext(context);
  const blocks = threadStreamViewBlocks({
    activeThreadId: normalized.activeThreadId,
    activeTurnId: activeTurnIdForThreadStream(normalized.turnLifecycle),
    historyCursor: normalized.historyCursor,
    loadingHistory: normalized.loadingHistory,
    items: normalized.items,
    stableItems: normalized.stableItems ?? (normalized.turnLifecycle.kind === "running" ? [] : normalized.items),
    activeItems: normalized.activeItems ?? (normalized.turnLifecycle.kind === "running" ? normalized.items : []),
    workspaceRoot: normalized.workspaceRoot,
    turnDiffs: normalized.turnDiffs ?? new Map(),
    textActionTargetsByItemId: normalized.textActionTargetsByItemId ?? new Map(),
    pendingRequests: pendingRequestBlockInput(normalized),
    subagentActivities: new Map(),
    authRecovery: null,
  });
  if (blocks.length === 0) throw new Error("Expected at least one thread stream block.");
  for (const block of blocks) threadStreamContextByBlock.set(block, normalized);
  return blocks as [ThreadStreamViewBlock, ...ThreadStreamViewBlock[]];
}

const threadStreamContextByBlock = new WeakMap<ThreadStreamViewBlock, ThreadStreamContext>();

function pendingRequestBlockInput(context: TestThreadStreamContext): { signature: string; snapshot: PendingRequestBlockSnapshot } | null {
  if (threadStreamBlockItemsEmpty(context)) return null;
  const pendingRequests = context.pendingRequests;
  const signature = pendingRequests?.signature;
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequests.snapshot(),
  };
}

function threadStreamBlockItemsEmpty(context: TestThreadStreamContext): boolean {
  if (!context.stableItems && !context.activeItems) return context.items.length === 0;
  return (context.stableItems?.length ?? 0) === 0 && (context.activeItems?.length ?? 0) === 0;
}

type TestThreadStreamContext = Omit<
  ThreadStreamContext,
  | "activeThreadId"
  | "copyText"
  | "disclosures"
  | "forkMenuItemId"
  | "loadOlderTurns"
  | "onDisclosureToggle"
  | "onFork"
  | "onForkMenuToggle"
  | "onImplementPlan"
  | "onRollback"
  | "openThreadInNewView"
  | "openTurnDiff"
  | "pendingRequests"
  | "renderObsidianMarkdown"
  | "renderStreamMarkdown"
> &
  Partial<
    Pick<
      ThreadStreamContext,
      | "activeThreadId"
      | "copyText"
      | "disclosures"
      | "forkMenuItemId"
      | "loadOlderTurns"
      | "onDisclosureToggle"
      | "onFork"
      | "onForkMenuToggle"
      | "onImplementPlan"
      | "onRollback"
      | "openThreadInNewView"
      | "openTurnDiff"
      | "renderObsidianMarkdown"
      | "renderStreamMarkdown"
    >
  > & {
    renderMarkdown?: (parent: HTMLElement, text: string) => void;
    turnLifecycle?: ThreadStreamTurnLifecycleState;
    historyCursor?: string | null;
    loadingHistory?: boolean;
    items: readonly ThreadStreamItem[];
    stableItems?: readonly ThreadStreamItem[];
    activeItems?: readonly ThreadStreamItem[];
    workspaceRoot?: string;
    turnDiffs?: ReadonlyMap<string, string>;
    textActionTargetsByItemId?: ReadonlyMap<string, ThreadStreamTextActionTargets>;
    pendingRequests?: TestPendingRequestContext;
  };

interface TestPendingRequestContext extends PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestBlockSnapshot;
}

type ThreadStreamTurnLifecycleState =
  | { kind: "idle" }
  | { kind: "starting"; pendingTurnStart: unknown }
  | { kind: "running"; turnId: string };

type NormalizedTestThreadStreamContext = ThreadStreamContext &
  Omit<TestThreadStreamContext, "activeThreadId" | "historyCursor" | "loadingHistory" | "loadOlderTurns" | "turnLifecycle"> & {
    activeThreadId: string | null;
    historyCursor: string | null;
    loadingHistory: boolean;
    loadOlderTurns: () => void;
    workspaceRoot: string;
    turnLifecycle: ThreadStreamTurnLifecycleState;
  };

function emptyDisclosures(): ThreadStreamDisclosureState {
  return testDisclosures();
}

export function testDisclosures(
  overrides: Partial<Record<keyof ThreadStreamDisclosureState, readonly string[]>> = {},
): ThreadStreamDisclosureState {
  return {
    details: new Set(overrides.details),
    activityGroups: new Set(overrides.activityGroups),
    textDetails: new Set(overrides.textDetails),
    userDialogueExpanded: new Set(overrides.userDialogueExpanded),
  };
}

function normalizeThreadStreamContext(context: TestThreadStreamContext): NormalizedTestThreadStreamContext {
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
    workspaceRoot: context.workspaceRoot ?? "/vault",
    disclosures: context.disclosures ?? emptyDisclosures(),
    forkMenuItemId: context.forkMenuItemId ?? null,
    onDisclosureToggle: context.onDisclosureToggle ?? vi.fn(),
    onForkMenuToggle: context.onForkMenuToggle ?? vi.fn(),
    copyText: context.copyText ?? vi.fn(),
    onImplementPlan: context.onImplementPlan ?? vi.fn(),
    onRollback: context.onRollback ?? vi.fn(),
    onFork: context.onFork ?? vi.fn(),
    openTurnDiff: context.openTurnDiff ?? vi.fn(),
    openThreadInNewView: context.openThreadInNewView ?? vi.fn(),
    pendingRequests:
      context.pendingRequests ??
      ({
        signature: "",
        snapshot: emptyPendingRequestSnapshot,
        controlNamespace: "test-panel",
        actions: pendingRequestActions(),
        consumeAutoFocus: () => false,
      } satisfies TestPendingRequestContext),
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

export function renderThreadStreamBlockElement(block: ThreadStreamViewBlock): HTMLElement {
  const parent = document.createElement("div");
  renderThreadStreamBlocksInAct(parent, [block]);
  const host = expectPresent(parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${block.key}"]`));
  return expectPresent(host.firstElementChild as HTMLElement | null);
}

export function actEvent(action: () => void): void {
  void act(action);
}

export function renderThreadStreamBlocksInAct(parent: HTMLElement, blocks: ThreadStreamViewBlock[]): void {
  parent.addClass("codex-panel__thread-stream");
  installThreadStreamViewportMetrics(parent);
  if (!parent.isConnected) document.body.appendChild(parent);
  const context = threadStreamContextForBlocks(blocks);
  void act(() => {
    renderUiRoot(
      parent,
      <ThreadStreamViewport
        state={{
          blocks,
          context,
          scrollPortBinding: noOpThreadStreamScrollPortBinding,
        }}
      />,
    );
  });
}

const noOpThreadStreamScrollPortBinding: ThreadStreamScrollPortBinding = {
  mountScrollPort: () => () => undefined,
};

function threadStreamContextForBlocks(blocks: readonly ThreadStreamViewBlock[]): ThreadStreamContext {
  const context = blocks.map((block) => threadStreamContextByBlock.get(block)).find((candidate) => candidate !== undefined);
  if (!context) throw new Error("Expected thread stream blocks created by threadStreamBlocks().");
  return context;
}

function installThreadStreamViewportMetrics(
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
  controlNamespace = "test-panel",
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
    pendingRequestBlockNode({
      snapshot,
      actions,
      consumeAutoFocus: autoFocusRequested ? () => true : (consumeAutoFocus ?? (() => false)),
      autoFocusSignature,
      controlNamespace,
    }),
  );
}

export function pendingRequestActions(overrides: Partial<PendingRequestBlockActions> = {}): PendingRequestBlockActions {
  return {
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    skipUserInput: vi.fn(),
    cancelUserInput: vi.fn(),
    resolveMcpElicitation: vi.fn(),
    setApprovalDetailsExpanded: vi.fn(),
    setUserInputDraft: vi.fn(),
    setMcpElicitationDraft: vi.fn(),
    ...overrides,
  };
}

function emptyPendingRequestSnapshot(): PendingRequestBlockSnapshot {
  return pendingRequestBlockSnapshotFromState({
    approvals: [],
    pendingUserInputs: [],
    pendingMcpElicitations: [],
    userInputDrafts: new Map(),
    mcpElicitationDrafts: new Map(),
    approvalDetails: new Set(),
  });
}

export function idleTurnLifecycle(): ThreadStreamTurnLifecycleState {
  return { kind: "idle" };
}

export function runningTurnLifecycle(turnId = "turn"): ThreadStreamTurnLifecycleState {
  return { kind: "running", turnId };
}

function activeTurnIdForThreadStream(lifecycle: ThreadStreamTurnLifecycleState): string | null {
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

export function withStreamItemContentScrollHeight<T>(scrollHeight: number, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.classList.contains("codex-panel__stream-item-content") ? scrollHeight : 0;
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
    autoResolutionAtMs: null,
    params: {
      turnId: "turn",
      isBlocking: true,
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
    actionOptions: null,
  };
}
