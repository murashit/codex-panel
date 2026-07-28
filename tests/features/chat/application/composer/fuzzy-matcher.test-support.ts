import { prepareFuzzySearch } from "obsidian";

import type { FuzzyMatcher } from "../../../../../src/features/chat/application/composer/fuzzy-search";

export const testFuzzyMatcher: FuzzyMatcher = {
  prepare: (query) => {
    const search = prepareFuzzySearch(query);
    return {
      match: (text) => {
        const result = search(text);
        return result ? { score: result.score } : null;
      },
    };
  },
};
