import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { executeThreadSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-thread";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { slashSubmissionFixture, slashThreadCommandsFixture } from "../../support/slash-command-ports";

type ThreadContext = Parameters<typeof executeThreadSlashCommand>[2];

function context(overrides: Partial<ThreadContext> = {}): ThreadContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    submission: slashSubmissionFixture(),
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    threadCommands: slashThreadCommandsFixture(),
    openSideChat: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
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
describe("thread slash commands", () => {
  it("resumes a thread by title argument without accepting ids", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeThreadSlashCommand("resume", "Beta", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledExactlyOnceWith("thread-beta");

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

    expect(ctx.resumeThread).toHaveBeenCalledExactlyOnceWith("target");

    const directInput = context({ listedThreads: [other, target] });
    await executeThreadSlashCommand("resume", `"${completedTitle}"`, directInput);
    expect(directInput.resumeThread).not.toHaveBeenCalled();
    expect(directInput.addSystemMessage).toHaveBeenCalledWith(`No matching thread: ${completedTitle}`);
  });

  it("forks the active thread for /fork", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeThreadSlashCommand("fork", "", ctx);

    expect(ctx.threadCommands.forkThread).toHaveBeenCalledWith("active-thread");
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

  it("trims /rename names before saving", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("rename", '"Beta thread"   New Beta Name   ', ctx);

    expect(ctx.threadCommands.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });
});
