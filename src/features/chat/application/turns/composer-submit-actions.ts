import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import { type SlashCommandName, slashCommandRequiresConnection } from "../composer/slash-commands";
import { parseSlashCommand } from "../composer/suggestions";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { cancellablePendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import { parseWebCommandArgs, type SlashCommandExecutionResult } from "./slash-command-execution";
import { submissionStateSnapshot } from "./submission-state";
import type { TurnSubmissionRequest } from "./turn-submission-actions";
import type { ChatTurnTransport } from "./turn-transport";
import { pendingWebSubmissionItem } from "./web-submission";

const STATUS_INTERRUPT_REQUESTED = "Interrupt requested.";

export interface ComposerSubmitActionsHost {
  stateStore: ChatStateStore;
  localItemIds: LocalIdSource;
  ensureRestoredThreadLoaded?: () => Promise<boolean>;
  composer: {
    readonly draft: string;
    readonly trimmedDraft: string;
    setDraft(
      text: string,
      options?: {
        clearSuggestions?: boolean;
        focus?: boolean;
        preserveContext?: boolean;
        threadCommandTarget?: ComposerInputSnapshot["threadCommandTarget"] | null;
      },
    ): void;
    captureInputSnapshot(): ComposerInputSnapshot;
  };
  slashCommandExecutor: {
    execute(
      command: SlashCommandName,
      args: string,
      inputSnapshot: ComposerInputSnapshot,
      isCurrent?: () => boolean,
    ): Promise<SlashCommandExecutionResult | undefined>;
  };
  turnSubmission: {
    sendTurnText(request: TurnSubmissionRequest): Promise<boolean>;
  };
  connection: {
    ensureConnected: () => Promise<boolean>;
  };
  turnTransport: Pick<ChatTurnTransport, "interruptTurn">;
  status: {
    setStatus: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  scroll: {
    showLatest: () => void;
  };
}

export interface ComposerSubmitActions {
  submit: () => Promise<void>;
}

export async function submitComposer(host: ComposerSubmitActionsHost): Promise<void> {
  const pendingSubmission = host.stateStore.getState().pendingSubmission;
  if (pendingSubmission) {
    if (pendingSubmission.phase === "cancellable") {
      rollbackPendingWebSubmission(host, pendingSubmission.id, pendingSubmission.originalDraft);
    }
    return;
  }
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const originalDraft = host.composer.draft;
  const draft = originalDraft.trim();
  if (host.ensureRestoredThreadLoaded && !(await host.ensureRestoredThreadLoaded())) return;
  if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
  const chatState = host.stateStore.getState();
  const state = submissionStateSnapshot(chatState);
  if (host.stateStore.getState().pendingSubmission) return;
  const operationDecision = activePanelOperationDecision(chatState, "submit");
  if (operationDecision.kind === "blocked") {
    host.status.addSystemMessage(operationDecision.message);
    return;
  }
  if (state.busy && state.activeThreadId && state.activeTurnId && draft.length === 0) {
    await interruptTurn(host, panelTarget);
    return;
  }
  await sendMessage(host, draft, originalDraft, panelTarget);
}

async function sendMessage(
  host: ComposerSubmitActionsHost,
  text: string,
  originalDraft: string,
  panelTarget: PanelTargetLease,
): Promise<void> {
  if (!text) return;
  if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
  const inputSnapshot = host.composer.captureInputSnapshot();

  const slashCommand = parseSlashCommand(text);
  if (slashCommand) {
    const pendingWeb = beginPendingWebSubmission(host, slashCommand.command, slashCommand.args, originalDraft);
    if (slashCommandRequiresConnection(slashCommand.command)) {
      const connected = await host.connection.ensureConnected();
      if (!connected) {
        if (pendingWeb && pendingWebSubmissionIsCurrent(host, pendingWeb.id))
          rollbackPendingWebSubmission(host, pendingWeb.id, originalDraft);
        return;
      }
      if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
      if (pendingWeb && !pendingWebSubmissionIsCurrent(host, pendingWeb.id)) return;
    }
    const execution = await executeSlashCommandAndRestoreOnFailure(
      host,
      slashCommand.command,
      slashCommand.args,
      inputSnapshot,
      originalDraft,
      pendingWeb?.id,
      () => panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget),
    );
    if (execution.failed) return;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    const result = execution.result;
    if (result?.composerDraft !== undefined) {
      host.composer.setDraft(result.composerDraft, { focus: true, clearSuggestions: true });
    }
    if (result?.sendText) {
      if (pendingWeb && !pendingWebSubmissionIsCurrent(host, pendingWeb.id)) return;
      if (!pendingWeb) host.scroll.showLatest();
      const submitted = await host.turnSubmission.sendTurnText({
        text: result.sendText,
        inputSnapshot,
        ...(result.sendInput !== undefined ? { codexInputOverride: result.sendInput } : {}),
        ...(result.sendInput !== undefined ? { preserveComposerContextOnFailure: true } : {}),
        ...(pendingWeb ? { pendingSubmissionId: pendingWeb.id, failureDraft: originalDraft } : {}),
      });
      if (!submitted) {
        if (pendingWeb) {
          if (pendingWebSubmissionIsCurrent(host, pendingWeb.id)) rollbackPendingWebSubmission(host, pendingWeb.id, originalDraft);
        } else {
          host.composer.setDraft(originalDraft, {
            focus: true,
            clearSuggestions: true,
            ...(inputSnapshot.threadCommandTarget ? { threadCommandTarget: inputSnapshot.threadCommandTarget } : {}),
          });
        }
      }
    }
    if (result === undefined || (result.sendText === undefined && result.composerDraft === undefined)) {
      if (pendingWeb) {
        if (pendingWebSubmissionIsCurrent(host, pendingWeb.id)) rollbackPendingWebSubmission(host, pendingWeb.id, originalDraft);
      } else {
        host.composer.setDraft("", { clearSuggestions: true });
      }
    }
    return;
  }

  host.scroll.showLatest();
  await host.turnSubmission.sendTurnText({ text, inputSnapshot });
}

async function executeSlashCommandAndRestoreOnFailure(
  host: ComposerSubmitActionsHost,
  command: SlashCommandName,
  args: string,
  inputSnapshot: ComposerInputSnapshot,
  originalText: string,
  pendingWebSubmissionId?: string,
  isCurrent: () => boolean = () => true,
): Promise<{ failed: false; result: SlashCommandExecutionResult | undefined } | { failed: true }> {
  try {
    const commandIsCurrent = () =>
      isCurrent() && (pendingWebSubmissionId === undefined || pendingWebSubmissionIsCurrent(host, pendingWebSubmissionId));
    return {
      failed: false,
      result: await host.slashCommandExecutor.execute(command, args, inputSnapshot, commandIsCurrent),
    };
  } catch (error) {
    if (!isCurrent()) return { failed: true };
    if (pendingWebSubmissionId && !pendingWebSubmissionIsCurrent(host, pendingWebSubmissionId)) return { failed: true };
    if (pendingWebSubmissionId) cancelPendingWebSubmission(host, pendingWebSubmissionId);
    host.composer.setDraft(originalText, {
      focus: true,
      clearSuggestions: true,
      ...(inputSnapshot.threadCommandTarget ? { threadCommandTarget: inputSnapshot.threadCommandTarget } : {}),
    });
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
    return { failed: true };
  }
}

interface PendingWebSubmission {
  id: string;
}

function beginPendingWebSubmission(
  host: ComposerSubmitActionsHost,
  command: SlashCommandName,
  args: string,
  originalDraft: string,
): PendingWebSubmission | null {
  if (command !== "web") return null;
  const parsed = parseWebCommandArgs(args);
  if (!parsed) return null;
  const id = host.localItemIds.next("local-web");
  const item = pendingWebSubmissionItem(id, parsed.url, parsed.message);
  if (!item) return null;
  const activeThreadId = submissionStateSnapshot(host.stateStore.getState()).activeThreadId;
  host.stateStore.dispatch({
    type: "web-submission/pending",
    submission: { id, item, targetThreadId: activeThreadId, originalDraft, phase: "cancellable" },
  });
  host.composer.setDraft("", { clearSuggestions: true, preserveContext: true });
  host.scroll.showLatest();
  return { id };
}

function pendingWebSubmissionIsCurrent(host: ComposerSubmitActionsHost, submissionId: string): boolean {
  const state = host.stateStore.getState();
  return cancellablePendingSubmissionMatches(
    { pendingSubmission: state.pendingSubmission, activeThreadId: submissionStateSnapshot(state).activeThreadId },
    submissionId,
  );
}

function cancelPendingWebSubmission(host: ComposerSubmitActionsHost, id: string): void {
  host.stateStore.dispatch({ type: "web-submission/cancelled", submissionId: id });
}

function rollbackPendingWebSubmission(host: ComposerSubmitActionsHost, id: string, text: string): void {
  if (!pendingWebSubmissionIsCurrent(host, id)) return;
  cancelPendingWebSubmission(host, id);
  host.composer.setDraft(text, { focus: true, clearSuggestions: true, preserveContext: true });
}

async function interruptTurn(host: ComposerSubmitActionsHost, panelTarget: PanelTargetLease): Promise<void> {
  const state = submissionStateSnapshot(host.stateStore.getState());
  const turnId = state.activeTurnId;
  if (!state.activeThreadId || !turnId) return;
  try {
    if (!(await host.turnTransport.interruptTurn(state.activeThreadId, turnId))) return;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    host.status.setStatus(STATUS_INTERRUPT_REQUESTED);
  } catch (error) {
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return;
    host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
  }
}
