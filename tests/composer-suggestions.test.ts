import { describe, expect, it } from "vitest";

import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  findWikiLinkSuggestions,
  nextComposerSuggestionIndex,
  parseSlashCommand,
} from "../src/composer/suggestions";

describe("composer suggestions", () => {
  const notes = [
    { basename: "Alpha", path: "thoughts/Alpha.md", mtime: 10 },
    { basename: "Alpha", path: "projects/Alpha.md", mtime: 20 },
    { basename: "Beta Note", path: "topics/Beta Note.md", mtime: 30 },
  ];

  it("parses supported slash commands only", () => {
    expect(parseSlashCommand("/status")).toEqual({ command: "status", args: "" });
    expect(parseSlashCommand("/doctor")).toEqual({ command: "doctor", args: "" });
    expect(parseSlashCommand("/fast now")).toEqual({ command: "fast", args: "now" });
    expect(parseSlashCommand("/plan")).toEqual({ command: "plan", args: "" });
    expect(parseSlashCommand("/plan OK、実装してください")).toEqual({ command: "plan", args: "OK、実装してください" });
    expect(parseSlashCommand("/model gpt-5.5")).toEqual({ command: "model", args: "gpt-5.5" });
    expect(parseSlashCommand("/effort high")).toEqual({ command: "effort", args: "high" });
    expect(parseSlashCommand("/unknown")).toBeNull();
  });

  it("ranks wikilinks and disambiguates duplicate basenames", () => {
    const suggestions = findWikiLinkSuggestions("alp", 0, notes);
    expect(suggestions[0]).toMatchObject({
      display: "Alpha",
      detail: "projects/Alpha.md",
      replacement: "[[projects/Alpha]]",
    });
  });

  it("uses one active suggestion family at a time", () => {
    expect(activeComposerSuggestions("[[bet", notes, [])[0]?.replacement).toBe("[[Beta Note]]");
    expect(activeComposerSuggestions("/pla", notes, [])[0]?.replacement).toBe("/plan");
    expect(activeComposerSuggestions("/eff", notes, [])[0]?.replacement).toBe("/effort");
    expect(activeComposerSuggestions("/sta", notes, [])[0]?.replacement).toBe("/status");
    expect(activeComposerSuggestions("/doc", notes, [])[0]?.replacement).toBe("/doctor");
  });

  it("adds a trailing space for slash command and skill insertions only", () => {
    const slash = activeComposerSuggestions("/sta", notes, [])[0];
    const skill = activeComposerSuggestions("$obs", notes, [
      {
        name: "obsidian-dataview-read",
        description: "Read Dataview results",
        path: "/vault/___/skills/obsidian-dataview-read/SKILL.md",
        scope: "local",
        enabled: true,
      } as never,
    ])[0];
    const wikilink = activeComposerSuggestions("[[bet", notes, [])[0];

    expect(slash).toMatchObject({ replacement: "/status", appendSpaceOnInsert: true });
    expect(skill).toMatchObject({ replacement: "$obsidian-dataview-read", appendSpaceOnInsert: true });
    expect(wikilink).toMatchObject({ replacement: "[[Beta Note]]" });
    expect(wikilink?.appendSpaceOnInsert).toBeUndefined();

    expect(applyComposerSuggestionInsertion("/sta", 4, slash)).toEqual({ value: "/status ", cursor: 8 });
    expect(applyComposerSuggestionInsertion("/sta then", 4, slash)).toEqual({ value: "/status then", cursor: 7 });
    expect(applyComposerSuggestionInsertion("[[bet", 5, wikilink)).toEqual({ value: "[[Beta Note]]", cursor: 13 });
  });

  it("maps arrow keys and Ctrl+n/p to suggestion navigation", () => {
    expect(composerSuggestionNavigationDirection({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: false })).toBe(1);
    expect(composerSuggestionNavigationDirection({ key: "ArrowUp", ctrlKey: false, metaKey: false, altKey: false })).toBe(-1);
    expect(composerSuggestionNavigationDirection({ key: "n", ctrlKey: true, metaKey: false, altKey: false })).toBe(1);
    expect(composerSuggestionNavigationDirection({ key: "p", ctrlKey: true, metaKey: false, altKey: false })).toBe(-1);
    expect(composerSuggestionNavigationDirection({ key: "Enter", ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
    expect(nextComposerSuggestionIndex(0, 3, -1)).toBe(2);
    expect(nextComposerSuggestionIndex(2, 3, 1)).toBe(0);
  });
});
