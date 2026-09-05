import { parseThreadAndTextArgs, parseThreadOnlyArgs, resolveThreadArgument, usageError } from "./execution-arguments";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "./execution-contracts";

export type ThreadSlashCommandName = "clear" | "resume" | "reconnect" | "fork" | "btw" | "rollback" | "compact" | "archive" | "rename";

type ThreadSlashCommandContext = Pick<
  SlashCommandExecutionContext,
  | "activeThreadId"
  | "listedThreads"
  | "threadCommandTarget"
  | "submission"
  | "startNewThread"
  | "resumeThread"
  | "reconnect"
  | "threadCommands"
  | "openSideChat"
  | "addSystemMessage"
>;

export async function executeThreadSlashCommand(
  command: ThreadSlashCommandName,
  args: string,
  context: ThreadSlashCommandContext,
): Promise<SlashCommandExecutionResult | undefined> {
  switch (command) {
    case "clear":
      context.submission.adoptPanelTarget(null);
      await context.startNewThread();
      return;
    case "resume": {
      const query = parseThreadOnlyArgs(args, { allowEmpty: true });
      if (query === null) {
        context.addSystemMessage(usageError(command, "requires a quoted title when the title contains spaces"));
        return;
      }
      const thread = resolveThreadArgument(command, query, context.listedThreads, context.threadCommandTarget);
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      context.submission.adoptPanelTarget(thread.thread.id);
      await context.resumeThread(thread.thread.id);
      return;
    }
    case "reconnect":
      context.submission.markAdopted();
      await context.reconnect({
        beforeTargetReset: () => {
          context.submission.adoptPanelTarget(null);
        },
      });
      return;
    case "fork":
      if (!context.activeThreadId) {
        noActiveThread(context, "to fork");
        return;
      }
      context.submission.markAdopted();
      await context.threadCommands.forkThread(context.activeThreadId);
      return;
    case "btw":
      if (!context.activeThreadId) {
        noActiveThread(context, "for a side chat");
        return;
      }
      if (!context.openSideChat) {
        context.addSystemMessage("Side chat is not available.");
        return;
      }
      context.submission.markAdopted();
      if (args) await context.openSideChat(context.activeThreadId, args);
      else await context.openSideChat(context.activeThreadId);
      return;
    case "rollback":
      if (!context.activeThreadId) {
        noActiveThread(context, "to roll back");
        return;
      }
      context.submission.markAdopted();
      await context.threadCommands.rollbackThread(context.activeThreadId, { adoptPanelTarget: context.submission.adoptPanelTarget });
      return;
    case "compact":
      if (!context.activeThreadId) {
        noActiveThread(context, "to compact");
        return;
      }
      context.submission.markAdopted();
      await context.threadCommands.compactThread(context.activeThreadId);
      return;
    case "archive": {
      const query = parseThreadOnlyArgs(args);
      if (query === null) {
        context.addSystemMessage(usageError(command, "requires one thread title"));
        return;
      }
      const thread = resolveThreadArgument(command, query, context.listedThreads, context.threadCommandTarget);
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      context.submission.markAdopted();
      await context.threadCommands.archiveThread(
        thread.thread.id,
        undefined,
        thread.thread.id === context.activeThreadId
          ? () => {
              context.submission.adoptPanelTarget(null);
            }
          : undefined,
      );
      return;
    }
    case "rename": {
      const parsed = parseThreadAndTextArgs(args);
      if (!parsed) {
        context.addSystemMessage(usageError(command, "requires a thread and a name"));
        return;
      }
      const thread = resolveThreadArgument(command, parsed.threadQuery, context.listedThreads, context.threadCommandTarget);
      if (!thread.ok) {
        context.addSystemMessage(thread.message);
        return;
      }
      context.submission.markAdopted();
      await context.threadCommands.renameThread(thread.thread.id, parsed.text);
      return;
    }
  }
  const _exhaustive: never = command;
  return _exhaustive;
}

function noActiveThread(context: Pick<ThreadSlashCommandContext, "addSystemMessage">, suffix: string): undefined {
  context.addSystemMessage(`No active thread ${suffix}.`);
}
