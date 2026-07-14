import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import { normalizeReasoningEffort } from "../../../../domain/catalog/metadata";
import type { CodexInput } from "../../../../domain/chat/input";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import { shortThreadId } from "../../../../domain/threads/id";
import type { Thread } from "../../../../domain/threads/model";
import type { ReferencedThreadMetadata } from "../../../../domain/threads/reference";
import { resolveThreadSearchQuery } from "../../../../domain/threads/search";
import { threadDisplayTitle } from "../../../../domain/threads/title";
import { modelOverrideMessage, permissionProfileOverrideMessage, reasoningEffortOverrideMessage } from "../../domain/runtime/labels";
import type { ThreadStreamAuditFact, ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import {
  type SlashCommandName,
  type SlashCommandSubcommandDefinition,
  slashCommandDefinition,
  slashCommandHelpSections,
  slashCommandSubcommandDefinition,
  slashCommandSubcommands,
} from "../composer/slash-commands";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import type { GoalActions } from "../threads/goal-actions";
import type { ThreadManagementActions } from "../threads/thread-management-actions";

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
  openSideChat?: (threadId: string) => Promise<void>;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: ThreadStreamNoticeSection[]) => void;
  runtimeSettings: {
    toggleFastMode: ChatRuntimeSettingsActions["toggleFastMode"];
    toggleCollaborationMode: ChatRuntimeSettingsActions["toggleCollaborationMode"];
    toggleAutoReview: ChatRuntimeSettingsActions["toggleAutoReview"];
    requestModel: ChatRuntimeSettingsActions["requestModel"];
    resetModelToConfig: ChatRuntimeSettingsActions["resetModelToConfig"];
    requestPermissionProfile: ChatRuntimeSettingsActions["requestPermissionProfile"];
    resetPermissionProfileToConfig: ChatRuntimeSettingsActions["resetPermissionProfileToConfig"];
    requestReasoningEffort: ChatRuntimeSettingsActions["requestReasoningEffort"];
    resetReasoningEffortToConfig: ChatRuntimeSettingsActions["resetReasoningEffortToConfig"];
  };
  goals: {
    activeGoal: GoalActions["activeGoal"];
    setObjective: GoalActions["setObjective"];
    setStatus: GoalActions["setStatus"];
    clear: GoalActions["clear"];
  };
  statusDetails: () => ThreadStreamNoticeSection[];
  permissionDetails: () => ThreadStreamNoticeSection[];
  connectionDiagnosticDetails: () => ThreadStreamNoticeSection[];
  toolInventoryDetails: () => ThreadStreamNoticeSection[] | Promise<ThreadStreamNoticeSection[]>;
  modelStatusDetails: () => ThreadStreamNoticeSection[];
  effortStatusDetails: () => ThreadStreamNoticeSection[];
}

