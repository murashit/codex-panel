import { describe, expect, it } from "vitest";
import type { ServerRequest } from "../../../../../../src/app-server/connection/rpc-messages";
import {
  appServerMcpElicitationResponse as mcpElicitationResponse,
  appServerMcpElicitationRequest as toPendingMcpElicitation,
} from "../../../../../../src/features/chat/app-server/inbound/server-request-adapter";
import type { JsonValue } from "../../../../../../src/generated/app-server/serde_json/JsonValue";
import { mcpFormRequestFixture } from "../../../../../support/server-requests";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("MCP elicitation request model", () => {
  it("maps form schema fields and adapts accepted content", () => {
    const input = expectPresent(toPendingMcpElicitation(formRequest()));

    expect(input).toMatchObject({
      requestId: 42,
      params: {
        mode: "form",
        turnId: null,
        serverName: "github",
      },
    });
    if (input.params.mode !== "form") throw new Error("Expected form mode");
    expect(input.params.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "title",
          type: "string",
          title: "Title",
          required: true,
          value: "Issue",
          minLength: 1,
          maxLength: 30,
        }),
        expect.objectContaining({ id: "notify", type: "boolean", value: true }),
        expect.objectContaining({ id: "count", type: "integer", value: "2", minimum: 0, maximum: 10 }),
        expect.objectContaining({ id: "ratio", type: "number", value: "" }),
        expect.objectContaining({
          id: "priority",
          type: "single-select",
          value: "high",
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        }),
        expect.objectContaining({
          id: "labels",
          type: "multi-select",
          value: ["bug"],
          minItems: 1n,
          maxItems: 2n,
          options: [
            { value: "bug", label: "Bug" },
            { value: "docs", label: "Docs" },
          ],
        }),
      ]),
    );

    const content = { title: "Fix bug", priority: "high", labels: ["bug", "docs"], notify: false, count: 3 };

    expect(mcpElicitationResponse("accept", content)).toEqual({
      action: "accept",
      content,
      _meta: null,
    });
    expect(mcpElicitationResponse("decline", content)).toEqual({ action: "decline", content: null, _meta: null });
  });

  it.each([
    [
      { type: "array", items: { type: "string", enum: ["a"] }, minItems: 0, maxItems: 1 },
      { type: "multi-select", minItems: 0n, maxItems: 1n },
    ],
    [
      { type: "string", enum: ["a"], minLength: 1, maxLength: 3 },
      { type: "single-select", minLength: 1, maxLength: 3 },
    ],
  ])("retains finite constraints from opaque OpenAI fields", (schema, expected) => {
    const input = expectPresent(toPendingMcpElicitation(fieldRequest(schema)));
    if (input.params.mode !== "form") throw new Error("Expected form mode");
    expect(input.params.fields).toEqual([expect.objectContaining(expected)]);
  });

  it.each([
    { schema: { type: "string", enum: ["a", "b"], default: "unknown" }, required: true, value: null },
    {
      schema: { type: "array", items: { type: "string", enum: ["a", "b"] }, default: ["unknown", "b", "b"] },
      required: true,
      value: ["b"],
    },
    { schema: { type: "array", items: { type: "string", enum: ["a"] }, minItems: 1, default: ["unknown"] }, required: true, value: [] },
    { schema: { type: "string", enum: [], default: "unknown" }, required: false, value: null },
    { schema: { type: "array", items: { type: "string", enum: [] }, default: ["unknown"] }, required: true, value: [] },
    { schema: { type: "array", items: { type: "string", enum: [] }, minItems: 1 }, required: false, value: [] },
    { schema: { type: "string", enum: [""], default: "" }, required: true, value: "" },
  ])("initializes selections only from offered defaults: %j", ({ schema, required, value }) => {
    const input = expectPresent(toPendingMcpElicitation(fieldRequest(schema, required)));
    if (input.params.mode !== "form") throw new Error("Expected form mode");
    expect(input.params.fields).toEqual([expect.objectContaining({ value })]);
  });

  it.each([
    { schema: { type: "string", oneOf: { const: "low", title: "Low" } }, required: false },
    { schema: { type: "string", minLength: -1 }, required: false },
    { schema: { type: "array", items: { type: "string", enum: ["a"] }, minItems: 1.5 }, required: false },
    { schema: { type: "string", oneOf: [] }, required: false },
    { schema: { type: "string", enum: ["a", 1] }, required: false },
    { schema: { type: "string", oneOf: [{ const: "a" }, {}] }, required: false },
    { schema: { type: "array", items: {} }, required: false },
    { schema: { type: "array", items: { anyOf: [] } }, required: false },
    { schema: { type: "string", enum: [] }, required: true },
    { schema: { type: "array", items: { type: "string", enum: [] }, minItems: 1 }, required: true },
  ])("does not turn an unusable field into an unconstrained control", ({ schema, required }) => {
    expect(toPendingMcpElicitation(fieldRequest(schema, required))).toBeNull();
  });

  it("maps url mode separately from form content", () => {
    const input = expectPresent(toPendingMcpElicitation(urlRequest()));

    expect(input).toMatchObject({
      requestId: 43,
      params: {
        mode: "url",
        url: "https://example.com/confirm",
      },
    });
  });

  it.each(["openai/form", "openaiForm"] as const)("maps OpenAI %s mode through the normal form model", (mode) => {
    const input = expectPresent(toPendingMcpElicitation(openAiFormRequest(mode)));

    expect(input).toMatchObject({
      requestId: 45,
      params: {
        mode: "form",
        serverName: "github",
      },
    });
    if (input.params.mode !== "form") throw new Error("Expected form mode");
    expect(input.params.fields).toEqual([expect.objectContaining({ id: "title", type: "string" })]);
  });

  it("rejects a form instead of dropping unsupported schema fields", () => {
    expect(toPendingMcpElicitation(fieldRequest({ type: "object" }))).toBeNull();
  });

  it("rejects a form whose required property cannot be presented", () => {
    const request = formRequest();
    if (request.method !== "mcpServer/elicitation/request" || request.params.mode !== "form") throw new Error("Expected form request");
    request.params.requestedSchema.required = ["missing"];
    expect(toPendingMcpElicitation(request)).toBeNull();
  });
});

