import type { EffectOutcome } from "../effect-outcome";
import { type ActivePanelOperation, activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems, threadStreamRollbackCandidate } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import type { ComposerSubmissionAdoption } from "../submission/input-claim";
import { chatTurnBusy } from "../turns/turn-state";
import { captureForkDisplaySnapshot } from "./fork-display-snapshot";
import { type ForkDraftPreparation, forkDraftRuntime } from "./fork-draft";

export interface ThreadCommandEffects {
  compactThread(threadId: string): Promise<EffectOutcome<void>>;
}

const STATUS_COMPACTION_REQUESTED = "Compaction requested.";

export interface ThreadCommandsHost {
  stateStore: ChatStateStore;
  mutations: ThreadManagementMutations;
  effects: ThreadCommandEffects;
  ensureConnected: () => Promise<boolean>;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  openForkDraft: (preparation: ForkDraftPreparation, inNewPanel: boolean) => Promise<void>;
}

interface ThreadManagementMutations {
  renameThread(threadId: string, value: string): Promise<boolean>;
  setThreadPinned(threadId: string, isPinned: boolean): Promise<void>;
  archiveThread(threadId: string, options?: { saveMarkdown?: boolean; afterArchive?: () => void }): Promise<boolean>;
}

export interface ThreadCommands {
  compactActiveThread: () => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean, afterArchive?: () => void) => Promise<void>;
  setThreadPinned: (threadId: string, isPinned: boolean) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  forkThreadFromTurn: (threadId: string, turnId: string | null, archiveSource: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<boolean>;
  rollbackThread: (threadId: string, options?: { adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"] }) => Promise<void>;
}

interface ThreadCommandPanelScope {
  targetThreadId: string;
  initialActiveThreadId: string | null;
  panelTarget: PanelTargetLease;
}

export function createThreadCommands(host: ThreadCommandsHost): ThreadCommands {
  return {
    compactActiveThread: () => compactActiveThread(host),
    compactThread: (threadId) => compactThread(host, threadId),
    archiveThread: (threadId, saveMarkdown, afterArchive) => archiveThread(host, threadId, saveMarkdown, afterArchive),
    setThreadPinned: (threadId, isPinned) => setThreadPinned(host, threadId, isPinned),
    forkThread: (threadId) => forkThread(host, threadId),
    forkThreadFromTurn: (threadId, turnId, archiveSource) => forkThreadFromTurn(host, threadId, turnId, archiveSource),
    renameThread: (threadId, name) => renameThread(host, threadId, name),
    rollbackThread: (threadId, options) => rollbackThread(host, threadId, options),
  };
}

async function compactActiveThread(host: ThreadCommandsHost): Promise<void> {
  const threadId = activeThreadId(threadCommandState(host));
  if (!threadId) {
    host.addSystemMessage("No active thread to compact.");
    return;
  }
  await compactThread(host, threadId);
}

async function compactThread(host: ThreadCommandsHost, threadId: string): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "compact")) return;
  const scope = captureThreadCommandPanelScope(host, threadId);
  try {
    if (!(await host.ensureConnected())) return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    const effect = await host.effects.compactThread(threadId);
    if (effect.kind === "not-started") return;
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(STATUS_COMPACTION_REQUESTED);
    host.setStatus(STATUS_COMPACTION_REQUESTED);
  } catch (error) {
    if (!threadCommandScopeStillTargetsOriginalPanel(host, scope)) return;
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function archiveThread(host: ThreadCommandsHost, threadId: string, saveMarkdown?: boolean, afterArchive?: () => void): Promise<void> {
  try {
    const options = {
      ...(saveMarkdown === undefined ? {} : { saveMarkdown }),
      ...(afterArchive ? { afterArchive } : {}),
    };
    await host.mutations.archiveThread(threadId, options);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

function forkThread(host: ThreadCommandsHost, threadId: string): Promise<void> {
  return forkThreadFromTurn(host, threadId, null, false);
}

async function forkThreadFromTurn(
  host: ThreadCommandsHost,
  threadId: string,
  turnId: string | null,
  archiveSource: boolean,
): Promise<void> {
  await prepareFork(host, threadId, turnId ? { kind: "through-turn", turnId } : null, archiveSource, archiveSource);
}

async function prepareFork(
  host: ThreadCommandsHost,
  threadId: string,
  boundary: Extract<ForkDraftPreparation["draft"], { kind: "persistent" }>["boundary"] | null,
  archiveSource: boolean,
  saveMarkdown: boolean,
  composerText?: string,
  adoption?: ComposerSubmissionAdoption["adoptPanelTarget"],
): Promise<void> {
  const state = threadCommandState(host);
  const previous =
    state.panelThread.kind === "fork-draft" && state.panelThread.draft.kind === "persistent" ? state.panelThread.draft : null;
  const sourceThreadId = previous?.sourceThreadId ?? activeThreadId(state);
  if (sourceThreadId !== threadId) {
    host.addSystemMessage("Open the source thread before forking it.");
    return;
  }
  if (activePanelOperationBlocked(host, threadId, "fork")) return;
  if (chatTurnBusy(state.activeTurn)) {
    host.addSystemMessage("Finish or interrupt the current turn before forking threads.");
    return;
  }
  const stream = chatThreadStreamViewState(state.threadStream, state.activeTurn);
  const turnIds = threadStreamItems(stream).flatMap((item) => (item.turnId ? [item.turnId] : []));
  const latest = turnIds.at(-1);
  const selected = boundary ?? previous?.boundary ?? (latest ? { kind: "through-turn" as const, turnId: latest } : null);
  if (!selected || (boundary && !turnIds.includes(boundary.turnId))) {
    host.addSystemMessage("Could not find a completed turn to fork.");
    return;
  }
  const replacement = archiveSource
    ? previous
      ? previous.replacement
      : { sourceThreadId, sourceLatestTurnId: latest ?? selected.turnId, saveMarkdown }
    : undefined;
  const preparation: ForkDraftPreparation = {
    draft: {
      kind: "persistent",
      sourceThreadId,
      boundary: selected,
      ...(composerText === undefined ? {} : { initialPrompt: composerText }),
      ...(replacement ? { replacement } : {}),
    },
    runtime: forkDraftRuntime(state.runtime),
    display: captureForkDisplaySnapshot(stream, !boundary && previous ? { kind: "latest" } : selected),
  };
  try {
    if (archiveSource) adoption?.(null, composerText);
    await host.openForkDraft(preparation, !archiveSource);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function renameThread(host: ThreadCommandsHost, threadId: string, value: string): Promise<boolean> {
  try {
    const result = await host.mutations.renameThread(threadId, value);
    if (!result) return false;
    return true;
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function setThreadPinned(host: ThreadCommandsHost, threadId: string, isPinned: boolean): Promise<void> {
  try {
    await host.mutations.setThreadPinned(threadId, isPinned);
  } catch (error) {
    host.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}

async function rollbackThread(
  host: ThreadCommandsHost,
  threadId: string,
  options: { adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"] } = {},
): Promise<void> {
  if (activePanelOperationBlocked(host, threadId, "rollback")) return;
  const state = threadCommandState(host);
  const candidate = threadStreamRollbackCandidate(chatThreadStreamViewState(state.threadStream, state.activeTurn));
  if (!candidate) {
    host.addSystemMessage("No completed turn to roll back.");
    return;
  }
  await prepareFork(
    host,
    threadId,
    { kind: "before-turn", turnId: candidate.turnId },
    true,
    false,
    candidate.text,
    options.adoptPanelTarget,
  );
}

function activePanelOperationBlocked(host: ThreadCommandsHost, threadId: string, operation: ActivePanelOperation): boolean {
  const state = threadCommandState(host);
  const targetId = state.panelThread.kind === "fork-draft" ? state.panelThread.draft.sourceThreadId : activeThreadId(state);
  if (targetId !== threadId) return false;
  const decision = activePanelOperationDecision(state, operation);
  if (decision.kind !== "blocked") return false;
  host.addSystemMessage(decision.message);
  return true;
}

function threadCommandState(host: ThreadCommandsHost): ChatState {
  return host.stateStore.getState();
}

function captureThreadCommandPanelScope(host: ThreadCommandsHost, targetThreadId: string): ThreadCommandPanelScope {
  return {
    targetThreadId,
    initialActiveThreadId: activeThreadId(threadCommandState(host)),
    panelTarget: capturePanelTargetLease(threadCommandState(host)),
  };
}

function threadCommandScopeStillTargetsOriginalPanel(host: ThreadCommandsHost, scope: ThreadCommandPanelScope): boolean {
  const state = threadCommandState(host);
  if (!panelTargetLeaseIsCurrent(state, scope.panelTarget)) return false;
  if (!scope.initialActiveThreadId) return true;
  return scope.initialActiveThreadId === scope.targetThreadId && activeThreadId(state) === scope.targetThreadId;
}
