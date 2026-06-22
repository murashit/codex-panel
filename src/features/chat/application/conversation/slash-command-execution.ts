import type { CodexInput } from "../../../../domain/chat/input";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { normalizeReasoningEffort } from "../../../../domain/catalog/metadata";
import type { Thread } from "../../../../domain/threads/model";
import { threadDisplayTitle } from "../../../../domain/threads/title";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import { shortThreadId } from "../../../../utils";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { GoalActions } from "../threads/goal-actions";
import type { ThreadManagementActions } from "../threads/thread-management-actions";
import {
  slashCommandDefinition,
  slashCommandHelpSections,
  slashCommandSubcommandDefinition,
  slashCommandSubcommands,
  type SlashCommandName,
  type SlashCommandSubcommandDefinition,
} from "../composer/slash-commands";
import type { MessageStreamAuditFact, MessageStreamNoticeSection } from "../../domain/message-stream/items";
import { modelOverrideMessage, reasoningEffortOverrideMessage } from "../../presentation/runtime/messages";

const DEFAULT_RUNTIME_SETTING_ALIASES = new Set(["default", "reset", "clear", "off"]);

export interface SlashCommandExecutionPorts {
  startNewThread: () => Promise<void>;
  startThreadForGoal: (objective: string) => Promise<string | null>;
  resumeThread: (threadId: string) => Promise<void>;
  threadActions: {
    forkThread: ThreadManagementActions["forkThread"];
    rollbackThread: ThreadManagementActions["rollbackThread"];
    compactThread: ThreadManagementActions["compactThread"];
    archiveThread: ThreadManagementActions["archiveThread"];
    renameThread: ThreadManagementActions["renameThread"];
  };
  reconnect: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
  runtimeSettings: {
    toggleFastMode: ChatRuntimeSettingsActions["toggleFastMode"];
    toggleCollaborationMode: ChatRuntimeSettingsActions["toggleCollaborationMode"];
    toggleAutoReview: ChatRuntimeSettingsActions["toggleAutoReview"];
    requestModel: ChatRuntimeSettingsActions["requestModel"];
    resetModelToConfig: ChatRuntimeSettingsActions["resetModelToConfig"];
    requestReasoningEffort: ChatRuntimeSettingsActions["requestReasoningEffort"];
    resetReasoningEffortToConfig: ChatRuntimeSettingsActions["resetReasoningEffortToConfig"];
  };
  goals: {
    activeGoal: GoalActions["activeGoal"];
    setObjective: GoalActions["setObjective"];
    setStatus: GoalActions["setStatus"];
    clear: GoalActions["clear"];
  };
  statusSummaryLines: () => string[];
  connectionDiagnosticDetails: () => MessageStreamNoticeSection[];
  toolInventoryDetails: () => MessageStreamNoticeSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
}

export interface SlashCommandExecutionContext extends SlashCommandExecutionPorts {
  activeThreadId: string | null;
  listedThreads: readonly Thread[];
  referThread: (thread: Thread, message: string) => Promise<ThreadReferenceInput | null>;
  supportedReasoningEfforts: () => readonly ReasoningEffort[];
}

export interface SlashCommandExecutionResult {
  sendText?: string;
  sendInput?: CodexInput;
  referencedThread?: ReferencedThreadMetadata;
  composerDraft?: string;
}

export interface ThreadReferenceInput {
  input: CodexInput;
  referencedThread: ReferencedThreadMetadata;
}

function currentThreadReferenceMessage(): string {
  return "Use the current thread directly instead of referencing it.";
}

function noActiveThreadToForkMessage(): string {
  return "No active thread to fork.";
}

function noActiveThreadToRollbackMessage(): string {
  return "No active thread to roll back.";
}

