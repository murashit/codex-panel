import { describe, expect, it } from "vitest";

import {
  cloneServerDiagnostics,
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeLabel,
  diagnosticProbeOk,
  diagnosticsWithToolInventory,
  replaceMcpServerStatusDiagnostics,
  serverIdentity,
  serverPlatform,
  shortDiagnosticErrorMessage,
  upsertMcpServerDiagnostic,
} from "../../../src/domain/server/diagnostics";
import type { ServerInitialization } from "../../../src/domain/server/initialization";
import { mcpServerStatusSummariesFromStatuses } from "../../../src/domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../src/domain/server/tool-inventory";

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

  it("creates generic capability probe defaults", () => {
    const diagnostics = createServerDiagnostics();

    expect(Object.keys(diagnostics.probes)).toEqual(["models", "skills", "permissionProfiles", "plugins", "rateLimits", "mcpServers"]);
    expect(diagnostics.probes.models).toMatchObject({
      id: "models",
      status: "unknown",
      message: null,
      summary: null,
      checkedAt: null,
    });
    expect(diagnosticProbeLabel("models")).toBe("Models");
    expect(diagnosticProbeLabel("permissionProfiles")).toBe("Permission profiles");
  });

  it("classifies ok and failed capability probes", () => {
    expect(diagnosticProbeOk("skills", "3 skills", 123)).toEqual({
      id: "skills",
      status: "ok",
      message: null,
      summary: "3 skills",
      checkedAt: 123,
    });
    expect(diagnosticProbeError("plugins", new Error("boom"), 456)).toMatchObject({
      id: "plugins",
      status: "failed",
      message: "boom",
      checkedAt: 456,
    });
  });

  it("shortens error messages and tracks MCP server diagnostics", () => {
    expect(diagnosticProbeError("models", "a\n b\t c", 1).message).toBe("a b c");
    expect(diagnosticProbeError("models", "x".repeat(200), 1).message).toHaveLength(160);

    let diagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
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

    expect(diagnostics.mcpServers).toEqual([
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

    expect(diagnostics.mcpServers[0]).toEqual({
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
    expect(diagnostics.mcpServers.map((server) => server.name)).toEqual(["docs", "github"]);
    expect(shortDiagnosticErrorMessage("1234567890", 10)).toBe("1234567890");
  });

  it("derives codex app ids from MCP tool prefixes", () => {
    const summaries = mcpServerStatusSummariesFromStatuses([
      {
        name: "codex_apps",
        runtimeStatus: "connected",
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
        runtimeStatus: null,
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

  it("clones tool inventory before publishing diagnostics snapshots", () => {
    const source: ToolInventorySnapshot = {
      checkedAt: 1,
      plugins: [
        {
          id: "writer@local",
          name: "writer",
          displayName: "Writer",
          marketplaceName: "local",
          marketplacePath: "/marketplaces/local.json",
          localVersion: "1.0.0",
          installed: true,
          enabled: true,
          availability: "AVAILABLE",
          source: "local",
        },
      ],
      pluginMarketplaceErrors: [{ marketplacePath: "/marketplaces/remote.json", message: "offline" }],
      pluginsError: null,
      mcpServers: [
        {
          name: "codex_apps",
          authStatus: "oAuth",
          toolCount: 1,
          connectionStatus: "connected",
          codexAppIds: ["github"],
        },
      ],
      mcpDiagnostics: [
        {
          name: "codex_apps",
          connectionStatus: "connected",
          authStatus: "oAuth",
          toolCount: 1,
          message: null,
          authenticationIssue: null,
        },
      ],
      mcpError: null,
    };

    const cloned = cloneServerDiagnostics(diagnosticsWithToolInventory(createServerDiagnostics(), source)).toolInventory;
    if (!cloned?.plugins || !cloned.mcpServers || !cloned.mcpDiagnostics) throw new Error("Expected cloned tool inventory");

    expect(cloned).not.toBe(source);
    expect(cloned.plugins).toEqual(source.plugins);
    expect(cloned.pluginMarketplaceErrors).toEqual(source.pluginMarketplaceErrors);
    expect(cloned.mcpDiagnostics).toEqual(source.mcpDiagnostics);
    expect(cloned.mcpServers).toEqual(source.mcpServers);
    expect(cloned.plugins).not.toBe(source.plugins);
    expect(cloned.mcpServers).not.toBe(source.mcpServers);
    expect(cloned.mcpServers[0]?.codexAppIds).not.toBe(source.mcpServers?.[0]?.codexAppIds);

    const clonedPlugin = cloned.plugins.at(0);
    const clonedServer = cloned.mcpServers.at(0);
    if (!clonedPlugin || !clonedServer?.codexAppIds) throw new Error("Expected cloned entries");

    (clonedPlugin as unknown as { name: string }).name = "changed";
    (clonedServer as unknown as { codexAppIds: string[] }).codexAppIds.push("gmail");

    expect(source.plugins?.[0]?.name).toBe("writer");
    expect(source.mcpServers?.[0]?.codexAppIds).toEqual(["github"]);
  });

  it("replaces MCP status diagnostics while retaining known startup facts", () => {
    let diagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      connectionStatus: "failed",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: "missing token",
      authenticationIssue: null,
    });

    diagnostics = replaceMcpServerStatusDiagnostics(diagnostics, [
      { name: "github", authStatus: "oAuth", toolCount: 3, connectionStatus: "failed" },
      { name: "docs", authStatus: "oAuth", toolCount: 1, connectionStatus: null },
    ]);

    expect(diagnostics.mcpServers).toEqual([
      {
        name: "docs",
        connectionStatus: "unknown",
        authStatus: "oAuth",
        toolCount: 1,
        message: null,
        authenticationIssue: null,
      },
      {
        name: "github",
        connectionStatus: "failed",
        authStatus: "oAuth",
        toolCount: 3,
        message: "missing token",
        authenticationIssue: null,
      },
    ]);
  });

  it("lets a runtime snapshot refine a startup failure into a re-authentication requirement", () => {
    const eventDiagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      connectionStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "OAuth token expired",
      authenticationIssue: "reauthenticationRequired",
    });

    const diagnostics = replaceMcpServerStatusDiagnostics(eventDiagnostics, [
      { name: "github", authStatus: "notLoggedIn", toolCount: 3, connectionStatus: "authenticationRequired" },
    ]);

    expect(diagnostics.mcpServers).toEqual([
      {
        name: "github",
        connectionStatus: "authenticationRequired",
        authStatus: "notLoggedIn",
        toolCount: 3,
        message: "OAuth token expired",
        authenticationIssue: "reauthenticationRequired",
      },
    ]);
  });
});
