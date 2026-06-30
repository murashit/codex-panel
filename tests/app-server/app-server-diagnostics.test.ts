import { describe, expect, it } from "vitest";

import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  serverIdentity,
  serverPlatform,
  upsertMcpServerDiagnostic,
} from "../../src/domain/server/diagnostics";
import type { ServerInitialization } from "../../src/domain/server/initialization";
import { mcpServerStatusSummariesFromStatuses } from "../../src/domain/server/mcp-status";

describe("app-server diagnostics", () => {
  it("formats initialize metadata", () => {
    const response = {
      userAgent: "codex-cli/0.128.0",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
    } satisfies ServerInitialization;

    expect(serverIdentity(response)).toBe("codex-cli/0.128.0");
    expect(serverPlatform(response)).toBe("macos/unix");
  });

  it("creates generic capability probe defaults", () => {
    const diagnostics = createServerDiagnostics();

    expect(Object.keys(diagnostics.probes)).toEqual([
      "model/list",
      "skills/list",
      "app/list",
      "plugin/installed",
      "account/rateLimits/read",
      "mcpServerStatus/list",
    ]);
    expect(diagnostics.probes["model/list"]).toMatchObject({
      method: "model/list",
      status: "unknown",
      message: null,
      summary: null,
      checkedAt: null,
    });
  });

  it("classifies ok and failed capability probes", () => {
    expect(diagnosticProbeOk("skills/list", "3 skills", 123)).toEqual({
      method: "skills/list",
      status: "ok",
      message: null,
      summary: "3 skills",
      checkedAt: 123,
    });
    expect(diagnosticProbeError("plugin/installed", new Error("boom"), 456)).toMatchObject({
      method: "plugin/installed",
      status: "failed",
      message: "boom",
      checkedAt: 456,
    });
    expect(diagnosticProbeError("model/list", new Error("unknown provider failure"), 792).status).toBe("failed");
  });

  it("shortens error messages and tracks MCP server diagnostics", () => {
    expect(diagnosticProbeError("model/list", "a\n b\t c", 1).message).toBe("a b c");
    expect(diagnosticProbeError("model/list", "x".repeat(200), 1).message).toHaveLength(160);

    let diagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      startupStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
    });
    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "github",
      startupStatus: "unknown",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
    });

    expect(diagnostics.mcpServers).toEqual([
      { name: "github", startupStatus: "failed", authStatus: "notLoggedIn", toolCount: 2, message: "missing token" },
    ]);

    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "github",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });

    expect(diagnostics.mcpServers[0]).toEqual({
      name: "github",
      startupStatus: "ready",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
    });
  });

  it("derives codex app ids from MCP tool prefixes", () => {
    const summaries = mcpServerStatusSummariesFromStatuses([
      {
        name: "codex_apps",
        authStatus: "oAuth",
        tools: {
          "github.fetch_issue": { name: "github.fetch_issue" },
          "google_drive.get_document_text": { name: "google_drive.get_document_text" },
          "apple_music.get-track-details-batch": {},
          malformed_tool: { name: "malformed_tool" },
        },
        resources: [],
        resourceTemplates: [],
      },
      {
        name: "github",
        authStatus: "oAuth",
        tools: {
          "github.fetch_issue": { name: "github.fetch_issue" },
        },
        resources: [],
        resourceTemplates: [],
      },
    ]);

    expect(summaries).toMatchObject([
      {
        name: "codex_apps",
        codexAppIds: ["apple_music", "github", "google_drive"],
      },
      {
        name: "github",
        codexAppIds: [],
      },
    ]);
  });
});
