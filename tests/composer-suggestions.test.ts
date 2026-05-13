import { describe, expect, it } from "vitest";

import type { Thread } from "../src/generated/app-server/v2/Thread";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionSignature,
  composerSuggestionNavigationDirection,
  findWikiLinkSuggestions,
  nextComposerSuggestionIndex,
  parseSlashCommand,
} from "../src/composer/suggestions";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    sessionId: "session-1",
    forkedFromId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    path: null,
    cwd: "/vault",
    cliVersion: "0.130.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  } as Thread;
}

describe("composer suggestions", () => {
  const notes = [
    { basename: "Alpha", path: "thoughts/Alpha.md", mtime: 10 },
    { basename: "Alpha", path: "projects/Alpha.md", mtime: 20 },
    { basename: "Beta Note", path: "topics/Beta Note.md", mtime: 30 },
  ];

  it("parses supported slash commands only", () => {
    expect(parseSlashCommand("/status")).toEqual({ command: "status", args: "" });
    expect(parseSlashCommand("/new")).toEqual({ command: "new", args: "" });
    expect(parseSlashCommand("/resume thread-1")).toEqual({ command: "resume", args: "thread-1" });
    expect(parseSlashCommand("/fork")).toEqual({ command: "fork", args: "" });
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
    expect(activeComposerSuggestions("/status", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("/help", notes, [])).toEqual([]);
  });

  it("suggests recent threads for /resume arguments", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Codex Panel実装" }),
      thread({ id: "019abcde-0000-7000-8000-000000000002", name: "別件" }),
    ];

    const suggestions = activeComposerSuggestions("/resume codex", notes, [], threads);

    expect(suggestions[0]).toMatchObject({
      display: "Codex Panel実装",
      detail: "019abcde",
      replacement: "019abcde-0000-7000-8000-000000000001",
      appendSpaceOnInsert: true,
    });
    expect(applyComposerSuggestionInsertion("/resume codex", 13, suggestions[0])).toEqual({
      value: "/resume 019abcde-0000-7000-8000-000000000001 ",
      cursor: 45,
    });
    expect(activeComposerSuggestions("/resume ", notes, [], threads)).toHaveLength(2);
    expect(activeComposerSuggestions("/resume", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/resume 019abcde-0000-7000-8000-000000000001", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/resume 019abcde-0000-7000-8000-000000000001 ", notes, [], threads)).toEqual([]);
  });

  it("does not suggest threads for /fork arguments", () => {
    const suggestions = activeComposerSuggestions(
      "/fork codex",
      notes,
      [],
      [thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Codex Panel実装" })],
    );

    expect(suggestions).toEqual([]);
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
    expect(
      activeComposerSuggestions("$obsidian-dataview-read", notes, [
        {
          name: "obsidian-dataview-read",
          description: "Read Dataview results",
          path: "/vault/___/skills/obsidian-dataview-read/SKILL.md",
          scope: "local",
          enabled: true,
        } as never,
      ]),
    ).toEqual([]);
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

  it("uses value and cursor as the dismissed suggestion signature", () => {
    const dismissed = composerSuggestionSignature("/sta", 4);

    expect(composerSuggestionSignature("/sta", 4)).toBe(dismissed);
    expect(composerSuggestionSignature("/sta", 3)).not.toBe(dismissed);
    expect(composerSuggestionSignature("/stat", 5)).not.toBe(dismissed);
  });
});
