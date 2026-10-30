import type { ComponentChild as UiNode } from "preact";
import { act } from "preact/test-utils";
import { vi } from "vitest";
import type { PendingApproval, PendingUserInput } from "../../../../../../src/features/chat/domain/pending-requests/model";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamViewBlocks } from "../../../../../../src/features/chat/ui/thread-stream/blocks";
import type {
  PendingRequestBlockActions,
  PendingRequestBlockContext,
  ThreadStreamContext,
  ThreadStreamDisclosureState,
} from "../../../../../../src/features/chat/ui/thread-stream/context";
import type { ThreadStreamScrollPortBinding } from "../../../../../../src/features/chat/ui/thread-stream/flow-scroll";
import type {
  PendingRequestBlockSnapshot,
  ThreadStreamTextActionTargets,
  ThreadStreamViewBlock,
} from "../../../../../../src/features/chat/ui/thread-stream/model";
import { pendingRequestBlockNode } from "../../../../../../src/features/chat/ui/thread-stream/pending-request-block.dom";
import { pendingRequestBlockSnapshotFromState } from "../../../../../../src/features/chat/ui/thread-stream/pending-requests";
import { ThreadStreamViewport } from "../../../../../../src/features/chat/ui/thread-stream/stream-blocks";
import { renderUiRoot, unmountUiRoot } from "../../../../../../src/shared/ui/preact-root.dom";
import { serverRequestActionsFixture } from "../../../support/thread-stream-dependencies";

interface TestThreadStreamProjection {
  blocks: ThreadStreamViewBlock[];
  context: ThreadStreamContext;
}

export function projectedThreadStream(context: TestThreadStreamContext): TestThreadStreamProjection {
  const normalized = normalizeThreadStreamContext(context);
  const blocks = threadStreamViewBlocks({
    activeThreadId: normalized.activeThreadId,
    activeTurnId: normalized.activeTurnId ?? null,
    historyCursor: normalized.historyCursor,
    loadingHistory: normalized.loadingHistory,
    items: normalized.items,
    workspaceRoot: normalized.workspaceRoot,
    turnDiffs: normalized.turnDiffs ?? new Map(),
    textActionTargetsByItemId: normalized.textActionTargetsByItemId ?? new Map(),
    pendingRequests: pendingRequestBlockInput(normalized),
    subagentActivities: new Map(),
    authRecovery: null,
  });
  return { blocks, context: normalized };
}

function pendingRequestBlockInput(context: TestThreadStreamContext): { signature: string; snapshot: PendingRequestBlockSnapshot } | null {
  const pendingRequests = context.pendingRequests;
  const signature = pendingRequests?.signature;
  if (!signature) return null;
  return {
    signature,
    snapshot: pendingRequests.snapshot(),
  };
}

type TestThreadStreamContext = Partial<Omit<ThreadStreamContext, "pendingRequests">> & {
  renderMarkdown?: (parent: HTMLElement, text: string) => void;
  activeTurnId?: string | null;
  historyCursor?: string | null;
  loadingHistory?: boolean;
  items: readonly ThreadStreamItem[];
  workspaceRoot?: string;
  turnDiffs?: ReadonlyMap<string, string>;
  textActionTargetsByItemId?: ReadonlyMap<string, ThreadStreamTextActionTargets>;
  pendingRequests?: TestPendingRequestContext;
};

interface TestPendingRequestContext extends PendingRequestBlockContext {
  signature: string;
  snapshot: () => PendingRequestBlockSnapshot;
}

type NormalizedTestThreadStreamContext = ThreadStreamContext &
  Omit<TestThreadStreamContext, "activeThreadId" | "historyCursor" | "loadingHistory" | "loadOlderTurns"> & {
    activeThreadId: string | null;
    historyCursor: string | null;
    loadingHistory: boolean;
    loadOlderTurns: () => void;
    workspaceRoot: string;
  };

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
    historyCursor: context.historyCursor ?? null,
    loadingHistory: context.loadingHistory ?? false,
    loadOlderTurns: context.loadOlderTurns ?? vi.fn(),
    workspaceRoot: context.workspaceRoot ?? "/vault",
    disclosures: context.disclosures ?? testDisclosures(),
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

export function renderThreadStreamBlockElement(block: ThreadStreamViewBlock, context: ThreadStreamContext): HTMLElement {
  const parent = document.createElement("div");
  renderThreadStreamBlocksInAct(parent, { blocks: [block], context });
  const host = expectPresent(parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${block.key}"]`));
  return expectPresent(host.firstElementChild as HTMLElement | null);
}

export function actEvent(action: () => void): void {
  void act(action);
}

export function renderThreadStreamBlocksInAct(parent: HTMLElement, { blocks, context }: TestThreadStreamProjection): void {
  parent.addClass("codex-panel__thread-stream");
  installThreadStreamViewportMetrics(parent);
  if (!parent.isConnected) document.body.appendChild(parent);
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
  drafts: ReadonlyMap<string, string>,
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
    userInputDrafts: drafts,
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
    ...serverRequestActionsFixture(),
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
