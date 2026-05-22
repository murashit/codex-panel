export const SLASH_COMMANDS = [
  { command: "/new", detail: "Start a new Codex thread, optionally with a message." },
  { command: "/resume", detail: "Resume a recent Codex thread." },
  { command: "/refer", detail: "Send a message with recent turns from another non-archived thread." },
  { command: "/fork", detail: "Fork the active Codex thread." },
  { command: "/rollback", detail: "Roll back the latest turn and restore its prompt." },
  { command: "/compact", detail: "Compact the current conversation context." },
  { command: "/archive", detail: "Archive the active or selected Codex thread." },
  { command: "/auto-review", detail: "Toggle approval auto-review, optionally with a message." },
  { command: "/fast", detail: "Toggle fast service tier for subsequent turns." },
  { command: "/plan", detail: "Toggle Plan mode, optionally with a message." },
  { command: "/status", detail: "Show current session, context, and usage limits." },
  { command: "/doctor", detail: "Show Codex CLI and Codex App Server diagnostics." },
  { command: "/mcp", detail: "Show MCP servers reported by Codex App Server." },
  { command: "/model", detail: "Show or set the model for subsequent turns." },
  { command: "/effort", detail: "Show or set reasoning effort for subsequent turns." },
  { command: "/help", detail: "Show available Codex slash commands." },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number]["command"];

export type SlashCommandName = SlashCommand extends `/${infer Name}` ? Name : never;

export function slashCommandHelpLines(): string[] {
  return SLASH_COMMANDS.map((item) => `${item.command} - ${item.detail}`);
}

export function slashCommandHelpRows(): { key: string; value: string }[] {
  return SLASH_COMMANDS.map((item) => ({ key: item.command, value: item.detail }));
}
