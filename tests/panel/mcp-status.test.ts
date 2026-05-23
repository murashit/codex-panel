import { describe, expect, it } from "vitest";

import type { McpServerStatus } from "../../src/generated/app-server/v2/McpServerStatus";
import { mcpStatusLines } from "../../src/features/chat/mcp-status";

function mcpServer(overrides: Partial<McpServerStatus> = {}): McpServerStatus {
  return {
    name: "github",
    tools: {
      search_issues: { name: "search_issues", description: null, inputSchema: {} },
      fetch_pr: { name: "fetch_pr", description: null, inputSchema: {} },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
    ...overrides,
  } as McpServerStatus;
}

describe("mcpStatusLines", () => {
  it("reports no configured servers clearly", () => {
    expect(mcpStatusLines([])).toEqual(["MCP servers", "Codex App Server reports no MCP servers."]);
  });

  it("formats recognized MCP servers", () => {
    expect(mcpStatusLines([mcpServer()])).toEqual(["MCP servers", "github: available, auth oAuth, 2 tools, 0 resources"]);
  });

  it("includes diagnostic-only startup failures", () => {
    expect(
      mcpStatusLines(
        [],
        [
          {
            name: "figma",
            startupStatus: "failed",
            authStatus: null,
            toolCount: null,
            message: "command not found",
          },
        ],
      ),
    ).toEqual(["MCP servers", "figma: failed, auth unknown, tools unknown, command not found"]);
  });
});
