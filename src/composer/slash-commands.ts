export const SLASH_COMMANDS = [
  { command: "/new", detail: "Start a new Codex thread, optionally sending a message." },
  { command: "/resume", detail: "Resume a recent Codex thread." },
  { command: "/refer", detail: "Send a message with up to 20 recent turns from another non-archived thread." },
  { command: "/fork", detail: "Fork the active Codex thread." },
  { command: "/rollback", detail: "Drop the latest turn and restore its prompt to the composer." },
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
