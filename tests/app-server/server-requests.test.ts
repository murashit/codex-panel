import { describe, expect, it } from "vitest";

import type { ServerRequest } from "../../src/app-server/connection/rpc-messages";
import {
  appServerApprovalRequest,
  appServerApprovalResponse,
  appServerMcpElicitationRequest,
  appServerMcpElicitationResponse,
  appServerUserInputRequest,
  appServerUserInputResponse,
} from "../../src/app-server/protocol/server-requests";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

describe("app-server server request protocol adapters", () => {
  it("classifies approval requests and builds approval responses", () => {
    const request: ServerRequest = {
      id: 2,
      method: "item/permissions/requestApproval",
      params: {
        cwd: "/tmp/project",
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        environmentId: null,
        startedAtMs: 1,
        reason: "Need network",
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    };

    const approval = expectPresent(appServerApprovalRequest(request));

    expect(approval.method).toBe("item/permissions/requestApproval");
    expect(appServerApprovalResponse(approval, "decline")).toEqual({ permissions: {}, scope: "turn" });
    expect(appServerApprovalResponse(approval, "accept")).toEqual({
      permissions: { network: { enabled: true } },
      scope: "turn",
    });
  });

  it("classifies user input requests and builds answer responses", () => {
    const request: ServerRequest = {
      id: 7,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "item",
        questions: [
          {
            id: "direction",
            header: "Direction",
            question: "Which way?",
            isOther: true,
            isSecret: false,
            options: [{ label: "Recommended", description: "Use the default path" }],
          },
        ],
        autoResolutionMs: null,
      },
    };

    const input = expectPresent(appServerUserInputRequest(request));

    expect(input.params.questions[0]?.id).toBe("direction");
    expect(appServerUserInputResponse(input.params.questions, { direction: "Left" })).toEqual({
      answers: { direction: { answers: ["Left"] } },
    });
  });

  it("normalizes MCP form schema fields and response content", () => {
    const input = expectPresent(appServerMcpElicitationRequest(formRequest()));

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

    expect(appServerMcpElicitationResponse("accept", { title: "Fix bug", labels: ["bug"] })).toEqual({
      action: "accept",
      content: { title: "Fix bug", labels: ["bug"] },
      _meta: null,
    });
    expect(appServerMcpElicitationResponse("decline", { title: "Fix bug" })).toEqual({
      action: "decline",
      content: null,
      _meta: null,
    });
  });

  it("normalizes MCP url mode separately from form fields", () => {
    expect(appServerMcpElicitationRequest(urlRequest())).toMatchObject({
      requestId: 43,
      params: {
        mode: "url",
        url: "https://example.com/confirm",
        elicitationId: "elicit-1",
      },
    });
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
