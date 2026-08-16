import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { executeContextSlashCommand } from "../../../../../src/features/chat/application/slash-commands/execute-context";

type ContextCommandContext = Parameters<typeof executeContextSlashCommand>[2];

function context(overrides: Partial<ContextCommandContext> = {}): ContextCommandContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    submission: { isCurrent: vi.fn(() => true), markAdopted: vi.fn(), adoptPanelTarget: vi.fn() },
    referThread: vi.fn().mockResolvedValue({ text: "referenced", input: [{ type: "text", text: "referenced" }] }),
    readWebUrl: vi.fn().mockResolvedValue({
      text: "https://example.com/article 要約して",
      input: [
        { type: "text", text: "https://example.com/article 要約して" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
      ],
    }),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    goals: {
      activeGoal: vi.fn(() => null),
      setObjective: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
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
function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread-1",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
describe("context slash commands", () => {
  it("rejects /refer when no composer input snapshot is available", async () => {
    const target = thread({ id: "thread-alpha", name: "Alpha" });
    const ctx = context({
      listedThreads: [thread({ id: "thread-current", name: "Current" }), target],
    });

    await executeContextSlashCommand("refer", '"Alpha" 質問です', ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Cannot reference a thread without composer input context.");
  });

  it("rejects /refer for the active thread", async () => {
    const ctx = context({
      activeThreadId: "thread-1",
      listedThreads: [thread({ id: "thread-1", name: "Current" })],
    });

    await executeContextSlashCommand("refer", '"Current" 続きです', ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Use the current thread directly instead of referencing it.");
  });

  it("does not let the active thread shadow a non-active /refer match", async () => {
    const target = thread({ id: "alpha-thread", name: "Alpha other thread" });
    const input = [{ type: "text" as const, text: "質問です" }];
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const ctx = context({
      activeThreadId: "thread-current",
      inputSnapshot,
      listedThreads: [thread({ id: "thread-current", name: "Alpha plan" }), target],
      referThread: vi.fn().mockResolvedValue({ text: "質問です", input }),
    });

    const result = await executeContextSlashCommand("refer", "alpha 質問です", ctx);

    expect(ctx.referThread).toHaveBeenCalledWith(target, "質問です", inputSnapshot);
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("Use the current thread directly instead of referencing it.");
    expect(result).toEqual({ sendText: "質問です", sendInput: input });
  });

  it("returns fetched web context input for /web", async () => {
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const input = [
      { type: "text" as const, text: "https://example.com/article 要約して" },
      { type: "additionalContext" as const, key: "codex_panel_web_context", kind: "untrusted" as const, value: "Readable article" },
    ];
    const ctx = context({
      inputSnapshot,
      readWebUrl: vi.fn().mockResolvedValue({ text: "https://example.com/article 要約して", input }),
    });

    const result = await executeContextSlashCommand("web", "https://example.com/article 要約して", ctx);

    expect(ctx.submission.markAdopted).not.toHaveBeenCalled();
    expect(ctx.readWebUrl).toHaveBeenCalledWith("https://example.com/article", "要約して", inputSnapshot, ctx.submission.isCurrent);
    expect(result).toEqual({ sendText: "https://example.com/article 要約して", sendInput: input });
  });

  it("returns fetched web context input for /web without a message", async () => {
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const input = [
      { type: "text" as const, text: "https://example.com/article" },
      { type: "additionalContext" as const, key: "codex_panel_web_context", kind: "untrusted" as const, value: "Readable article" },
    ];
    const ctx = context({
      inputSnapshot,
      readWebUrl: vi.fn().mockResolvedValue({ text: "https://example.com/article", input }),
    });

    const result = await executeContextSlashCommand("web", "https://example.com/article", ctx);

    expect(ctx.readWebUrl).toHaveBeenCalledWith("https://example.com/article", "", inputSnapshot, ctx.submission.isCurrent);
    expect(result).toEqual({ sendText: "https://example.com/article", sendInput: input });
  });

  it("rejects /web when no composer input snapshot is available", async () => {
    const ctx = context();

    await executeContextSlashCommand("web", "https://example.com/article 要約して", ctx);

    expect(ctx.readWebUrl).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Cannot read a web URL without composer input context.");
  });

  it("shows the current goal for /goal", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeContextSlashCommand("goal", "", ctx);

    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith(
      "Thread goal",
      expect.arrayContaining([
        expect.objectContaining({ auditFacts: expect.arrayContaining([expect.objectContaining({ key: "objective", value: "Finish" })]) }),
      ]),
    );
  });

  it("reports no goal for bare /goal when unset", async () => {
    const ctx = context();

    await executeContextSlashCommand("goal", "", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No goal set.");
  });

  it("sets, pauses, resumes, and clears goals", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeContextSlashCommand("goal", "set Ship this", ctx);
    await executeContextSlashCommand("goal", "pause", ctx);
    await executeContextSlashCommand("goal", "resume", ctx);
    await executeContextSlashCommand("goal", "clear", ctx);

    expect(ctx.goals.setObjective).toHaveBeenCalledWith("thread-1", "Ship this", null);
    expect(ctx.goals.setStatus).toHaveBeenCalledWith("thread-1", "paused");
    expect(ctx.goals.setStatus).toHaveBeenCalledWith("thread-1", "active");
    expect(ctx.goals.clear).toHaveBeenCalledWith("thread-1");
    expect(ctx.submission.markAdopted).toHaveBeenCalledTimes(4);
  });

  it("loads the current goal into the composer for /goal edit", async () => {
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => goal({ objective: "Ship goal support" }));

    const result = await executeContextSlashCommand("goal", "edit", ctx);

    expect(ctx.submission.markAdopted).not.toHaveBeenCalled();
    expect(result).toEqual({ composerDraft: "/goal set Ship goal support" });
  });

  it("reports no goal for /goal edit when unset", async () => {
    const ctx = context();

    await executeContextSlashCommand("goal", "edit", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No goal set.");
  });

  it("requires objective text for /goal set", async () => {
    const ctx = context();

    await executeContextSlashCommand("goal", "set", ctx);

    expect(ctx.goals.setObjective).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal set <objective> requires an objective. Usage: /goal set <objective>");
  });

  it("rejects extra arguments for goal subcommands without free text", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeContextSlashCommand("goal", "edit later", ctx);
    await executeContextSlashCommand("goal", "pause later", ctx);
    await executeContextSlashCommand("goal", "resume now", ctx);
    await executeContextSlashCommand("goal", "clear please", ctx);

    expect(ctx.goals.setStatus).not.toHaveBeenCalled();
    expect(ctx.goals.clear).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal edit does not take arguments. Usage: /goal edit");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal pause does not take arguments. Usage: /goal pause");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal resume does not take arguments. Usage: /goal resume");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal clear does not take arguments. Usage: /goal clear");
  });

  it("rejects unknown goal subcommands", async () => {
    const ctx = context();

    await executeContextSlashCommand("goal", "stop", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith(
      "/goal requires set <objective>, edit, pause, resume, or clear. Subcommands: /goal set <objective>, /goal edit, /goal pause, /goal resume, /goal clear. Usage: /goal [set <objective>|edit|pause|resume|clear]",
    );
  });

  it("starts a thread before setting a goal without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeContextSlashCommand("goal", "set Ship this", ctx);

    expect(ctx.submission.adoptPanelTarget).not.toHaveBeenCalled();
    expect(ctx.startThreadForGoal).toHaveBeenCalledWith("Ship this", ctx.submission.adoptPanelTarget);
    expect(ctx.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("No active thread for goal management.");
  });

  it("rejects non-set goal mutation without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeContextSlashCommand("goal", "pause", ctx);

    expect(ctx.startThreadForGoal).not.toHaveBeenCalled();
    expect(ctx.goals.setStatus).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No active thread for goal management.");
  });
});
