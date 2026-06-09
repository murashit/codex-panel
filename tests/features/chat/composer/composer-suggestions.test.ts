import { describe, expect, it } from "vitest";

import type { ReasoningEffort } from "../../../../src/generated/app-server/ReasoningEffort";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";
import type { PanelModelOption } from "../../../../src/domain/catalog/model";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionSignature,
  composerSuggestionNavigationDirection,
  findWikiLinkSuggestions,
  nextComposerSuggestionIndex,
  parseSlashCommand,
} from "../../../../src/features/chat/composer/suggestions";
import { userInputWithWikiLinkMentions } from "../../../../src/features/chat/composer/wikilink-context";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function thread(overrides: Partial<Thread & { archived: boolean }> = {}): Thread & { archived: boolean } {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
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
    archived: false,
    turns: [],
    ...overrides,
  } as Thread & { archived: boolean };
}

function model(name: string, efforts: ReasoningEffort[], overrides: Partial<PanelModelOption> = {}): PanelModelOption {
  return {
    id: name,
    model: name,
    displayName: name,
    description: `${name} description`,
    hidden: false,
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort: efforts[0] ?? "medium",
    inputModalities: ["text"],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
    ...overrides,
  };
}

describe("composer suggestions", () => {
  const notes = [
    {
      basename: "Alpha",
      displayName: "Alpha",
      path: "thoughts/Alpha.md",
      mtime: 10,
      linktext: "thoughts/Alpha",
      headings: [],
      recentIndex: 1,
    },
    {
      basename: "Alpha",
      displayName: "Alpha",
      path: "projects/Alpha.md",
      mtime: 20,
      linktext: "projects/Alpha",
      headings: [],
      recentIndex: 0,
    },
    {
      basename: "Beta Note",
      displayName: "Beta Note",
      path: "topics/Beta Note.md",
      mtime: 30,
      linktext: "Beta Note",
      headings: [
        { heading: "Overview", linkHeading: "Overview", level: 1 },
        { heading: "Implementation Details", linkHeading: "Implementation Details", level: 2 },
      ],
      recentIndex: null,
    },
    {
      basename: "Projects",
      displayName: "Projects.base",
      path: "Bases/Projects.base",
      mtime: 40,
      linktext: "Bases/Projects.base",
      headings: [],
      recentIndex: null,
    },
    {
      basename: "Paper",
      displayName: "Paper.pdf",
      path: "References/Paper.pdf",
      mtime: 50,
      linktext: "References/Paper.pdf",
      headings: [],
      recentIndex: null,
    },
    {
      basename: "Diagram",
      displayName: "Diagram.png",
      path: "Assets/Diagram.png",
      mtime: 60,
      linktext: "Assets/Diagram.png",
      headings: [],
      recentIndex: 2,
    },
  ];

  it("parses supported slash commands only", () => {
    expect(parseSlashCommand("/status")).toEqual({ command: "status", args: "" });
    expect(parseSlashCommand("/clear")).toEqual({ command: "clear", args: "" });
    expect(parseSlashCommand("/resume thread-1")).toEqual({ command: "resume", args: "thread-1" });
    expect(parseSlashCommand("/refer thread-1 続きです")).toEqual({ command: "refer", args: "thread-1 続きです" });
    expect(parseSlashCommand("/fork")).toEqual({ command: "fork", args: "" });
    expect(parseSlashCommand("/archive thread-1")).toEqual({ command: "archive", args: "thread-1" });
    expect(parseSlashCommand("/rename thread-1 New name")).toEqual({ command: "rename", args: "thread-1 New name" });
    expect(parseSlashCommand("/doctor")).toEqual({ command: "doctor", args: "" });
    expect(parseSlashCommand("/fast now")).toEqual({ command: "fast", args: "now" });
    expect(parseSlashCommand("/plan")).toEqual({ command: "plan", args: "" });
    expect(parseSlashCommand("/plan OK、実装してください")).toEqual({ command: "plan", args: "OK、実装してください" });
    expect(parseSlashCommand("/model gpt-5.5")).toEqual({ command: "model", args: "gpt-5.5" });
    expect(parseSlashCommand("/reasoning high")).toEqual({ command: "reasoning", args: "high" });
    expect(parseSlashCommand("/new")).toBeNull();
    expect(parseSlashCommand("/unknown")).toBeNull();
  });

  it("ranks wikilinks with Obsidian fuzzy search and uses Obsidian linktext", () => {
    const suggestions = findWikiLinkSuggestions("alp", 0, notes);
    expect(suggestions[0]).toMatchObject({
      display: "Alpha",
      detail: "projects/Alpha.md",
      replacement: "[[projects/Alpha]]",
    });
    expect(findWikiLinkSuggestions("btnt", 0, notes)[0]).toMatchObject({
      display: "Beta Note",
      replacement: "[[Beta Note]]",
    });
  });

  it("uses recent files only for empty wikilink suggestions", () => {
    expect(findWikiLinkSuggestions("", 0, notes).map((suggestion) => suggestion.replacement)).toEqual([
      "[[projects/Alpha]]",
      "[[thoughts/Alpha]]",
      "[[Assets/Diagram.png]]",
    ]);
  });

  it("suggests non-markdown vault files when filtering wikilinks", () => {
    expect(findWikiLinkSuggestions("projects", 0, notes)[0]).toMatchObject({
      display: "Projects.base",
      detail: "Bases/Projects.base",
      replacement: "[[Bases/Projects.base]]",
    });
    expect(findWikiLinkSuggestions("paper", 0, notes)[0]).toMatchObject({
      display: "Paper.pdf",
      detail: "References/Paper.pdf",
      replacement: "[[References/Paper.pdf]]",
    });
  });

  it("keeps non-markdown wikilink completions compatible with mention parsing", () => {
    const suggestion = expectPresent(findWikiLinkSuggestions("diagram", 0, notes)[0]);
    const text = `Please inspect ${suggestion.replacement}`;
    const input = userInputWithWikiLinkMentions(text, (target) =>
      target === "Assets/Diagram.png" ? { name: "Diagram", path: "Assets/Diagram.png" } : null,
    );

    expect(suggestion).toMatchObject({
      display: "Diagram.png",
      detail: "Assets/Diagram.png",
      replacement: "[[Assets/Diagram.png]]",
    });
    expect(input).toEqual([
      { type: "text", text, text_elements: [] },
      { type: "mention", name: "Diagram", path: "Assets/Diagram.png" },
    ]);
  });

  it("suggests headings inside a completed wikilink without suggesting block references", () => {
    const heading = expectPresent(activeComposerSuggestions("[[Beta Note#impl", notes, [])[0]);

    expect(activeComposerSuggestions("[[Beta Note#", notes, []).map((suggestion) => suggestion.replacement)).toEqual([
      "[[Beta Note#Overview]]",
      "[[Beta Note#Implementation Details]]",
    ]);
    expect(heading).toMatchObject({
      display: "Implementation Details",
      detail: "## topics/Beta Note.md",
      replacement: "[[Beta Note#Implementation Details]]",
    });
    expect(applyComposerSuggestionInsertion("[[Beta Note#impl]]", 16, heading)).toEqual({
      value: "[[Beta Note#Implementation Details]]",
      cursor: 36,
    });
    expect(applyComposerSuggestionInsertion("[[Beta Note#impl next", 16, heading)).toEqual({
      value: "[[Beta Note#Implementation Details]] next",
      cursor: 36,
    });
    expect(activeComposerSuggestions("[[Beta Note#^", notes, [])).toEqual([]);
  });

  it("uses one active suggestion family at a time", () => {
    expect(activeComposerSuggestions("[[bet", notes, [])[0]?.replacement).toBe("[[Beta Note]]");
    expect(activeComposerSuggestions("/pla", notes, [])[0]?.replacement).toBe("/plan");
    expect(activeComposerSuggestions("/rea", notes, [])[0]?.replacement).toBe("/reasoning");
    expect(activeComposerSuggestions("/sta", notes, [])[0]?.replacement).toBe("/status");
    expect(activeComposerSuggestions("/doc", notes, [])[0]?.replacement).toBe("/doctor");
    expect(activeComposerSuggestions("/status", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("/help", notes, [])).toEqual([]);
  });

  it("limits slash command suggestions to the start of the composer", () => {
    const threads = [thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Codex Panel実装" })];
    const models = [model("gpt-5.5", ["low", "medium", "high"])];

    expect(activeComposerSuggestions("please\n/sta", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("please\n/resume codex", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("please\n/model gpt", notes, [], [], models)).toEqual([]);
    expect(activeComposerSuggestions("please\n/reasoning h", notes, [], [], models, "gpt-5.5")).toEqual([]);
  });

  it("suggests recent threads for thread slash command arguments", () => {
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
    expect(applyComposerSuggestionInsertion("/resume codex", 13, expectPresent(suggestions[0]))).toEqual({
      value: "/resume 019abcde-0000-7000-8000-000000000001 ",
      cursor: 45,
    });
    expect(activeComposerSuggestions("/resume ", notes, [], threads)).toHaveLength(2);
    expect(activeComposerSuggestions("/resume", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/resume 019abcde-0000-7000-8000-000000000001", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/resume 019abcde-0000-7000-8000-000000000001 ", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/refer codex", notes, [], threads)[0]).toMatchObject({
      display: "Codex Panel実装",
      detail: "019abcde",
      replacement: "019abcde-0000-7000-8000-000000000001",
      appendSpaceOnInsert: true,
    });
    expect(activeComposerSuggestions("/refer 019abcde-0000-7000-8000-000000000001 ", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/archive codex", notes, [], threads)[0]).toMatchObject({
      display: "Codex Panel実装",
      detail: "019abcde",
      replacement: "019abcde-0000-7000-8000-000000000001",
      appendSpaceOnInsert: true,
    });
    expect(activeComposerSuggestions("/archive 019abcde-0000-7000-8000-000000000001 ", notes, [], threads)).toEqual([]);
    expect(activeComposerSuggestions("/rename codex", notes, [], threads)[0]).toMatchObject({
      display: "Codex Panel実装",
      detail: "019abcde",
      replacement: "019abcde-0000-7000-8000-000000000001",
      appendSpaceOnInsert: true,
    });
    expect(
      applyComposerSuggestionInsertion(
        "/rename codex",
        13,
        expectPresent(activeComposerSuggestions("/rename codex", notes, [], threads)[0]),
      ),
    ).toEqual({
      value: "/rename 019abcde-0000-7000-8000-000000000001 ",
      cursor: 45,
    });
    expect(activeComposerSuggestions("/rename 019abcde-0000-7000-8000-000000000001 New name", notes, [], threads)).toEqual([]);
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

  it("suggests slash subcommands from command definitions", () => {
    expect(activeComposerSuggestions("/goal ", notes, []).map((suggestion) => suggestion.replacement)).toEqual([
      "set",
      "edit",
      "pause",
      "resume",
      "clear",
    ]);
    expect(activeComposerSuggestions("/goal p", notes, [])[0]).toMatchObject({
      display: "pause",
      detail: "/goal pause - Pause the current thread goal.",
      replacement: "pause",
      appendSpaceOnInsert: true,
    });
    expect(applyComposerSuggestionInsertion("/goal p", 7, expectPresent(activeComposerSuggestions("/goal p", notes, [])[0]))).toEqual({
      value: "/goal pause ",
      cursor: 12,
    });
    expect(activeComposerSuggestions("/goal pause", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("/goal set Ship it", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("/plan p", notes, [])).toEqual([]);
  });

  it("suggests model override arguments for /model", () => {
    const models = [
      model("gpt-5.5", ["low", "medium", "high"]),
      model("gpt-5.4-mini", ["minimal", "low", "medium"]),
      model("hidden-model", ["medium"], { hidden: true }),
    ];

    const suggestions = activeComposerSuggestions("/model gpt-5.4", notes, [], [], models);

    expect(suggestions[0]).toMatchObject({
      display: "gpt-5.4-mini",
      detail: "gpt-5.4-mini",
      replacement: "gpt-5.4-mini",
      appendSpaceOnInsert: true,
    });
    expect(activeComposerSuggestions("/model ", notes, [], [], models).map((suggestion) => suggestion.replacement)).toEqual([
      "default",
      "gpt-5.4-mini",
      "gpt-5.5",
    ]);
    expect(activeComposerSuggestions("/model hidden", notes, [], [], models)).toEqual([]);
    expect(activeComposerSuggestions("/model gpt-5.5", notes, [], [], models)).toEqual([]);
    expect(activeComposerSuggestions("/model gpt-5.5 ", notes, [], [], models)).toEqual([]);
  });

  it("suggests reasoning effort arguments for /reasoning", () => {
    const models = [model("gpt-5.5", ["low", "medium", "high"]), model("gpt-5.4-mini", ["minimal", "low", "medium"])];

    expect(activeComposerSuggestions("/reasoning h", notes, [], [], models, "gpt-5.5")[0]).toMatchObject({
      display: "high",
      detail: "Supported by gpt-5.5",
      replacement: "high",
      appendSpaceOnInsert: true,
    });
    expect(
      activeComposerSuggestions("/reasoning ", notes, [], [], models, "gpt-5.4-mini").map((suggestion) => suggestion.replacement),
    ).toEqual(["default", "minimal", "low", "medium"]);
    expect(activeComposerSuggestions("/reasoning x", notes, [], [], models, "gpt-5.4-mini")).toEqual([]);
    expect(activeComposerSuggestions("/reasoning high", notes, [], [], models, "gpt-5.5")).toEqual([]);
    expect(activeComposerSuggestions("/reasoning high ", notes, [], [], models, "gpt-5.5")).toEqual([]);
  });

  it("adds a trailing space for slash command and skill insertions only", () => {
    const slash = expectPresent(activeComposerSuggestions("/sta", notes, [])[0]);
    const skill = expectPresent(
      activeComposerSuggestions("$obs", notes, [
        {
          name: "obsidian-dataview-read",
          description: "Read Dataview results",
          path: "/vault/___/skills/obsidian-dataview-read/SKILL.md",
          enabled: true,
        },
      ])[0],
    );
    const wikilink = expectPresent(activeComposerSuggestions("[[bet", notes, [])[0]);

    expect(slash).toMatchObject({
      detail: "/status - Show current thread, context, and usage limits.",
      replacement: "/status",
      appendSpaceOnInsert: true,
    });
    expect(skill).toMatchObject({ replacement: "$obsidian-dataview-read", appendSpaceOnInsert: true });
    expect(wikilink).toMatchObject({ replacement: "[[Beta Note]]" });
    expect(wikilink.appendSpaceOnInsert).toBeUndefined();

    expect(applyComposerSuggestionInsertion("/sta", 4, slash)).toEqual({ value: "/status ", cursor: 8 });
    expect(applyComposerSuggestionInsertion("/sta then", 4, slash)).toEqual({ value: "/status then", cursor: 7 });
    expect(applyComposerSuggestionInsertion("[[bet", 5, wikilink)).toEqual({ value: "[[Beta Note]]", cursor: 13 });
    expect(applyComposerSuggestionInsertion("[[bet", 5, wikilink, { activation: "tab" })).toEqual({
      value: "[[Beta Note]]",
      cursor: 11,
    });
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
