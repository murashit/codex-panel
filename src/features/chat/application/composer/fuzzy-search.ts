export interface FuzzyMatch {
  score: number;
}

interface FuzzySearch {
  match(text: string): FuzzyMatch | null;
}

export interface FuzzyMatcher {
  prepare(query: string): FuzzySearch;
}
