import { describe, expect, it, vi } from "vitest";

import { slashCommandHelpLines, slashCommandHelpRows } from "../../../../src/features/chat/composer/slash-commands";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";
import { executeSlashCommand, type SlashCommandExecutionContext } from "../../../../src/features/chat/slash-commands";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    busy: false,
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    referThread: vi.fn().mockResolvedValue({
      input: [{ type: "text", text: "referenced", text_elements: [] }],
      referencedThread: { threadId: "thread-2", title: "Referenced", includedTurns: 1, turnLimit: 20 },
    }),
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    compactThread: vi.fn().mockResolvedValue(undefined),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    toggleAutoReview: vi.fn(),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setRequestedModel: vi.fn(),
    setRequestedReasoningEffort: vi.fn(),
    statusSummaryLines: () => ["status"],
    connectionDiagnosticDetails: () => [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }],
    mcpStatusLines: vi.fn().mockResolvedValue(["mcp"]),
    modelStatusLines: () => ["model"],
    effortStatusLines: () => ["effort"],
    ...overrides,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    preview: "Preview",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    path: null,
    cwd: "/vault",
    cliVersion: "0.130.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  } as Thread;
}

describe("slash commands", () => {
  it("starts a new thread for /new", async () => {
    const ctx = context();

    await executeSlashCommand("new", "", ctx);

    expect(ctx.startNewThread).toHaveBeenCalledOnce();
  });

  it("returns message text after starting a new thread for /new arguments", async () => {
    const ctx = context();

    const result = await executeSlashCommand("new", "最初の依頼です", ctx);

    expect(ctx.startNewThread).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "最初の依頼です" });
  });

  it("resumes the latest listed thread for bare /resume", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "latest", name: "Latest" }), thread({ id: "older", name: "Older" })],
    });

    await executeSlashCommand("resume", "", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("latest");
  });

  it("resumes a thread by id argument", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("resume", "thread-beta", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-beta");
  });

  it("reports ambiguous resume matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeSlashCommand("resume", "Draft", ctx);

    expect(ctx.resumeThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Multiple matching threads: Draft, Draft notes");
  });

  it("returns referenced input for /refer", async () => {
    const target = thread({ id: "thread-alpha", name: "Alpha" });
    const input = [{ type: "text" as const, text: "context\n質問です", text_elements: [] }];
    const referencedThread = { threadId: "thread-alpha", title: "Alpha", includedTurns: 2, turnLimit: 20 };
    const ctx = context({
      listedThreads: [thread({ id: "thread-current", name: "Current" }), target],
      referThread: vi.fn().mockResolvedValue({ input, referencedThread }),
    });

    const result = await executeSlashCommand("refer", "thread-alpha 質問です", ctx);

    expect(ctx.referThread).toHaveBeenCalledWith(target, "質問です");
    expect(result).toEqual({ sendText: "質問です", sendInput: input, referencedThread });
  });

  it("rejects /refer without both thread and message", async () => {
    const ctx = context();

    await executeSlashCommand("refer", "thread-2", ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/refer requires a thread and a message. Usage: /refer <thread> <message>");
  });

  it("rejects /refer for the active thread", async () => {
    const ctx = context({
      activeThreadId: "thread-1",
      listedThreads: [thread({ id: "thread-1", name: "Current" })],
    });

    await executeSlashCommand("refer", "thread-1 続きです", ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Use the current thread directly instead of referencing it.");
  });

  it("forks the active thread for /fork", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("fork", "", ctx);

    expect(ctx.forkThread).toHaveBeenCalledWith("active-thread");
  });

  it("rejects /fork arguments", async () => {
    const ctx = context();

    await executeSlashCommand("fork", "anything", ctx);

    expect(ctx.forkThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/fork does not take arguments. Usage: /fork");
  });

  it("rolls back the active thread for /rollback", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.rollbackThread).toHaveBeenCalledWith("active-thread");
  });

  it("rejects /rollback without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No active thread to roll back.");
  });

  it("rejects /rollback while a turn is running", async () => {
    const ctx = context({ busy: true });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Interrupt the current turn before rolling back.");
  });

  it("rejects /rollback arguments", async () => {
    const ctx = context();

    await executeSlashCommand("rollback", "2", ctx);

    expect(ctx.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rollback does not take arguments. Usage: /rollback");
  });

  it("toggles Plan mode without sending text for bare /plan", async () => {
    const ctx = context();

    const result = await executeSlashCommand("plan", "", ctx);

    expect(ctx.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("returns message text after toggling Plan mode for /plan arguments", async () => {
    const ctx = context();

    const result = await executeSlashCommand("plan", "OK、実装してください", ctx);

    expect(ctx.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "OK、実装してください" });
  });

  it("toggles auto-review without sending text for bare /auto-review", async () => {
    const ctx = context();

    const result = await executeSlashCommand("auto-review", "", ctx);

    expect(ctx.toggleAutoReview).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("returns message text after toggling auto-review for /auto-review arguments", async () => {
    const ctx = context();

    const result = await executeSlashCommand("auto-review", "この依頼からお願いします", ctx);

    expect(ctx.toggleAutoReview).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "この依頼からお願いします" });
  });

  it("rejects /compact arguments", async () => {
    const ctx = context();

    await executeSlashCommand("compact", "ignored for now", ctx);

    expect(ctx.compactThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/compact does not take arguments. Usage: /compact");
  });

  it("rejects bare /archive", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("archives a selected thread by id argument", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("archive", "thread-beta", ctx);

    expect(ctx.archiveThread).toHaveBeenCalledWith("thread-beta");
  });

  it("rejects /archive without a thread before active-thread checks", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("rejects /archive while a turn is running", async () => {
    const ctx = context({ busy: true });

    await executeSlashCommand("archive", "thread-1", ctx);

    expect(ctx.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before archiving threads.");
  });

  it("reports ambiguous archive matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeSlashCommand("archive", "Draft", ctx);

    expect(ctx.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Multiple matching threads: Draft, Draft notes");
  });

  it("documents archive", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/archive"))).toBe(
      "/archive <thread> - Archive the selected Codex thread.",
    );
  });

  it("shows slash command help as a structured system result", async () => {
    const ctx = context();

    await executeSlashCommand("help", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Available slash commands", [{ rows: slashCommandHelpRows() }]);
  });

  it("rejects /help arguments", async () => {
    const ctx = context();

    await executeSlashCommand("help", "anything", ctx);

    expect(ctx.addStructuredSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/help does not take arguments. Usage: /help");
  });

  it("shows status as a structured system result", async () => {
    const ctx = context({ statusSummaryLines: () => ["Thread status", "Thread: thread-1", "Usage limits", "5h: 42%"] });

    await executeSlashCommand("status", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Thread status", [
      {
        rows: [
          { key: "Thread", value: "thread-1" },
          { key: "message", value: "Usage limits" },
          { key: "5h", value: "42%" },
        ],
      },
    ]);
  });

  it("rejects /status arguments", async () => {
    const ctx = context();

    await executeSlashCommand("status", "anything", ctx);

    expect(ctx.addStructuredSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/status does not take arguments. Usage: /status");
  });

  it("shows doctor diagnostics as shared structured sections", async () => {
    const details = [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }];
    const ctx = context({ connectionDiagnosticDetails: () => details });

    await executeSlashCommand("doctor", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Connection diagnostics", details);
  });

  it("rejects /doctor arguments", async () => {
    const details = [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }];
    const ctx = context({ connectionDiagnosticDetails: () => details });

    await executeSlashCommand("doctor", "anything", ctx);

    expect(ctx.addStructuredSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/doctor does not take arguments. Usage: /doctor");
  });

  it("documents that /plan can take a message", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/plan"))).toBe(
      "/plan [message] - Toggle Plan mode, optionally with a message.",
    );
  });

  it("documents that /auto-review can take a message", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/auto-review"))).toBe(
      "/auto-review [message] - Toggle approval auto-review, optionally with a message.",
    );
  });

  it("documents rollback", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/rollback"))).toBe(
      "/rollback - Roll back the latest turn and restore its prompt.",
    );
  });

  it("documents refer history size", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/refer"))).toBe(
      "/refer <thread> <message> - Send a message with recent turns from another non-archived thread.",
    );
  });

  it("documents status and doctor as separate commands", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/status"))).toBe(
      "/status - Show current thread, context, and usage limits.",
    );
    expect(slashCommandHelpLines().find((line) => line.startsWith("/doctor"))).toBe(
      "/doctor - Show Codex CLI and Codex App Server diagnostics.",
    );
  });

  it("rejects unsupported reasoning effort with usage", async () => {
    const ctx = context();

    await executeSlashCommand("effort", "extreme", ctx);

    expect(ctx.setRequestedReasoningEffort).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Unsupported effort: extreme. Usage: /effort [effort|default]");
  });

  it("shows MCP server status", async () => {
    const ctx = context();

    await executeSlashCommand("mcp", "", ctx);

    expect(ctx.mcpStatusLines).toHaveBeenCalledOnce();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("MCP servers", [{ rows: [] }]);
  });

  it("rejects /mcp arguments", async () => {
    const ctx = context();

    await executeSlashCommand("mcp", "enable github", ctx);

    expect(ctx.mcpStatusLines).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/mcp does not take arguments. Usage: /mcp");
  });

  it("rejects /fast arguments before toggling", async () => {
    const ctx = context();

    await executeSlashCommand("fast", "now", ctx);

    expect(ctx.toggleFastMode).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/fast does not take arguments. Usage: /fast");
  });

  it("documents MCP status", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/mcp"))).toBe("/mcp - Show MCP servers reported by Codex App Server.");
  });
});
