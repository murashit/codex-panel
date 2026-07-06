import { shortThreadId } from "./id";
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
const EMPTY_THREAD_SEARCH_SCORE = 5;

export function threadSearchMatches(threads: readonly Thread[], queryText: string): ThreadSearchMatch[] {
  const query = normalizedThreadSearchQuery(queryText);
  return threads
    .map((thread, index) => {
      const title = threadDisplayTitle(thread);
      const score = threadSearchScore(thread, title, query);
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

function threadSearchScore(thread: Thread, title: string, query: string): number {
  if (!query) return EMPTY_THREAD_SEARCH_SCORE;

  const id = thread.id.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const shortId = shortThreadId(thread.id).toLowerCase();
  if (id === query || shortId === query) return 0;
  if (normalizedTitle.startsWith(query)) return 1;
  if (id.startsWith(query) || shortId.startsWith(query)) return 2;
  if (normalizedTitle.includes(query)) return 3;
  if (id.includes(query)) return 4;
  return NO_THREAD_SEARCH_MATCH;
}
