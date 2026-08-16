import { describe, expect, it, vi } from "vitest";

import type { Thread } from "../../../../../src/domain/threads/model";
import { executeThreadSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-thread";

type ThreadContext = Parameters<typeof executeThreadSlashCommand>[2];

function context(overrides: Partial<ThreadContext> = {}): ThreadContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    submission: { isCurrent: vi.fn(() => true), markAdopted: vi.fn(), adoptPanelTarget: vi.fn() },
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    threadCommands: {
      forkThread: vi.fn().mockResolvedValue(undefined),
      rollbackThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      renameThread: vi.fn().mockResolvedValue(true),
    },
    openSideChat: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
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
describe("thread slash commands", () => {
  it("resumes a thread by title argument without accepting ids", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeThreadSlashCommand("resume", "Beta", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-beta");

    await executeThreadSlashCommand("resume", "thread-alpha", ctx);
    expect(ctx.resumeThread).toHaveBeenCalledOnce();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No matching thread: thread-alpha");
  });

  it("uses a completed thread target before falling back to normal title search", async () => {
    const sharedPrefix = "x".repeat(100);
    const completedTitle = `${"x".repeat(93)}...`;
    const target = thread({ id: "target", name: null, preview: `${sharedPrefix} target` });
    const other = thread({ id: "other", name: null, preview: `${sharedPrefix} other` });
    const ctx = context({
      listedThreads: [other, target],
      threadCommandTarget: { command: "resume", threadId: "target", title: completedTitle },
    });

    await executeThreadSlashCommand("resume", `"${completedTitle}"`, ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("target");

    const directInput = context({ listedThreads: [other, target] });
    await executeThreadSlashCommand("resume", `"${completedTitle}"`, directInput);
    expect(directInput.resumeThread).not.toHaveBeenCalled();
    expect(directInput.addSystemMessage).toHaveBeenCalledWith(`No matching thread: ${completedTitle}`);
  });

  it("resolves an exact title before another title with the same prefix", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeThreadSlashCommand("resume", "Draft", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-alpha");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("resolves a stronger ranked resume match before looser title matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha plan" }), thread({ id: "thread-beta", name: "Older Alpha plan" })],
    });

    await executeThreadSlashCommand("resume", "alpha", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-alpha");
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("Multiple matching threads: Alpha plan (thread-a), Older Alpha plan (thread-b)");
  });

  it("forks the active thread for /fork", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeThreadSlashCommand("fork", "", ctx);

    expect(ctx.submission.markAdopted).toHaveBeenCalledOnce();
    expect(ctx.threadCommands.forkThread).toHaveBeenCalledWith("active-thread");
    expect(vi.mocked(ctx.submission.markAdopted).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.threadCommands.forkThread).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("opens a side chat from the active thread", async () => {
    const openSideChat = vi.fn().mockResolvedValue(undefined);
    const ctx = context({ activeThreadId: "active-thread", openSideChat });

    await executeThreadSlashCommand("btw", "", ctx);

    expect(openSideChat).toHaveBeenCalledWith("active-thread");
  });

  it("passes an optional initial message to the side chat", async () => {
    const openSideChat = vi.fn().mockResolvedValue(undefined);
    const ctx = context({ activeThreadId: "active-thread", openSideChat });

    await executeThreadSlashCommand("btw", "Explain this briefly", ctx);

    expect(openSideChat).toHaveBeenCalledWith("active-thread", "Explain this briefly");
  });

  it("rolls back the active thread for /rollback", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeThreadSlashCommand("rollback", "", ctx);

    expect(ctx.threadCommands.rollbackThread).toHaveBeenCalledWith("active-thread", {
      adoptPanelTarget: expect.any(Function),
    });
  });

  it("rejects /rollback without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeThreadSlashCommand("rollback", "", ctx);

    expect(ctx.threadCommands.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No active thread to roll back.");
  });

  it("archives a selected thread by quoted title", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("archive", '"Beta thread"', ctx);

    expect(ctx.threadCommands.archiveThread).toHaveBeenCalledWith("thread-beta", undefined, undefined);
    expect(ctx.submission.adoptPanelTarget).not.toHaveBeenCalled();
  });

  it("adopts the panel target only when archiving the active thread is published", async () => {
    const archiveThread = vi.fn(async (_threadId, _saveMarkdown, afterArchive) => {
      afterArchive?.();
    });
    const ctx = context({
      threadCommands: {
        ...context().threadCommands,
        archiveThread,
      },
    });

    await executeThreadSlashCommand("archive", '"Current"', ctx);

    expect(archiveThread).toHaveBeenCalledWith("thread-1", undefined, expect.any(Function));
    expect(ctx.submission.adoptPanelTarget).toHaveBeenCalledOnce();
  });

  it("renames a selected thread by quoted title", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("rename", '"Beta thread" New Beta Name', ctx);

    expect(ctx.threadCommands.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });

  it("trims /rename names before saving", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("rename", '"Beta thread"   New Beta Name   ', ctx);

    expect(ctx.threadCommands.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });
});
