import type { CodexInput } from "../../../../app-server/request-input";
import type { ThreadGoal, ThreadGoalStatus } from "../../../../app-server/thread-goal";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import type { ReferencedThreadDisplay } from "../../../../domain/threads/reference";
import {
  slashCommandDefinition,
  slashCommandHelpSections,
  slashCommandSubcommandDefinition,
  slashCommandSubcommands,
  type SlashCommandName,
  type SlashCommandSubcommandDefinition,
} from "../composer/slash-commands";
import type { DisplayDetailSection, DisplayDetailMetaRow } from "../../display/types";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../runtime/settings-copy";
import { parseModelOverride, parseReasoningEffortOverride } from "./runtime-setting-commands";

export interface SlashCommandExecutionContext {
  activeThreadId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  startNewThread: () => Promise<void>;
  startThreadForGoal: (objective: string) => Promise<string | null>;
  resumeThread: (threadId: string) => Promise<void>;
  referThread: (thread: Thread, message: string) => Promise<ThreadReferenceInput | null>;
  forkThread: (threadId: string) => Promise<void>;
  rollbackThread: (threadId: string) => Promise<void>;
  compactThread: (threadId: string) => Promise<void>;
  archiveThread: (threadId: string, saveMarkdown?: boolean) => Promise<void>;
  renameThread: (threadId: string, name: string) => Promise<void>;
  reconnect: () => Promise<void>;
  toggleFastMode: () => void | Promise<void>;
  toggleCollaborationMode: () => void | Promise<void>;
  toggleAutoReview: () => void | Promise<void>;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  requestModel: (model: string) => boolean | undefined | Promise<boolean | undefined>;
  resetModelToConfig: () => boolean | undefined | Promise<boolean | undefined>;
  requestReasoningEffort: (effort: ReasoningEffort) => boolean | undefined | Promise<boolean | undefined>;
  resetReasoningEffortToConfig: () => boolean | undefined | Promise<boolean | undefined>;
  supportedReasoningEfforts: () => readonly ReasoningEffort[];
  activeGoal: () => ThreadGoal | null;
  setGoalObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setGoalStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clearGoal: (threadId: string) => Promise<boolean>;
  statusSummaryLines: () => string[];
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandExecutionResult {
  sendText?: string;
  sendInput?: CodexInput;
  referencedThread?: ReferencedThreadDisplay;
  composerDraft?: string;
}

export interface ThreadReferenceInput {
  input: CodexInput;
  referencedThread: ReferencedThreadDisplay;
}

export async function executeSlashCommand(
  command: SlashCommandName,
  args: string,
  context: SlashCommandExecutionContext,
): Promise<SlashCommandExecutionResult | undefined> {
  const argumentError = validateSlashCommandArguments(command, args);
  if (argumentError) {
    context.addSystemMessage(argumentError);
    return;
  }

  if (command === "clear") {
    await context.startNewThread();
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

  if (command === "reconnect") {
    await context.reconnect();
    return;
  }

  if (command === "refer") {
    const parsed = parseReferArgs(args);
    if (!parsed) {
      context.addSystemMessage(usageError(command, "requires a thread and a message"));
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
    if (!context.activeThreadId) {
      context.addSystemMessage("No active thread to fork.");
      return;
    }
    await context.forkThread(context.activeThreadId);
    return;
  }

  if (command === "rollback") {
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
    await context.compactThread(context.activeThreadId);
    return;
  }

  if (command === "archive") {
    if (context.busy) {
      context.addSystemMessage("Finish or interrupt the current turn before archiving threads.");
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

  if (command === "rename") {
    const parsed = parseThreadAndNameArgs(args);
    if (!parsed) {
      context.addSystemMessage(usageError(command, "requires a thread and a name"));
      return;
    }
    const thread = resolveThreadArgument(parsed.threadQuery, context.listedThreads);
    if (!thread.ok) {
      context.addSystemMessage(thread.message);
      return;
    }
    await context.renameThread(thread.thread.id, parsed.text);
    return;
  }

  if (command === "fast") {
    await context.toggleFastMode();
    return;
  }

  if (command === "auto-review") {
    await context.toggleAutoReview();
    return;
  }

  if (command === "plan") {
    await context.toggleCollaborationMode();
    if (args) return { sendText: args };
    return;
  }

  if (command === "goal") {
    return await executeGoalCommand(args, context);
  }

  if (command === "status") {
    context.addStructuredSystemMessage("Thread status", detailsFromLines(context.statusSummaryLines()));
    return;
  }

  if (command === "doctor") {
    context.addStructuredSystemMessage("Connection diagnostics", context.connectionDiagnosticDetails());
    return;
  }

  if (command === "mcp") {
    context.addStructuredSystemMessage("MCP servers", detailsFromLines(await context.mcpStatusLines()));
    return;
  }

  if (command === "model") {
    const requested = parseModelOverride(args);
    if (requested !== undefined) {
      const applied = await applyModelOverride(context, requested);
      if (applied === false) return;
      context.addSystemMessage(modelOverrideMessage(requested));
      return;
    }
    context.addStructuredSystemMessage("Model settings", detailsFromLines(context.modelStatusLines()));
    return;
  }

  if (command === "reasoning") {
    const requested = parseReasoningEffortOverride(args);
    if (requested !== undefined) {
      if (requested !== null && !context.supportedReasoningEfforts().includes(requested)) {
        context.addSystemMessage(`Unsupported reasoning level: ${args}. Usage: ${slashCommandDefinition(command).usage}`);
        return;
      }
      const applied = await applyReasoningEffortOverride(context, requested);
      if (applied === false) return;
      context.addSystemMessage(reasoningEffortOverrideMessage(requested));
      return;
    }
    if (args) {
      context.addSystemMessage(`Unsupported reasoning level: ${args}. Usage: ${slashCommandDefinition(command).usage}`);
      return;
    }
    context.addStructuredSystemMessage("Reasoning effort", detailsFromLines(context.effortStatusLines()));
    return;
  }

  context.addStructuredSystemMessage("Available slash commands", slashCommandHelpSections());
}

function applyModelOverride(
  context: SlashCommandExecutionContext,
  requested: string | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null ? context.resetModelToConfig() : context.requestModel(requested);
}

function applyReasoningEffortOverride(
  context: SlashCommandExecutionContext,
  requested: ReasoningEffort | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null ? context.resetReasoningEffortToConfig() : context.requestReasoningEffort(requested);
}

function validateSlashCommandArguments(command: SlashCommandName, args: string): string | null {
  const definition = slashCommandDefinition(command);
  if (definition.argsKind === "none" && args) return usageError(command, "does not take arguments");
  if (definition.argsKind === "requiredThread" && !args) return usageError(command, "requires a thread");
  if (definition.argsKind === "threadAndMessage" && !parseReferArgs(args)) return usageError(command, "requires a thread and a message");
  if (definition.argsKind === "threadAndName" && !parseThreadAndNameArgs(args)) return usageError(command, "requires a thread and a name");
  return null;
}

async function executeGoalCommand(args: string, context: SlashCommandExecutionContext): Promise<SlashCommandExecutionResult | undefined> {
  const parsed = parseGoalArgs(args);
  if (parsed.kind === "invalid") {
    context.addSystemMessage(parsed.message);
    return;
  }
  if (parsed.kind === "show") {
    const goal = context.activeGoal();
    if (!goal) {
      context.addSystemMessage("No goal set.");
      return;
    }
    context.addStructuredSystemMessage("Thread goal", goalDetails(goal));
    return;
  }
  const goal = context.activeGoal();
  if (parsed.kind === "set") {
    const threadId = context.activeThreadId ?? (await context.startThreadForGoal(parsed.objective));
    if (!threadId) {
      context.addSystemMessage("No active thread for goal management.");
      return;
    }
    await context.setGoalObjective(threadId, parsed.objective, goal?.tokenBudget ?? null);
    return;
  }
  const threadId = context.activeThreadId;
  if (!threadId) {
    context.addSystemMessage("No active thread for goal management.");
    return;
  }
  if (!goal) {
    context.addSystemMessage("No goal set.");
    return;
  }
  if (parsed.kind === "edit") {
    return { composerDraft: `/goal set ${goal.objective}` };
  }
  if (parsed.kind === "pause") {
    await context.setGoalStatus(threadId, "paused");
    return;
  }
  if (parsed.kind === "resume") {
    await context.setGoalStatus(threadId, "active");
    return;
  }
  await context.clearGoal(threadId);
}

type GoalArgs =
  | { kind: "show" }
  | { kind: "set"; objective: string }
  | { kind: "edit" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "invalid"; message: string };

function parseGoalArgs(args: string): GoalArgs {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "show" };
  const subcommandMatch = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  const subcommandName = subcommandMatch?.[1] ?? "";
  const subcommand = slashCommandSubcommandDefinition("goal", subcommandName);
  if (!subcommand) return { kind: "invalid", message: goalUsageError("requires set <objective>, edit, pause, resume, or clear") };

  const rawArgs = subcommandMatch?.[2] ?? "";
  const subcommandArgs = rawArgs.trim();
  const argumentError = validateSubcommandArguments(subcommand, subcommandArgs);
  if (argumentError) return { kind: "invalid", message: argumentError };
  if (subcommand.subcommand === "set") return { kind: "set", objective: subcommandArgs };
  if (subcommand.subcommand === "edit") return { kind: "edit" };
  if (subcommand.subcommand === "pause") return { kind: "pause" };
  if (subcommand.subcommand === "resume") return { kind: "resume" };
  return { kind: "clear" };
}

function validateSubcommandArguments(subcommand: SlashCommandSubcommandDefinition, args: string): string | null {
  if (subcommand.argsKind === "none" && args) {
    return `${subcommand.usage} does not take arguments. Usage: ${subcommand.usage}`;
  }
  if (subcommand.argsKind === "requiredMessage" && !args) {
    return `${subcommand.usage} requires an objective. Usage: ${subcommand.usage}`;
  }
  return null;
}

function goalUsageError(message: string): string {
  return usageError(
    "goal",
    `${message}. Subcommands: ${slashCommandSubcommands("goal")
      .map((item) => item.usage)
      .join(", ")}`,
  );
}

function goalDetails(goal: ThreadGoal): DisplayDetailSection[] {
  const rows: DisplayDetailMetaRow[] = [
    { key: "status", value: goal.status },
    { key: "objective", value: goal.objective },
    {
      key: "tokens",
      value: goal.tokenBudget === null ? String(goal.tokensUsed) : `${String(goal.tokensUsed)} / ${String(goal.tokenBudget)}`,
    },
    { key: "elapsed", value: formatGoalElapsed(goal.timeUsedSeconds) },
  ];
  return [{ rows }];
}

function formatGoalElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(remainingSeconds)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remainingMinutes)}m`;
}

function usageError(command: SlashCommandName, message: string): string {
  const definition = slashCommandDefinition(command);
  return `${definition.command} ${message}. Usage: ${definition.usage}`;
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
  const parsed = parseThreadAndTextArgs(args);
  return parsed ? { threadQuery: parsed.threadQuery, message: parsed.text } : null;
}

function parseThreadAndTextArgs(args: string): { threadQuery: string; text: string } | null {
  const match = /^(\S+)\s+([\s\S]*\S)\s*$/.exec(args);
  if (!match) return null;
  const threadQuery = match[1];
  const text = match[2];
  return threadQuery !== undefined && text !== undefined ? { threadQuery, text } : null;
}

function parseThreadAndNameArgs(args: string): { threadQuery: string; text: string } | null {
  const parsed = parseThreadAndTextArgs(args);
  if (!parsed) return null;
  const text = parsed.text.trim();
  return text ? { threadQuery: parsed.threadQuery, text } : null;
}

function resolveThreadArgument(args: string, threads: readonly Thread[]): ThreadResolution {
  const query = args.trim();
  if (!query) {
    const thread = threads.at(0);
    return thread ? { ok: true, thread } : { ok: false, message: "No recent threads to resume." };
  }

  const idMatches = threads.filter((thread) => thread.id === query || thread.id.startsWith(query));
  if (idMatches.length === 1 && idMatches[0]) return { ok: true, thread: idMatches[0] };
  if (idMatches.length > 1) return { ok: false, message: `Multiple matching threads: ${idMatches.map((thread) => thread.id).join(", ")}` };

  const titleQuery = query.toLowerCase();
  const titleMatches = threads.filter((thread) => getThreadTitle(thread).toLowerCase().includes(titleQuery));
  if (titleMatches.length === 1 && titleMatches[0]) return { ok: true, thread: titleMatches[0] };
  if (titleMatches.length > 1) return { ok: false, message: `Multiple matching threads: ${titleMatches.map(getThreadTitle).join(", ")}` };

  return { ok: false, message: `No matching thread: ${query}` };
}
