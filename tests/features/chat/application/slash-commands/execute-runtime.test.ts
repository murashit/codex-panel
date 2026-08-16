import { describe, expect, it, vi } from "vitest";

import { slashCommandHelpSections } from "../../../../../src/features/chat/application/slash-commands/catalog";
import { executeRuntimeSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-runtime";

type RuntimeContext = Parameters<typeof executeRuntimeSlashCommand>[2];

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    submission: { isCurrent: vi.fn(() => true), markAdopted: vi.fn(), adoptPanelTarget: vi.fn() },
    runtimeSettings: {
      toggleFastMode: vi.fn(),
      toggleCollaborationMode: vi.fn(),
      toggleAutoReview: vi.fn(),
      requestModel: vi.fn(),
      resetModelToConfig: vi.fn(),
      requestPermissionProfile: vi.fn(),
      resetPermissionProfileToConfig: vi.fn(),
      requestReasoningEffort: vi.fn(),
      resetReasoningEffortToConfig: vi.fn(),
    },
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    statusDetails: () => [{ auditFacts: [{ key: "Thread", value: "thread-1" }] }],
    permissionDetails: () => [{ title: "Permissions", auditFacts: [{ key: "Profile", value: "read-only" }] }],
    connectionDiagnosticDetails: () => [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }],
    toolInventoryDetails: vi.fn(() => [{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] }]),
    modelStatusDetails: () => [{ auditFacts: [{ key: "Model", value: "gpt-5.5" }] }],
    effortStatusDetails: () => [{ auditFacts: [{ key: "Effort", value: "high" }] }],
    ...overrides,
  };
}

describe("runtime slash commands", () => {
  it("returns message text after toggling Plan mode for /plan arguments", async () => {
    const ctx = context();

    const result = await executeRuntimeSlashCommand("plan", "OK、実装してください", ctx);

    expect(ctx.runtimeSettings.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "OK、実装してください" });
  });

  it("toggles auto-review without sending text for bare /auto-review", async () => {
    const ctx = context();

    const result = await executeRuntimeSlashCommand("auto-review", "", ctx);

    expect(ctx.runtimeSettings.toggleAutoReview).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("shows slash command help as a structured system result", async () => {
    const ctx = context();

    await executeRuntimeSlashCommand("help", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Available slash commands", slashCommandHelpSections());
  });

  it("shows status as a structured system result", async () => {
    const details = [
      {
        auditFacts: [
          { key: "Thread", value: "thread-1" },
          { key: "Usage Limits", value: "5h 42%" },
        ],
      },
    ];
    const ctx = context({ statusDetails: () => details });

    await executeRuntimeSlashCommand("status", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Thread status", details);
  });

  it("shows permissions and approvals as shared structured sections", async () => {
    const details = [
      { title: "Permissions", auditFacts: [{ key: "Profile", value: "workspace-write" }] },
      { title: "Approvals", auditFacts: [{ key: "Auto review", value: "on" }] },
    ];
    const ctx = context({ permissionDetails: () => details });

    await executeRuntimeSlashCommand("permissions", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Permissions & Approvals", details);
  });

  it("sets the permission profile for /permissions arguments", async () => {
    const ctx = context();

    await executeRuntimeSlashCommand("permissions", ":workspace", ctx);

    expect(ctx.addStructuredSystemMessage).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestPermissionProfile).toHaveBeenCalledWith(":workspace");
    expect(ctx.runtimeSettings.resetPermissionProfileToConfig).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Permission profile set to :workspace for subsequent turns.");
  });

  it("routes default permission profile through reset", async () => {
    const ctx = context();

    await executeRuntimeSlashCommand("permissions", "default", ctx);

    expect(ctx.runtimeSettings.resetPermissionProfileToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.requestPermissionProfile).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Permission profile reset to default for subsequent turns.");
  });

  it("does not announce permission profile changes when applying them fails", async () => {
    const ctx = context();
    ctx.runtimeSettings.requestPermissionProfile = vi.fn().mockResolvedValue(false);

    await executeRuntimeSlashCommand("permissions", ":workspace", ctx);

    expect(ctx.runtimeSettings.requestPermissionProfile).toHaveBeenCalledWith(":workspace");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("shows doctor diagnostics as shared structured sections", async () => {
    const details = [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }];
    const ctx = context({ connectionDiagnosticDetails: () => details });

    await executeRuntimeSlashCommand("doctor", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Connection diagnostics", details);
  });

  it("does not announce model or effort changes when applying them fails", async () => {
    const ctx = context();
    ctx.runtimeSettings.requestModel = vi.fn().mockResolvedValue(false);
    ctx.runtimeSettings.requestReasoningEffort = vi.fn().mockResolvedValue(false);

    await executeRuntimeSlashCommand("model", "gpt-5.5", ctx);
    await executeRuntimeSlashCommand("reasoning", "high", ctx);

    expect(ctx.runtimeSettings.requestModel).toHaveBeenCalledWith("gpt-5.5");
    expect(ctx.runtimeSettings.requestReasoningEffort).toHaveBeenCalledWith("high");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("routes default model and reasoning overrides through reset commands", async () => {
    const ctx = context();

    await executeRuntimeSlashCommand("model", "default", ctx);
    await executeRuntimeSlashCommand("reasoning", "default", ctx);

    expect(ctx.runtimeSettings.resetModelToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.resetReasoningEffortToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Model reset to default for subsequent turns.");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Reasoning effort reset to default for subsequent turns.");
  });

  it("shows model and reasoning status for empty runtime commands", async () => {
    const modelDetails = [{ auditFacts: [{ key: "Model", value: "gpt-5.5" }] }];
    const effortDetails = [{ auditFacts: [{ key: "Effort", value: "high" }] }];
    const ctx = context({
      modelStatusDetails: () => modelDetails,
      effortStatusDetails: () => effortDetails,
    });

    await executeRuntimeSlashCommand("model", "", ctx);
    await executeRuntimeSlashCommand("reasoning", "", ctx);

    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Model settings", modelDetails);
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Reasoning effort", effortDetails);
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
  });

  it("preserves explicit reasoning effort casing", async () => {
    const ctx = context();

    await executeRuntimeSlashCommand("reasoning", "CaseSensitive", ctx);

    expect(ctx.runtimeSettings.requestReasoningEffort).toHaveBeenCalledWith("CaseSensitive");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Reasoning effort set to CaseSensitive for subsequent turns.");
  });

  it("shows Codex capabilities", async () => {
    const toolInventoryDetails = vi
      .fn()
      .mockResolvedValue([{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] }]);
    const ctx = context({ toolInventoryDetails });

    await executeRuntimeSlashCommand("tools", "", ctx);

    expect(toolInventoryDetails).toHaveBeenCalledOnce();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] },
    ]);
  });

  it("toggles fast mode without sending text", async () => {
    const ctx = context();

    const result = await executeRuntimeSlashCommand("fast", "", ctx);

    expect(ctx.runtimeSettings.toggleFastMode).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });
});
