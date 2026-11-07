import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { contentForPendingMcpElicitation } from "../../../../../src/features/chat/domain/pending-requests/mcp-elicitation";
import type { PendingMcpElicitationField } from "../../../../../src/features/chat/domain/pending-requests/model";

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

describe("MCP elicitation content", () => {
  it.each([
    ["1e3", 1000],
    ["-2e2", -200],
  ])("preserves integer meaning for %s", (value, expected) => {
    expect(content({ type: "integer", value })).toEqual({ valid: true, content: { answer: expected } });
  });

  it.each(["number", "integer"] as const)("honors inclusive %s bounds without changing the value", (type) => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 2 }), fc.boolean(), (start, span, withOppositeBound) => {
        // Quarter units stay exact and exercise fractional bounds; integer controls use whole units.
        const step = type === "number" ? 0.25 : 1;
        const minimum = start * step;
        const maximum = (start + span) * step;
        const field = { type, minimum, maximum };
        for (const value of [minimum, (start + Math.floor(span / 2)) * step, maximum]) {
          expect(content({ ...field, value: String(value) })).toEqual({ valid: true, content: { answer: value } });
        }
        const lowerBound = withOppositeBound ? field : { type, minimum };
        const upperBound = withOppositeBound ? field : { type, maximum };
        expect(content({ ...lowerBound, value: String(minimum - step) })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "minimum", limit: minimum }]]),
        });
        expect(content({ ...upperBound, value: String(maximum + step) })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "maximum", limit: maximum }]]),
        });
      }),
    );
  });

  it.each(["string", "single-select"] as const)("measures %s limits in Unicode code points", (type) => {
    const codePoints = fc.array(fc.constantFrom("a", " ", "あ", "e", "\u0301", "💡"), { maxLength: 20 });
    fc.assert(
      fc.property(codePoints, (suffix) => {
        // Each token is one code point; the prefix distinguishes UTF-16 units and grapheme clusters.
        const value = ["💡", "e", "\u0301", ...suffix].join("");
        const length = 3 + suffix.length;
        const field: FieldInput = type === "string" ? { type, value } : { type, value, options: [{ value, label: "Choice" }] };
        expect(content({ ...field, minLength: length, maxLength: length })).toEqual({ valid: true, content: { answer: value } });
        expect(content({ ...field, minLength: length - 1, maxLength: length + 1 })).toEqual({ valid: true, content: { answer: value } });
        expect(content({ ...field, minLength: length + 1 })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "minLength", limit: length + 1 }]]),
        });
        expect(content({ ...field, maxLength: length - 1 })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "maxLength", limit: length - 1 }]]),
        });
      }),
    );
  });

  it("preserves offered selections within cardinality limits and rejects an unoffered replacement", () => {
    const selections = fc.uniqueArray(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 8 }).chain((labels) => {
      const offered = labels.map((label) => ({ value: `offered:${label}`, label }));
      return fc
        .shuffledSubarray(
          offered.map((option) => option.value),
          { minLength: 1 },
        )
        .map((value) => ({ options: offered, value: Object.freeze(value) }));
    });
    fc.assert(
      fc.property(selections, ({ options, value }) => {
        const field = { type: "multi-select", options, value } as const;
        const count = BigInt(value.length);
        expect(content({ ...field, minItems: count, maxItems: count })).toEqual({ valid: true, content: { answer: value } });
        expect(content({ ...field, minItems: count - 1n, maxItems: count + 1n })).toEqual({ valid: true, content: { answer: value } });
        expect(content({ ...field, minItems: count + 1n })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "minItems", limit: count + 1n }]]),
        });
        expect(content({ ...field, maxItems: count - 1n })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "maxItems", limit: count - 1n }]]),
        });
        expect(content({ ...field, value: ["unoffered", ...value.slice(1)], minItems: count, maxItems: count })).toEqual({
          valid: false,
          issues: new Map([["answer", { kind: "selection" }]]),
        });
      }),
    );
  });

  it.each([
    [{ type: "number", value: "4oops" }, { kind: "number" }],
    [{ type: "number", value: "1e999" }, { kind: "number" }],
    [{ type: "integer", value: "4.5" }, { kind: "integer" }],
    [{ type: "integer", required: true, value: "" }, { kind: "required" }],
    [
      { type: "string", required: true, value: "", minLength: 1 },
      { kind: "minLength", limit: 1 },
    ],
    [{ type: "single-select", value: "unknown", options }, { kind: "selection" }],
    [
      { type: "multi-select", required: true, value: [], options, minItems: 1n },
      { kind: "minItems", limit: 1n },
    ],
  ] satisfies [FieldInput, object][])("rejects invalid values and required controls without an answer: %o", (field, issue) => {
    expect(content(field)).toEqual({ valid: false, issues: new Map([["answer", issue]]) });
  });

  it.each([
    [{ type: "boolean", required: true, value: false }, false],
    [{ type: "string", required: true, value: "" }, ""],
    [{ type: "multi-select", required: true, value: [], options, minItems: 0n }, []],
  ] satisfies [FieldInput, unknown][])("keeps false and supplied empty values: %o", (field, value) => {
    expect(content(field)).toEqual({ valid: true, content: { answer: value } });
  });

  it.each([
    { type: "string", value: "", minLength: 2 },
    { type: "number", value: "" },
    { type: "single-select", value: null, options },
    { type: "multi-select", value: [], options, minItems: 1n },
  ] satisfies FieldInput[])("omits unanswered optional controls: %o", (field) => {
    expect(content(field)).toEqual({ valid: true, content: {} });
  });

  it("distinguishes unanswered single selections from an empty-string option", () => {
    const field = { type: "single-select", options: [{ value: "", label: "Empty" }] } as const;
    expect(content({ ...field, required: true, value: null })).toEqual({
      valid: false,
      issues: new Map([["answer", { kind: "selection" }]]),
    });
    expect(content({ ...field, required: true, value: "" })).toEqual({ valid: true, content: { answer: "" } });
    expect(content({ ...field, value: "" })).toEqual({ valid: true, content: { answer: "" } });
    expect(content({ ...field, value: null })).toEqual({ valid: true, content: {} });
  });

  it("does not create form content for URL elicitations", () => {
    expect(
      contentForPendingMcpElicitation({
        requestId: 7,
        params: { turnId: null, serverName: "server", mode: "url", message: "Open", url: "https://example.com" },
      }),
    ).toEqual({ valid: true, content: null });
  });
});

type FieldInput<Field = PendingMcpElicitationField> = Field extends PendingMcpElicitationField
  ? Omit<Field, "id" | "title" | "description" | "required"> & { required?: boolean }
  : never;

function content(field: FieldInput) {
  return contentForPendingMcpElicitation({
    requestId: 7,
    params: {
      turnId: "turn",
      serverName: "server",
      mode: "form",
      message: "Configure",
      fields: [{ id: "answer", title: "Answer", description: null, required: false, ...field }],
    },
  });
}
