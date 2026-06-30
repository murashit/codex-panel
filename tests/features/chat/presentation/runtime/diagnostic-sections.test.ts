import { describe, expect, it } from "vitest";

import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
  upsertMcpServerStatusDiagnostics,
} from "../../../../../src/domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { appServerDiagnosticSections } from "../../../../../src/features/chat/presentation/runtime/diagnostic-sections";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/presentation/runtime/tool-inventory-diagnostic-sections";

function diagnosticsWithToolInventory(inventory: ToolInventorySnapshot) {
  let diagnostics = createServerDiagnostics();
  for (const server of inventory.mcpDiagnostics) {
    diagnostics = upsertMcpServerDiagnostic(diagnostics, server);
  }
  return { ...diagnostics, toolInventory: inventory };
}

describe("connection diagnostics", () => {
  it("formats connection rows and runtime checks for /doctor", () => {
    let diagnostics = createServerDiagnostics();
    diagnostics = diagnosticsWithProbe(diagnostics, diagnosticProbeOk("models", "12 models", 1));
    diagnostics = diagnosticsWithProbe(diagnostics, diagnosticProbeError("rateLimits", new Error("rate limit request failed"), 2));
    diagnostics = diagnosticsWithProbe(diagnostics, diagnosticProbeError("skills", new Error("unknown method skills/list"), 3));
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

  it("summarizes usable Codex capabilities and groups skills by provenance", () => {
    const inventory: ToolInventorySnapshot = {
      checkedAt: 1,
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
          resourceCount: 0,
          resourceTemplateCount: 0,
          codexAppIds: ["apple_music", "github", "google_drive"],
        },
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 2,
          resourceCount: 0,
          resourceTemplateCount: 0,
        },
      ],
      mcpDiagnostics: [
        {
          name: "codex_apps",
          startupStatus: "ready",
          authStatus: "oAuth",
          toolCount: 219,
          message: null,
        },
        {
          name: "github",
          startupStatus: "ready",
          authStatus: "oAuth",
          toolCount: 2,
          message: null,
        },
      ],
      mcpError: null,
      skills: [
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
      ],
      skillsError: null,
    };

    const sections = toolInventoryDiagnosticSections(diagnosticsWithToolInventory(inventory));
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
      "github: MCP server, ready, auth oAuth, 2 tools, 0 resources",
    ]);
    expect(skillRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "codex-panel: codex-panel-local",
      "Personal: jujutsu-agent-workflow",
      "System: openai-docs",
      "GitHub: gh-fix-ci, github",
    ]);
  });

  it("projects Codex capabilities from the latest diagnostic snapshot", () => {
    const inventory: ToolInventorySnapshot = {
      checkedAt: 1,
      plugins: [],
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 1,
          resourceCount: 0,
          resourceTemplateCount: 0,
        },
      ],
      mcpDiagnostics: [],
      mcpError: null,
      skills: [],
      skillsError: null,
    };
    let diagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });
    diagnostics = {
      ...diagnostics,
      toolInventory: inventory,
    };

    const mcpRows = toolInventoryDiagnosticSections(diagnostics).find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual(["github: MCP server, ready, auth oAuth, 1 tool, 0 resources"]);
  });

  it("keeps diagnostic-only MCP server failures in MCP servers", () => {
    const inventory: ToolInventorySnapshot = {
      checkedAt: 1,
      plugins: [],
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [],
      mcpDiagnostics: [
        {
          name: "figma",
          startupStatus: "failed",
          authStatus: null,
          toolCount: null,
          message: "command not found",
        },
      ],
      mcpError: null,
      skills: [],
      skillsError: null,
    };

    const mcpRows =
      toolInventoryDiagnosticSections(diagnosticsWithToolInventory(inventory)).find((section) => section.title === "Tool providers")
        ?.rows ?? [];

    expect(mcpRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "figma: MCP server, failed, auth unknown, tools unknown, command not found",
    ]);
    expect(mcpRows.find((row) => row.label === "figma")?.level).toBe("error");
  });
});
