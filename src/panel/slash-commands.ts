import type { ReasoningEffort } from "../generated/app-server/ReasoningEffort";
import type { Thread } from "../generated/app-server/v2/Thread";
import { getThreadTitle } from "../threads";
import { modelOverrideMessage, parseModelOverride, parseReasoningEffortOverride, reasoningEffortOverrideMessage } from "./runtime-settings";

export const SLASH_COMMANDS = [
  { command: "/new", detail: "Start a new Codex thread, optionally sending a message." },
  { command: "/resume", detail: "Resume a recent Codex thread." },
  { command: "/fork", detail: "Fork the active Codex thread." },
  { command: "/compact", detail: "Compact the current conversation context." },
  { command: "/fast", detail: "Toggle fast service tier for subsequent turns." },
  { command: "/plan", detail: "Toggle Plan mode, optionally sending a message." },
  { command: "/status", detail: "Show current session, context, and usage limits." },
  { command: "/doctor", detail: "Show Codex CLI and app-server connection diagnostics." },
  { command: "/model", detail: "Show or set the model for subsequent turns." },
  { command: "/effort", detail: "Show or set reasoning effort for subsequent turns." },
  { command: "/help", detail: "Show available Codex slash commands." },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number]["command"];

export type SlashCommandName = SlashCommand extends `/${infer Name}` ? Name : never;

export function slashCommandHelpLines(): string[] {
  return SLASH_COMMANDS.map((item) => `${item.command} - ${item.detail}`);
}

export interface SlashCommandExecutionContext {
  activeThreadId: string | null;
  listedThreads: Thread[];
  startNewThread: () => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  forkThread: (threadId: string) => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  toggleFastMode: () => void;
  toggleCollaborationMode: () => void;
  addSystemMessage: (text: string) => void;
  setStatus: (status: string) => void;
  setRequestedModel: (model: string | null) => void;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => void;
  statusSummaryLines: () => string[];
  connectionDiagnosticLines: () => string[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandExecutionResult {
  sendText?: string;
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
