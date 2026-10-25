import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import type { SelectionContextReference } from "../../../../../src/features/chat/application/composer/context-references";
import {
  captureSelectionContext,
  selectionContextMatches,
  selectionContextPreview,
} from "../../../../../src/features/chat/application/composer/selection-context";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "../../../../../src/features/chat/application/composer/wikilink-context";

const note = { name: "Note", path: "Note.md", linktext: "Note" };
function reading(text: string, selectionId = "capture"): SelectionContextReference {
  return { ...note, text, selectionId, range: null };
}
function editor(text: string, line: number): SelectionContextReference {
  return { ...note, text, range: { from: { line, ch: 0 }, to: { line, ch: text.length } } };
}

describe("selection quotation labels", () => {
  it("lengthens only the newly confirmed preview without looking for the differing character", () => {
    const prefix = "x".repeat(60);
    const first = captureSelectionContext(reading(`${prefix}A`), []);
    const second = captureSelectionContext(reading(`${prefix}B`, "second"), [first]);
    expect(first.marker).toBe(`[[Note]] "${"x".repeat(48)}…"`);
    expect(second.marker).toBe(`[[Note]] "${"x".repeat(49)}…"`);
    expect(first.reference.text).toBe(`${prefix}A`);
    expect(second.reference.text).toBe(`${prefix}B`);
    expect(captureSelectionContext(reading(`${prefix}A`, "fresh"), [first, second])).toBe(first);
  });

  it("keeps exact source ranges while adding coordinates only to a later same-text source citation", () => {
    const first = captureSelectionContext(editor("same text", 1), []);
    const second = captureSelectionContext(editor("same text", 19), [first]);
    expect(first.marker).toBe('[[Note]] "same text"');
    expect(first.reference.range).toEqual({ from: { line: 1, ch: 0 }, to: { line: 1, ch: 9 } });
    expect(second.marker).toBe('[[Note]] (20:1-20:10) "same text"');
    expect(captureSelectionContext(editor("same text", 19), [first, second])).toBe(second);
    expect(captureSelectionContext(reading("same text"), [first, second])).toBe(first);
    const fromReading = captureSelectionContext(reading("same text"), []);
    expect(captureSelectionContext(editor("same text", 19), [fromReading]).marker).toBe('[[Note]] (20:1-20:10) "same text"');
  });

  it("prettifies whitespace without escaping content or merging different original texts", () => {
    const newline = captureSelectionContext(reading("a\nb"), []);
    const space = captureSelectionContext(reading("a b"), [newline]);
    const literal = captureSelectionContext(reading("a\\nb"), [newline, space]);
    expect(newline.marker).toBe('[[Note]] "a b"');
    expect(space.marker).toBe('[[Note]] "a …"');
    expect(literal.marker).toBe('[[Note]] "a\\nb"');
    expect(newline.reference.text).toBe("a\nb");
    expect(space.reference.text).toBe("a b");
    expect(selectionContextPreview(reading('  "tab"\t '))).toBe('[[Note]] "  "tab"  "');
    expect(selectionContextPreview(reading("a\r\nb\rc\nd\te"))).toBe('[[Note]] "a b c d e"');
    expect(selectionContextPreview(reading("`code` & <tag> ~~deleted~~ ==highlight== |"))).toBe(
      '[[Note]] "`code` & <tag> ~~deleted~~ ==highlight== |"',
    );
  });

  it.each([false, true])("never allocates prefix-related quotation labels (reverse=%s)", (reverse) => {
    const firstText = reverse ? 'foo"bar' : "foo";
    const secondText = reverse ? "foo" : 'foo"bar';
    const first = captureSelectionContext(reading(firstText), []);
    const second = captureSelectionContext(reading(secondText), [first]);
    expect(second.marker.startsWith(first.marker)).toBe(false);
    expect(first.marker.startsWith(second.marker)).toBe(false);
    const damaged = second.marker.slice(0, -1);
    expect(selectionContextMatches(`${first.marker}\n${damaged}`, [first, second]).matches.map((match) => match.snapshot)).toEqual([first]);
    expect(selectionContextMatches(damaged, [first, second]).matches).toEqual([]);
  });

  it("keeps a one-character excerpt readable when another label starts with its entire short form", () => {
    const first = captureSelectionContext(reading('x"tail'), []);
    const second = captureSelectionContext(reading("x"), [first]);
    expect(second.marker).toBe('[[Note.md]] "x"');
    expect(second.reference.text).toBe("x");
  });

  it("uses the actual note path when different notes share the same short linktext and excerpt", () => {
    const first = captureSelectionContext({ ...reading("x"), path: "folder-a/Note.md" }, []);
    const reference = { ...reading("x"), path: "folder-b/Note.md" };
    const second = captureSelectionContext(reference, [first]);
    expect(first.marker).toBe('[[Note]] "x"');
    expect(second.marker).toBe('[[folder-b/Note]] "x"');
    expect(second.reference).toBe(reference);
  });

  it("does not split surrogate pairs or confuse a literal terminal ellipsis with truncation", () => {
    expect(selectionContextPreview(reading("😀".repeat(49)))).toBe(`[[Note]] "${"😀".repeat(48)}…"`);
    const first = captureSelectionContext(reading(`${"x".repeat(48)}tail`), []);
    const literal = captureSelectionContext(reading(`${"x".repeat(48)}…`), [first]);
    expect(literal.marker).toBe(`[[Note]] "${"x".repeat(47)}…"`);
    expect(literal.reference.text).toBe(`${"x".repeat(48)}…`);
  });

  it("does not parse preview text as new references, skills, or code syntax", () => {
    const snapshot = captureSelectionContext(reading("[[Hidden]] $hidden ` ``` <tag>"), []);
    const text = `Unclosed \` before ${snapshot.marker}\nUse [[Visible]] $visible`;
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => ({ name: target, path: `${target}.md` }),
      [
        { name: "hidden", path: "/hidden", description: "hidden", enabled: true, scope: "user", pluginId: null },
        { name: "visible", path: "/visible", description: "visible", enabled: true, scope: "user", pluginId: null },
      ],
      { activeNote: null, selection: null, selectionSnapshots: [snapshot] },
      { referenceActiveNoteOnSend: false },
    );
    expect(prepared.input.filter((item) => item.type === "fileReference")).toEqual([
      { type: "fileReference", name: "Visible", path: "Visible.md" },
      { type: "fileReference", name: "Note", path: "Note.md" },
    ]);
    expect(prepared.input.filter((item) => item.type === "skill")).toEqual([{ type: "skill", name: "visible", path: "/visible" }]);
    expect(prepared.text).toBe('Unclosed \\` before [[Note]] ```` "[[Hidden]] $hidden ` ``` <tag>" ````\nUse [[Visible]] $visible');
    const code: string[] = [];
    const html: string[] = [];
    visit(fromMarkdown(prepared.text), (node) => {
      if (node.type === "inlineCode") code.push(node.value);
      if (node.type === "html") html.push(node.value);
    });
    expect(code).toEqual(['"[[Hidden]] $hidden ` ``` <tag>"']);
    expect(html).toEqual([]);
    expect(prepared.input.find((item) => item.type === "additionalContext")).toMatchObject({
      kind: "untrusted",
      value: expect.stringContaining("[[Hidden]] $hidden ` ``` <tag>"),
    });
  });

  it.each([
    { input: "Use `valid` and ", expected: "Use `valid` and " },
    { input: "Use \\`literal and ", expected: "Use \\`literal and " },
    { input: "Use \\\\`literal and ", expected: "Use \\\\\\`literal and " },
  ])("preserves existing code and literal backticks around quotations ($input)", ({ input, expected }) => {
    const snapshot = captureSelectionContext(reading("selected"), []);
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      input + snapshot.marker,
      () => null,
      [],
      { activeNote: null, selection: null, selectionSnapshots: [snapshot] },
      { referenceActiveNoteOnSend: false },
    );
    expect(prepared.text).toBe(`${expected}[[Note]] \`"selected"\``);
  });

  it("does not repair ordinary user Markdown when no quotation is attached", () => {
    const text = "Unclosed ` before <tag> $value";
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      () => null,
      [],
      { activeNote: null, selection: null },
      { referenceActiveNoteOnSend: false },
    );
    expect(prepared.text).toBe(text);
  });

  it.each(
    [
      { mode: "Reading", reference: reading("selected") },
      { mode: "editor", reference: editor("selected", 0) },
    ].flatMap(({ mode, reference }) => ["    ", "`", "```text\n"].map((prefix) => ({ mode, reference, prefix }))),
  )("keeps $mode quotations inside surrounding Markdown code opaque ($prefix)", ({ reference, prefix }) => {
    const snapshot = captureSelectionContext(reference, []);
    const suffix = prefix === "`" ? "`" : prefix.startsWith("```") ? "\n```" : "";
    const text = prefix + snapshot.marker + suffix;
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      () => null,
      [],
      { activeNote: null, selection: null, selectionSnapshots: [snapshot] },
      { referenceActiveNoteOnSend: false },
    );
    expect(prepared.input).toEqual([{ type: "text", text }]);
  });
});
