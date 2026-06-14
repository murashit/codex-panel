import { describe, expect, it } from "vitest";

import {
  diagnosticProbeError,
  diagnosticProbeOk,
  createServerDiagnostics,
  upsertMcpServerDiagnostic,
  upsertMcpServerStatusDiagnostics,
} from "../../../src/domain/server/diagnostics";
import { connectionDiagnosticSections, hasDiagnosticIssue } from "../../../src/features/chat/connection/diagnostics-display";

describe("connection diagnostics", () => {
  it("formats base rows, capability probes, and MCP issues for /doctor", () => {
    let diagnostics = createServerDiagnostics();
    diagnostics.probes["model/list"] = diagnosticProbeOk("model/list", "12 models", 1);
    diagnostics.probes["skills/list"] = diagnosticProbeError("skills/list", new Error("unknown method skills/list"), 2);
    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "github",
      startupStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
    });
    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "docs",
      startupStatus: "ready",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
    });

    const sections = connectionDiagnosticSections({
      connected: true,
      configuredCommand: "/opt/homebrew/bin/codex",
      initializeResponse: {
        userAgent: "codex-cli/0.130.0",
        codexHome: "/Users/showhey/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
      diagnostics,
    });

    const rows = sections.flatMap((section) => section.rows);
    expect(sections.map((section) => section.title)).toEqual(["Process", "App Server Checks", "MCP issues"]);
    expect(rows.map((row) => `${row.label}: ${row.value}`)).toEqual(
      expect.arrayContaining([
        "connection: connected",
        "model/list: ok (12 models)",
        "skills/list: failed - unknown method skills/list",
        "mcp docs: ready - auth notLoggedIn",
        "mcp github: failed - missing token",
      ]),
    );
    expect(rows.find((row) => row.label === "skills/list")?.level).toBe("error");
    expect(rows.find((row) => row.label === "mcp github")?.level).toBe("error");
    expect(sections.find((section) => section.title === "MCP issues")?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "mcp github", value: "failed - missing token" })]),
    );
  });

  it("detects diagnostic issues without treating unknown probes as issues", () => {
    expect(hasDiagnosticIssue(createServerDiagnostics())).toBe(false);

    const failed = createServerDiagnostics();
    failed.probes["model/list"] = diagnosticProbeError("model/list", new Error("network down"), 1);
    expect(hasDiagnosticIssue(failed)).toBe(true);
  });

  it("detects MCP diagnostic issues", () => {
    let authIssue = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "docs",
      startupStatus: "ready",
      authStatus: "notLoggedIn",
      toolCount: 0,
      message: null,
    });
    expect(hasDiagnosticIssue(authIssue)).toBe(true);

    authIssue = upsertMcpServerDiagnostic(authIssue, {
      name: "github",
      startupStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
    });
    expect(hasDiagnosticIssue(authIssue)).toBe(true);
  });

  it("maps app-server MCP status snapshots into diagnostics", () => {
    const diagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      startupStatus: "starting",
      authStatus: null,
      toolCount: null,
      message: "launching",
    });

    const next = upsertMcpServerStatusDiagnostics(diagnostics, [
      {
        name: "github",
        authStatus: "oAuth",
        toolCount: 2,
        resourceCount: 0,
        resourceTemplateCount: 0,
      },
    ]);

    expect(next.mcpServers).toEqual([
      {
        name: "github",
        startupStatus: "starting",
        authStatus: "oAuth",
        toolCount: 2,
        message: "launching",
      },
    ]);
  });
});
