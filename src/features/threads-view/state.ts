import type { Thread } from "../../domain/threads/model";
import { threadRenameDraftTitle, threadUserTitle } from "../../domain/threads/title";
import type { OpenCodexPanelSnapshot } from "../../workspace/panel-coordinator";

type ThreadsLiveStatus = "needs-input" | "approval" | "running" | "draft" | "offline" | "open";

interface ThreadsLiveState {
  status: ThreadsLiveStatus;
  label: string;
  viewId: string;
  openPanels: number;
}

export interface ThreadsRowModel {
  thread: Thread;
  title: string;
  live: ThreadsLiveState | null;
  selected: boolean;
  rename: { active: boolean; draft: string; generating: boolean };
  archiveConfirm: { active: boolean; defaultSaveMarkdown: boolean };
}

export type ThreadsRenameState =
  | { kind: "editing"; draft: string }
  | { kind: "generating"; draft: string; originalDraft: string; generationToken: number };
export type ThreadsGeneratingRenameState = Extract<ThreadsRenameState, { kind: "generating" }>;
type ThreadsRenameLifecycleKind = ThreadsRenameState["kind"] | "idle";
export type ThreadsRenameLifecycleState = ThreadsRenameState | undefined;
export type ThreadsRenameLifecycleEvent =
  | { type: "started"; draft: string }
  | { type: "draft-updated"; draft: string }
  | { type: "cancelled" }
  | { type: "auto-name-started"; generationToken: number }
  | { type: "auto-name-generated"; generatingState: ThreadsGeneratingRenameState; title: string }
  | { type: "auto-name-finished"; generatingState: ThreadsGeneratingRenameState };
type ThreadsRenameLifecycleEventType = ThreadsRenameLifecycleEvent["type"];
type ThreadsRenameLifecycleTransition = (
  state: ThreadsRenameLifecycleState,
  event: ThreadsRenameLifecycleEvent,
) => ThreadsRenameLifecycleState;
type ThreadsRenameLifecycleTransitionTable = Record<
  ThreadsRenameLifecycleKind,
  Record<ThreadsRenameLifecycleEventType, ThreadsRenameLifecycleTransition>
>;

const STATUS_PRIORITY: Record<ThreadsLiveStatus, number> = {
  "needs-input": 5,
  approval: 4,
  running: 3,
  draft: 2,
  offline: 1,
  open: 0,
};

export function threadRows(
  threads: readonly Thread[],
  snapshots: OpenCodexPanelSnapshot[],
  renameStates: ReadonlyMap<string, ThreadsRenameState>,
  archiveConfirmThreadId: string | null = null,
  defaultArchiveSaveMarkdown = false,
): ThreadsRowModel[] {
  const snapshotsByThread = snapshotsForThreads(snapshots);
  return [...threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => {
      const threadSnapshots = snapshotsByThread.get(thread.id) ?? [];
      const live = liveStateForSnapshots(threadSnapshots);
      const selected = selectedStateForSnapshots(threadSnapshots);
      const rename = renameStates.get(thread.id);
      return {
        thread,
        title: threadUserTitle(thread),
        live,
        selected,
        rename: {
          active: rename !== undefined,
          draft: rename?.draft ?? threadRenameDraftTitle(thread),
          generating: rename?.kind === "generating",
        },
        archiveConfirm: {
          active: archiveConfirmThreadId === thread.id,
          defaultSaveMarkdown: defaultArchiveSaveMarkdown,
        },
      };
    });
}

function liveStateForSnapshots(snapshots: OpenCodexPanelSnapshot[]): ThreadsLiveState | null {
  const liveSnapshots = snapshots.filter((snapshot) => snapshot.threadId !== null);
  if (liveSnapshots.length === 0) return null;
  const winner = [...liveSnapshots].sort((a, b) => STATUS_PRIORITY[snapshotStatus(b)] - STATUS_PRIORITY[snapshotStatus(a)]).at(0);
  if (!winner) return null;
  const status = snapshotStatus(winner);
  return {
    status,
    label: statusLabel(status),
    viewId: winner.viewId,
    openPanels: liveSnapshots.length,
  };
}

function selectedStateForSnapshots(snapshots: OpenCodexPanelSnapshot[]): boolean {
  return snapshots.some((snapshot) => snapshot.threadId !== null && snapshot.lastFocused);
}

export function transitionThreadsRenameState(
  state: ThreadsRenameLifecycleState,
  event: ThreadsRenameLifecycleEvent,
): ThreadsRenameLifecycleState {
  return threadsRenameLifecycleTransitions[threadsRenameLifecycleKind(state)][event.type](state, event);
}

const keepThreadsRenameState: ThreadsRenameLifecycleTransition = (state) => state;

const startThreadsRenameTransition: ThreadsRenameLifecycleTransition = (_state, event) =>
  editingThreadRenameState(requireThreadsRenameDraft(event));

