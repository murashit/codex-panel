type SlashCommandArgsKind =
  | "none"
  | "optionalThread"
  | "requiredThread"
  | "optionalMessage"
  | "threadAndMessage"
  | "threadAndName"
  | "urlAndOptionalMessage"
  | "goal"
  | "showOrSet";

type SlashCommandSubcommandArgsKind = "none" | "requiredMessage";

type SlashCommandSurface = "panelAction" | "threadSetting" | "diagnostic" | "composition";

const SLASH_COMMAND_SURFACE_LABELS: Record<SlashCommandSurface, string> = {
  panelAction: "Panel actions",
  threadSetting: "Thread settings",
  diagnostic: "Diagnostics",
  composition: "Composition",
};

export interface SlashCommandSubcommandDefinition {
  subcommand: string;
  usage: string;
  argsKind: SlashCommandSubcommandArgsKind;
  detail: string;
}

export interface SlashCommandDefinitionShape {
  command: string;
  usage: string;
  argsKind: SlashCommandArgsKind;
  surface: SlashCommandSurface;
  detail: string;
  subcommands?: readonly SlashCommandSubcommandDefinition[];
}

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
    command: "/reconnect",
    usage: "/reconnect",
    argsKind: "none",
    surface: "panelAction",
    detail: "Reconnect to Codex app-server and resume the active thread.",
  },
  {
    command: "/refer",
    usage: "/refer <thread> <message>",
    argsKind: "threadAndMessage",
    surface: "composition",
    detail: "Send a message with recent turns from another non-archived thread.",
  },
  {
    command: "/clip",
    usage: "/clip <url> [message]",
    argsKind: "urlAndOptionalMessage",
    surface: "composition",
    detail: "Clip a URL into a vault note and send a wikilink reference with an optional message.",
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
    command: "/rename",
    usage: "/rename <thread> <name>",
    argsKind: "threadAndName",
    surface: "panelAction",
    detail: "Rename the selected Codex thread.",
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
    command: "/goal",
    usage: "/goal [set <objective>|edit|pause|resume|clear]",
    argsKind: "goal",
    surface: "threadSetting",
    detail: "Show or manage the current thread goal.",
    subcommands: [
      { subcommand: "set", usage: "/goal set <objective>", argsKind: "requiredMessage", detail: "Create or update the thread goal." },
      { subcommand: "edit", usage: "/goal edit", argsKind: "none", detail: "Load the current thread goal into the composer." },
      { subcommand: "pause", usage: "/goal pause", argsKind: "none", detail: "Pause the current thread goal." },
      { subcommand: "resume", usage: "/goal resume", argsKind: "none", detail: "Resume the current thread goal." },
      { subcommand: "clear", usage: "/goal clear", argsKind: "none", detail: "Clear the current thread goal." },
    ],
  },
  {
    command: "/status",
    usage: "/status",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show current thread, context, and usage limits.",
  },
  {
    command: "/permissions",
    usage: "/permissions [profile|default]",
    argsKind: "showOrSet",
    surface: "threadSetting",
    detail: "Show or set the permission profile for subsequent turns.",
  },
  {
    command: "/doctor",
    usage: "/doctor",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show Codex CLI and Codex App Server diagnostics.",
  },
  {
    command: "/tools",
    usage: "/tools",
    argsKind: "none",
    surface: "diagnostic",
    detail: "Show Codex plugins, tool providers, and skills reported by App Server.",
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
] as const satisfies readonly SlashCommandDefinitionShape[];

type SlashCommand = (typeof SLASH_COMMANDS)[number]["command"];

export type SlashCommandName = SlashCommand extends `/${infer Name}` ? Name : never;

export type SlashCommandDefinition = (typeof SLASH_COMMANDS)[number];

const CONNECTION_INDEPENDENT_SLASH_COMMANDS = new Set<SlashCommandName>(["compact", "reconnect"]);

export interface SlashCommandHelpSection {
  readonly title: string;
  readonly auditFacts: readonly { key: string; value: string }[];
}

export function slashCommandRequiresConnection(command: SlashCommandName): boolean {
  return !CONNECTION_INDEPENDENT_SLASH_COMMANDS.has(command);
}

export function slashCommandDefinition(command: SlashCommandName): SlashCommandDefinition {
  const definition = SLASH_COMMANDS.find((item) => item.command === `/${command}`);
  if (!definition) throw new Error(`Unknown slash command: ${command}`);
  return definition;
}

export function slashCommandSubcommands(command: SlashCommandName): readonly SlashCommandSubcommandDefinition[] {
  const definition = slashCommandDefinition(command);
  return "subcommands" in definition ? definition.subcommands : [];
}

export function slashCommandSubcommandDefinition(command: SlashCommandName, subcommand: string): SlashCommandSubcommandDefinition | null {
  return slashCommandSubcommands(command).find((item) => item.subcommand === subcommand) ?? null;
}

export function slashCommandHelpSections(): SlashCommandHelpSection[] {
  return (Object.keys(SLASH_COMMAND_SURFACE_LABELS) as SlashCommandSurface[])
    .map((surface) => ({
      title: SLASH_COMMAND_SURFACE_LABELS[surface],
      auditFacts: SLASH_COMMANDS.filter((item) => item.surface === surface).flatMap(slashCommandHelpRows),
    }))
    .filter((section) => section.auditFacts.length > 0);
}

function slashCommandHelpRows(command: SlashCommandDefinition): readonly { key: string; value: string }[] {
  if (!("subcommands" in command)) return [{ key: command.usage, value: command.detail }];

  return [
    { key: command.command, value: command.detail },
    ...command.subcommands.map((subcommand) => ({
      key: subcommand.usage,
      value: subcommand.detail,
    })),
  ];
}
