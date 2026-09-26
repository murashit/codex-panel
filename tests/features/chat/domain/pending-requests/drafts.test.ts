import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  contentForPendingMcpElicitation,
  mcpElicitationDraftKey,
  mcpElicitationFieldDefaultDraft,
} from "../../../../../src/features/chat/domain/pending-requests/drafts";
import type { PendingMcpElicitation, PendingMcpElicitationField } from "../../../../../src/features/chat/domain/pending-requests/model";

describe("pending MCP elicitation drafts", () => {
  it.each([
    ["1e3", 1000],
    ["-2e2", -200],
    ["4.5", 3],
    ["4oops", 3],
    ["1e999", 3],
    ["", null],
  ])("preserves integer meaning or falls back for draft %s", (draft, expected) => {
    const count = field({ id: "count", type: "integer", defaultValue: 3 });
    const drafts = new Map([[mcpElicitationDraftKey(7, "count"), draft]]);
    expect(contentForPendingMcpElicitation(elicitation([count]), drafts)).toEqual({ count: expected });
  });

  it("serializes boolean, numeric, and integer form values", () => {
    const fields: PendingMcpElicitationField[] = [
      field({ id: "enabled", type: "boolean", defaultValue: false }),
      field({ id: "ratio", type: "number", defaultValue: 1.5 }),
      field({ id: "count", type: "integer", defaultValue: 2 }),
      field({ id: "optional", type: "number", defaultValue: null }),
    ];
    const drafts = new Map([
      [mcpElicitationDraftKey(7, "enabled"), "true"],
      [mcpElicitationDraftKey(7, "ratio"), "2.75"],
      [mcpElicitationDraftKey(7, "count"), "4"],
      [mcpElicitationDraftKey(7, "optional"), "  "],
    ]);

    expect(contentForPendingMcpElicitation(elicitation(fields), drafts)).toEqual({
      enabled: true,
      ratio: 2.75,
      count: 4,
      optional: null,
    });
  });

  it("falls back to the request default for an invalid multi-select draft", () => {
    const numeric = field({ id: "count", type: "integer", defaultValue: 3 });
    const choices = field({
      id: "choices",
      type: "multi-select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      defaultValue: ["a"],
    });
    const drafts = new Map([[mcpElicitationDraftKey(7, "choices"), "not-json"]]);

    expect(contentForPendingMcpElicitation(elicitation([numeric, choices]), drafts)).toEqual({ count: 3, choices: ["a"] });
    expect(mcpElicitationFieldDefaultDraft(numeric)).toBe("3");
    expect(mcpElicitationFieldDefaultDraft(choices)).toBe('["a"]');
  });

  it("keeps only allowed string values from arbitrary multi-select drafts", () => {
    const choices = field({
      id: "choices",
      type: "multi-select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      defaultValue: [],
    });
    const value = fc.oneof(fc.constantFrom("a", "b", "unknown"), fc.integer(), fc.boolean(), fc.constant(null));
    fc.assert(
      fc.property(fc.array(value, { maxLength: 20 }), (values) => {
        const drafts = new Map([[mcpElicitationDraftKey(7, "choices"), JSON.stringify(values)]]);
        expect(contentForPendingMcpElicitation(elicitation([choices]), drafts)).toEqual({
          choices: values.filter((item) => item === "a" || item === "b"),
        });
      }),
    );
  });

  it("does not create form content for URL elicitations", () => {
    const input: PendingMcpElicitation = {
      requestId: 7,
      params: { turnId: null, serverName: "server", mode: "url", message: "Open", url: "https://example.com" },
    };

    expect(contentForPendingMcpElicitation(input, new Map())).toBeNull();
  });
});

function elicitation(fields: readonly PendingMcpElicitationField[]): PendingMcpElicitation {
  return {
    requestId: 7,
    params: { turnId: "turn", serverName: "server", mode: "form", message: "Configure", fields },
  };
}

type PendingMcpElicitationFieldInput<Field = PendingMcpElicitationField> = Field extends PendingMcpElicitationField
  ? Omit<Field, "title" | "description" | "required">
  : never;

function field(input: PendingMcpElicitationFieldInput): PendingMcpElicitationField {
  return { ...input, title: input.id, description: null, required: false } as PendingMcpElicitationField;
}
