import { describe, expect, it } from "vitest";
import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import {
  createServerDiagnostics,
  type DiagnosticProbeResult,
  type Diagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/server/diagnostics";
import type { McpServerDiagnostic } from "../../../../../src/domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { appServerDiagnosticSections } from "../../../../../src/features/chat/host/runtime/diagnostics";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/host/runtime/tool-inventory";

type InventoryFixture = ToolInventorySnapshot;

function withProbe(diagnostics: Diagnostics, probe: DiagnosticProbeResult): Diagnostics {
  return { ...diagnostics, probes: { ...diagnostics.probes, [probe.id]: probe } };
}

function withMcpDiagnostic(diagnostics: Diagnostics, server: McpServerDiagnostic): Diagnostics {
  return { ...diagnostics, mcpServers: upsertMcpServerDiagnostic(diagnostics.mcpServers, server) };
}

describe("connection diagnostics", () => {
  it("formats connection rows and runtime checks for /doctor", () => {
    let diagnostics = createServerDiagnostics();
    diagnostics = withProbe(diagnostics, diagnosticProbeOk("models", "12 models", 1));
    diagnostics = withProbe(diagnostics, diagnosticProbeError("rateLimits", new Error("rate limit request failed"), 2));
    diagnostics = withProbe(diagnostics, diagnosticProbeError("skills", new Error("unknown method skills/list"), 3));
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
        codexHome: "/Users/showhey/.codex",
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

  it("summarizes usable Codex capabilities and groups skills by provenance", () => {
    const skills = [
      {
        name: "codex-panel-local",
        description: "Local panel skill",
        path: "/Users/showhey/Repos/github.com/murashit/codex-panel/.codex/skills/codex-panel-local/SKILL.md",
        enabled: true,
      },
      {
        name: "jujutsu-agent-workflow",
        description: "Personal skill",
        path: "/Users/showhey/.agents/skills/jujutsu-agent-workflow/SKILL.md",
        enabled: true,
      },
      {
        name: "openai-docs",
        description: "System skill",
        path: "/Users/showhey/.codex/skills/.system/openai-docs/SKILL.md",
        enabled: true,
      },
      {
        name: "github:gh-fix-ci",
        description: "GitHub CI skill",
        path: "/Users/showhey/.codex/plugins/cache/openai-curated-remote/github/0.1.5/skills/gh-fix-ci/SKILL.md",
        enabled: true,
      },
      {
        name: "github:github",
        description: "GitHub skill",
        path: "/Users/showhey/.codex/plugins/cache/openai-curated-remote/github/0.1.5/skills/github/SKILL.md",
        enabled: true,
      },
      {
        name: "gmail:gmail",
        description: "Disabled skill",
        path: "/Users/showhey/.codex/plugins/cache/openai-curated-remote/gmail/0.1.3/skills/gmail/SKILL.md",
        enabled: false,
      },
    ] satisfies readonly SkillMetadata[];
    const inventory: InventoryFixture = {
      plugins: [
        {
          id: "usable-plugin",
          name: "usable-plugin",
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
          name: "unversioned-plugin",
          displayName: "Unversioned Plugin",
          marketplaceName: "personal",
          marketplacePath: null,
          localVersion: null,
          installed: true,
          enabled: true,
          availability: "AVAILABLE",
          source: "remote",
        },
      ],
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "codex_apps",
          authStatus: "oAuth",
          toolCount: 219,
          connectionStatus: "connected",
          codexAppIds: ["apple_music", "github", "google_drive"],
        },
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 2,
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
      probe: diagnosticProbeOk("skills", "6 skills", 1),
    });
    const pluginRows = sections.find((section) => section.title === "Plugins")?.rows ?? [];
    const toolProviderRows = sections.find((section) => section.title === "Tool providers")?.rows ?? [];
    const skillRows = sections.find((section) => section.title === "Skills")?.rows ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Plugins", "Tool providers", "Skills"]);
    expect(pluginRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "Usable Plugin: version 1.2.3",
      "Unversioned Plugin: version unknown",
    ]);
    expect(toolProviderRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "codex_apps: apple_music, github, google_drive",
      "github: MCP server, connected, auth OAuth, 2 tools",
    ]);
    expect(skillRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "codex-panel: codex-panel-local",
      "Personal: jujutsu-agent-workflow",
      "System: openai-docs",
      "GitHub: gh-fix-ci, github",
    ]);
  });

  it("keeps last-known tool inventory visible with refresh failures", () => {
    const sections = toolInventoryDiagnosticSections(
      {
        plugins: [],
        pluginMarketplaceErrors: [],
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
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 1,
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
        probe: diagnosticProbeOk("skills", "0 skills", 1),
      }).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual(["github: MCP server, connected, auth OAuth, 1 tool"]);
  });

  it("keeps diagnostic-only MCP server failures in MCP servers", () => {
    const inventory: InventoryFixture = {
      plugins: [],
      pluginMarketplaceErrors: [],
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
        probe: diagnosticProbeOk("skills", "0 skills", 1),
      }).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "figma: MCP server, failed, auth unknown, tools unknown, re-authentication required, command not found",
    ]);
    expect(mcpRows.find((row) => row.label === "figma")?.level).toBe("error");
  });

  it("keeps codex app provider failures visible alongside the app inventory", () => {
    const inventory: InventoryFixture = {
      plugins: [],
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "codex_apps",
          authStatus: "notLoggedIn",
          toolCount: 2,
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
        probe: diagnosticProbeOk("skills", "0 skills", 1),
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
