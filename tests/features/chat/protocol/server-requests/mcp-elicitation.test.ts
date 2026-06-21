import { describe, expect, it } from "vitest";

import type { ServerRequest } from "../../../../../src/app-server/connection/rpc-messages";
import { toPendingMcpElicitation, mcpElicitationResponse } from "../../../../../src/features/chat/app-server/requests/mcp-elicitation";
import { contentForPendingMcpElicitation, mcpElicitationDraftKey } from "../../../../../src/domain/pending-requests/model";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("MCP elicitation request model", () => {
  it("maps form schema fields and builds accepted content", () => {
    const input = expectPresent(toPendingMcpElicitation(formRequest()));

    expect(input).toMatchObject({
      requestId: 42,
      method: "mcpServer/elicitation/request",
      params: {
        mode: "form",
        threadId: "thread",
        turnId: null,
        serverName: "github",
      },
    });
    if (input.params.mode !== "form") throw new Error("Expected form mode");
    expect(input.params.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "title", type: "string", title: "Title", required: true, defaultValue: "Issue" }),
        expect.objectContaining({ id: "notify", type: "boolean", defaultValue: true }),
        expect.objectContaining({ id: "count", type: "integer", defaultValue: 2 }),
        expect.objectContaining({ id: "ratio", type: "number", defaultValue: null }),
        expect.objectContaining({
          id: "priority",
          type: "single-select",
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        }),
        expect.objectContaining({
          id: "labels",
          type: "multi-select",
          minItems: 1,
          maxItems: 2,
          options: [
            { value: "bug", label: "Bug" },
            { value: "docs", label: "Docs" },
          ],
        }),
      ]),
    );

    const drafts = new Map([
      [mcpElicitationDraftKey(42, "title"), "Fix bug"],
      [mcpElicitationDraftKey(42, "priority"), "high"],
      [mcpElicitationDraftKey(42, "labels"), JSON.stringify(["bug", "docs"])],
      [mcpElicitationDraftKey(42, "notify"), "false"],
      [mcpElicitationDraftKey(42, "count"), "3"],
    ]);
    const content = contentForPendingMcpElicitation(input, drafts);

    expect(content).toEqual({
      title: "Fix bug",
      priority: "high",
      labels: ["bug", "docs"],
      notify: false,
      count: 3,
      ratio: null,
    });
    expect(mcpElicitationResponse("accept", content)).toEqual({
      action: "accept",
      content,
      _meta: null,
    });
    expect(mcpElicitationResponse("decline", content)).toEqual({ action: "decline", content: null, _meta: null });
  });

  it("maps url mode separately from form content", () => {
    const input = expectPresent(toPendingMcpElicitation(urlRequest()));

    expect(input).toMatchObject({
      requestId: 43,
      params: {
        mode: "url",
        url: "https://example.com/confirm",
        elicitationId: "elicit-1",
      },
    });
    expect(contentForPendingMcpElicitation(input, new Map())).toBeNull();
  });
});

function formRequest(): ServerRequest {
  return {
    id: 42,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "github",
      mode: "form",
      _meta: null,
      message: "Provide issue details",
      requestedSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", title: "Title", description: "Issue title", default: "Issue" },
          priority: {
            type: "string",
            title: "Priority",
            oneOf: [
              { const: "low", title: "Low" },
              { const: "high", title: "High" },
            ],
            default: "low",
          },
          labels: {
            type: "array",
            title: "Labels",
            minItems: 1,
            maxItems: 2,
            items: {
              anyOf: [
                { const: "bug", title: "Bug" },
                { const: "docs", title: "Docs" },
              ],
            },
            default: ["bug"],
          },
          notify: { type: "boolean", title: "Notify", default: true },
          count: { type: "integer", title: "Count", default: 2 },
          ratio: { type: "number", title: "Ratio" },
        },
      },
    },
  } as unknown as ServerRequest;
}

function urlRequest(): ServerRequest {
  return {
    id: 43,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread",
      turnId: "turn",
      serverName: "github",
      mode: "url",
      _meta: null,
      message: "Confirm in browser",
      url: "https://example.com/confirm",
      elicitationId: "elicit-1",
    },
  };
}
