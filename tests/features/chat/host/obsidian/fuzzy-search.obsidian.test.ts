import * as obsidian from "obsidian";
import { afterEach, expect, it, vi } from "vitest";

import type { NoteCandidate } from "../../../../../src/features/chat/application/composer/note-context";
import { activeComposerSuggestions } from "../../../../../src/features/chat/application/composer/suggestions";
import { obsidianFuzzyMatcher } from "../../../../../src/features/chat/host/obsidian/fuzzy-search.obsidian";

afterEach(() => vi.restoreAllMocks());

it("ranks the best host-provided name or path score, retaining zero and negative matches", () => {
  const scores = new Map([
    ["Name winner", 0],
    ["notes/Name winner.md", -20],
    ["Path winner", -30],
    ["notes/Path winner.md", -5],
    ["Negative match", -10],
  ]);
  const search = vi.fn((text: string) => {
    const score = scores.get(text);
    return score === undefined ? null : { score, matches: [] };
  });
  const prepare = vi.spyOn(obsidian, "prepareFuzzySearch").mockReturnValue(search);
  const notes = ["Unmatched", "Negative match", "Path winner", "Name winner"].map(
    (name, index): NoteCandidate => ({
      basename: name,
      displayName: name,
      path: `notes/${name}.md`,
      linktext: `notes/${name}`,
      mtime: 100 - index,
      headings: [],
      recentIndex: null,
    }),
  );

  const suggestions = activeComposerSuggestions("[[host query", () => notes, [], [], [], null, {
    fuzzyMatcher: obsidianFuzzyMatcher,
  });

  expect(prepare).toHaveBeenCalledExactlyOnceWith("host query");
  expect(suggestions.map((suggestion) => suggestion.replacement)).toEqual([
    "[[notes/Name winner]]",
    "[[notes/Path winner]]",
    "[[notes/Negative match]]",
  ]);
});
