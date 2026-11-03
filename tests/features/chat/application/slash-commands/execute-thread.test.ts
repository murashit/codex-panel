import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import { executeThreadSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-thread";
import { deferred } from "../../../../support/async";
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

  it.each([
    { otherTitle: "Alpha", archiveCalls: [["thread-beta", undefined, undefined]], messages: [] },
    { otherTitle: "Beta thread", archiveCalls: [], messages: [expect.stringContaining("Multiple matching threads:")] },
  ])("archives a quoted title only when it is unambiguous (other title=$otherTitle)", async ({ otherTitle, archiveCalls, messages }) => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: otherTitle }), thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("archive", '"Beta thread"', ctx);

    expect(vi.mocked(ctx.threadCommands.archiveThread).mock.calls).toEqual(archiveCalls);
    expect(vi.mocked(ctx.addSystemMessage).mock.calls.flat()).toEqual(messages);
    expect(ctx.submission.adoptPanelTarget).not.toHaveBeenCalled();
  });

  it("adopts the panel target only when archiving the active thread is published", async () => {
    const archived = deferred<void>();
    const archiveThread = vi.fn<ThreadContext["threadCommands"]["archiveThread"]>(() => archived.promise);
    const ctx = context({
      threadCommands: {
        ...context().threadCommands,
        archiveThread,
      },
    });

    const archiving = executeThreadSlashCommand("archive", '"Current"', ctx);

    expect(archiveThread).toHaveBeenCalledWith("thread-1", undefined, expect.any(Function));
    expect(ctx.submission.adoptPanelTarget).not.toHaveBeenCalled();
    const afterArchive = archiveThread.mock.calls[0]?.[2];
    if (!afterArchive) throw new Error("Expected archive publication callback");
    afterArchive();
    expect(ctx.submission.adoptPanelTarget).toHaveBeenCalledExactlyOnceWith(null);
    archived.resolve(undefined);
    await archiving;
    expect(ctx.submission.adoptPanelTarget).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("trims /rename names before saving", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeThreadSlashCommand("rename", '"Beta thread"   New Beta Name   ', ctx);

    expect(ctx.threadCommands.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });
});
