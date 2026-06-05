import type { AppServerClient } from "../../../../app-server/client";
import {
  referencedThreadInput as buildReferencedThreadInput,
  referencedThreadTurns,
  REFERENCED_THREAD_TURN_LIMIT,
} from "../../../../domain/threads/reference";
import type { Thread } from "../../../../generated/app-server/v2/Thread";
import { executeSlashCommand as runSlashCommand, type SlashCommandExecutionResult, type ThreadReferenceInput } from "../../slash-commands";
import type { SlashCommandName } from "../../composer/slash-commands";
import type { DisplayDetailSection } from "../../display/types";
import type { ReasoningEffort } from "../../../../generated/app-server/ReasoningEffort";
import type { UserInput } from "../../../../generated/app-server/v2/UserInput";
import type { SubmissionStatePort } from "../state-ports";

export interface SlashCommandThreadPort {
  startNewThread: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<void>;
  reconnect: () => Promise<void>;
}

export interface SlashCommandRuntimePort {
  toggleFastMode: () => void | Promise<void>;
  toggleCollaborationMode: () => void | Promise<void>;
  toggleAutoReview: () => void | Promise<void>;
  setRequestedModel: (model: string | null) => boolean | undefined | Promise<boolean | undefined>;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => boolean | undefined | Promise<boolean | undefined>;
}

export interface SlashCommandStatusPort {
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  setStatus: (status: string) => void;
  statusSummaryLines: () => string[];
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandControllerHost {
  state: SubmissionStatePort;
  currentClient: () => AppServerClient | null;
  codexInput: (text: string) => UserInput[];
  threads: SlashCommandThreadPort;
  runtime: SlashCommandRuntimePort;
  status: SlashCommandStatusPort;
}

export class SlashCommandController {
  constructor(private readonly host: SlashCommandControllerHost) {}

  async execute(command: SlashCommandName, args: string): Promise<SlashCommandExecutionResult | undefined> {
    const state = this.host.state.snapshot();
    const client = this.host.currentClient();
    if (!client && command !== "reconnect") return;
    return runSlashCommand(command, args, {
      activeThreadId: state.activeThreadId,
      listedThreads: state.listedThreads,
      startNewThread: () => this.host.threads.startNewThread(),
      resumeThread: (threadId) => this.host.threads.resumeThread(threadId),
      reconnect: () => this.host.threads.reconnect(),
      referThread: (thread, message) => {
        if (!client) return Promise.resolve(null);
        return this.referencedThreadInput(client, thread, message);
      },
      forkThread: (threadId) => this.host.threads.forkThread(threadId),
      rollbackThread: (threadId) => this.host.threads.rollbackThread(threadId),
      compactThread: async (threadId) => {
        if (!client) return;
        await client.compactThread(threadId);
      },
      archiveThread: (threadId) => this.host.threads.archiveThread(threadId),
      renameThread: (threadId, name) => this.host.threads.renameThread(threadId, name),
      busy: state.busy,
      toggleFastMode: () => this.host.runtime.toggleFastMode(),
      toggleCollaborationMode: () => this.host.runtime.toggleCollaborationMode(),
      toggleAutoReview: () => this.host.runtime.toggleAutoReview(),
      addSystemMessage: (text) => {
        this.host.status.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        this.host.status.addStructuredSystemMessage(text, details);
      },
      setStatus: (status) => {
        this.host.status.setStatus(status);
      },
      setRequestedModel: (model) => this.host.runtime.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => this.host.runtime.setRequestedReasoningEffort(effort),
      statusSummaryLines: () => this.host.status.statusSummaryLines(),
      connectionDiagnosticDetails: () => this.host.status.connectionDiagnosticDetails(),
      mcpStatusLines: () => this.host.status.mcpStatusLines(),
      modelStatusLines: () => this.host.status.modelStatusLines(),
      effortStatusLines: () => this.host.status.effortStatusLines(),
    });
  }

  private async referencedThreadInput(client: AppServerClient, thread: Thread, message: string): Promise<ThreadReferenceInput | null> {
    try {
      const response = await client.threadTurnsList(thread.id, null, REFERENCED_THREAD_TURN_LIMIT);
      const turns = referencedThreadTurns(response.data);
      if (turns.length === 0) {
        this.host.status.addSystemMessage("Referenced thread has no readable conversation turns.");
        return null;
      }
      const reference = buildReferencedThreadInput(thread, turns, message, this.host.codexInput(message));
      this.host.status.setStatus(reference.status);
      return reference;
    } catch (error) {
      this.host.status.addSystemMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
