import { type Thread, threadRecencyAt } from "./model";
import { threadDisplayTitle } from "./title";

export interface ThreadSearchMatch {
  thread: Thread;
  title: string;
  score: number;
  recencyAt: number;
  index: number;
}

export type ThreadSearchResolution =
  | { kind: "match"; match: ThreadSearchMatch }
  | { kind: "multiple"; matches: ThreadSearchMatch[] }
  | { kind: "none"; query: string };

const NO_THREAD_SEARCH_MATCH = -1;
const TITLE_EXACT_SCORE = 0;
const TITLE_PREFIX_SCORE = 1;
const TITLE_SUBSTRING_SCORE = 2;
const TITLE_FUZZY_SCORE = 3;
const EMPTY_THREAD_SEARCH_SCORE = 4;

export function threadSearchMatches(threads: readonly Thread[], queryText: string): ThreadSearchMatch[] {
  const query = normalizedThreadSearchQuery(queryText);
  return threads
    .map((thread, index) => {
      const title = threadDisplayTitle(thread);
      const score = threadSearchScore(title, query);
      return { thread, title, score, recencyAt: threadRecencyAt(thread), index };
    })
    .filter((match) => match.score !== NO_THREAD_SEARCH_MATCH)
    .sort(compareThreadSearchMatches);
}

export function resolveThreadSearchQuery(threads: readonly Thread[], queryText: string): ThreadSearchResolution {
  const query = normalizedThreadSearchQuery(queryText);
  const matches = threadSearchMatches(threads, query);
  const first = matches[0];
  if (!first) return { kind: "none", query };
  if (!query) return { kind: "match", match: first };

  const bestMatches = matches.filter((match) => match.score === first.score);
  return bestMatches.length === 1 ? { kind: "match", match: first } : { kind: "multiple", matches: bestMatches };
}

export function compareThreadSearchMatches(left: ThreadSearchMatch, right: ThreadSearchMatch): number {
  return left.score - right.score || right.recencyAt - left.recencyAt || left.index - right.index;
}

function normalizedThreadSearchQuery(queryText: string): string {
  return queryText.trim().toLowerCase();
}

function threadSearchScore(title: string, query: string): number {
  if (!query) return EMPTY_THREAD_SEARCH_SCORE;

  const normalizedTitle = title.toLowerCase();
  if (normalizedTitle === query) return TITLE_EXACT_SCORE;
  if (normalizedTitle.startsWith(query)) return TITLE_PREFIX_SCORE;
  if (normalizedTitle.includes(query)) return TITLE_SUBSTRING_SCORE;
  return fuzzySubsequenceMatches(normalizedTitle, query) ? TITLE_FUZZY_SCORE : NO_THREAD_SEARCH_MATCH;
}

function fuzzySubsequenceMatches(title: string, query: string): boolean {
  let queryIndex = 0;
  for (const character of title) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}
