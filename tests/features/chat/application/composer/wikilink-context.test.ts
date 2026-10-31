import { describe, expect, it } from "vitest";
import type { CodexInput } from "../../../../../src/domain/input/input";
import type { SkillMetadata } from "../../../../../src/domain/runtime/catalog";
import type { ComposerContextReferences } from "../../../../../src/features/chat/application/composer/context-references";
import {
  preparedUserInputWithWikiLinkReferencesSkillsAndContext,
  type WikiLinkFileReferenceResolver,
} from "../../../../../src/features/chat/application/composer/wikilink-context";

const obsidianContext = (...sections: string[]) => ({
  type: "additionalContext" as const,
  key: "codex_panel_obsidian_context",
  kind: "untrusted" as const,
  value: ["Obsidian references for the current user input:", ...sections].join("\n"),
});

const wikilinkContext = (...mappings: string[]) => obsidianContext(...mappings);

function emptyComposerContextReferences(): ComposerContextReferences {
  return { activeNote: null, selection: null, activeNoteSnapshots: [], selectionSnapshots: [] };
}

function userInputWithWikiLinkReferencesAndSkills(
  text: string,
  resolveFileReference: WikiLinkFileReferenceResolver,
  skills: readonly SkillMetadata[],
): CodexInput {
  return preparedUserInputWithWikiLinkReferencesSkillsAndContext(text, resolveFileReference, skills, emptyComposerContextReferences(), {
    referenceActiveNoteOnSend: false,
  }).input;
}

