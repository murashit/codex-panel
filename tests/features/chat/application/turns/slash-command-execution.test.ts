import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import {
  SLASH_COMMANDS,
  type SlashCommandName,
  slashCommandHelpSections,
} from "../../../../../src/features/chat/application/composer/slash-commands";
import {
  executeSlashCommand,
  type SlashCommandExecutionContext,
} from "../../../../../src/features/chat/application/turns/slash-command-execution";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
    listedThreads: [thread({ id: "thread-1", name: "Current" })],
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    referThread: vi.fn().mockResolvedValue({
      text: "referenced",
      input: [{ type: "text", text: "referenced" }],
      referencedThread: { threadId: "thread-2", title: "Referenced", includedTurns: 1, turnLimit: 20 },
    }),
    readWebUrl: vi.fn().mockResolvedValue({
      text: "https://example.com/article 要約して",
      input: [
        { type: "text", text: "https://example.com/article 要約して" },
        { type: "additionalContext", key: "codex_panel_web_context", kind: "untrusted", value: "Readable article" },
      ],
    }),
    threadActions: {
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
    supportedReasoningEfforts: () => ["low", "medium", "high"],
    goals: {
      activeGoal: vi.fn(() => null),
      setObjective: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
    statusDetails: () => [{ auditFacts: [{ key: "Thread", value: "thread-1" }] }],
    permissionDetails: () => [{ title: "Permissions", auditFacts: [{ key: "Profile", value: "read-only" }] }],
    connectionDiagnosticDetails: () => [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }],
    toolInventoryDetails: vi.fn(() => [{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] }]),
    modelStatusDetails: () => [{ auditFacts: [{ key: "Model", value: "gpt-5.5" }] }],
    effortStatusDetails: () => [{ auditFacts: [{ key: "Effort", value: "high" }] }],
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

