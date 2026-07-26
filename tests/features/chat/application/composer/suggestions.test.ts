import { describe, expect, it, vi } from "vitest";
import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import type { ComposerContextReferences } from "../../../../../src/features/chat/application/composer/context-references";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
} from "../../../../../src/features/chat/application/composer/suggestions";
import {
  preparedUserInputWithWikiLinkReferencesSkillsAndContext,
  type WikiLinkFileReferenceResolver,
} from "../../../../../src/features/chat/application/composer/wikilink-context";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function wikiLinkSuggestions(query: string, notes: Parameters<typeof activeComposerSuggestions>[1]) {
  return activeComposerSuggestions(`[[${query}`, notes, []);
}

function emptyComposerContextReferences(): ComposerContextReferences {
  return { activeNote: null, selection: null, activeNoteSnapshots: [], selectionSnapshots: [] };
}

function userInputWithWikiLinkReferencesAndSkills(
  text: string,
  resolveFileReference: WikiLinkFileReferenceResolver,
  skills: readonly SkillMetadata[],
) {
  return preparedUserInputWithWikiLinkReferencesSkillsAndContext(text, resolveFileReference, skills, emptyComposerContextReferences(), {
    referenceActiveNoteOnSend: false,
  }).input;
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

  it("keeps non-markdown wikilink completions compatible with file-reference parsing", () => {
    const suggestion = expectPresent(wikiLinkSuggestions("diagram", notes)[0]);
    const text = `Please inspect ${suggestion.replacement}`;
    const input = userInputWithWikiLinkReferencesAndSkills(
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
      { type: "fileReference", name: "Diagram", path: "Assets/Diagram.png" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian references for the current user input:\n- [[Assets/Diagram.png]] -> Assets/Diagram.png",
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
      activeComposerSuggestions("@active", notes, [], [], [], null, {
        contextReferences: {
          activeNote: { name: "Beta Note", path: "topics/Beta Note.md", linktext: "Beta Note" },
          selection: null,
        },
      })[0],
    ).toMatchObject({
      display: "Active · Beta Note",
      detail: "topics/Beta Note.md",
      replacement: "[[Beta Note]]",
    });
    expect(
      activeComposerSuggestions("@active-note", notes, [], [], [], null, {
        contextReferences: {
          activeNote: { name: "Beta Note", path: "topics/Beta Note.md", linktext: "Beta Note" },
          selection: null,
        },
      }),
    ).toEqual([]);
    expect(
      activeComposerSuggestions("@sel", notes, [], [], [], null, {
        contextReferences: {
          activeNote: null,
          selection: {
            name: "Beta Note",
            path: "topics/Beta Note.md",
            linktext: "Beta Note",
            range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
            text: "  selected\n\ttext  ",
          },
        },
      })[0],
    ).toMatchObject({
      display: "Selection · Beta Note · L42:C5-L47:C1",
      detail: "selected text",
      replacement: "[[Beta Note]] (L42:C5-L47:C1)",
      selectionContext: {
        name: "Beta Note",
        path: "topics/Beta Note.md",
        linktext: "Beta Note",
        range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
        text: "  selected\n\ttext  ",
      },
    });
    expect(activeComposerSuggestions("/pla", notes, [])[0]?.replacement).toBe("/plan");
    expect(activeComposerSuggestions("/rea", notes, [])[0]?.replacement).toBe("/reasoning");
    expect(activeComposerSuggestions("/sta", notes, [])[0]?.replacement).toBe("/status");
    expect(activeComposerSuggestions("/doc", notes, [])[0]?.replacement).toBe("/doctor");
    expect(activeComposerSuggestions("/status", notes, [])).toEqual([]);
    expect(activeComposerSuggestions("/help", notes, [])).toEqual([]);
  });

  it("omits slash suggestions from subagent threads", () => {
    const options = { slashCommandAvailable: () => false };
    expect(activeComposerSuggestions("/", notes, [], [], [], null, options)).toEqual([]);
    expect(activeComposerSuggestions("/permissions ", notes, [], [], [], null, options)).toEqual([]);
    expect(activeComposerSuggestions("/resume ", notes, [], [], [], null, options)).toEqual([]);
    expect(activeComposerSuggestions("/model ", notes, [], [], [], null, options)).toEqual([]);
  });

  it("bounds selection preview text before rendering it in the suggestion list", () => {
    const suggestion = activeComposerSuggestions("@sel", notes, [], [], [], null, {
      contextReferences: {
        activeNote: null,
        selection: {
          name: "Beta Note",
          path: "topics/Beta Note.md",
          linktext: "Beta Note",
          range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 600 } },
          text: "x".repeat(600),
        },
      },
    })[0];

    expect(suggestion?.detail).toBe(`${"x".repeat(499)}…`);
  });

  it("resolves relative daily-note references to configured wikilinks", () => {
    const dailyNoteReferences = [
      {
        keyword: "today",
        display: "Today",
        name: "2026-07-10",
        path: "Journal/2026/07/2026-07-10.md",
        linktext: "Journal/2026/07/2026-07-10",
      },
      {
        keyword: "tomorrow",
        display: "Tomorrow",
        name: "2026-07-11",
        path: "Journal/2026/07/2026-07-11.md",
        linktext: "Journal/2026/07/2026-07-11",
      },
      {
        keyword: "yesterday",
        display: "Yesterday",
        name: "2026-07-09",
        path: "Journal/2026/07/2026-07-09.md",
        linktext: "Journal/2026/07/2026-07-09",
      },
    ] as const;

    expect(
      activeComposerSuggestions("@to", notes, [], [], [], null, {
        dailyNoteReferences,
      }),
    ).toMatchObject([
      {
        display: "Today · 2026-07-10",
        detail: "Journal/2026/07/2026-07-10.md",
        replacement: "[[Journal/2026/07/2026-07-10]]",
      },
      {
        display: "Tomorrow · 2026-07-11",
        detail: "Journal/2026/07/2026-07-11.md",
        replacement: "[[Journal/2026/07/2026-07-11]]",
      },
    ]);
    expect(
      activeComposerSuggestions("Please inspect @yesterday", notes, [], [], [], null, {
        dailyNoteReferences,
      })[0],
    ).toMatchObject({
      display: "Yesterday · 2026-07-09",
      detail: "Journal/2026/07/2026-07-09.md",
      replacement: "[[Journal/2026/07/2026-07-09]]",
    });
  });

  it("suggests Obsidian tags after a hash trigger", () => {
    const options = {
      tagCandidates: ["project/codex", "project/obsidian", "daily-note", "web"],
    };

    expect(activeComposerSuggestions("#pro", notes, [], [], [], null, options)[0]).toMatchObject({
      display: "#project/codex",
      detail: "Obsidian tag",
      replacement: "#project/codex",
      appendSpaceOnInsert: true,
    });
    expect(suggestionReplacements(activeComposerSuggestions("please tag #project/o", notes, [], [], [], null, options))).toEqual([
      "#project/obsidian",
    ]);
    expect(suggestionReplacements(activeComposerSuggestions("#", notes, [], [], [], null, options))).toEqual([
      "#daily-note",
      "#project/codex",
      "#project/obsidian",
      "#web",
    ]);
    expect(activeComposerSuggestions("#project/codex", notes, [], [], [], null, options)).toEqual([]);
    expect(activeComposerSuggestions("https://example.com/#pro", notes, [], [], [], null, options)).toEqual([]);
    expect(activeComposerSuggestions("[Section](#pro", notes, [], [], [], null, options)).toEqual([]);
    expect(
      applyComposerSuggestionInsertion("#pro", 4, expectPresent(activeComposerSuggestions("#pro", notes, [], [], [], null, options)[0])),
    ).toEqual({
      value: "#project/codex ",
      cursor: 15,
    });
  });

  it("loads Obsidian tags lazily only after a hash trigger", () => {
    const tagCandidates = vi.fn(() => ["project/codex"]);

    expect(activeComposerSuggestions("plain text", notes, [], [], [], null, { tagCandidates })).toEqual([]);
    expect(tagCandidates).not.toHaveBeenCalled();

    expect(activeComposerSuggestions("#pro", notes, [], [], [], null, { tagCandidates })[0]).toMatchObject({
      replacement: "#project/codex",
    });
    expect(tagCandidates).toHaveBeenCalledOnce();
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
