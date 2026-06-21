import type { AppServerObservedQueryResult } from "./cache";

export function observedQueryData<T>(result: AppServerObservedQueryResult<T>): T | null {
  return result.data;
}

export function observedQueryInitialLoading<T>(result: AppServerObservedQueryResult<T>, currentData: T | null | undefined): boolean {
  return currentData == null && result.isFetching;
}

export function observedQueryInitialError<T>(result: AppServerObservedQueryResult<T>, currentData: T | null | undefined): Error | null {
  return currentData == null ? result.error : null;
}
