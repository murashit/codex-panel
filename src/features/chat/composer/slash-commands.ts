export type SlashCommandArgsKind = "none" | "optionalThread" | "requiredThread" | "optionalMessage" | "threadAndMessage" | "showOrSet";

export type SlashCommandSurface = "panelAction" | "threadSetting" | "diagnostic" | "composition";

export const SLASH_COMMAND_SURFACE_LABELS: Record<SlashCommandSurface, string> = {
  panelAction: "Panel actions",
  threadSetting: "Thread settings",
  diagnostic: "Diagnostics",
  composition: "Composition",
};

export const SLASH_COMMANDS = [
  {
    command: "/clear",
    usage: "/clear",
    argsKind: "none",
    surface: "panelAction",
    detail: "Clear the current panel and start a fresh Codex thread.",
  },
  {
    command: "/resume",
    usage: "/resume [thread]",
    argsKind: "optionalThread",
    surface: "panelAction",
    detail: "Resume a recent Codex thread.",
  },
  {
    command: "/refer",
    usage: "/refer <thread> <message>",
    argsKind: "threadAndMessage",
    surface: "composition",
    detail: "Send a message with recent turns from another non-archived thread.",
  },
  { command: "/fork", usage: "/fork", argsKind: "none", surface: "panelAction", detail: "Fork the active Codex thread." },
  {
    command: "/rollback",
    usage: "/rollback",
    argsKind: "none",
    surface: "panelAction",
    detail: "Roll back the latest turn and restore its prompt.",
  },
  { command: "/compact", usage: "/compact", argsKind: "none", surface: "panelAction", detail: "Compact the current thread context." },
  {
    command: "/archive",
    usage: "/archive <thread>",
    argsKind: "requiredThread",
    surface: "panelAction",
    detail: "Archive the selected Codex thread.",
  },
  {
    command: "/auto-review",
    usage: "/auto-review",
    argsKind: "none",
    surface: "threadSetting",
    detail: "Toggle approval auto-review.",
  },
  {
    command: "/fast",
    usage: "/fast",
    argsKind: "none",
    surface: "threadSetting",
    detail: "Toggle fast service tier for subsequent turns.",
  },
  {
    command: "/plan",
    usage: "/plan [message]",
    argsKind: "optionalMessage",
    surface: "threadSetting",
    detail: "Toggle Plan mode, optionally with a message.",
  },
  {
    command: "/status",
    usage: "/status",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show current thread, context, and usage limits.",
  },
  {
    command: "/doctor",
    usage: "/doctor",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show Codex CLI and Codex App Server diagnostics.",
  },
  {
    command: "/mcp",
    usage: "/mcp",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show MCP servers reported by Codex App Server.",
  },
  {
    command: "/model",
    usage: "/model [model|default]",
    argsKind: "showOrSet",
    surface: "threadSetting",
    detail: "Show or set the model for subsequent turns.",
  },
  {
    command: "/reasoning",
    usage: "/reasoning [level|default]",
    argsKind: "showOrSet",
    surface: "threadSetting",
    detail: "Show or set reasoning level for subsequent turns.",
  },
  {
    command: "/help",
    usage: "/help",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show available Codex slash commands.",
  },
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

export function slashCommandHelpSections(): { title: string; rows: { key: string; value: string }[] }[] {
  return (Object.keys(SLASH_COMMAND_SURFACE_LABELS) as SlashCommandSurface[])
    .map((surface) => ({
      title: SLASH_COMMAND_SURFACE_LABELS[surface],
      rows: SLASH_COMMANDS.filter((item) => item.surface === surface).map((item) => ({ key: item.usage, value: item.detail })),
    }))
    .filter((section) => section.rows.length > 0);
}
