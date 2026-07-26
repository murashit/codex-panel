import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import type { ComposerSubmissionAdoption, ComposerSubmissionClaim } from "../composer/submission-claim";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { type SlashCommandName, slashCommandRequiresConnection } from "../slash-commands/catalog";
import { parseSlashCommand, parseWebCommandArgs } from "../slash-commands/parse";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { cancellablePendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import type { SlashCommandExecutionResult } from "./slash-command-execution";
import { submissionStateSnapshot } from "./submission-state";
import type { ChatTurnPort } from "./turn-port";
import type { TurnSubmissionRequest } from "./turn-submission-command";
import { pendingWebSubmissionItem } from "./web-submission";

const STATUS_INTERRUPT_REQUESTED = "Interrupt requested.";

export interface ComposerSubmitCommandHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  ensureRestoredThreadLoaded?: () => Promise<boolean>;
  composer: {
    readonly draft: string;
    readonly trimmedDraft: string;
    claimSubmission(): ComposerSubmissionClaim | null;
    isSubmissionPreparing(): boolean;
    failActiveSubmissionClaim(): void;
  };
  slashCommandExecutor: {
    execute(
      command: SlashCommandName,
      args: string,
      inputSnapshot: ComposerInputSnapshot,
      submission: ComposerSubmissionAdoption,
    ): Promise<SlashCommandExecutionResult | undefined>;
  };
  turnSubmissionCommand: {
    sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
  };
  connection: {
    ensureConnected: () => Promise<boolean>;
  };
  turnPort: Pick<ChatTurnPort, "interruptTurn">;
  status: {
    setStatus: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface ComposerSubmitCommand {
  submit: () => Promise<void>;
}

export async function submitComposer(host: ComposerSubmitCommandHost): Promise<void> {
  const pendingSubmission = host.stateStore.getState().pendingSubmission;
  if (pendingSubmission) {
    if (pendingSubmission.phase === "cancellable") {
      rollbackPendingWebSubmission(host, pendingSubmission.id);
    }
    return;
  }
  if (host.composer.isSubmissionPreparing()) return;
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const originalDraft = host.composer.draft;
  const draft = originalDraft.trim();
  const submissionClaim = draft.length > 0 ? host.composer.claimSubmission() : null;
  if (draft.length > 0 && !submissionClaim) return;
  try {
    if (host.ensureRestoredThreadLoaded && !(await host.ensureRestoredThreadLoaded())) return;
    if (submissionClaim ? !submissionClaim.isCurrent() : !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    const chatState = host.stateStore.getState();
    const state = submissionStateSnapshot(chatState);
    if (host.stateStore.getState().pendingSubmission) return;
    const operationDecision = activePanelOperationDecision(chatState, "submit");
    if (state.busy && state.activeThreadId && state.activeTurnId && (draft.length === 0 || operationDecision.kind === "blocked")) {
      await interruptTurn(host, panelTarget);
      return;
    }
    if (operationDecision.kind === "blocked") {
      host.status.addSystemMessage(operationDecision.message);
      return;
    }
    await sendMessage(host, draft, submissionClaim);
  } finally {
    submissionClaim?.settle("failed");
  }
}

async function sendMessage(host: ComposerSubmitCommandHost, text: string, submissionClaim: ComposerSubmissionClaim | null): Promise<void> {
  if (!text) return;
  if (!submissionClaim) return;
  if (!submissionClaim.isCurrent()) return;
  const inputSnapshot = submissionClaim.inputSnapshot;

  const slashCommand = parseSlashCommand(text);
  if (slashCommand) {
    const pendingWeb = beginPendingWebSubmission(host, slashCommand.command, slashCommand.args);
    if (slashCommandRequiresConnection(slashCommand.command)) {
      const connected = await host.connection.ensureConnected();
      if (!connected) {
        if (pendingWeb && pendingWebSubmissionIsCurrent(host, pendingWeb.id)) rollbackPendingWebSubmission(host, pendingWeb.id);
        return;
      }
      if (!submissionClaim.isCurrent()) return;
      if (pendingWeb && !pendingWebSubmissionIsCurrent(host, pendingWeb.id)) return;
    }
    const execution = await executeSlashCommandAndRestoreOnFailure(
      host,
      slashCommand.command,
      slashCommand.args,
      inputSnapshot,
      submissionClaim,
      pendingWeb?.id,
    );
    if (execution.failed) return;
    if (!submissionClaim.isCurrent()) return;
    const result = execution.result;
    if (result?.composerDraft !== undefined && result.sendText === undefined) {
      submissionClaim.settle("accepted", result.composerDraft);
      return;
    }
    if (result?.sendText) {
      if (pendingWeb && !pendingWebSubmissionIsCurrent(host, pendingWeb.id)) return;
      if (!pendingWeb) host.scroll.showLatest();
      const submitted = await host.turnSubmissionCommand.sendTurnText({
        text: result.sendText,
        inputSnapshot,
        ...(result.sendInput !== undefined ? { codexInputOverride: result.sendInput } : {}),
        ...(pendingWeb ? { pendingSubmissionId: pendingWeb.id } : {}),
        submissionClaim,
      });
      if (!submitted) {
        if (pendingWeb) {
          if (pendingWebSubmissionIsCurrent(host, pendingWeb.id)) rollbackPendingWebSubmission(host, pendingWeb.id);
        }
      }
    }
    if (result === undefined || (result.sendText === undefined && result.composerDraft === undefined)) {
      if (pendingWeb) {
        if (pendingWebSubmissionIsCurrent(host, pendingWeb.id)) rollbackPendingWebSubmission(host, pendingWeb.id);
      } else {
        submissionClaim.settle("accepted");
      }
    }
    return;
  }

  host.scroll.showLatest();
  await host.turnSubmissionCommand.sendTurnText({
    text,
    inputSnapshot,
    submissionClaim,
  });
}

async function executeSlashCommandAndRestoreOnFailure(
  host: ComposerSubmitCommandHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot: ComposerSubmissionClaim["inputSnapshot"],
  submission: ComposerSubmissionClaim,
  pendingWebSubmissionId?: string,
): Promise<{ failed: false; result: SlashCommandExecutionResult | undefined } | { failed: true }> {
  try {
    const commandIsCurrent = () =>
      submission.isCurrent() && (pendingWebSubmissionId === undefined || pendingWebSubmissionIsCurrent(host, pendingWebSubmissionId));
    return {
      failed: false,
      result: await host.slashCommandExecutor.execute(command, args, inputSnapshot, {
        isCurrent: commandIsCurrent,
        markAdopted: submission.markAdopted,
        adoptPanelTarget: submission.adoptPanelTarget,
      }),
    };
  } catch (error) {
    if (!submission.isCurrent()) return { failed: true };
    if (pendingWebSubmissionId && !pendingWebSubmissionIsCurrent(host, pendingWebSubmissionId)) return { failed: true };
    if (pendingWebSubmissionId) cancelPendingWebSubmission(host, pendingWebSubmissionId);
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    return { failed: true };
  }
}

interface PendingWebSubmission {
  id: string;
}

function beginPendingWebSubmission(host: ComposerSubmitCommandHost, command: SlashCommandName, args: string): PendingWebSubmission | null {
  if (command !== "web") return null;
  const parsed = parseWebCommandArgs(args);
  if (!parsed) return null;
  const id = host.localItemIds.next("local-web");
  const item = pendingWebSubmissionItem(id, parsed.url, parsed.message);
  if (!item) return null;
  const activeThreadId = submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
  host.stateStore.dispatch({
    type: "web-submission/pending",
    submission: { id, item, targetThreadId: activeThreadId, phase: "cancellable" },
  });
  host.scroll.showLatest();
  return { id };
}

function pendingWebSubmissionIsCurrent(host: ComposerSubmitCommandHost, submissionId: string): boolean {
  const state = host.stateStore.getState();
  return cancellablePendingSubmissionMatches(
    { pendingSubmission: state.pendingSubmission, activeThreadId: submissionStateSnapshot(state).activeThreadId },
    submissionId,
  );
}

function cancelPendingWebSubmission(host: ComposerSubmitCommandHost, id: string): void {
  host.stateStore.dispatch({ type: "web-submission/cancelled", submissionId: id });
}

function rollbackPendingWebSubmission(host: ComposerSubmitCommandHost, id: string): void {
  if (!pendingWebSubmissionIsCurrent(host, id)) return;
  cancelPendingWebSubmission(host, id);
  host.composer.failActiveSubmissionClaim();
}

async function interruptTurn(host: ComposerSubmitCommandHost, panelTarget: PanelTargetLease): Promise<void> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const turnId = state.activeTurnId;
  if (!state.activeThreadId || !turnId) return;
  try {
    if (!(await host.turnPort.interruptTurn(state.activeThreadId, turnId))) return;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    host.status.setStatus(STATUS_INTERRUPT_REQUESTED);
  } catch (error) {
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
