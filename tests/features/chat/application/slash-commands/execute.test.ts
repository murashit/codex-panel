import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { executeSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute";
import type { SlashCommandExecutionContext } from "../../../../../src/features/chat/application/slash-commands/execution-contracts";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    submission: { isCurrent: vi.fn(() => true), markAdopted: vi.fn(), adoptPanelTarget: vi.fn() },
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    referThread: vi.fn().mockResolvedValue({ text: "referenced", input: [{ type: "text", text: "referenced" }] }),
    readWebUrl: vi.fn().mockResolvedValue({
      text: "https://example.com/article 要約して",
      input: [
        { type: "text", text: "https://example.com/article 要約して" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
      ],
    }),
    threadCommands: {
      forkThread: vi.fn().mockResolvedValue(undefined),
      rollbackThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      renameThread: vi.fn().mockResolvedValue(true),
    },
    reconnect: vi.fn().mockResolvedValue(undefined),
    openSideChat: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
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
  return {
    id: "thread-1",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
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
