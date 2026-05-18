import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Thread } from "../generated/app-server/v2/Thread";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import { getThreadTitle } from "../threads/model";
import type { ReferencedThreadDisplay } from "../threads/reference";
import { slashCommandHelpLines, type SlashCommandName } from "../composer/slash-commands";
import {
  modelOverrideMessage,
  parseModelOverride,
  parseReasoningEffortOverride,
  reasoningEffortOverrideMessage,
} from "../runtime/settings";

export interface SlashCommandExecutionContext {
  activeThreadId: string | null;
  busy: boolean;
  listedThreads: Thread[];
  startNewThread: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  referThread: (thread: Thread, message: string) => Promise<ThreadReferenceInput | null>;
  forkThread: (threadId: string) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  toggleFastMode: () => void;
  toggleCollaborationMode: () => void;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setRequestedModel: (model: string | null) => void;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => void;
  statusSummaryLines: () => string[];
  connectionDiagnosticLines: () => string[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandExecutionResult {
  sendText?: string;
  sendInput?: UserInput[];
  referencedThread?: ReferencedThreadDisplay;
}

export interface ThreadReferenceInput {
  input: UserInput[];
  referencedThread: ReferencedThreadDisplay;
}

export async function executeSlashCommand(
  command: SlashCommandName,
  args: string,
  context: SlashCommandExecutionContext,
): Promise<SlashCommandExecutionResult | void> {
  if (command === "new") {
    await context.startNewThread();
    if (args) return { sendText: args };
    return;
  }

  if (command === "resume") {
    const thread = resolveThreadArgument(args, context.listedThreads);
    if (!thread.ok) {
      context.addSystemMessage(thread.message);
      return;
    }
    await context.resumeThread(thread.thread.id);
    return;
  }

  if (command === "refer") {
    const parsed = parseReferArgs(args);
    if (!parsed) {
      context.addSystemMessage("Usage: /refer <thread> <message>");
      return;
    }
    const thread = resolveThreadArgument(parsed.threadQuery, context.listedThreads);
    if (!thread.ok) {
      context.addSystemMessage(thread.message);
      return;
    }
    if (thread.thread.id === context.activeThreadId) {
      context.addSystemMessage("Use the current thread directly instead of referencing it.");
      return;
    }
    const reference = await context.referThread(thread.thread, parsed.message);
    if (!reference) return;
    return { sendText: parsed.message, sendInput: reference.input, referencedThread: reference.referencedThread };
  }

  if (command === "fork") {
    if (args) {
      context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
      return;
    }
    if (!context.activeThreadId) {
      context.addSystemMessage("No active thread to fork.");
      return;
    }
    await context.forkThread(context.activeThreadId);
    return;
  }

  if (command === "rollback") {
    if (args) {
      context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
      return;
    }
    if (!context.activeThreadId) {
      context.addSystemMessage("No active thread to roll back.");
      return;
    }
    if (context.busy) {
      context.addSystemMessage("Interrupt the current turn before rolling back.");
      return;
    }
    await context.rollbackThread(context.activeThreadId);
    return;
  }

  if (command === "compact") {
    if (!context.activeThreadId) {
      context.addSystemMessage("No active thread to compact.");
      return;
    }
    try {
      await context.compactThread(context.activeThreadId);
      context.addSystemMessage("Compaction requested.");
      context.setStatus("Compaction requested.");
    } catch (error) {
      context.addSystemMessage(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (command === "fast") {
    context.toggleFastMode();
    return;
  }

  if (command === "plan") {
    context.toggleCollaborationMode();
    if (args) return { sendText: args };
    return;
  }

  if (command === "status") {
    context.addSystemMessage(context.statusSummaryLines().join("\n"));
    return;
  }

  if (command === "doctor") {
    context.addSystemMessage(context.connectionDiagnosticLines().join("\n"));
    return;
  }

  if (command === "mcp") {
    if (args) {
      context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
      return;
    }
    context.addSystemMessage((await context.mcpStatusLines()).join("\n"));
    return;
  }

  if (command === "model") {
    const requested = parseModelOverride(args);
    if (requested !== undefined) {
      context.setRequestedModel(requested);
      context.addSystemMessage(modelOverrideMessage(requested));
      return;
    }
    context.addSystemMessage(context.modelStatusLines().join("\n"));
    return;
  }

  if (command === "effort") {
    const requested = parseReasoningEffortOverride(args);
    if (requested !== undefined) {
      context.setRequestedReasoningEffort(requested);
      context.addSystemMessage(reasoningEffortOverrideMessage(requested));
      return;
    }
    if (args) {
      context.addSystemMessage(`Unsupported effort: ${args}`);
      return;
    }
    context.addSystemMessage(context.effortStatusLines().join("\n"));
    return;
  }

  if (command === "help") {
    context.addSystemMessage(slashCommandHelpLines().join("\n"));
    return;
  }

  if (args) {
    context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
  }
}

type ThreadResolution = { ok: true; thread: Thread } | { ok: false; message: string };

function parseReferArgs(args: string): { threadQuery: string; message: string } | null {
  const match = args.match(/^(\S+)\s+([\s\S]*\S)\s*$/);
  if (!match) return null;
  return { threadQuery: match[1], message: match[2] };
}

export function resolveThreadArgument(args: string, threads: Thread[]): ThreadResolution {
  const query = args.trim();
  if (!query) {
    const thread = threads[0];
    return thread ? { ok: true, thread } : { ok: false, message: "No recent threads to resume." };
  }

  const idMatches = threads.filter((thread) => thread.id === query || thread.id.startsWith(query));
  if (idMatches.length === 1) return { ok: true, thread: idMatches[0] };
  if (idMatches.length > 1) return { ok: false, message: `Multiple matching threads: ${idMatches.map((thread) => thread.id).join(", ")}` };

  const titleQuery = query.toLowerCase();
  const titleMatches = threads.filter((thread) => getThreadTitle(thread).toLowerCase().includes(titleQuery));
  if (titleMatches.length === 1) return { ok: true, thread: titleMatches[0] };
  if (titleMatches.length > 1) return { ok: false, message: `Multiple matching threads: ${titleMatches.map(getThreadTitle).join(", ")}` };

  return { ok: false, message: `No matching thread: ${query}` };
}
