import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { executeSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute";
import type { SlashCommandExecutionContext } from "../../../../../src/features/chat/application/slash-commands/execution-contracts";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { slashRuntimeSettingsFixture, slashSubmissionFixture, slashThreadCommandsFixture } from "../../support/slash-command-ports";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    submission: slashSubmissionFixture(),
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    referThread: vi.fn().mockResolvedValue({ text: "referenced", input: [{ type: "text", text: "referenced" }] }),
    readWebUrl: vi.fn(),
    threadCommands: slashThreadCommandsFixture(),
    reconnect: vi.fn().mockResolvedValue(undefined),
    openSideChat: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    runtimeSettings: slashRuntimeSettingsFixture(),
    goals: { activeGoal: vi.fn(() => null), setObjective: vi.fn(), setStatus: vi.fn(), clear: vi.fn() },
    statusDetails: () => [],
    permissionDetails: () => [],
    connectionDiagnosticDetails: () => [],
    toolInventoryDetails: () => [],
    modelStatusDetails: () => [],
    effortStatusDetails: () => [],
    ...overrides,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return panelThreadFixture({
    id: "thread-1",
    preview: "Preview",
    ...overrides,
  });
}
describe("slash command validation and routing", () => {
  it("rejects arguments for a no-argument command from catalog metadata", async () => {
    const ctx = context();

    await executeSlashCommand("status", "unexpected", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/status does not take arguments. Usage: /status");
  });

  it("rejects /refer without both thread and message", async () => {
    const ctx = context();

    await executeSlashCommand("refer", "thread-2", ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/refer requires a thread and a message. Usage: /refer <thread> <message>");
  });

  it("rejects /web without a URL", async () => {
    const ctx = context();

    await executeSlashCommand("web", "", ctx);

    expect(ctx.readWebUrl).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/web requires a URL. Usage: /web <url> [message]");
  });

  it("rejects bare /archive", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.threadCommands.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("rejects /rename without a thread and name", async () => {
    const ctx = context();

    await executeSlashCommand("rename", "thread-1", ctx);

    expect(ctx.threadCommands.renameThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rename requires a thread and a name. Usage: /rename <thread> <name>");
  });

  it("resumes the latest listed thread for bare /resume", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "latest", name: "Latest" }), thread({ id: "older", name: "Older" })],
    });

    await executeSlashCommand("resume", "", ctx);

    expect(ctx.submission.adoptPanelTarget).toHaveBeenCalledOnce();
    expect(ctx.resumeThread).toHaveBeenCalledWith("latest");
  });

  it("toggles Plan mode without sending text for bare /plan", async () => {
    const ctx = context();

    const result = await executeSlashCommand("plan", "", ctx);

    expect(ctx.runtimeSettings.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });
});
