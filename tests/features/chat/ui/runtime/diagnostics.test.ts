import { describe, expect, it } from "vitest";
import { mcpServerStatusSummariesFromStatuses } from "../../../../../src/app-server/protocol/tool-inventory";
import type { SkillMetadata } from "../../../../../src/domain/runtime/catalog";
import {
  createServerDiagnostics,
  type DiagnosticProbeId,
  type DiagnosticProbeResult,
  type Diagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/runtime/diagnostics";
import type { McpServerDiagnostic, ToolInventorySnapshot } from "../../../../../src/domain/runtime/tool-inventory";
import { appServerDiagnosticSections } from "../../../../../src/features/chat/ui/runtime/diagnostics";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/ui/runtime/tool-inventory";

type InventoryFixture = ToolInventorySnapshot;

function withProbe(diagnostics: Diagnostics, id: DiagnosticProbeId, probe: DiagnosticProbeResult): Diagnostics {
  return { ...diagnostics, probes: { ...diagnostics.probes, [id]: probe } };
}

function withMcpDiagnostic(diagnostics: Diagnostics, server: McpServerDiagnostic): Diagnostics {
  return { ...diagnostics, mcpServers: upsertMcpServerDiagnostic(diagnostics.mcpServers, server) };
}

function skillFixture(name: string, scope: SkillMetadata["scope"], pluginId: string | null = null, enabled = true): SkillMetadata {
  return { name, scope, pluginId, enabled, description: "", path: `/skills/${name}/SKILL.md` };
}

describe("connection diagnostics", () => {
  it("shows unprobed runtime checks as unknown warnings", () => {
    const sections = appServerDiagnosticSections({
      connected: false,
      configuredCommand: "codex",
      initializeResponse: null,
      diagnostics: createServerDiagnostics(),
    });

    expect(sections.find((section) => section.title === "Runtime Checks")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Models", value: "unknown", level: "warning" },
        { label: "Rate limits", value: "unknown", level: "warning" },
      ]),
    );
  });

  it("formats connection rows and runtime checks for /doctor", () => {
    let diagnostics = createServerDiagnostics();
    diagnostics = withProbe(diagnostics, "models", diagnosticProbeOk("12 models", 1));
    diagnostics = withProbe(diagnostics, "rateLimits", diagnosticProbeError(new Error("rate limit request failed"), 2));
    diagnostics = withProbe(diagnostics, "skills", diagnosticProbeError(new Error("unknown method skills/list"), 3));
    diagnostics = withMcpDiagnostic(diagnostics, {
      name: "github",
      connectionStatus: "failed",
      authStatus: null,
      toolCount: null,
      message: "missing token",
      authenticationIssue: null,
    });
    diagnostics = withMcpDiagnostic(diagnostics, {
      name: "docs",
      connectionStatus: "connected",
      authStatus: "notLoggedIn",
      toolCount: 2,
      message: null,
      authenticationIssue: null,
    });

    const sections = appServerDiagnosticSections({
      connected: true,
      configuredCommand: "/opt/homebrew/bin/codex",
      initializeResponse: {
        userAgent: "codex-cli/0.130.0",
        codexHome: "/Users/example/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
      diagnostics,
    });

    const rows = sections.flatMap((section) => section.rows);
    expect(sections.map((section) => section.title)).toEqual(["Process", "Runtime Checks"]);
    expect(rows.map((row) => `${row.label}: ${row.value}`)).toEqual(
      expect.arrayContaining(["connection: connected", "Models: ok (12 models)", "Rate limits: failed - rate limit request failed"]),
    );
    expect(rows.find((row) => row.label === "Rate limits")?.level).toBe("error");
    expect(rows.find((row) => row.label === "Skills")).toBeUndefined();
    expect(rows.find((row) => row.label === "MCP servers")).toBeUndefined();
    expect(rows.find((row) => row.label === "mcp github")).toBeUndefined();
  });

  it("distinguishes unavailable plugins from last known inventory after a failed read", () => {
    const inventory: ToolInventorySnapshot = {
      plugins: null,
      pluginsError: "marketplace unavailable",
      mcpServers: [],
      mcpDiagnostics: [],
      mcpError: null,
    };
    const sections = (value: ToolInventorySnapshot) =>
      toolInventoryDiagnosticSections(value, {
        value: [],
        probe: diagnosticProbeOk("0 skills", 1),
      }).find((section) => section.title === "Plugins")?.rows;
    expect(sections(inventory)).toEqual([
      { label: "Refresh", value: "marketplace unavailable", level: "error" },
      { label: "Plugins", value: "not loaded", level: "warning" },
    ]);
    expect(sections({ ...inventory, plugins: [] })).toEqual([
      { label: "Refresh", value: "marketplace unavailable", level: "error" },
      { label: "Plugins", value: "showing last known inventory", level: "warning" },
      { label: "Plugins", value: "(none)" },
    ]);
  });

  it("summarizes usable Codex capabilities and groups skills by provenance", () => {
    const skills = [
      skillFixture("codex-panel-local", "repo"),
      skillFixture("jujutsu-agent-workflow", "user"),
      skillFixture("openai-docs", "system"),
      skillFixture("github:gh-fix-ci", "user", "usable-plugin"),
      skillFixture("github:github", "user", "usable-plugin"),
      skillFixture("gmail:gmail", "user", "disabled-plugin", false),
      skillFixture("admin:guidance", "admin"),
      skillFixture("writer", "user", "unversioned-plugin"),
    ];
    const inventory: InventoryFixture = {
      plugins: [
        {
          id: "usable-plugin",
          name: "usable-bundle",
          displayName: "Usable Plugin",
          marketplaceName: "personal",
          marketplacePath: null,
          localVersion: "1.2.3",
          installed: true,
          enabled: true,
          availability: "AVAILABLE",
          source: "remote",
        },
        {
          id: "installable-plugin",
          name: "installable-plugin",
          displayName: "Installable Plugin",
          marketplaceName: "directory",
          marketplacePath: null,
          localVersion: null,
          installed: false,
          enabled: true,
          availability: "AVAILABLE",
          source: "remote",
        },
        {
          id: "disabled-plugin",
          name: "disabled-plugin",
          displayName: "Disabled Plugin",
          marketplaceName: "personal",
          marketplacePath: null,
          localVersion: "2.0.0",
          installed: true,
          enabled: false,
          availability: "AVAILABLE",
          source: "remote",
        },
        {
          id: "unversioned-plugin",
          name: "unversioned-bundle",
          displayName: "Usable Plugin",
          marketplaceName: "personal",
          marketplacePath: null,
          localVersion: null,
          installed: true,
          enabled: true,
          availability: "AVAILABLE",
          source: "remote",
        },
      ],
      pluginsError: null,
      mcpServers: [
        {
          name: "codex_apps",
          authStatus: "oAuth",
          toolCount: 219,
          toolDiscoveryFailed: false,
          connectionStatus: "connected",
          codexAppIds: ["apple_music", "github", "google_drive"],
        },
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 2,
          toolDiscoveryFailed: false,
          connectionStatus: "connected",
        },
      ],
      mcpDiagnostics: [
        {
          name: "codex_apps",
          connectionStatus: "connected",
          authStatus: "oAuth",
          toolCount: 219,
          message: null,
          authenticationIssue: null,
        },
        {
          name: "github",
          connectionStatus: "connected",
          authStatus: "oAuth",
          toolCount: 2,
          message: null,
          authenticationIssue: null,
        },
      ],
      mcpError: null,
    };

    const sections = toolInventoryDiagnosticSections(inventory, {
      value: skills,
      probe: diagnosticProbeOk("8 skills", 1),
    });
    const pluginRows = sections.find((section) => section.title === "Plugins")?.rows ?? [];
    const toolProviderRows = sections.find((section) => section.title === "Tool providers")?.rows ?? [];
    const skillRows = sections.find((section) => section.title === "Skills")?.rows ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Plugins", "Tool providers", "Skills"]);
    expect(pluginRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Usable Plugin: version 1.2.3",
      "Usable Plugin: version unknown",
    ]);
    expect(toolProviderRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "codex_apps: apple_music, github, google_drive",
      "github: MCP server, connected, auth OAuth, 2 tools",
    ]);
    expect(skillRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Workspace: codex-panel-local",
      "Personal: jujutsu-agent-workflow",
      "System: openai-docs",
      "Admin: admin:guidance",
      "Usable Plugin: github:gh-fix-ci, github:github",
      "Usable Plugin: writer",
    ]);
    const skillRowsFor = (value: ToolInventorySnapshot | null) =>
      toolInventoryDiagnosticSections(value, { value: skills, probe: diagnosticProbeOk("8 skills", 1) })
        .find((section) => section.title === "Skills")
        ?.rows.slice(-2);
    const fallbackRows = [
      { label: "unversioned-plugin", value: "writer" },
      { label: "usable-plugin", value: "github:gh-fix-ci, github:github" },
    ];
    expect(skillRowsFor(null)).toEqual(fallbackRows);
    expect(skillRowsFor({ ...inventory, pluginsError: "offline" })).toEqual(skillRows.slice(-2));
    expect(skillRowsFor({ ...inventory, plugins: inventory.plugins?.map((plugin) => ({ ...plugin, displayName: null })) ?? [] })).toEqual([
      { label: "unversioned-bundle", value: "writer" },
      { label: "usable-bundle", value: "github:gh-fix-ci, github:github" },
    ]);
  });

  it("shows plugin and MCP refresh failures", () => {
    const sections = toolInventoryDiagnosticSections(
      {
        plugins: [],
        pluginsError: "plugins offline",
        mcpServers: [],
        mcpDiagnostics: [],
        mcpError: "MCP offline",
      },
      { value: [], probe: createServerDiagnostics().probes.skills },
    );

    expect(sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rows: expect.arrayContaining([{ label: "Refresh", value: "plugins offline", level: "error" }]) }),
        expect.objectContaining({ rows: expect.arrayContaining([{ label: "Refresh", value: "MCP offline", level: "error" }]) }),
      ]),
    );
  });

  it("projects Codex capabilities from the latest diagnostic snapshot", () => {
    const inventory: InventoryFixture = {
      plugins: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 1,
          toolDiscoveryFailed: false,
          connectionStatus: null,
        },
      ],
      mcpDiagnostics: [
        {
          name: "github",
          connectionStatus: "connected",
          authStatus: null,
          toolCount: null,
          message: null,
          authenticationIssue: null,
        },
      ],
      mcpError: null,
    };
    const mcpRows =
      toolInventoryDiagnosticSections(inventory, {
        value: [],
        probe: diagnosticProbeOk("0 skills", 1),
      }).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual(["github: MCP server, connected, auth OAuth, 1 tool"]);
  });

  it.each(["github", "codex_apps"])("distinguishes discovery errors from empty catalogs for %s without highlighting", (name) => {
    const rowsFor = (toolsError: string | null) =>
      toolInventoryDiagnosticSections(
        {
          plugins: [],
          pluginsError: null,
          mcpServers: mcpServerStatusSummariesFromStatuses([
            { name, runtimeStatus: "connected", authStatus: "oAuth", tools: {}, toolsError },
          ]),
          mcpDiagnostics: [],
          mcpError: null,
        },
        { value: [], probe: diagnosticProbeOk("0 skills", 1) },
      ).find((section) => section.title === "Tool providers")?.rows;

    expect(rowsFor("Tool listing failed")).toEqual([
      { label: name, value: "MCP server, connected, auth OAuth, tool discovery failed", level: "normal" },
    ]);
    expect(rowsFor(null)).toEqual([
      { label: name, value: name === "codex_apps" ? "(none)" : "MCP server, connected, auth OAuth, 0 tools", level: "normal" },
    ]);
  });

  it("keeps inventory auth and zero tool counts when connection diagnostics disagree", () => {
    const sections = toolInventoryDiagnosticSections(
      {
        plugins: [],
        pluginsError: null,
        mcpServers: [{ name: "github", authStatus: "oAuth", toolCount: 0, toolDiscoveryFailed: false, connectionStatus: "connected" }],
        mcpDiagnostics: [
          {
            name: "github",
            connectionStatus: "failed",
            authStatus: "notLoggedIn",
            toolCount: 10,
            message: "connection lost",
            authenticationIssue: null,
          },
        ],
        mcpError: null,
      },
      { value: [], probe: diagnosticProbeOk("0 skills", 1) },
    );

    expect(sections.find((section) => section.title === "Tool providers")?.rows).toEqual([
      { label: "github", value: "MCP server, failed, auth OAuth, 0 tools, connection lost", level: "error" },
    ]);
  });

  it("keeps diagnostic-only MCP server failures in MCP servers", () => {
    const inventory: InventoryFixture = {
      plugins: [],
      pluginsError: null,
      mcpServers: [],
      mcpDiagnostics: [
        {
          name: "figma",
          connectionStatus: "failed",
          authStatus: null,
          toolCount: null,
          message: "command not found",
          authenticationIssue: "reauthenticationRequired",
        },
      ],
      mcpError: null,
    };

    const mcpRows =
      toolInventoryDiagnosticSections(inventory, {
        value: [],
        probe: diagnosticProbeOk("0 skills", 1),
      }).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "figma: MCP server, failed, auth unknown, tools unknown, re-authentication required, command not found",
    ]);
    expect(mcpRows.find((row) => row.label === "figma")?.level).toBe("error");
  });

  it("keeps codex app provider failures visible alongside the app inventory", () => {
    const inventory: InventoryFixture = {
      plugins: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "codex_apps",
          authStatus: "notLoggedIn",
          toolCount: 2,
          toolDiscoveryFailed: false,
          connectionStatus: "authenticationRequired",
          codexAppIds: ["github", "google_drive"],
        },
      ],
      mcpDiagnostics: [
        {
          name: "codex_apps",
          connectionStatus: "authenticationRequired",
          authStatus: "notLoggedIn",
          toolCount: 2,
          message: "OAuth token expired",
          authenticationIssue: "reauthenticationRequired",
        },
      ],
      mcpError: null,
    };

    const rows =
      toolInventoryDiagnosticSections(inventory, {
        value: [],
        probe: diagnosticProbeOk("0 skills", 1),
      }).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(rows).toEqual([
      {
        label: "codex_apps",
        value: "github, google_drive, authentication required, auth not logged in, re-authentication required, OAuth token expired",
        level: "warning",
      },
    ]);
  });
});
