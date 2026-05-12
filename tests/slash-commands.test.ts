import { describe, expect, it, vi } from "vitest";

import { executeSlashCommand, slashCommandHelpLines, type SlashCommandExecutionContext } from "../src/panel/slash-commands";

function context(overrides: Partial<SlashCommandExecutionContext> = {}): SlashCommandExecutionContext {
  return {
    activeThreadId: "thread-1",
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

describe("slash commands", () => {
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
});
