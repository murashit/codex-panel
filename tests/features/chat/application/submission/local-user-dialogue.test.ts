import { describe, expect, it } from "vitest";
import { toAppServerUserInput } from "../../../../../src/app-server/protocol/request-input";
import { threadStreamItemFromTurnItem } from "../../../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import { captureSelectionContext } from "../../../../../src/features/chat/application/composer/selection-context";
import { preparedUserInputWithWikiLinkReferencesSkillsAndContext } from "../../../../../src/features/chat/application/composer/wikilink-context";
import { localUserDialogueItemFromInput } from "../../../../../src/features/chat/application/submission/local-user-dialogue";

describe("optimistic user messages", () => {
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
    const draft = `Review ${snapshot.marker} and $real and $missing.`;
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      draft,
      () => null,
      [{ name: "real", path: "/real", description: "real", enabled: true, scope: "user", pluginId: null }],
      { activeNote: null, selection: null, selectionSnapshots: [snapshot] },
      { referenceActiveNoteOnSend: false },
    );
    expect(draft).toBe('Review [[Note]] "Use $real and `tick` then continue" and $real and $missing.');
    expect(prepared.text).toBe('Review [[Note]] `` "Use $real and `tick` then continue" `` and $real and $missing.');
    const optimistic = localUserDialogueItemFromInput({ id: "local", text: prepared.text, codexInput: prepared.input });
    const history = threadStreamItemFromTurnItem({
      type: "userMessage",
      id: "server",
      clientId: "local",
      content: toAppServerUserInput(prepared.input),
    });
    const displayed = 'Review [[Note]] `` "Use $real and `tick` then continue" `` and `$real` and $missing.';
    expect(optimistic).toMatchObject({ text: displayed, copyText: prepared.text });
    expect(history).toMatchObject({ text: displayed, copyText: prepared.text });
    expect(prepared.input).toContainEqual(
      expect.objectContaining({ type: "additionalContext", value: expect.stringContaining("Use $real and `tick`\nthen\tcontinue") }),
    );
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
});