export interface SlashCommandExecutionContext extends SlashCommandExecutionPorts {
  activeThreadId: string | null;
  activeThreadEphemeral: boolean;
  listedThreads: readonly Thread[];
  referThread: (thread: Thread, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<ThreadReferenceInput | null>;
  readWebUrl: (url: string, message: string, inputSnapshot: ComposerInputSnapshot) => Promise<WebUrlInput>;
  supportedReasoningEfforts: () => readonly ReasoningEffort[];
  inputSnapshot?: ComposerInputSnapshot;
}

export interface SlashCommandExecutionResult {
  sendText?: string;
  sendInput?: CodexInput;
  referencedThread?: ReferencedThreadMetadata;
  composerDraft?: string;
}

export interface ThreadReferenceInput {
  text: string;
  input: CodexInput;
  referencedThread: ReferencedThreadMetadata;
}

export interface WebUrlInput {
  text: string;
  input: CodexInput;
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
      const thread = resolveThreadArgument(parsed.threadQuery, context.listedThreads, {
        excludedThreadId: context.activeThreadId,
        allowExactExcludedThread: true,
      });
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      if (thread.thread.id === context.activeThreadId) {
        context.addSystemMessage("Use the current thread directly instead of referencing it.");
        return;
      }
      if (!context.inputSnapshot) {
        context.addSystemMessage("Cannot reference a thread without composer input context.");
        return;
      }
      const reference = await context.referThread(thread.thread, parsed.message, context.inputSnapshot);
      if (!reference) return;
      return { sendText: reference.text, sendInput: reference.input, referencedThread: reference.referencedThread };
    }
    case "web": {
      const parsed = parseUrlAndMessageArgs(args);
      if (!parsed) {
        context.addSystemMessage(usageError(command, "requires a URL"));
        return;
      }
      if (!context.inputSnapshot) {
        context.addSystemMessage("Cannot read a web URL without composer input context.");
        return;
      }
      const web = await context.readWebUrl(parsed.url, parsed.message, context.inputSnapshot);
      return { sendText: web.text, sendInput: web.input };
    }
    case "fork":
      if (!context.activeThreadId) {
        context.addSystemMessage("No active thread to fork.");
        return;
      }
      if (context.activeThreadEphemeral) {
        context.addSystemMessage("Side chats cannot be forked.");
        return;
      }
      await context.threadActions.forkThread(context.activeThreadId);
      return;
    case "btw":
      if (!context.activeThreadId) {
        context.addSystemMessage("No active thread for a side chat.");
        return;
      }
      if (context.activeThreadEphemeral) {
        context.addSystemMessage("Side chats cannot be started from another side chat.");
        return;
      }
      if (!context.openSideChat) {
        context.addSystemMessage("Side chat is not available.");
        return;
      }
      await context.openSideChat(context.activeThreadId);
      return;
    case "rollback":
      if (!context.activeThreadId) {
        context.addSystemMessage("No active thread to roll back.");
        return;
      }
      if (context.activeThreadEphemeral) {
        context.addSystemMessage("Side chats cannot be rolled back.");
        return;
      }
      await context.threadActions.rollbackThread(context.activeThreadId);
      return;
    case "compact":
      if (!context.activeThreadId) {
        context.addSystemMessage("No active thread to compact.");
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
      context.addStructuredSystemMessage("Thread status", context.statusDetails());
      return;
    case "permissions": {
      const requested = parsePermissionProfileOverride(args);
      if (requested !== undefined) {
        if (context.activeThreadEphemeral) {
          context.addSystemMessage("Permission changes are unavailable in side chats.");
          return;
        }
        const applied = await applyPermissionProfileOverride(context, requested);
        if (applied === false) return;
        context.addSystemMessage(permissionProfileOverrideMessage(requested));
        return;
      }
      context.addStructuredSystemMessage("Permissions & Approvals", context.permissionDetails());
      return;
    }
    case "doctor":
      context.addStructuredSystemMessage("Connection diagnostics", context.connectionDiagnosticDetails());
      return;
    case "tools":
      context.addStructuredSystemMessage("Codex capabilities", await context.toolInventoryDetails());
      return;
    case "model": {
      const requested = parseModelOverride(args);
      if (requested !== undefined) {
        const applied = await applyModelOverride(context, requested);
        if (applied === false) return;
        context.addSystemMessage(modelOverrideMessage(requested));
        return;
      }
      context.addStructuredSystemMessage("Model settings", context.modelStatusDetails());
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
      context.addStructuredSystemMessage("Reasoning effort", context.effortStatusDetails());
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

function applyPermissionProfileOverride(
  context: SlashCommandExecutionContext,
  requested: string | null,
): boolean | undefined | Promise<boolean | undefined> {
  return requested === null
    ? context.runtimeSettings.resetPermissionProfileToConfig()
    : context.runtimeSettings.requestPermissionProfile(requested);
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

function parsePermissionProfileOverride(args: string): string | null | undefined {
  const profile = args.trim();
  if (!profile) return undefined;
  if (profile.toLowerCase() === "default") return null;
  return profile;
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
  if (definition.argsKind === "urlAndOptionalMessage" && !parseUrlAndMessageArgs(args)) return usageError(command, "requires a URL");
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
  return;
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

function goalDetails(goal: ThreadGoal): ThreadStreamNoticeSection[] {
  const auditFacts: ThreadStreamAuditFact[] = [
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

type ThreadResolution = { ok: true; thread: Thread } | { ok: false; message: string };

interface ThreadResolutionOptions {
  excludedThreadId?: string | null;
  allowExactExcludedThread?: boolean;
}

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

function parseUrlAndMessageArgs(args: string): { url: string; message: string } | null {
  const match = /^(\S+)(?:\s+([\s\S]*\S))?\s*$/.exec(args);
  if (!match) return null;
  const url = match[1];
  const message = match[2] ?? "";
  return url !== undefined ? { url, message } : null;
}

function resolveThreadArgument(args: string, threads: readonly Thread[], options: ThreadResolutionOptions = {}): ThreadResolution {
  const query = args.trim();
  const exactExcludedThread = options.allowExactExcludedThread
    ? threads.find((thread) => thread.id === options.excludedThreadId && threadIdMatchesExactly(thread.id, query))
    : null;
  if (exactExcludedThread) return { ok: true, thread: exactExcludedThread };

  const searchThreads = options.excludedThreadId ? threads.filter((thread) => thread.id !== options.excludedThreadId) : threads;
  const resolution = resolveThreadSearchQuery(searchThreads, query);
  if (resolution.kind === "match") return { ok: true, thread: resolution.match.thread };
  if (resolution.kind === "multiple") {
    const matches = resolution.matches.map((match) => threadResolutionLabel(match.thread)).join(", ");
    return { ok: false, message: `Multiple matching threads: ${matches}` };
  }
  return { ok: false, message: query ? `No matching thread: ${query}` : "No recent threads to resume." };
}

function threadResolutionLabel(thread: Thread): string {
  return `${threadDisplayTitle(thread)} (${shortThreadId(thread.id)})`;
}

function threadIdMatchesExactly(threadId: string, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return threadId.toLowerCase() === normalizedQuery || shortThreadId(threadId).toLowerCase() === normalizedQuery;
}
