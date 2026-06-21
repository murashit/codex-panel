import { describe, expect, it } from "vitest";

import type { AppServerObservedQueryResult } from "../../src/app-server/query/cache";
import { observedQueryData, observedQueryInitialError, observedQueryInitialLoading } from "../../src/app-server/query/observed-result";

describe("observed query result helpers", () => {
  it("treats successful empty arrays as current data", () => {
    const loading = observedResult<readonly string[]>({ data: null, isFetching: true });
    const error = new Error("boom");
    const failed = observedResult<readonly string[]>({ data: null, error });

    expect(observedQueryInitialLoading(loading, [])).toBe(false);
    expect(observedQueryInitialError(failed, [])).toBeNull();
  });

  it("returns initial loading and error only before current data exists", () => {
    const error = new Error("boom");

    expect(observedQueryInitialLoading(observedResult({ data: null, isFetching: true }), null)).toBe(true);
    expect(observedQueryInitialError(observedResult({ data: null, error }), null)).toBe(error);
  });

  it("projects nullable observed data without reinterpreting empty values", () => {
    expect(observedQueryData(observedResult({ data: [] as readonly string[] }))).toEqual([]);
    expect(observedQueryData(observedResult({ data: null }))).toBeNull();
  });
});

function observedResult<T>(
  overrides: Partial<AppServerObservedQueryResult<T>> & Pick<AppServerObservedQueryResult<T>, "data">,
): AppServerObservedQueryResult<T> {
  return {
    error: null,
    isFetching: false,
    ...overrides,
  } as AppServerObservedQueryResult<T>;
}
