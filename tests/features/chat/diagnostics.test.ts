import { describe, expect, it } from "vitest";

import {
  capabilityProbeError,
  capabilityProbeOk,
  createAppServerDiagnostics,
  upsertMcpServerDiagnostic,
} from "../../../src/app-server/compatibility";
import { connectionDiagnosticSections, hasDiagnosticIssue } from "../../../src/features/chat/diagnostics";

describe("connection diagnostics", () => {
  it("formats base rows, capability probes, and MCP issues for /doctor", () => {
    let diagnostics = createAppServerDiagnostics();
    diagnostics.probes["model/list"] = capabilityProbeOk("model/list", "12 models", 1);
    diagnostics.probes["skills/list"] = capabilityProbeError("skills/list", new Error("unknown method skills/list"), 2);
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
    expect(sections.map((section) => section.title)).toEqual(["Process", "Capabilities", "MCP issues"]);
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
    expect(hasDiagnosticIssue(createAppServerDiagnostics())).toBe(false);

    const failed = createAppServerDiagnostics();
    failed.probes["model/list"] = capabilityProbeError("model/list", new Error("network down"), 1);
    expect(hasDiagnosticIssue(failed)).toBe(true);
  });

  it("detects MCP diagnostic issues", () => {
    let authIssue = upsertMcpServerDiagnostic(createAppServerDiagnostics(), {
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
});
