import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../src/generated/app-server/v2/Thread";
import { executeSlashCommand, slashCommandHelpLines, type SlashCommandExecutionContext } from "../src/panel/slash-commands";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    busy: false,
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    compactThread: vi.fn().mockResolvedValue(undefined),
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    addSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setRequestedModel: vi.fn(),
    setRequestedReasoningEffort: vi.fn(),
    statusSummaryLines: () => ["status"],
    connectionDiagnosticLines: () => ["doctor"],
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

  it("forks the active thread for /fork", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("fork", "", ctx);

    expect(ctx.forkThread).toHaveBeenCalledWith("active-thread");
  });

  it("rejects /fork arguments", async () => {
    const ctx = context();

    await executeSlashCommand("fork", "anything", ctx);

    expect(ctx.forkThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Unsupported slash command arguments: anything");
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
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Unsupported slash command arguments: 2");
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

  it("keeps /compact behavior unchanged", async () => {
    const ctx = context();

    await executeSlashCommand("compact", "ignored for now", ctx);

    expect(ctx.compactThread).toHaveBeenCalledWith("thread-1");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
  });

  it("documents that /plan can take a message", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/plan"))).toBe(
      "/plan - Toggle Plan mode, optionally sending a message.",
    );
  });

  it("documents rollback", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/rollback"))).toBe(
      "/rollback - Drop the latest turn and restore its prompt to the composer.",
    );
  });

  it("documents status and doctor as separate commands", () => {
    expect(slashCommandHelpLines().find((line) => line.startsWith("/status"))).toBe(
      "/status - Show current session, context, and usage limits.",
    );
    expect(slashCommandHelpLines().find((line) => line.startsWith("/doctor"))).toBe(
      "/doctor - Show Codex CLI and app-server connection diagnostics.",
    );
  });
});
