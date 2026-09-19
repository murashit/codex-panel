import type { FuzzyMatcher } from "../../../../../src/features/chat/application/composer/fuzzy-search";

// Interaction tests need predictable matches, not a reimplementation of Obsidian ranking.
// Tests of ranking supply explicit scores through FuzzyMatcher instead.
export const substringMatcher: FuzzyMatcher = {
  prepare: (query) => ({
    match: (text) => (text.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null),
  }),
};
