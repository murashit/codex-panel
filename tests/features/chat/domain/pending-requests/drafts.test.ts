import { describe, expect, it } from "vitest";

import {
  contentForPendingMcpElicitation,
  mcpElicitationDraftKey,
  mcpElicitationFieldDefaultDraft,
} from "../../../../../src/features/chat/domain/pending-requests/drafts";
import type { PendingMcpElicitation, PendingMcpElicitationField } from "../../../../../src/features/chat/domain/pending-requests/model";

describe("pending MCP elicitation drafts", () => {
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

  it("keeps only allowed string values from a multi-select draft", () => {
    const choices = field({
      id: "choices",
      type: "multi-select",
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
      defaultValue: [],
    });
    const drafts = new Map([[mcpElicitationDraftKey(7, "choices"), JSON.stringify(["b", "unknown", 1, null])]]);

    expect(contentForPendingMcpElicitation(elicitation([choices]), drafts)).toEqual({ choices: ["b"] });
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