describe("wikilink context", () => {
  it("parses aliases, subpaths, and duplicate links", () => {
    const text =
      "See [[Alpha|label]], [[Beta#Heading]], [[Gamma^block]], [[Delta#Heading^block]], [[Epsilon^block#Heading]], and [[Alpha]].";
    const input = userInputWithWikiLinkReferencesAndSkills(text, (target) => ({ name: target, path: `${target}.md` }), []);

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Alpha", path: "Alpha.md" },
      { type: "fileReference", name: "Beta", path: "Beta.md" },
      { type: "fileReference", name: "Gamma", path: "Gamma.md" },
      { type: "fileReference", name: "Delta", path: "Delta.md" },
      { type: "fileReference", name: "Epsilon", path: "Epsilon.md" },
      wikilinkContext(
        "- [[Alpha|label]] -> Alpha.md",
        "- [[Beta#Heading]] -> Beta.md",
        "- [[Gamma^block]] -> Gamma.md",
        "- [[Delta#Heading^block]] -> Delta.md",
        "- [[Epsilon^block#Heading]] -> Epsilon.md",
      ),
    ]);
  });

  it("adds only resolved file references without changing the visible prompt body", () => {
    const text = "Please compare [[Alpha#Heading|A]] and [[Missing]].";
    const input = userInputWithWikiLinkReferencesAndSkills(
      text,
      (target) => (target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Alpha", path: "thoughts/Alpha.md" },
      wikilinkContext("- [[Alpha#Heading|A]] -> thoughts/Alpha.md"),
    ]);
    expect(input).toHaveLength(3);
  });

  it("resolves aliases and subpaths from non-markdown wikilinks by target", () => {
    const text = "Open [[Bases/Projects.base|Projects]], [[References/Paper.pdf]], and [[Assets/Diagram.png#crop|Diagram]].";
    const input = userInputWithWikiLinkReferencesAndSkills(
      text,
      (target) => {
        const fileReferences = new Map([
          ["Bases/Projects.base", { name: "Projects", path: "Bases/Projects.base" }],
          ["References/Paper.pdf", { name: "Paper", path: "References/Paper.pdf" }],
          ["Assets/Diagram.png", { name: "Diagram", path: "Assets/Diagram.png" }],
        ]);
        return fileReferences.get(target) ?? null;
      },
      [],
    );
    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Projects", path: "Bases/Projects.base" },
      { type: "fileReference", name: "Paper", path: "References/Paper.pdf" },
      { type: "fileReference", name: "Diagram", path: "Assets/Diagram.png" },
      wikilinkContext(
        "- [[Bases/Projects.base|Projects]] -> Bases/Projects.base",
        "- [[References/Paper.pdf]] -> References/Paper.pdf",
        "- [[Assets/Diagram.png#crop|Diagram]] -> Assets/Diagram.png",
      ),
    ]);
  });

  it("deduplicates file references by resolved path", () => {
    const text = "Read [[Alpha]], [[Alpha#Heading]], and [[Alias|A]].";
    const input = userInputWithWikiLinkReferencesAndSkills(
      text,
      (target) => (target === "Alpha" || target === "Alias" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Alpha", path: "thoughts/Alpha.md" },
      wikilinkContext("- [[Alpha]] -> thoughts/Alpha.md"),
    ]);
  });

  it("adds resolved skill input without changing the visible prompt body", () => {
    const text = "Please use $obsidian-codex-panel-maintain with [[Alpha]].";
    const input = userInputWithWikiLinkReferencesAndSkills(
      text,
      (target) => (target === "Alpha" ? { name: "Alpha", path: "thoughts/Alpha.md" } : null),
      [
        {
          name: "obsidian-codex-panel-maintain",
          description: "Maintain Codex Panel",
          path: "/vault/___/skills/obsidian-codex-panel-maintain/SKILL.md",
          scope: "repo",
          pluginId: null,
          enabled: true,
        },
      ],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Alpha", path: "thoughts/Alpha.md" },
      {
        type: "skill",
        name: "obsidian-codex-panel-maintain",
        path: "/vault/___/skills/obsidian-codex-panel-maintain/SKILL.md",
      },
      wikilinkContext("- [[Alpha]] -> thoughts/Alpha.md"),
    ]);
  });

  it("ignores unresolved skills and deduplicates resolved skills by path", () => {
    const text = "Use $First, $missing, $first, and $Alias.";
    const input = userInputWithWikiLinkReferencesAndSkills(text, () => null, [
      {
        name: "First",
        description: "First skill",
        path: "/skills/first/SKILL.md",
        scope: "user",
        pluginId: null,
        enabled: true,
      },
      {
        name: "first",
        description: "Duplicate name should not win",
        path: "/skills/duplicate/SKILL.md",
        scope: "user",
        pluginId: null,
        enabled: true,
      },
      {
        name: "Alias",
        description: "Same path alias",
        path: "/skills/first/SKILL.md",
        scope: "user",
        pluginId: null,
        enabled: true,
      },
      {
        name: "missing",
        description: "Disabled skill",
        path: "/skills/missing/SKILL.md",
        scope: "user",
        pluginId: null,
        enabled: false,
      },
    ]);

    expect(input).toEqual([
      { type: "text", text },
      { type: "skill", name: "First", path: "/skills/first/SKILL.md" },
    ]);
  });

  it("does not resolve wikilinks or skills written as Markdown code", () => {
    const text = [
      "Use [[Visible]] and $Visible.",
      "",
      "`[[Inline]] $Inline`",
      "",
      "```text",
      "[[Fenced]] $Fenced",
      "```",
      "",
      "    [[Indented]] $Indented",
    ].join("\n");
    const skills = ["Visible", "Inline", "Fenced", "Indented"].map(
      (name): SkillMetadata => ({
        name,
        description: name,
        path: `/skills/${name.toLowerCase()}/SKILL.md`,
        scope: "repo",
        pluginId: null,
        enabled: true,
      }),
    );

    const input = userInputWithWikiLinkReferencesAndSkills(text, (target) => ({ name: target, path: `${target}.md` }), skills);

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Visible", path: "Visible.md" },
      { type: "skill", name: "Visible", path: "/skills/visible/SKILL.md" },
      wikilinkContext("- [[Visible]] -> Visible.md"),
    ]);
  });

  it("keeps raw Obsidian wikilinks intact when CommonMark would split their contents", () => {
    const text = "Read [[A *strange* note]].";
    const input = userInputWithWikiLinkReferencesAndSkills(
      text,
      (target) => (target === "A *strange* note" ? { name: target, path: "notes/Strange.md" } : null),
      [],
    );

    expect(input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "A *strange* note", path: "notes/Strange.md" },
      wikilinkContext("- [[A *strange* note]] -> notes/Strange.md"),
    ]);
  });

  it("leaves bare context references as raw text", () => {
    const text = "Organize this @active and @selection";
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => (target === "notes/Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null),
      [],
      {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "notes/Alpha" },
        selection: {
          name: "Alpha",
          path: "notes/Alpha.md",
          linktext: "notes/Alpha",
          range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
          text: "selected text",
        },
      },
      { referenceActiveNoteOnSend: false },
    );

    expect(prepared.text).toBe(text);
    expect(prepared.input).toEqual([{ type: "text", text }]);
  });

  it("resolves completed active snapshots without depending on the current link context", () => {
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      "Organize this [[Alpha]]",
      () => null,
      [],
      {
        activeNote: null,
        selection: null,
        activeNoteSnapshots: [{ name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" }],
      },
      { referenceActiveNoteOnSend: false },
    );

    expect(prepared.input).toContainEqual({ type: "fileReference", name: "Alpha", path: "notes/Alpha.md" });
  });

  it("references the active file on send when enabled without changing visible text", () => {
    const text = "Rewrite the introduction.";
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      () => null,
      [],
      {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
        selection: null,
      },
      { referenceActiveNoteOnSend: true },
    );

    expect(prepared.text).toBe(text);
    expect(prepared.input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "<active>", path: "notes/Alpha.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian references for the current user input:\n- <active> -> notes/Alpha.md",
      },
    ]);
  });

  it("keeps wikilinks and active file in one Obsidian context when both are present", () => {
    const text = "Compare [[Beta]] with the active file.";
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => (target === "Beta" ? { name: "Beta", path: "notes/Beta.md" } : null),
      [],
      {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
        selection: null,
      },
      { referenceActiveNoteOnSend: true },
    );

    expect(prepared.text).toBe(text);
    expect(prepared.input).toEqual([
      { type: "text", text },
      { type: "fileReference", name: "Beta", path: "notes/Beta.md" },
      { type: "fileReference", name: "<active>", path: "notes/Alpha.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value: "Obsidian references for the current user input:\n- [[Beta]] -> notes/Beta.md\n- <active> -> notes/Alpha.md",
      },
    ]);
  });

  it("keeps wikilinks, selections, and active file in one Obsidian context", () => {
    const text = 'Compare [[Beta]] with [[Gamma]] "selected gamma".';
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => {
        if (target === "Beta") return { name: "Beta", path: "notes/Beta.md" };
        if (target === "Gamma") return { name: "Gamma", path: "notes/Gamma.md" };
        return null;
      },
      [],
      {
        activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
        selection: null,
        selectionSnapshots: [
          {
            marker: '[[Gamma]] "selected gamma"',
            reference: {
              name: "Gamma",
              path: "notes/Gamma.md",
              linktext: "Gamma",
              range: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 5 } },
              text: "selected gamma",
            },
          },
        ],
      },
      { referenceActiveNoteOnSend: true },
    );

    expect(prepared.input).toEqual([
      { type: "text", text: 'Compare [[Beta]] with [[Gamma]] `"selected gamma"`.' },
      { type: "fileReference", name: "Beta", path: "notes/Beta.md" },
      { type: "fileReference", name: "Gamma", path: "notes/Gamma.md" },
      { type: "fileReference", name: "<active>", path: "notes/Alpha.md" },
      {
        type: "additionalContext",
        key: "codex_panel_obsidian_context",
        kind: "untrusted",
        value:
          'Obsidian references for the current user input:\n- [[Beta]] -> notes/Beta.md\n- [[Gamma]] "selected gamma" -> notes/Gamma.md (source range 2:1-2:6) (inline excerpt below)\n- <active> -> notes/Alpha.md\n\nInline excerpts:\n[[Gamma]] "selected gamma":\nselected gamma',
      },
    ]);
  });

  it("attaches completed selection snapshots without depending on the current editor selection", () => {
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      'Organize this [[notes/Alpha]] "completed selection"',
      (target) => (target === "notes/Alpha" ? { name: "Alpha", path: "notes/Alpha.md" } : null),
      [],
      {
        activeNote: null,
        selection: {
          name: "Beta",
          path: "notes/Beta.md",
          linktext: "notes/Beta",
          range: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } },
          text: "current selection",
        },
        selectionSnapshots: [
          {
            marker: '[[notes/Alpha]] "completed selection"',
            reference: {
              name: "Alpha",
              path: "notes/Alpha.md",
              linktext: "notes/Alpha",
              range: { from: { line: 41, ch: 4 }, to: { line: 46, ch: 0 } },
              text: "completed selection",
            },
          },
        ],
      },
      { referenceActiveNoteOnSend: false },
    );

    expect(prepared.input).toContainEqual({
      type: "additionalContext",
      key: "codex_panel_obsidian_context",
      kind: "untrusted",
      value:
        'Obsidian references for the current user input:\n- [[notes/Alpha]] "completed selection" -> notes/Alpha.md (source range 42:5-47:1) (inline excerpt below)\n\nInline excerpts:\n[[notes/Alpha]] "completed selection":\ncompleted selection',
    });
  });
});
