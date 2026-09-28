import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { ThreadStreamAuditFact, ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import { type GoalSubcommandDefinition, goalSubcommandDefinition } from "./catalog";
import { parseThreadAndTextArgs, resolveThreadArgument, usageError } from "./execution-arguments";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "./execution-contracts";
import { parseWebCommandArgs } from "./parse";

export type ContextSlashCommandName = "refer" | "web" | "goal";

type ContextSlashCommandContext = Pick<
  SlashCommandExecutionContext,
  | "activeThreadId"
  | "listedThreads"
  | "threadCommandTarget"
  | "inputSnapshot"
  | "submission"
  | "referThread"
  | "readWebUrl"
  | "goals"
  | "addSystemMessage"
  | "addStructuredSystemMessage"
>;

export async function executeContextSlashCommand(
  command: ContextSlashCommandName,
  args: string,
  context: ContextSlashCommandContext,
): Promise<SlashCommandExecutionResult | undefined> {
  switch (command) {
    case "refer": {
      const parsed = parseThreadAndTextArgs(args);
      if (!parsed) {
        context.addSystemMessage(usageError(command, "requires a thread and a message"));
        return;
      }
      const thread = resolveThreadArgument(command, parsed.threadQuery, context.listedThreads, context.threadCommandTarget, {
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
      const reference = await context.referThread(thread.thread, parsed.text, context.inputSnapshot);
      return { sendText: reference.text, sendInput: reference.input };
    }
    case "web": {
      const parsed = parseWebCommandArgs(args);
      if (!parsed) {
        context.addSystemMessage(usageError(command, "requires a URL"));
        return;
      }
      if (!context.inputSnapshot) {
        context.addSystemMessage("Cannot read a web URL without composer input context.");
        return;
      }
      const web = await context.readWebUrl(parsed.url, parsed.message, context.inputSnapshot, context.submission.isCurrent);
      return { sendText: web.text, sendInput: web.input };
    }
    case "goal":
      return executeGoalCommand(args, context);
  }
  const _exhaustive: never = command;
  return _exhaustive;
}

async function executeGoalCommand(args: string, context: ContextSlashCommandContext): Promise<SlashCommandExecutionResult | undefined> {
  const parsed = parseGoalArgs(args);
  if (parsed.kind === "invalid") {
    context.addSystemMessage(parsed.message);
    return;
  }
  if (parsed.kind === "show") {
    const goal = context.goals.activeGoal();
    if (!goal) context.addSystemMessage("No goal set.");
    else context.addStructuredSystemMessage("Thread goal", goalDetails(goal));
    return;
  }
  const goal = context.goals.activeGoal();
  if (parsed.kind === "set") {
    await context.goals.setObjective(parsed.objective, goal?.tokenBudget ?? null, context.submission);
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
  if (parsed.kind === "edit") return { composerDraft: `/goal set ${goal.objective}` };
  context.submission.markAdopted();
  switch (parsed.kind) {
    case "pause":
      await context.goals.setStatus(threadId, "paused");
      return;
    case "resume":
      await context.goals.setStatus(threadId, "active");
      return;
    case "clear":
      await context.goals.clear(threadId);
      return;
    default:
      return parsed satisfies never;
  }
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
  const subcommand = goalSubcommandDefinition(subcommandName);
  if (!subcommand) return { kind: "invalid", message: usageError("goal", "requires a valid subcommand") };
  const subcommandArgs = (subcommandMatch?.[2] ?? "").trim();
  const argumentError = validateSubcommandArguments(subcommand, subcommandArgs);
  if (argumentError) return { kind: "invalid", message: argumentError };
  switch (subcommand.subcommand) {
    case "set":
      return { kind: "set", objective: subcommandArgs };
    case "edit":
    case "pause":
    case "resume":
    case "clear":
      return { kind: subcommand.subcommand };
    default:
      return subcommand satisfies never;
  }
}

function validateSubcommandArguments(subcommand: GoalSubcommandDefinition, args: string): string | null {
  if (subcommand.argsKind === "none" && args) return `${subcommand.usage} does not take arguments. Usage: ${subcommand.usage}`;
  if (subcommand.argsKind === "requiredMessage" && !args) {
    return `${subcommand.usage} requires an objective. Usage: ${subcommand.usage}`;
  }
  return null;
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
