import { describe, expect, it } from "vitest";
import { toAppServerUserInput } from "../../../../../src/app-server/protocol/request-input";
import { threadStreamItemFromTurnItem } from "../../../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import { captureSelectionContext } from "../../../../../src/features/chat/application/composer/selection-context";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "../../../../../src/features/chat/application/composer/wikilink-context";
import { localUserDialogueItemFromInput } from "../../../../../src/features/chat/application/submission/local-user-dialogue";

describe("optimistic turn start helpers", () => {
  it("keeps readable quotation previews consistent in optimistic items and server history", () => {
    const reference = {
      name: "Note",
      path: "Note.md",
      linktext: "Note",
      text: "Use $real and `tick`\nthen\tcontinue",
      range: null,
      selectionId: "quote",
    } as const;
    const snapshot = captureSelectionContext(reference, []);
    const draft = `Review ${snapshot.marker} and $real.`;
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      draft,
      () => null,
      [{ name: "real", path: "/real", description: "real", enabled: true, scope: "user", pluginId: null }],
      { activeNote: null, selection: null, selectionSnapshots: [snapshot] },
      { referenceActiveNoteOnSend: false },
    );
    expect(draft).toBe('Review [[Note]] "Use $real and `tick` then continue" and $real.');
    expect(prepared.text).toBe('Review [[Note]] `` "Use $real and `tick` then continue" `` and $real.');
    const optimistic = localUserDialogueItemFromInput({ id: "local", text: prepared.text, codexInput: prepared.input });
    const history = threadStreamItemFromTurnItem({
      type: "userMessage",
      id: "server",
      clientId: "local",
      content: toAppServerUserInput(prepared.input),
    });
    const displayed = 'Review [[Note]] `` "Use $real and `tick` then continue" `` and `$real`.';
    expect(optimistic).toMatchObject({ text: displayed, copyText: prepared.text });
    expect(history).toMatchObject({ text: displayed, copyText: prepared.text });
    expect(prepared.input).toContainEqual(
      expect.objectContaining({ type: "additionalContext", value: expect.stringContaining("Use $real and `tick`\nthen\tcontinue") }),
    );
  });

  it("builds optimistic turn starts from immutable input snapshots", () => {
    const input = [
      { type: "text" as const, text: "hello [[Note]]" },
      { type: "fileReference" as const, name: "Note", path: "Note.md" },
    ];

    const item = localUserDialogueItemFromInput({ id: "local-user", text: "hello [[Note]]", codexInput: input });

    expect(item).toMatchObject({
      id: "local-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "hello [[Note]]",
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    });

    expect(localUserDialogueItemFromInput({ id: "steer", text: "hello [[Note]]", turnId: "turn", codexInput: input })).toMatchObject({
      id: "steer",
      turnId: "turn",
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    });
  });

  it("keeps additional context out of optimistic user message text", () => {
    const text = "Read [[Note]].";
    const input = [
      { type: "text" as const, text },
      { type: "fileReference" as const, name: "Note", path: "Note.md" },
      {
        type: "additionalContext" as const,
        key: "codex_panel_obsidian_context",
        kind: "untrusted" as const,
        value: "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Note]] -> Note.md",
      },
    ];

    expect(localUserDialogueItemFromInput({ id: "local-user", text, codexInput: input })).toMatchObject({
      text,
      copyText: text,
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    });
  });

  it("keeps web context visible as user message attachment metadata", () => {
    const text = "https://example.com/ summarize this";
    const input = [
      { type: "text" as const, text },
      {
        type: "additionalContext" as const,
        key: "codex_panel_web_context",
        kind: "untrusted" as const,
        value: "Web page context for the current user input:\nSource: https://example.com/\nTitle: Example\n\nReadable article",
      },
    ];

    expect(localUserDialogueItemFromInput({ id: "local-user", text, codexInput: input })).toMatchObject({
      text,
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
    });
  });

  it("keeps active file references visible even when the same file is referenced explicitly", () => {
    const text = "Read [[Note]].";
    const input = [
      { type: "text" as const, text },
      { type: "fileReference" as const, name: "Note", path: "Note.md" },
      { type: "fileReference" as const, name: "Note duplicate", path: "Note.md" },
      { type: "fileReference" as const, name: "<active>", path: "Note.md" },
    ];

    expect(localUserDialogueItemFromInput({ id: "local-user", text, codexInput: input })).toMatchObject({
      referencedFiles: [
        { name: "Note", path: "Note.md" },
        { name: "Active file", path: "Note.md" },
      ],
    });
  });

  it("formats resolved skill references in optimistic user messages only for display", () => {
    const text = "Use $obsidian-codex-panel-maintain and $missing.";
    const input = [
      { type: "text" as const, text },
      {
        type: "skill" as const,
        name: "obsidian-codex-panel-maintain",
        path: "/skills/obsidian-codex-panel-maintain/SKILL.md",
      },
    ];

    expect(localUserDialogueItemFromInput({ id: "steer", text, codexInput: input })).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain` and $missing.",
      copyText: "Use $obsidian-codex-panel-maintain and $missing.",
    });
  });
});
