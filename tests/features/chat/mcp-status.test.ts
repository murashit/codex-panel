import { describe, expect, it } from "vitest";

import type { McpServerStatusSummary } from "../../../src/app-server/diagnostics";
import { mcpStatusLines } from "../../../src/features/chat/mcp-status";

function mcpServer(overrides: Partial<McpServerStatusSummary> = {}): McpServerStatusSummary {
  return {
    name: "github",
    authStatus: "oAuth",
    toolCount: 2,
    resourceCount: 0,
    resourceTemplateCount: 0,
    ...overrides,
  };
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