describe("slash commands", () => {
  it.each(
    SLASH_COMMANDS.filter((definition) => definition.argsKind === "none").map((definition) => [
      definition.command.slice(1) as SlashCommandName,
      definition.usage,
    ]),
  )("rejects arguments for /%s from catalog metadata", async (command, usage) => {
    const ctx = context();

    await executeSlashCommand(command, "unexpected", ctx);

    expect(ctx.addSystemMessage).toHaveBeenCalledWith(`/${command} does not take arguments. Usage: ${usage}`);
  });

  it("clears the current panel for /clear", async () => {
    const ctx = context();

    await executeSlashCommand("clear", "", ctx);

    expect(ctx.startNewThread).toHaveBeenCalledOnce();
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

  it("resumes a thread by title argument without accepting ids", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta" })],
    });

    await executeSlashCommand("resume", "Beta", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-beta");

    await executeSlashCommand("resume", "thread-alpha", ctx);
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

    await executeSlashCommand("resume", `"${completedTitle}"`, ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("target");

    const directInput = context({ listedThreads: [other, target] });
    await executeSlashCommand("resume", `"${completedTitle}"`, directInput);
    expect(directInput.resumeThread).not.toHaveBeenCalled();
    expect(directInput.addSystemMessage).toHaveBeenCalledWith(`No matching thread: ${completedTitle}`);
  });

  it("resolves an exact title before another title with the same prefix", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Draft" }), thread({ id: "thread-beta", name: "Draft notes" })],
    });

    await executeSlashCommand("resume", "Draft", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-alpha");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("resolves a stronger ranked resume match before looser title matches", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha plan" }), thread({ id: "thread-beta", name: "Older Alpha plan" })],
    });

    await executeSlashCommand("resume", "alpha", ctx);

    expect(ctx.resumeThread).toHaveBeenCalledWith("thread-alpha");
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("Multiple matching threads: Alpha plan (thread-a), Older Alpha plan (thread-b)");
  });

  it("returns referenced input for /refer", async () => {
    const target = thread({ id: "thread-alpha", name: "Alpha" });
    const input = [{ type: "text" as const, text: "context\n質問です" }];
    const referencedThread = { threadId: "thread-alpha", title: "Alpha", includedTurns: 2, turnLimit: 20 };
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const ctx = context({
      inputSnapshot,
      listedThreads: [thread({ id: "thread-current", name: "Current" }), target],
      referThread: vi.fn().mockResolvedValue({ text: "質問です", input, referencedThread }),
    });

    const result = await executeSlashCommand("refer", '"Alpha" 質問です', ctx);

    expect(ctx.referThread).toHaveBeenCalledWith(target, "質問です", inputSnapshot);
    expect(result).toEqual({ sendText: "質問です", sendInput: input, referencedThread });
  });

  it("rejects /refer when no composer input snapshot is available", async () => {
    const target = thread({ id: "thread-alpha", name: "Alpha" });
    const ctx = context({
      listedThreads: [thread({ id: "thread-current", name: "Current" }), target],
    });

    await executeSlashCommand("refer", '"Alpha" 質問です', ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Cannot reference a thread without composer input context.");
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

    await executeSlashCommand("refer", '"Current" 続きです', ctx);

    expect(ctx.referThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Use the current thread directly instead of referencing it.");
  });

  it("does not let the active thread shadow a non-active /refer match", async () => {
    const target = thread({ id: "alpha-thread", name: "Alpha other thread" });
    const input = [{ type: "text" as const, text: "質問です" }];
    const referencedThread = { threadId: "alpha-thread", title: "Other thread", includedTurns: 1, turnLimit: 20 };
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    const ctx = context({
      activeThreadId: "thread-current",
      inputSnapshot,
      listedThreads: [thread({ id: "thread-current", name: "Alpha plan" }), target],
      referThread: vi.fn().mockResolvedValue({ text: "質問です", input, referencedThread }),
    });

    const result = await executeSlashCommand("refer", "alpha 質問です", ctx);

    expect(ctx.referThread).toHaveBeenCalledWith(target, "質問です", inputSnapshot);
    expect(ctx.addSystemMessage).not.toHaveBeenCalledWith("Use the current thread directly instead of referencing it.");
    expect(result).toEqual({ sendText: "質問です", sendInput: input, referencedThread });
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

    const result = await executeSlashCommand("web", "https://example.com/article 要約して", ctx);

    expect(ctx.readWebUrl).toHaveBeenCalledWith("https://example.com/article", "要約して", inputSnapshot);
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

    const result = await executeSlashCommand("web", "https://example.com/article", ctx);

    expect(ctx.readWebUrl).toHaveBeenCalledWith("https://example.com/article", "", inputSnapshot);
    expect(result).toEqual({ sendText: "https://example.com/article", sendInput: input });
  });

  it("rejects /web without a URL", async () => {
    const ctx = context();

    await executeSlashCommand("web", "", ctx);

    expect(ctx.readWebUrl).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/web requires a URL. Usage: /web <url> [message]");
  });

  it("rejects /web when no composer input snapshot is available", async () => {
    const ctx = context();

    await executeSlashCommand("web", "https://example.com/article 要約して", ctx);

    expect(ctx.readWebUrl).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Cannot read a web URL without composer input context.");
  });

  it("forks the active thread for /fork", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("fork", "", ctx);

    expect(ctx.threadActions.forkThread).toHaveBeenCalledWith("active-thread");
  });

  it("opens a side chat from the active thread", async () => {
    const openSideChat = vi.fn().mockResolvedValue(undefined);
    const ctx = context({ activeThreadId: "active-thread", openSideChat });

    await executeSlashCommand("btw", "", ctx);

    expect(openSideChat).toHaveBeenCalledWith("active-thread");
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

  it("rejects bare /archive", async () => {
    const ctx = context({ activeThreadId: "active-thread" });

    await executeSlashCommand("archive", "", ctx);

    expect(ctx.threadActions.archiveThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/archive requires a thread. Usage: /archive <thread>");
  });

  it("archives a selected thread by quoted title", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeSlashCommand("archive", '"Beta thread"', ctx);

    expect(ctx.threadActions.archiveThread).toHaveBeenCalledWith("thread-beta");
  });

  it("renames a selected thread by quoted title", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-alpha", name: "Alpha" }), thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeSlashCommand("rename", '"Beta thread" New Beta Name', ctx);

    expect(ctx.threadActions.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });

  it("trims /rename names before saving", async () => {
    const ctx = context({
      listedThreads: [thread({ id: "thread-beta", name: "Beta thread" })],
    });

    await executeSlashCommand("rename", '"Beta thread"   New Beta Name   ', ctx);

    expect(ctx.threadActions.renameThread).toHaveBeenCalledWith("thread-beta", "New Beta Name");
  });

  it("rejects /rename without a thread and name", async () => {
    const ctx = context();

    await executeSlashCommand("rename", "thread-1", ctx);

    expect(ctx.threadActions.renameThread).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("/rename requires a thread and a name. Usage: /rename <thread> <name>");
  });

  it("shows slash command help as a structured system result", async () => {
    const ctx = context();

    await executeSlashCommand("help", "", ctx);

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

    await executeSlashCommand("status", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Thread status", details);
  });

  it("shows permissions and approvals as shared structured sections", async () => {
    const details = [
      { title: "Permissions", auditFacts: [{ key: "Profile", value: "workspace-write" }] },
      { title: "Approvals", auditFacts: [{ key: "Auto review", value: "on" }] },
    ];
    const ctx = context({ permissionDetails: () => details });

    await executeSlashCommand("permissions", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Permissions & Approvals", details);
  });

  it("sets the permission profile for /permissions arguments", async () => {
    const ctx = context();

    await executeSlashCommand("permissions", ":workspace", ctx);

    expect(ctx.addStructuredSystemMessage).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestPermissionProfile).toHaveBeenCalledWith(":workspace");
    expect(ctx.runtimeSettings.resetPermissionProfileToConfig).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Permission profile set to :workspace for subsequent turns.");
  });

  it("routes default permission profile through reset", async () => {
    const ctx = context();

    await executeSlashCommand("permissions", "default", ctx);

    expect(ctx.runtimeSettings.resetPermissionProfileToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.requestPermissionProfile).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith("Permission profile reset to default for subsequent turns.");
  });

  it.each(["reset", "clear", "off"])("treats permission profile alias-like value %s as a profile id", async (profile) => {
    const ctx = context();

    await executeSlashCommand("permissions", profile, ctx);

    expect(ctx.runtimeSettings.requestPermissionProfile).toHaveBeenCalledWith(profile);
    expect(ctx.runtimeSettings.resetPermissionProfileToConfig).not.toHaveBeenCalled();
    expect(ctx.addSystemMessage).toHaveBeenCalledWith(`Permission profile set to ${profile} for subsequent turns.`);
  });

  it("does not announce permission profile changes when applying them fails", async () => {
    const ctx = context();
    ctx.runtimeSettings.requestPermissionProfile = vi.fn().mockResolvedValue(false);

    await executeSlashCommand("permissions", ":workspace", ctx);

    expect(ctx.runtimeSettings.requestPermissionProfile).toHaveBeenCalledWith(":workspace");
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("shows doctor diagnostics as shared structured sections", async () => {
    const details = [{ title: "Process", rows: [{ key: "connection", value: "connected" }] }];
    const ctx = context({ connectionDiagnosticDetails: () => details });

    await executeSlashCommand("doctor", "", ctx);

    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Connection diagnostics", details);
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

  it.each(["reset", "clear", "off"])("routes runtime reset alias %s through reset commands", async (alias) => {
    const ctx = context();

    await executeSlashCommand("model", alias, ctx);
    await executeSlashCommand("reasoning", alias, ctx);

    expect(ctx.runtimeSettings.resetModelToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.resetReasoningEffortToConfig).toHaveBeenCalledOnce();
    expect(ctx.runtimeSettings.requestModel).not.toHaveBeenCalled();
    expect(ctx.runtimeSettings.requestReasoningEffort).not.toHaveBeenCalled();
  });

  it("shows model and reasoning status for empty runtime commands", async () => {
    const modelDetails = [{ auditFacts: [{ key: "Model", value: "gpt-5.5" }] }];
    const effortDetails = [{ auditFacts: [{ key: "Effort", value: "high" }] }];
    const ctx = context({
      modelStatusDetails: () => modelDetails,
      effortStatusDetails: () => effortDetails,
    });

    await executeSlashCommand("model", "", ctx);
    await executeSlashCommand("reasoning", "", ctx);

    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Model settings", modelDetails);
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Reasoning effort", effortDetails);
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

  it("shows Codex capabilities", async () => {
    const toolInventoryDetails = vi
      .fn()
      .mockResolvedValue([{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] }]);
    const ctx = context({ toolInventoryDetails });

    await executeSlashCommand("tools", "", ctx);

    expect(toolInventoryDetails).toHaveBeenCalledOnce();
    expect(ctx.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github" }] },
    ]);
  });

  it("toggles fast mode without sending text", async () => {
    const ctx = context();

    const result = await executeSlashCommand("fast", "", ctx);

    expect(ctx.runtimeSettings.toggleFastMode).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });
});
