import { describe, expect, it } from "vitest";

import type { ObservedDataResult } from "../../src/domain/observed-data";
import { observedData, observedInitialError, observedInitialLoading } from "../../src/domain/observed-data";

describe("observed query result helpers", () => {
  it("treats successful empty arrays as current data", () => {
    const loading = observedResult<readonly string[]>({ data: null, isFetching: true });
    const error = new Error("boom");
    const failed = observedResult<readonly string[]>({ data: null, error });

    expect(observedInitialLoading(loading, [])).toBe(false);
    expect(observedInitialError(failed, [])).toBeNull();
  });

  it("returns initial loading and error only before current data exists", () => {
    const error = new Error("boom");

    expect(observedInitialLoading(observedResult({ data: null, isFetching: true }), null)).toBe(true);
    expect(observedInitialError(observedResult({ data: null, error }), null)).toBe(error);
  });

  it("projects nullable observed data without reinterpreting empty values", () => {
    expect(observedData(observedResult({ data: [] as readonly string[] }))).toEqual([]);
    expect(observedData(observedResult({ data: null }))).toBeNull();
  });
});

function observedResult<T>(overrides: Partial<ObservedDataResult<T>> & Pick<ObservedDataResult<T>, "data">): ObservedDataResult<T> {
  return {
    error: null,
    isFetching: false,
    ...overrides,
  };
}
