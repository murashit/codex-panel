import type { AppServerClient } from "../../app-server/client";
import {
  referencedThreadInput as buildReferencedThreadInput,
  referencedThreadTurns,
  REFERENCED_THREAD_TURN_LIMIT,
} from "../../domain/threads/reference";
import type { Thread } from "../../generated/app-server/v2/Thread";
import { chatTurnBusy, type ChatStateStore } from "./chat-state";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult, type ThreadReferenceInput } from "./slash-commands";
import type { SlashCommandName } from "./composer/slash-commands";
import type { DisplayDetailSection } from "./display/types";
import type { ReasoningEffort } from "../../generated/app-server/ReasoningEffort";
import type { UserInput } from "../../generated/app-server/v2/UserInput";

export interface SlashCommandControllerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  codexInput: (text: string) => UserInput[];
  startNewThread: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  toggleFastMode: () => void | Promise<void>;
  toggleCollaborationMode: () => void | Promise<void>;
  toggleAutoReview: () => void | Promise<void>;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  setStatus: (status: string) => void;
  setRequestedModel: (model: string | null) => boolean | undefined | Promise<boolean | undefined>;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => boolean | undefined | Promise<boolean | undefined>;
  statusSummaryLines: () => string[];
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export class SlashCommandController {
  constructor(private readonly host: SlashCommandControllerHost) {}

  async execute(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined> {
    const client = this.host.currentClient();
    if (!client) return;
    const state = this.host.stateStore.getState();
    return runSlashCommand(command, args, {
      activeThreadId: state.activeThreadId,
      listedThreads: state.listedThreads,
      startNewThread: () => this.host.startNewThread(),
      resumeThread: (threadId) => this.host.resumeThread(threadId),
      referThread: (thread, message) => this.referencedThreadInput(client, thread, message),
      forkThread: (threadId) => this.host.forkThread(threadId),
      rollbackThread: (threadId) => this.host.rollbackThread(threadId),
      compactThread: async (threadId) => {
        await client.compactThread(threadId);
      },
      archiveThread: (threadId) => this.host.archiveThread(threadId),
      busy: chatTurnBusy(state),
      toggleFastMode: () => this.host.toggleFastMode(),
      toggleCollaborationMode: () => this.host.toggleCollaborationMode(),
      toggleAutoReview: () => this.host.toggleAutoReview(),
      addSystemMessage: (text) => {
        this.host.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        this.host.addStructuredSystemMessage(text, details);
      },
      setStatus: (status) => {
        this.host.setStatus(status);
      },
      setRequestedModel: (model) => this.host.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => this.host.setRequestedReasoningEffort(effort),
      statusSummaryLines: () => this.host.statusSummaryLines(),
      connectionDiagnosticDetails: () => this.host.connectionDiagnosticDetails(),
      mcpStatusLines: () => this.host.mcpStatusLines(),
      modelStatusLines: () => this.host.modelStatusLines(),
      effortStatusLines: () => this.host.effortStatusLines(),
    });
  }

  private async referencedThreadInput(client: AppServerClient, thread: Thread, message: string): Promise<ThreadReferenceInput | null> {
    try {
      const response = await client.threadTurnsList(thread.id, null, REFERENCED_THREAD_TURN_LIMIT);
      const turns = referencedThreadTurns(response.data);
      if (turns.length === 0) {
        this.host.addSystemMessage("Referenced thread has no readable conversation turns.");
        return null;
      }
      const reference = buildReferencedThreadInput(thread, turns, message, this.host.codexInput(message));
      this.host.setStatus(reference.status);
      return reference;
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
