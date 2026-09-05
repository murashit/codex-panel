import { describe, expect, it } from "vitest";

import {
  diagnosticProbeError,
  diagnosticProbeOk,
  serverIdentity,
  serverPlatform,
  shortDiagnosticErrorMessage,
  upsertMcpServerDiagnostic,
} from "../../../src/domain/server/diagnostics";
import type { ServerInitialization } from "../../../src/domain/server/initialization";

describe("server diagnostics", () => {
  it("formats initialize metadata", () => {
    const response = {
      userAgent: "codex-cli/0.128.0",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
    } satisfies ServerInitialization;

    expect(serverIdentity(response)).toBe("codex-cli/0.128.0");
    expect(serverPlatform(response)).toBe("macos/unix");
    expect(serverIdentity(null)).toBe("(not connected)");
    expect(serverPlatform(null)).toBe("(not connected)");
  });

  it("classifies ok and failed capability probes", () => {
    expect(diagnosticProbeOk("skills", "3 skills", 123)).toEqual({
      id: "skills",
      status: "ok",
      message: null,
      summary: "3 skills",
      checkedAt: 123,
    });
    expect(diagnosticProbeError("skills", new Error("boom"), 456)).toMatchObject({
      id: "skills",
      status: "failed",
      message: "boom",
      checkedAt: 456,
    });
  });

  it("shortens error messages and tracks MCP server diagnostics", () => {
    expect(diagnosticProbeError("models", "a\n b\t c", 1).message).toBe("a b c");
    expect(diagnosticProbeError("models", "x".repeat(200), 1).message).toHaveLength(160);

    let diagnostics = upsertMcpServerDiagnostic([], {
      name: "github",
      connectionStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
      authenticationIssue: null,
    });
    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "github",
      connectionStatus: "unknown",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
      authenticationIssue: null,
    });

    expect(diagnostics).toEqual([
      {
        name: "github",
        connectionStatus: "failed",
        authStatus: "notLoggedIn",
        toolCount: 2,
        message: "missing token",
        authenticationIssue: null,
      },
    ]);

    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "github",
      connectionStatus: "connected",
      authStatus: null,
      toolCount: null,
      message: null,
      authenticationIssue: null,
    });

    expect(diagnostics[0]).toEqual({
      name: "github",
      connectionStatus: "connected",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
      authenticationIssue: null,
    });

    diagnostics = upsertMcpServerDiagnostic(diagnostics, {
      name: "docs",
      connectionStatus: "connected",
      authStatus: "oAuth",
      toolCount: 1,
      message: null,
      authenticationIssue: null,
    });
    expect(diagnostics.map((server) => server.name)).toEqual(["docs", "github"]);
    expect(shortDiagnosticErrorMessage("1234567890", 10)).toBe("1234567890");
  });
});
