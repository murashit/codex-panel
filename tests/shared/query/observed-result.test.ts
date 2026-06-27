import { describe, expect, it } from "vitest";

import type { ObservedResult } from "../../../src/shared/query/observed-result";
import { observedInitialError, observedInitialLoading, observedValue } from "../../../src/shared/query/observed-result";

describe("observed query result helpers", () => {
  it("treats successful empty arrays as current values", () => {
    const loading = observedResult<readonly string[]>({ value: null, isFetching: true });
    const error = new Error("boom");
    const failed = observedResult<readonly string[]>({ value: null, error });

    expect(observedInitialLoading(loading, [])).toBe(false);
    expect(observedInitialError(failed, [])).toBeNull();
  });

  it("returns initial loading and error only before current values exist", () => {
    const error = new Error("boom");

    expect(observedInitialLoading(observedResult({ value: null, isFetching: true }), null)).toBe(true);
    expect(observedInitialError(observedResult({ value: null, error }), null)).toBe(error);
  });

  it("projects nullable observed values without reinterpreting empty values", () => {
    expect(observedValue(observedResult({ value: [] as readonly string[] }))).toEqual([]);
    expect(observedValue(observedResult({ value: null }))).toBeNull();
  });
});

function observedResult<T>(overrides: Partial<ObservedResult<T>> & Pick<ObservedResult<T>, "value">): ObservedResult<T> {
  return {
    error: null,
    isFetching: false,
    ...overrides,
  };
}