const updateThreadsRenameDraftTransition: ThreadsRenameLifecycleTransition = (state, event) => {
  const draft = requireThreadsRenameDraft(event);
  return state?.kind === "generating" ? { ...state, draft } : editingThreadRenameState(draft);
};

const cancelThreadsRenameTransition: ThreadsRenameLifecycleTransition = () => undefined;

const startThreadsAutoNameTransition: ThreadsRenameLifecycleTransition = (state, event) => {
  if (!state || state.kind === "generating") return state;
  return { kind: "generating", draft: state.draft, originalDraft: state.draft, generationToken: requireThreadsGenerationToken(event) };
};

const generatedThreadsAutoNameTransition: ThreadsRenameLifecycleTransition = (state, event) => {
  const generatingState = requireThreadsGeneratingState(event);
  if (!threadsRenameGenerationStillActive(state, generatingState)) return state;
  if (state.draft !== state.originalDraft) return state;
  return { ...state, draft: requireGeneratedThreadsTitle(event) };
};

const finishThreadsAutoNameTransition: ThreadsRenameLifecycleTransition = (state, event) => {
  if (!threadsRenameGenerationStillActive(state, requireThreadsGeneratingState(event))) return state;
  return editingThreadRenameState(state.draft);
};

const threadsRenameLifecycleTransitions: ThreadsRenameLifecycleTransitionTable = {
  idle: {
    started: startThreadsRenameTransition,
    "draft-updated": updateThreadsRenameDraftTransition,
    cancelled: keepThreadsRenameState,
    "auto-name-started": keepThreadsRenameState,
    "auto-name-generated": keepThreadsRenameState,
    "auto-name-finished": keepThreadsRenameState,
  },
  editing: {
    started: startThreadsRenameTransition,
    "draft-updated": updateThreadsRenameDraftTransition,
    cancelled: cancelThreadsRenameTransition,
    "auto-name-started": startThreadsAutoNameTransition,
    "auto-name-generated": keepThreadsRenameState,
    "auto-name-finished": keepThreadsRenameState,
  },
  generating: {
    started: startThreadsRenameTransition,
    "draft-updated": updateThreadsRenameDraftTransition,
    cancelled: cancelThreadsRenameTransition,
    "auto-name-started": keepThreadsRenameState,
    "auto-name-generated": generatedThreadsAutoNameTransition,
    "auto-name-finished": finishThreadsAutoNameTransition,
  },
};

function threadsRenameLifecycleKind(state: ThreadsRenameLifecycleState): ThreadsRenameLifecycleKind {
  return state?.kind ?? "idle";
}

function editingThreadRenameState(draft: string): ThreadsRenameState {
  return { kind: "editing", draft };
}

function threadsRenameGenerationStillActive(
  state: ThreadsRenameLifecycleState,
  generatingState: ThreadsGeneratingRenameState,
): state is ThreadsGeneratingRenameState {
  return state?.kind === "generating" && state.generationToken === generatingState.generationToken;
}

function requireThreadsRenameDraft(event: ThreadsRenameLifecycleEvent): string {
  if ("draft" in event) return event.draft;
  throw new Error(`Threads rename lifecycle event ${event.type} does not include a draft.`);
}

function requireThreadsGeneratingState(event: ThreadsRenameLifecycleEvent): ThreadsGeneratingRenameState {
  if ("generatingState" in event) return event.generatingState;
  throw new Error(`Threads rename lifecycle event ${event.type} does not include generating state.`);
}

function requireThreadsGenerationToken(event: ThreadsRenameLifecycleEvent): number {
  if ("generationToken" in event) return event.generationToken;
  throw new Error(`Threads rename lifecycle event ${event.type} does not include a generation token.`);
}

function requireGeneratedThreadsTitle(event: ThreadsRenameLifecycleEvent): string {
  if ("title" in event) return event.title;
  throw new Error(`Threads rename lifecycle event ${event.type} does not include a title.`);
}

function snapshotsForThreads(snapshots: OpenCodexPanelSnapshot[]): Map<string, OpenCodexPanelSnapshot[]> {
  const map = new Map<string, OpenCodexPanelSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.threadId) continue;
    const existing = map.get(snapshot.threadId) ?? [];
    existing.push(snapshot);
    map.set(snapshot.threadId, existing);
  }
  return map;
}

function snapshotStatus(snapshot: OpenCodexPanelSnapshot): ThreadsLiveStatus {
  if (snapshot.pendingUserInputs > 0 || snapshot.pendingMcpElicitations > 0) return "needs-input";
  if (snapshot.pendingApprovals > 0) return "approval";
  if (snapshot.turnLifecycle.kind !== "idle") return "running";
  if (snapshot.hasComposerDraft) return "draft";
  if (!snapshot.connected) return "offline";
  return "open";
}

function statusLabel(status: ThreadsLiveStatus): string {
  switch (status) {
    case "needs-input":
      return "Needs input";
    case "approval":
      return "Approval";
    case "running":
      return "Running";
    case "draft":
      return "Draft";
    case "offline":
      return "Offline";
    case "open":
      return "Open";
  }
}
