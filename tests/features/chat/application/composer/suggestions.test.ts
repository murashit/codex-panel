import { describe, expect, it } from "vitest";
import type { ModelMetadata, ReasoningEffort, SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import type { Thread } from "../../../../../src/domain/threads/model";
import { emptyComposerContextReferences } from "../../../../../src/features/chat/application/composer/context-references";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
  parseSlashCommand,
} from "../../../../../src/features/chat/application/composer/suggestions";
import {
  preparedUserInputWithWikiLinkMentionsSkillsAndContext,
  type WikiLinkMentionResolver,
} from "../../../../../src/features/chat/application/composer/wikilink-context";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function wikiLinkSuggestions(query: string, notes: Parameters<typeof activeComposerSuggestions>[1]) {
  return activeComposerSuggestions(`[[${query}`, notes, []);
}

function userInputWithWikiLinkMentionsAndSkills(text: string, resolveMention: WikiLinkMentionResolver, skills: readonly SkillMetadata[]) {
  return preparedUserInputWithWikiLinkMentionsSkillsAndContext(text, resolveMention, skills, emptyComposerContextReferences(), {
    referenceActiveNoteOnSend: false,
  }).input;
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ...overrides,
  };
}

function model(name: string, efforts: ReasoningEffort[], overrides: Partial<ModelMetadata> = {}): ModelMetadata {
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

  it.each([
    { input: "/status", expected: { command: "status", args: "" } },
    { input: "/clear", expected: { command: "clear", args: "" } },
    { input: "/resume thread-1", expected: { command: "resume", args: "thread-1" } },
    { input: "/refer thread-1 続きです", expected: { command: "refer", args: "thread-1 続きです" } },
    { input: "/clip https://example.com/article 要約して", expected: { command: "clip", args: "https://example.com/article 要約して" } },
    { input: "/fork", expected: { command: "fork", args: "" } },
    { input: "/archive thread-1", expected: { command: "archive", args: "thread-1" } },
    { input: "/rename thread-1 New name", expected: { command: "rename", args: "thread-1 New name" } },
    { input: "/doctor", expected: { command: "doctor", args: "" } },
    { input: "/fast now", expected: { command: "fast", args: "now" } },
    { input: "/plan", expected: { command: "plan", args: "" } },
    { input: "/plan OK、実装してください", expected: { command: "plan", args: "OK、実装してください" } },
    { input: "/model gpt-5.5", expected: { command: "model", args: "gpt-5.5" } },
    { input: "/permissions :workspace", expected: { command: "permissions", args: ":workspace" } },
    { input: "/reasoning high", expected: { command: "reasoning", args: "high" } },
    { input: "/new", expected: null },
    { input: "/unknown", expected: null },
  ])("parses slash command input $input", ({ input, expected }) => {
    expect(parseSlashCommand(input)).toEqual(expected);
  });

  it("ranks wikilinks with Obsidian fuzzy search and uses Obsidian linktext", () => {
    const suggestions = wikiLinkSuggestions("alp", notes);
    expect(suggestions[0]).toMatchObject({
      display: "Alpha",
      detail: "projects/Alpha.md",
      replacement: "[[projects/Alpha]]",
    });
    expect(wikiLinkSuggestions("btnt", notes)[0]).toMatchObject({
      display: "Beta Note",
      replacement: "[[Beta Note]]",
    });
  });

  it("uses recent files only for empty wikilink suggestions", () => {
    expect(suggestionReplacements(wikiLinkSuggestions("", notes))).toEqual([
      "[[projects/Alpha]]",
      "[[thoughts/Alpha]]",
      "[[Assets/Diagram.png]]",
    ]);
  });

  it("suggests non-markdown vault files when filtering wikilinks", () => {
    expect(wikiLinkSuggestions("projects", notes)[0]).toMatchObject({
      display: "Projects.base",
      detail: "Bases/Projects.base",
      replacement: "[[Bases/Projects.base]]",
    });
    expect(wikiLinkSuggestions("paper", notes)[0]).toMatchObject({
      display: "Paper.pdf",
      detail: "References/Paper.pdf",
      replacement: "[[References/Paper.pdf]]",
    });
  });

  it("keeps non-markdown wikilink completions compatible with mention parsing", () => {
    const suggestion = expectPresent(wikiLinkSuggestions("diagram", notes)[0]);
    const text = `Please inspect ${suggestion.replacement}`;
    const input = userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => (target === "Assets/Diagram.png" ? { name: "Diagram", path: "Assets/Diagram.png" } : null),
      [],
    );

    expect(suggestion).toMatchObject({
      display: "Diagram.png",
      detail: "Assets/Diagram.png",
      replacement: "[[Assets/Diagram.png]]",
    });
    expect(input).toEqual([
      { type: "text", text },
      { type: "mention", name: "Diagram", path: "Assets/Diagram.png" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Assets/Diagram.png]] -> Assets/Diagram.png",
      },
    ]);
  });

  it("suggests headings inside a completed wikilink without suggesting block references", () => {
    const heading = expectPresent(activeComposerSuggestions("[[Beta Note#impl", notes, [])[0]);

    expect(suggestionReplacements(activeComposerSuggestions("[[Beta Note#", notes, []))).toEqual([
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
    expect(
      activeComposerSuggestions("@act", notes, [], [], [], null, {
        contextReferences: {
          activeNote: { name: "Beta Note", path: "topics/Beta Note.md", linktext: "Beta Note" },
          selection: null,
        },
      })[0]?.replacement,
    ).toBe("[[Beta Note]]");
    expect(
      activeComposerSuggestions("@sel", notes, [], [], [], null, {
        contextReferences: {
          activeNote: null,
          selection: {
            name: "Beta Note",
            path: "topics/Beta Note.md",
            linktext: "Beta Note",
            range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
            text: "selected",
          },
        },
      })[0],
    ).toMatchObject({
      display: "Selection",
      detail: "topics/Beta Note.md L42:C5-L47:C1",
      replacement: "[[Beta Note]] (L42:C5-L47:C1)",
      selectionContext: {
        name: "Beta Note",
        path: "topics/Beta Note.md",
        linktext: "Beta Note",
        range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
        text: "selected",
      },
    });
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

  it("prioritizes the active thread for empty archive and rename completions", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Latest thread" }),
      thread({ id: "019abcde-0000-7000-8000-000000000002", name: "Current panel thread" }),
      thread({ id: "019abcde-0000-7000-8000-000000000003", name: "Older thread" }),
    ];

    expect(
      suggestionReplacements(
        activeComposerSuggestions("/archive ", notes, [], threads, [], null, {
          activeThreadId: "019abcde-0000-7000-8000-000000000002",
        }),
      ),
    ).toEqual(["019abcde-0000-7000-8000-000000000002", "019abcde-0000-7000-8000-000000000001", "019abcde-0000-7000-8000-000000000003"]);
    expect(
      activeComposerSuggestions("/rename ", notes, [], threads, [], null, { activeThreadId: "019abcde-0000-7000-8000-000000000002" })[0]
        ?.replacement,
    ).toBe("019abcde-0000-7000-8000-000000000002");
    expect(suggestionReplacements(activeComposerSuggestions("/archive ", notes, [], threads, [], null, { activeThreadId: null }))).toEqual([
      "019abcde-0000-7000-8000-000000000001",
      "019abcde-0000-7000-8000-000000000002",
      "019abcde-0000-7000-8000-000000000003",
    ]);
    expect(
      activeComposerSuggestions("/archive latest", notes, [], threads, [], null, {
        activeThreadId: "019abcde-0000-7000-8000-000000000002",
      })[0]?.replacement,
    ).toBe("019abcde-0000-7000-8000-000000000001");
  });

  it("omits the active thread from resume and refer completions", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Latest thread" }),
      thread({ id: "019abcde-0000-7000-8000-000000000002", name: "Current panel thread" }),
      thread({ id: "019abcde-0000-7000-8000-000000000003", name: "Older thread" }),
    ];
    const activeThreadId = "019abcde-0000-7000-8000-000000000002";

    expect(suggestionReplacements(activeComposerSuggestions("/resume ", notes, [], threads, [], null, { activeThreadId }))).toEqual([
      "019abcde-0000-7000-8000-000000000001",
      "019abcde-0000-7000-8000-000000000003",
    ]);
    expect(activeComposerSuggestions("/refer current", notes, [], threads, [], null, { activeThreadId })).toEqual([]);
    expect(activeComposerSuggestions("/archive current", notes, [], threads, [], null, { activeThreadId })[0]?.replacement).toBe(
      activeThreadId,
    );
    expect(activeComposerSuggestions("/rename current", notes, [], threads, [], null, { activeThreadId })[0]?.replacement).toBe(
      activeThreadId,
    );
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
    expect(suggestionReplacements(activeComposerSuggestions("/goal ", notes, []))).toEqual(["set", "edit", "pause", "resume", "clear"]);
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
    expect(suggestionReplacements(activeComposerSuggestions("/model ", notes, [], [], models))).toEqual([
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
    expect(suggestionReplacements(activeComposerSuggestions("/reasoning ", notes, [], [], models, "gpt-5.4-mini"))).toEqual([
      "default",
      "minimal",
      "low",
      "medium",
    ]);
    expect(activeComposerSuggestions("/reasoning x", notes, [], [], models, "gpt-5.4-mini")).toEqual([]);
    expect(activeComposerSuggestions("/reasoning high", notes, [], [], models, "gpt-5.5")).toEqual([]);
    expect(activeComposerSuggestions("/reasoning high ", notes, [], [], models, "gpt-5.5")).toEqual([]);
  });

  it("suggests existing allowed permission profiles for /permissions", () => {
    const permissionProfiles = [
      { id: ":read-only", description: "Read only", allowed: true },
      { id: ":workspace", description: "Workspace write", allowed: true },
      { id: "DevProfile", description: "Developer profile", allowed: true },
      { id: "reset", description: "Reset-like profile", allowed: true },
      { id: "blocked", description: null, allowed: false },
    ];

    expect(
      suggestionReplacements(
        activeComposerSuggestions("/permissions ", notes, [], [], [], null, {
          permissionProfiles,
        }),
      ),
    ).toEqual(["default", ":read-only", ":workspace", "DevProfile", "reset"]);
    expect(
      activeComposerSuggestions("/permissions :r", notes, [], [], [], null, {
        permissionProfiles,
      })[0],
    ).toMatchObject({
      display: ":read-only",
      detail: "Read only",
      replacement: ":read-only",
      appendSpaceOnInsert: true,
    });
    expect(
      activeComposerSuggestions("/permissions work", notes, [], [], [], null, {
        permissionProfiles,
      })[0],
    ).toMatchObject({
      replacement: ":workspace",
    });
    expect(activeComposerSuggestions("/permissions blocked", notes, [], [], [], null, { permissionProfiles })).toEqual([]);
    expect(activeComposerSuggestions("/permissions devprofile", notes, [], [], [], null, { permissionProfiles })[0]).toMatchObject({
      replacement: "DevProfile",
    });
    expect(activeComposerSuggestions("/permissions res", notes, [], [], [], null, { permissionProfiles })[0]).toMatchObject({
      replacement: "reset",
    });
    expect(activeComposerSuggestions("/permissions DevProfile", notes, [], [], [], null, { permissionProfiles })).toEqual([]);
    expect(activeComposerSuggestions("/permissions reset", notes, [], [], [], null, { permissionProfiles })).toEqual([]);
    expect(activeComposerSuggestions("/permissions :read-only", notes, [], [], [], null, { permissionProfiles })).toEqual([]);
    expect(activeComposerSuggestions("/permissions :read-only ", notes, [], [], [], null, { permissionProfiles })).toEqual([]);
  });

  it("does not suggest fixed reasoning effort fallbacks without model support metadata", () => {
    expect(activeComposerSuggestions("/reasoning h", notes, [], [], [], null)).toEqual([]);
    expect(activeComposerSuggestions("/reasoning ", notes, [], [], [model("gpt-5.5", [])], "gpt-5.5")).toEqual([
      expect.objectContaining({ replacement: "default" }),
    ]);
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

function suggestionReplacements(suggestions: readonly { replacement: string }[]): string[] {
  return suggestions.map((suggestion) => suggestion.replacement);
}
