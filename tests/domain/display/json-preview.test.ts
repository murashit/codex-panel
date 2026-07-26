import { describe, expect, it } from "vitest";

import { jsonPreview } from "../../../src/domain/display/json-preview";

describe("jsonPreview", () => {
  it("falls back to a string when diagnostics contain a circular value", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(jsonPreview(value)).toBe("[object Object]");
  });
});
