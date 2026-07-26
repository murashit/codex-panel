import { describe, expect, it } from "vitest";
import type { ModelMetadata, ReasoningEffort } from "../../../../../src/domain/catalog/metadata";
import type { RuntimePermissionProfileSummary } from "../../../../../src/domain/runtime/permissions";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { SlashCommandName } from "../../../../../src/features/chat/application/slash-commands/catalog";
import { activeSlashCommandSuggestions } from "../../../../../src/features/chat/application/slash-commands/suggestions";

function suggestions(
  beforeCursor: string,
  options: {
    threads?: readonly Thread[];
    models?: readonly ModelMetadata[];
    currentModel?: string | null;
    activeThreadId?: string | null;
    permissionProfiles?: readonly RuntimePermissionProfileSummary[];
    available?: (command: SlashCommandName) => boolean;
  } = {},
) {
  return (
    activeSlashCommandSuggestions(
      beforeCursor,
      options.threads ?? [],
      options.models ?? [],
      options.currentModel ?? null,
      options.activeThreadId ?? null,
      options.permissionProfiles ?? [],
      options.available ?? (() => true),
    ) ?? []
  );
}

function replacements(items: ReturnType<typeof suggestions>): string[] {
  return items.map((item) => item.replacement);
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "019abcde-0000-7000-8000-000000000001",
    preview: "Preview",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

function model(name: string, efforts: ReasoningEffort[], overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    id: name,
    model: name,
    displayName: name,
    description: `${name} description`,
    hidden: false,
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort: efforts[0] ?? "medium",
    inputModalities: ["text"],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
    ...overrides,
  };
}

describe("activeSlashCommandSuggestions", () => {
  it("limits command completion to the beginning of the input and honors availability", () => {
    expect(suggestions("/sta")[0]?.replacement).toBe("/status");
    expect(suggestions("please\n/sta")).toEqual([]);
    expect(suggestions("please\n/resume codex", { threads: [thread({ name: "Codex Panel" })] })).toEqual([]);
    expect(suggestions("please\n/model gpt", { models: [model("gpt-5.5", ["medium"])] })).toEqual([]);
    expect(suggestions("please\n/reasoning h", { models: [model("gpt-5.5", ["high"])], currentModel: "gpt-5.5" })).toEqual([]);
    expect(suggestions("/", { available: () => false })).toEqual([]);
    expect(suggestions("/status")).toEqual([]);
  });

  it("suggests slash subcommands from command definitions", () => {
    expect(replacements(suggestions("/goal "))).toEqual(["set", "edit", "pause", "resume", "clear"]);
    expect(suggestions("/goal p")[0]).toMatchObject({
      display: "pause",
      detail: "/goal pause - Pause the current thread goal.",
      replacement: "pause",
      appendSpaceOnInsert: true,
    });
    expect(suggestions("/goal pause")).toEqual([]);
    expect(suggestions("/goal set Ship it")).toEqual([]);
    expect(suggestions("/plan p")).toEqual([]);
  });

  it("suggests matching threads and preserves the completed target identity", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Codex Panel実装" }),
      thread({ id: "019abcde-0000-7000-8000-000000000002", name: "別件" }),
    ];

    expect(suggestions("/resume codex", { threads })[0]).toMatchObject({
      display: "Codex Panel実装",
      detail: "019abcde",
      replacement: '"Codex Panel実装"',
      appendSpaceOnInsert: true,
      threadCommandTarget: {
        command: "resume",
        threadId: "019abcde-0000-7000-8000-000000000001",
        title: "Codex Panel実装",
      },
    });
    expect(suggestions("/resume ", { threads })).toHaveLength(2);
    expect(suggestions("/resume 019abcde-0000-7000-8000-000000000001 ", { threads })).toEqual([]);
    expect(suggestions("/fork codex", { threads })).toEqual([]);
  });

  it("uses shared thread ranking without truncating matches", () => {
    const rankedThreads = [
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
    ];
    expect(replacements(suggestions("/resume alpha", { threads: rankedThreads }))).toEqual([
      '"Recent unrelated alpha mention"',
      '"Older Alpha"',
    ]);

    const manyThreads = Array.from({ length: 10 }, (_unused, index) =>
      thread({ id: `thread-${String(index).padStart(2, "0")}`, name: `Alpha ${String(index)}`, updatedAt: index }),
    );
    expect(suggestions("/resume alpha", { threads: manyThreads })).toHaveLength(10);
  });

  it("applies active-thread policies per thread command", () => {
    const threads = [
      thread({ id: "latest", name: "Latest thread" }),
      thread({ id: "current", name: "Current panel thread" }),
      thread({ id: "older", name: "Older thread" }),
    ];

    expect(replacements(suggestions("/archive ", { threads, activeThreadId: "current" }))).toEqual([
      '"Current panel thread"',
      '"Latest thread"',
      '"Older thread"',
    ]);
    expect(replacements(suggestions("/resume ", { threads, activeThreadId: "current" }))).toEqual(['"Latest thread"', '"Older thread"']);
    expect(suggestions("/refer current", { threads, activeThreadId: "current" })).toEqual([]);
    expect(suggestions("/rename current", { threads, activeThreadId: "current" })[0]?.replacement).toBe('"Current panel thread"');
  });

  it("suggests visible model and supported reasoning overrides", () => {
    const models = [
      model("gpt-5.5", ["low", "medium", "high"], {
        reasoningEffortOptions: [{ reasoningEffort: "high", description: "Deep reasoning" }],
      }),
      model("gpt-5.4-mini", ["minimal", "low", "medium"]),
      model("hidden-model", ["medium"], { hidden: true }),
    ];

    expect(replacements(suggestions("/model ", { models }))).toEqual(["default", "gpt-5.4-mini", "gpt-5.5"]);
    expect(suggestions("/model hidden", { models })).toEqual([]);
    expect(suggestions("/model gpt-5.5", { models })).toEqual([]);
    expect(suggestions("/reasoning h", { models, currentModel: "gpt-5.5" })[0]).toMatchObject({
      replacement: "high",
      detail: "Deep reasoning",
    });
    expect(suggestions("/reasoning high ", { models, currentModel: "gpt-5.5" })).toEqual([]);
  });

  it("does not invent reasoning effort fallbacks without model metadata", () => {
    expect(suggestions("/reasoning h")).toEqual([]);
    expect(suggestions("/reasoning ", { models: [model("gpt-5.5", [])], currentModel: "gpt-5.5" })).toEqual([
      expect.objectContaining({ replacement: "default" }),
    ]);
  });

  it("suggests only allowed permission profiles", () => {
    const permissionProfiles = [
      { id: ":read-only", description: "Read only", allowed: true },
      { id: ":workspace", description: "Workspace write", allowed: true },
      { id: "DevProfile", description: "Developer profile", allowed: true },
      { id: "reset", description: "Reset-like profile", allowed: true },
      { id: "blocked", description: null, allowed: false },
    ];

    expect(replacements(suggestions("/permissions ", { permissionProfiles }))).toEqual([
      "default",
      ":read-only",
      ":workspace",
      "DevProfile",
      "reset",
    ]);
    expect(suggestions("/permissions work", { permissionProfiles })[0]?.replacement).toBe(":workspace");
    expect(suggestions("/permissions blocked", { permissionProfiles })).toEqual([]);
    expect(suggestions("/permissions DevProfile", { permissionProfiles })).toEqual([]);
  });
});
