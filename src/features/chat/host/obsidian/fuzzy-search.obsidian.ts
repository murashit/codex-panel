import { prepareFuzzySearch } from "obsidian";

import type { FuzzyMatcher } from "../../application/composer/fuzzy-search";

export const obsidianFuzzyMatcher: FuzzyMatcher = {
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
