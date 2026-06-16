import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import { slashCommandHelpSections } from "../../../../../src/features/chat/application/composer/slash-commands";
import type { Thread } from "../../../../../src/domain/threads/model";
import {
  executeSlashCommand,
  type SlashCommandExecutionContext,
} from "../../../../../src/features/chat/application/conversation/slash-command-execution";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    busy: false,
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    referThread: vi.fn().mockResolvedValue({
      input: [{ type: "text", text: "referenced" }],
      referencedThread: { threadId: "thread-2", title: "Referenced", includedTurns: 1, turnLimit: 20 },
    }),
    threadActions: {
      forkThread: vi.fn().mockResolvedValue(undefined),
      rollbackThread: vi.fn().mockResolvedValue(undefined),
      compactThread: vi.fn().mockResolvedValue(undefined),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      renameThread: vi.fn().mockResolvedValue(true),
    },
    reconnect: vi.fn().mockResolvedValue(undefined),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    runtimeSettings: {
      toggleFastMode: vi.fn(),
      toggleCollaborationMode: vi.fn(),
      toggleAutoReview: vi.fn(),
      requestModel: vi.fn(),
      resetModelToConfig: vi.fn(),
      requestReasoningEffort: vi.fn(),
      resetReasoningEffortToConfig: vi.fn(),
    },
    supportedReasoningEfforts: () => ["low", "medium", "high"],
    goals: {
      activeGoal: vi.fn(() => null),
      setObjective: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
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
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
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

describe("slash commands", () => {
  it("clears the current panel for /clear", async () => {
    const ctx = context();

    await executeSlashCommand("clear", "", ctx);

    expect(ctx.startNewThread).toHaveBeenCalledOnce();
  });

  it("rejects /clear arguments", async () => {
    const ctx = context();

    await executeSlashCommand("clear", "最初の依頼です", ctx);

    expect(ctx.startNewThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/clear does not take arguments. Usage: /clear");
  });

  it("resumes the latest listed thread for bare /resume", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "latest", name: "Latest" }), thread({ id: "older", name: "Older" })],
    });

    await executeSlashCommand("resume", "", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("latest");
  });

  it("reconnects the panel for /reconnect", async () => {
    const ctx = context();

    await executeSlashCommand("reconnect", "", ctx);

    expect(ctx.reconnect).toHaveBeenCalledOnce();
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
    const input = [{ type: "text" as const, text: "context\n質問です" }];
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

    expect(ctx.threadActions.forkThread).toHaveBeenCalledWith("active-thread");
  });

  it("rejects /fork arguments", async () => {
    const ctx = context();

    await executeSlashCommand("fork", "anything", ctx);

    expect(ctx.threadActions.forkThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/fork does not take arguments. Usage: /fork");
  });

  it("rolls back the active thread for /rollback", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.threadActions.rollbackThread).toHaveBeenCalledWith("active-thread");
  });

  it("rejects /rollback without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.threadActions.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No active thread to roll back.");
  });

  it("rejects /rollback while a turn is running", async () => {
    const ctx = context({ busy: true });

    await executeSlashCommand("rollback", "", ctx);

    expect(ctx.threadActions.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Interrupt the current turn before rolling back.");
  });

  it("rejects /rollback arguments", async () => {
    const ctx = context();

    await executeSlashCommand("rollback", "2", ctx);

    expect(ctx.threadActions.rollbackThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rollback does not take arguments. Usage: /rollback");
  });

  it("toggles Plan mode without sending text for bare /plan", async () => {
    const ctx = context();

    const result = await executeSlashCommand("plan", "", ctx);

    expect(ctx.runtimeSettings.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("shows the current goal for /goal", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeSlashCommand("goal", "", ctx);

    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith(
      "Thread goal",
      expect.arrayContaining([
        expect.objectContaining({ auditFacts: expect.arrayContaining([expect.objectContaining({ key: "objective", value: "Finish" })]) }),
      ]),
    );
  });

  it("reports no goal for bare /goal when unset", async () => {
    const ctx = context();

    await executeSlashCommand("goal", "", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No goal set.");
  });

  it("sets, pauses, resumes, and clears goals", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeSlashCommand("goal", "set Ship this", ctx);
    await executeSlashCommand("goal", "pause", ctx);
    await executeSlashCommand("goal", "resume", ctx);
    await executeSlashCommand("goal", "clear", ctx);

    expect(ctx.goals.setObjective).toHaveBeenCalledWith("thread-1", "Ship this", null);
    expect(ctx.goals.setStatus).toHaveBeenCalledWith("thread-1", "paused");
    expect(ctx.goals.setStatus).toHaveBeenCalledWith("thread-1", "active");
    expect(ctx.goals.clear).toHaveBeenCalledWith("thread-1");
  });

  it("loads the current goal into the composer for /goal edit", async () => {
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => goal({ objective: "Ship goal support" }));

    const result = await executeSlashCommand("goal", "edit", ctx);

    expect(result).toEqual({ composerDraft: "/goal set Ship goal support" });
  });

  it("reports no goal for /goal edit when unset", async () => {
    const ctx = context();

    await executeSlashCommand("goal", "edit", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No goal set.");
  });

  it("requires objective text for /goal set", async () => {
    const ctx = context();

    await executeSlashCommand("goal", "set", ctx);

    expect(ctx.goals.setObjective).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal set <objective> requires an objective. Usage: /goal set <objective>");
  });

  it("rejects extra arguments for goal subcommands without free text", async () => {
    const currentGoal = goal();
    const ctx = context();
    ctx.goals.activeGoal = vi.fn(() => currentGoal);

    await executeSlashCommand("goal", "edit later", ctx);
    await executeSlashCommand("goal", "pause later", ctx);
    await executeSlashCommand("goal", "resume now", ctx);
    await executeSlashCommand("goal", "clear please", ctx);

    expect(ctx.goals.setStatus).not.toHaveBeenCalled();
    expect(ctx.goals.clear).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal edit does not take arguments. Usage: /goal edit");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal pause does not take arguments. Usage: /goal pause");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal resume does not take arguments. Usage: /goal resume");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/goal clear does not take arguments. Usage: /goal clear");
  });

  it("rejects unknown goal subcommands", async () => {
    const ctx = context();

    await executeSlashCommand("goal", "stop", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith(
      "/goal requires set <objective>, edit, pause, resume, or clear. Subcommands: /goal set <objective>, /goal edit, /goal pause, /goal resume, /goal clear. Usage: /goal [set <objective>|edit|pause|resume|clear]",
    );
  });

  it("starts a thread before setting a goal without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("goal", "set Ship this", ctx);

    expect(ctx.startThreadForGoal).toHaveBeenCalledWith("Ship this");
    expect(ctx.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("No active thread for goal management.");
  });

  it("rejects non-set goal mutation without an active thread", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("goal", "pause", ctx);

    expect(ctx.startThreadForGoal).not.toHaveBeenCalled();
    expect(ctx.goals.setStatus).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("No active thread for goal management.");
  });

  it("returns message text after toggling Plan mode for /plan arguments", async () => {
    const ctx = context();

    const result = await executeSlashCommand("plan", "OK、実装してください", ctx);

    expect(ctx.runtimeSettings.toggleCollaborationMode).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "OK、実装してください" });
  });

  it("toggles auto-review without sending text for bare /auto-review", async () => {
    const ctx = context();

    const result = await executeSlashCommand("auto-review", "", ctx);

    expect(ctx.runtimeSettings.toggleAutoReview).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("rejects /auto-review arguments", async () => {
    const ctx = context();

    await executeSlashCommand("auto-review", "この依頼からお願いします", ctx);

    expect(ctx.runtimeSettings.toggleAutoReview).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/auto-review does not take arguments. Usage: /auto-review");
  });

  it("rejects /compact arguments", async () => {
    const ctx = context();

    await executeSlashCommand("compact", "ignored for now", ctx);

    expect(ctx.threadActions.compactThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/compact does not take arguments. Usage: /compact");
  });

  it("rejects bare /archive", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.threadActions.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("archives a selected thread by id argument", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("archive", "thread-beta", ctx);

    expect(ctx.threadActions.archiveThread).toHaveBeenCalledWith("thread-beta");
  });

  it("rejects /archive without a thread before active-thread checks", async () => {
    const ctx = context({ activeThreadId: null });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.threadActions.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("rejects /archive while a turn is running", async () => {
    const ctx = context({ busy: true });

    await executeSlashCommand("archive", "thread-1", ctx);

    expect(ctx.threadActions.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Finish or interrupt the current turn before archiving threads.");
  });

  it("reports ambiguous archive matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeSlashCommand("archive", "Draft", ctx);

    expect(ctx.threadActions.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Multiple matching threads: Draft, Draft notes");
  });

  it("renames a selected thread by id argument", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("rename", "thread-beta New Beta Name", ctx);

    expect(ctx.threadActions.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });

  it("trims /rename names before saving", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("rename", "thread-beta   New Beta Name   ", ctx);

    expect(ctx.threadActions.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });

  it("rejects /rename without a thread and name", async () => {
    const ctx = context();

    await executeSlashCommand("rename", "thread-1", ctx);

    expect(ctx.threadActions.renameThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rename requires a thread and a name. Usage: /rename <thread> <name>");
  });

  it("rejects blank /rename names after trimming", async () => {
    const ctx = context();

    await executeSlashCommand("rename", "thread-1     ", ctx);

    expect(ctx.threadActions.renameThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rename requires a thread and a name. Usage: /rename <thread> <name>");
  });

  it("reports ambiguous rename matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeSlashCommand("rename", "Draft New name", ctx);

    expect(ctx.threadActions.renameThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Multiple matching threads: Draft, Draft notes");
  });

  it("documents archive", () => {
    expect(slashCommandHelpValue("/archive <thread>")).toBe("Archive the selected Codex thread.");
  });

  it("shows slash command help as a structured system result", async () => {
    const ctx = context();

    await executeSlashCommand("help", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Available slash commands", slashCommandHelpSections());
  });

  it("groups slash command help by command surface", () => {
    expect(slashCommandHelpSections()).toEqual([
      {
        title: "Panel actions",
        rows: expect.arrayContaining([
          { key: "/clear", value: "Clear the current panel and start a fresh Codex thread." },
          { key: "/reconnect", value: "Reconnect to Codex app-server and resume the active thread." },
          { key: "/archive <thread>", value: "Archive the selected Codex thread." },
          { key: "/rename <thread> <name>", value: "Rename the selected Codex thread." },
        ]),
      },
      {
        title: "Thread settings",
        rows: expect.arrayContaining([
          { key: "/plan [message]", value: "Toggle Plan mode, optionally with a message." },
          { key: "/model [model|default]", value: "Show or set the model for subsequent turns." },
        ]),
      },
      {
        title: "Diagnostics",
        rows: expect.arrayContaining([
          { key: "/status", value: "Show current thread, context, and usage limits." },
          { key: "/help", value: "Show available Codex slash commands." },
        ]),
      },
      {
        title: "Composition",
        rows: [{ key: "/refer <thread> <message>", value: "Send a message with recent turns from another non-archived thread." }],
      },
    ]);
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
        auditFacts: [
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
    expect(slashCommandHelpValue("/plan [message]")).toBe("Toggle Plan mode, optionally with a message.");
  });

  it("documents auto-review", () => {
    expect(slashCommandHelpValue("/auto-review")).toBe("Toggle approval auto-review.");
  });

  it("documents rollback", () => {
    expect(slashCommandHelpValue("/rollback")).toBe("Roll back the latest turn and restore its prompt.");
  });

  it("documents rename", () => {
    expect(slashCommandHelpValue("/rename <thread> <name>")).toBe("Rename the selected Codex thread.");
  });

  it("documents refer history size", () => {
    expect(slashCommandHelpValue("/refer <thread> <message>")).toBe("Send a message with recent turns from another non-archived thread.");
  });

  it("documents status and doctor as separate commands", () => {
    expect(slashCommandHelpValue("/status")).toBe("Show current thread, context, and usage limits.");
    expect(slashCommandHelpValue("/doctor")).toBe("Show Codex CLI and Codex App Server diagnostics.");
  });

  it("rejects unsupported reasoning effort with usage", async () => {
    const ctx = context();

    await executeSlashCommand("reasoning", "extreme", ctx);

    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.resetReasoningEffortToConfig).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Unsupported reasoning level: extreme. Usage: /reasoning [level|default]");
  });

  it("does not announce model or effort changes when applying them fails", async () => {
    const ctx = context();
    ctx.runtimeSettings.requestModel = vi.fn().mockResolvedValue(false);
    ctx.runtimeSettings.requestReasoningEffort = vi.fn().mockResolvedValue(false);

    await executeSlashCommand("model", "gpt-5.5", ctx);
    await executeSlashCommand("reasoning", "high", ctx);

    expect(ctx.runtimeSettings.requestModel).toHaveBeenCalledWith("gpt-5.5");
    expect(ctx.runtimeSettings.requestReasoningEffort).toHaveBeenCalledWith("high");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("routes default model and reasoning overrides through reset commands", async () => {
    const ctx = context();

    await executeSlashCommand("model", "default", ctx);
    await executeSlashCommand("reasoning", "default", ctx);

    expect(ctx.runtimeSettings.resetModelToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.resetReasoningEffortToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Model reset to default for subsequent turns.");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Reasoning effort reset to default for subsequent turns.");
  });

  it("routes runtime reset aliases through reset commands", async () => {
    const ctx = context();

    for (const alias of ["reset", "clear", "off"]) {
      await executeSlashCommand("model", alias, ctx);
      await executeSlashCommand("reasoning", alias, ctx);
    }

    expect(ctx.runtimeSettings.resetModelToConfig).toHaveBeenCalledTimes(3);
    expect(ctx.runtimeSettings.resetReasoningEffortToConfig).toHaveBeenCalledTimes(3);
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
  });

  it("shows model and reasoning status for empty runtime commands", async () => {
    const ctx = context({
      modelStatusLines: () => ["model: gpt-5.5"],
      effortStatusLines: () => ["effort: high"],
    });

    await executeSlashCommand("model", "", ctx);
    await executeSlashCommand("reasoning", "", ctx);

    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Model settings", [{ auditFacts: [{ key: "model", value: "gpt-5.5" }] }]);
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Reasoning effort", [{ auditFacts: [{ key: "effort", value: "high" }] }]);
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
  });

  it("preserves supported reasoning effort casing", async () => {
    const ctx = context({
      supportedReasoningEfforts: () => ["CaseSensitive"],
    });

    await executeSlashCommand("reasoning", "CaseSensitive", ctx);

    expect(ctx.runtimeSettings.requestReasoningEffort).toHaveBeenCalledWith("CaseSensitive");
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Reasoning effort set to CaseSensitive for subsequent turns.");
  });

  it("shows MCP server status", async () => {
    const ctx = context();

    await executeSlashCommand("mcp", "", ctx);

    expect(ctx.mcpStatusLines).toHaveBeenCalledOnce();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("MCP servers", [{ auditFacts: [] }]);
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

    expect(ctx.runtimeSettings.toggleFastMode).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/fast does not take arguments. Usage: /fast");
  });

  it("documents MCP status", () => {
    expect(slashCommandHelpValue("/mcp")).toBe("Show MCP servers reported by Codex App Server.");
  });
});

function slashCommandHelpValue(key: string): string | undefined {
  return slashCommandHelpSections()
    .flatMap((section) => section.rows)
    .find((row) => row.key === key)?.value;
}
