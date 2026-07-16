import { describe, expect, it } from "vitest";

import {
  SLASH_COMMANDS,
  type SlashCommandName,
  slashCommandAvailableInSideChat,
  slashCommandHelpSections,
  slashCommandRequiresConnection,
} from "../../../../../src/features/chat/application/composer/slash-commands";

describe("slash command catalog", () => {
  it("defines unique command names and usage rows", () => {
    expect(new Set(SLASH_COMMANDS.map((definition) => definition.command)).size).toBe(SLASH_COMMANDS.length);
    expect(SLASH_COMMANDS.every((definition) => definition.usage.startsWith(definition.command))).toBe(true);
  });

  it("groups help by command surface and expands catalog subcommands", () => {
    const sections = slashCommandHelpSections();
    const keys = (title: string) => sections.find((section) => section.title === title)?.auditFacts.map((row) => row.key) ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Panel actions", "Thread settings", "Diagnostics", "Composition"]);
    expect(keys("Panel actions")).toEqual(expect.arrayContaining(["/clear", "/reconnect", "/archive <thread>", "/rename <thread> <name>"]));
    expect(keys("Thread settings")).toEqual(
      expect.arrayContaining(["/plan [message]", "/goal", "/goal set <objective>", "/goal edit", "/permissions [profile|default]"]),
    );
    expect(keys("Thread settings")).not.toContain("/goal [set <objective>|edit|pause|resume|clear]");
    expect(keys("Diagnostics")).toEqual(expect.arrayContaining(["/status", "/doctor", "/tools", "/help"]));
    expect(keys("Composition")).toEqual(["/refer <thread> <message>", "/web <url> [message]"]);
  });

  it("owns connection and side-chat availability metadata", () => {
    expect(
      SLASH_COMMANDS.filter((definition) => !slashCommandRequiresConnection(definition.command.slice(1) as SlashCommandName)).map(
        (item) => item.command,
      ),
    ).toEqual(["/reconnect", "/compact"]);
    expect(
      SLASH_COMMANDS.filter((definition) => !slashCommandAvailableInSideChat(definition.command.slice(1) as SlashCommandName)).map(
        (item) => item.command,
      ),
    ).toEqual(["/fork", "/btw", "/rollback"]);
  });
});
