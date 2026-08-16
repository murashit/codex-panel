import type { SlashCommandName } from "./catalog";
import { executeContextSlashCommand } from "./execute-context";
import { executeRuntimeSlashCommand } from "./execute-runtime";
import { executeThreadSlashCommand } from "./execute-thread";
import { validateSlashCommandArguments } from "./execution-arguments";
import type { SlashCommandExecutionContext, SlashCommandExecutionResult } from "./execution-contracts";

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
    case "resume":
    case "reconnect":
    case "fork":
    case "btw":
    case "rollback":
    case "compact":
    case "archive":
    case "rename":
      return executeThreadSlashCommand(command, args, context);
    case "refer":
    case "web":
    case "goal":
      return executeContextSlashCommand(command, args, context);
    case "fast":
    case "auto-review":
    case "plan":
    case "status":
    case "permissions":
    case "doctor":
    case "tools":
    case "model":
    case "reasoning":
    case "help":
      return executeRuntimeSlashCommand(command, args, context);
  }
  const _exhaustive: never = command;
  return _exhaustive;
}