function noActiveThreadToCompactMessage(): string {
  return "No active thread to compact.";
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

  switch (command) {
    case "clear":
      await context.startNewThread();
      return;
    case "resume": {
      const thread = resolveThreadArgument(args, context.listedThreads);
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      await context.resumeThread(thread.thread.id);
      return;
    }
    case "reconnect":
      await context.reconnect();
      return;
    case "refer": {
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
        context.addSystemMessage(currentThreadReferenceMessage());
        return;
      }
      const reference = await context.referThread(thread.thread, parsed.message);
      if (!reference) return;
      return { sendText: parsed.message, sendInput: reference.input, referencedThread: reference.referencedThread };
    }
    case "fork":
      if (!context.activeThreadId) {
        context.addSystemMessage(noActiveThreadToForkMessage());
        return;
      }
      await context.threadActions.forkThread(context.activeThreadId);
      return;
    case "rollback":
      if (!context.activeThreadId) {
        context.addSystemMessage(noActiveThreadToRollbackMessage());
        return;
      }
      await context.threadActions.rollbackThread(context.activeThreadId);
      return;
    case "compact":
      if (!context.activeThreadId) {
        context.addSystemMessage(noActiveThreadToCompactMessage());
        return;
      }
      await context.threadActions.compactThread(context.activeThreadId);
      return;
    case "archive": {
      const thread = resolveThreadArgument(args, context.listedThreads);
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      await context.threadActions.archiveThread(thread.thread.id);
      return;
    }
    case "rename": {
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
      await context.threadActions.renameThread(thread.thread.id, parsed.text);
      return;
    }
    case "fast":
      await context.runtimeSettings.toggleFastMode();
      return;
    case "auto-review":
      await context.runtimeSettings.toggleAutoReview();
      return;
    case "plan":
      await context.runtimeSettings.toggleCollaborationMode();
      if (args) return { sendText: args };
      return;
    case "goal":
      return await executeGoalCommand(args, context);
    case "status":
      context.addStructuredSystemMessage("Thread status", detailsFromLines(context.statusSummaryLines()));
      return;
    case "doctor":
      context.addStructuredSystemMessage("Connection diagnostics", context.connectionDiagnosticDetails());
      return;
    case "tools":
      context.addStructuredSystemMessage("Codex capabilities", context.toolInventoryDetails());
      return;
    case "model": {
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
    case "reasoning": {
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
    case "help":
      context.addStructuredSystemMessage("Available slash commands", slashCommandHelpSections());
      return;
  }
  const _exhaustive: never = command;
  return _exhaustive;
}

function applyModelOverride(
  context: SlashCommandExecutionContext,
  requested: string | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null ? context.runtimeSettings.resetModelToConfig() : context.runtimeSettings.requestModel(requested);
}

function applyReasoningEffortOverride(
  context: SlashCommandExecutionContext,
  requested: ReasoningEffort | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null
    ? context.runtimeSettings.resetReasoningEffortToConfig()
    : context.runtimeSettings.requestReasoningEffort(requested);
}

function parseModelOverride(args: string): string | null | undefined {
  const model = args.trim();
  if (!model) return undefined;
  if (DEFAULT_RUNTIME_SETTING_ALIASES.has(model.toLowerCase())) return null;
  return model;
}

function parseReasoningEffortOverride(args: string): ReasoningEffort | null | undefined {
  const effort = args.trim();
  if (!effort) return undefined;
  if (DEFAULT_RUNTIME_SETTING_ALIASES.has(effort.toLowerCase())) return null;
  return normalizeReasoningEffort(effort) ?? undefined;
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
    const goal = context.goals.activeGoal();
    if (!goal) {
      context.addSystemMessage("No goal set.");
      return;
    }
    context.addStructuredSystemMessage("Thread goal", goalDetails(goal));
    return;
  }
  const goal = context.goals.activeGoal();
  if (parsed.kind === "set") {
    const threadId = context.activeThreadId ?? (await context.startThreadForGoal(parsed.objective));
    if (!threadId) {
      context.addSystemMessage("No active thread for goal management.");
      return;
    }
    await context.goals.setObjective(threadId, parsed.objective, goal?.tokenBudget ?? null);
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
    await context.goals.setStatus(threadId, "paused");
    return;
  }
  if (parsed.kind === "resume") {
    await context.goals.setStatus(threadId, "active");
    return;
  }
  await context.goals.clear(threadId);
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

function goalDetails(goal: ThreadGoal): MessageStreamNoticeSection[] {
  const auditFacts: MessageStreamAuditFact[] = [
    { key: "status", value: goal.status },
    { key: "objective", value: goal.objective },
    {
      key: "tokens",
      value: goal.tokenBudget === null ? String(goal.tokensUsed) : `${String(goal.tokensUsed)} / ${String(goal.tokenBudget)}`,
    },
    { key: "elapsed", value: formatGoalElapsed(goal.timeUsedSeconds) },
  ];
  return [{ auditFacts }];
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

function detailsFromLines(lines: string[]): MessageStreamNoticeSection[] {
  const first = lines[0] ?? "";
  const content = first.includes(": ") ? lines : lines.slice(1);
  return [{ auditFacts: content.map(lineToRow) }];
}

function lineToRow(line: string): MessageStreamAuditFact {
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
  const titleMatches = threads.filter((thread) => threadDisplayTitle(thread).toLowerCase().includes(titleQuery));
  if (titleMatches.length === 1 && titleMatches[0]) return { ok: true, thread: titleMatches[0] };
  if (titleMatches.length > 1) {
    return { ok: false, message: `Multiple matching threads: ${titleMatches.map(threadResolutionLabel).join(", ")}` };
  }

  return { ok: false, message: `No matching thread: ${query}` };
}

function threadResolutionLabel(thread: Thread): string {
  return `${threadDisplayTitle(thread)} (${shortThreadId(thread.id)})`;
}
