import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_PROBE_METHODS,
  appServerIdentity,
  appServerPlatform,
  diagnosticProbeError,
  diagnosticProbeOk,
  createAppServerDiagnostics,
  shortErrorMessage,
  upsertMcpServerDiagnostic,
} from "../../src/app-server/protocol/diagnostics";
import type { InitializeDiagnostics } from "../../src/app-server/protocol/diagnostics";

describe("app-server diagnostics", () => {
  it("formats initialize metadata", () => {
    const response = {
      userAgent: "codex-cli/0.128.0",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
    } satisfies InitializeDiagnostics;

    expect(appServerIdentity(response)).toBe("codex-cli/0.128.0");
    expect(appServerPlatform(response)).toBe("macos/unix");
  });

  it("creates generic capability probe defaults", () => {
    const diagnostics = createAppServerDiagnostics();

    expect(Object.keys(diagnostics.probes)).toEqual([...DIAGNOSTIC_PROBE_METHODS]);
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
    expect(diagnosticProbeError("hooks/list", new Error("boom"), 456)).toMatchObject({
      method: "hooks/list",
      status: "failed",
      message: "boom",
      checkedAt: 456,
    });
    expect(diagnosticProbeError("modelProvider/capabilities/read", new Error("unknown method"), 790).status).toBe("failed");
    expect(diagnosticProbeError("modelProvider/capabilities/read", new Error("unsupported RPC method"), 791).status).toBe("failed");
    expect(diagnosticProbeError("model/list", new Error("unknown provider failure"), 792).status).toBe("failed");
  });

  it("shortens error messages and tracks MCP server diagnostics", () => {
    expect(shortErrorMessage("a\n b\t c")).toBe("a b c");
    expect(shortErrorMessage("x".repeat(200))).toHaveLength(160);

    let diagnostics = upsertMcpServerDiagnostic(createAppServerDiagnostics(), {
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
});
