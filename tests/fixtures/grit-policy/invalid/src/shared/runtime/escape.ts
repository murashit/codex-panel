import type { Feature } from "../../features/escape";

export function first<T>(iterator: Iterator<T>): T {
  return iterator.next().value as T;
}

export type EscapedFeature = Feature;
