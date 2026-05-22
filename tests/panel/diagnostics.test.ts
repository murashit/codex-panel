import { describe, expect, it } from "vitest";

import {
  capabilityProbeError,
  capabilityProbeOk,
  createAppServerDiagnostics,
  upsertMcpServerDiagnostic,
} from "../../src/app-server/compatibility";
import { connectionDiagnosticSections, diagnosticAlertLevel } from "../../src/panel/diagnostics";

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
      activeThreadCliVersion: "0.130.0",
      diagnostics,
    });

    const rows = sections.flatMap((section) => section.rows);
    expect(sections.map((section) => section.title)).toEqual(["Process", "Capabilities", "MCP issues"]);
    expect(rows.map((row) => `${row.label}: ${row.value}`)).toEqual(
      expect.arrayContaining([
        "connection: connected",
        "model/list: ok (12 models)",
        "skills/list: unsupported - unknown method skills/list",
        "mcp docs: ready - auth notLoggedIn",
        "mcp github: failed - missing token",
      ]),
    );
    expect(rows.find((row) => row.label === "skills/list")?.level).toBe("warning");
    expect(rows.find((row) => row.label === "mcp github")?.level).toBe("error");
    expect(sections.find((section) => section.title === "MCP issues")?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "mcp github", value: "failed - missing token" })]),
    );
  });

  it("derives a top-level diagnostic alert without treating unknown or unsupported probes as warnings", () => {
    expect(diagnosticAlertLevel(createAppServerDiagnostics())).toBe("normal");

    const unsupported = createAppServerDiagnostics();
    unsupported.probes["skills/list"] = capabilityProbeError("skills/list", new Error("unknown method skills/list"), 1);
    expect(diagnosticAlertLevel(unsupported)).toBe("normal");

    const failed = createAppServerDiagnostics();
    failed.probes["model/list"] = capabilityProbeError("model/list", new Error("network down"), 1);
    expect(diagnosticAlertLevel(failed)).toBe("error");
  });

  it("derives MCP diagnostic alerts with error priority", () => {
    let authIssue = upsertMcpServerDiagnostic(createAppServerDiagnostics(), {
      name: "docs",
      startupStatus: "ready",
      authStatus: "notLoggedIn",
      toolCount: 0,
      message: null,
    });
    expect(diagnosticAlertLevel(authIssue)).toBe("warning");

    authIssue = upsertMcpServerDiagnostic(authIssue, {
      name: "github",
      startupStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
    });
    expect(diagnosticAlertLevel(authIssue)).toBe("error");
  });
});
