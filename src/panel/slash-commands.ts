import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Thread } from "../generated/app-server/v2/Thread";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import { getThreadTitle } from "../threads/model";
import type { ReferencedThreadDisplay } from "../threads/reference";
import { slashCommandHelpRows, type SlashCommandName } from "../composer/slash-commands";
import type { DisplayDetailSection, DisplayDetailMetaRow } from "../display/types";
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
  archiveThread: (threadId: string) => Promise<void>;
  toggleFastMode: () => void;
  toggleCollaborationMode: () => void;
  toggleAutoReview: () => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
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

  if (command === "archive") {
    if (context.busy) {
      context.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
      return;
    }
    if (!args) {
      if (!context.activeThreadId) {
        context.addSystemMessage("No active thread to archive.");
        return;
      }
      await context.archiveThread(context.activeThreadId);
      return;
    }

    const thread = resolveThreadArgument(args, context.listedThreads);
    if (!thread.ok) {
      context.addSystemMessage(thread.message);
      return;
    }
    await context.archiveThread(thread.thread.id);
    return;
  }

  if (command === "fast") {
    context.toggleFastMode();
    return;
  }

  if (command === "auto-review") {
    context.toggleAutoReview();
    if (args) return { sendText: args };
    return;
  }

  if (command === "plan") {
    context.toggleCollaborationMode();
    if (args) return { sendText: args };
    return;
  }

  if (command === "status") {
    context.addStructuredSystemMessage("Session status", detailsFromLines(context.statusSummaryLines()));
    return;
  }

  if (command === "doctor") {
    context.addStructuredSystemMessage("Connection diagnostics", detailsFromLines(context.connectionDiagnosticLines()));
    return;
  }

  if (command === "mcp") {
    if (args) {
      context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
      return;
    }
    context.addStructuredSystemMessage("MCP servers", detailsFromLines(await context.mcpStatusLines()));
    return;
  }

  if (command === "model") {
    const requested = parseModelOverride(args);
    if (requested !== undefined) {
      context.setRequestedModel(requested);
      context.addSystemMessage(modelOverrideMessage(requested));
      return;
    }
    context.addStructuredSystemMessage("Model settings", detailsFromLines(context.modelStatusLines()));
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
    context.addStructuredSystemMessage("Reasoning effort", detailsFromLines(context.effortStatusLines()));
    return;
  }

  if (command === "help") {
    context.addStructuredSystemMessage("Available slash commands", [{ rows: slashCommandHelpRows() }]);
    return;
  }

  if (args) {
    context.addSystemMessage(`Unsupported slash command arguments: ${args}`);
  }
}

function detailsFromLines(lines: string[]): DisplayDetailSection[] {
  const first = lines[0] ?? "";
  const content = first.includes(": ") ? lines : lines.slice(1);
  return [{ rows: content.map(lineToRow) }];
}

function lineToRow(line: string): DisplayDetailMetaRow {
  const separator = line.indexOf(": ");
  if (separator > 0) {
    return {
      key: line.slice(0, separator),
      value: line.slice(separator + 2),
    };
  }
  return { key: "message", value: line };
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