function formRequest(): ServerRequest {
  return mcpFormRequestFixture(
    42,
    {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", title: "Title", description: "Issue title", default: "Issue", minLength: 1, maxLength: 30 },
        priority: {
          type: "string",
          title: "Priority",
          default: "high",
          oneOf: [
            { const: "low", title: "Low" },
            { const: "high", title: "High" },
          ],
        },
        labels: {
          type: "array",
          title: "Labels",
          minItems: 1n,
          maxItems: 2n,
          items: {
            anyOf: [
              { const: "bug", title: "Bug" },
              { const: "docs", title: "Docs" },
            ],
          },
          default: ["bug"],
        },
        notify: { type: "boolean", title: "Notify", default: true },
        count: { type: "integer", title: "Count", default: 2, minimum: 0, maximum: 10 },
        ratio: { type: "number", title: "Ratio" },
      },
    },
    { turnId: null },
  );
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

function openAiFormRequest(mode: "openai/form" | "openaiForm"): ServerRequest {
  return {
    id: 45,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "github",
      mode,
      _meta: null,
      message: "Provide issue details",
      requestedSchema: {
        type: "object",
        properties: {
          title: { type: "string", title: "Title" },
        },
      },
    },
  };
}

function fieldRequest(schema: JsonValue, required = false): ServerRequest {
  return {
    id: 45,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread",
      turnId: null,
      serverName: "github",
      mode: "openai/form",
      _meta: null,
      message: "Provide issue details",
      requestedSchema: { type: "object", properties: { value: schema }, required: required ? ["value"] : [] },
    },
  };
}
