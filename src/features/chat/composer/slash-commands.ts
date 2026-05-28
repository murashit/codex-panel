export type SlashCommandArgsKind = "none" | "optionalThread" | "requiredThread" | "optionalMessage" | "threadAndMessage" | "showOrSet";

export const SLASH_COMMANDS = [
  {
    command: "/new",
    usage: "/new [message]",
    argsKind: "optionalMessage",
    detail: "Start a new Codex thread, optionally with a message.",
  },
  { command: "/resume", usage: "/resume [thread]", argsKind: "optionalThread", detail: "Resume a recent Codex thread." },
  {
    command: "/refer",
    usage: "/refer <thread> <message>",
    argsKind: "threadAndMessage",
    detail: "Send a message with recent turns from another non-archived thread.",
  },
  { command: "/fork", usage: "/fork", argsKind: "none", detail: "Fork the active Codex thread." },
  { command: "/rollback", usage: "/rollback", argsKind: "none", detail: "Roll back the latest turn and restore its prompt." },
  { command: "/compact", usage: "/compact", argsKind: "none", detail: "Compact the current thread context." },
  { command: "/archive", usage: "/archive <thread>", argsKind: "requiredThread", detail: "Archive the selected Codex thread." },
  {
    command: "/auto-review",
    usage: "/auto-review [message]",
    argsKind: "optionalMessage",
    detail: "Toggle approval auto-review, optionally with a message.",
  },
  { command: "/fast", usage: "/fast", argsKind: "none", detail: "Toggle fast service tier for subsequent turns." },
  { command: "/plan", usage: "/plan [message]", argsKind: "optionalMessage", detail: "Toggle Plan mode, optionally with a message." },
  { command: "/status", usage: "/status", argsKind: "none", detail: "Show current thread, context, and usage limits." },
  { command: "/doctor", usage: "/doctor", argsKind: "none", detail: "Show Codex CLI and Codex App Server diagnostics." },
  { command: "/mcp", usage: "/mcp", argsKind: "none", detail: "Show MCP servers reported by Codex App Server." },
  { command: "/model", usage: "/model [model|default]", argsKind: "showOrSet", detail: "Show or set the model for subsequent turns." },
  {
    command: "/effort",
    usage: "/effort [effort|default]",
    argsKind: "showOrSet",
    detail: "Show or set reasoning effort for subsequent turns.",
  },
  { command: "/help", usage: "/help", argsKind: "none", detail: "Show available Codex slash commands." },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number]["command"];

export type SlashCommandName = SlashCommand extends `/${infer Name}` ? Name : never;

export type SlashCommandDefinition = (typeof SLASH_COMMANDS)[number];

export function slashCommandDefinition(command: SlashCommandName): SlashCommandDefinition {
  const definition = SLASH_COMMANDS.find((item) => item.command === `/${command}`);
  if (!definition) throw new Error(`Unknown slash command: ${command}`);
  return definition;
}

export function slashCommandHelpLines(): string[] {
  return SLASH_COMMANDS.map((item) => `${item.usage} - ${item.detail}`);
}

export function slashCommandHelpRows(): { key: string; value: string }[] {
  return SLASH_COMMANDS.map((item) => ({ key: item.usage, value: item.detail }));
}
