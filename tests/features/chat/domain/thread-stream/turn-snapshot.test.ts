import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { reconcileTurnSnapshot } from "../../../../../src/features/chat/domain/thread-stream/turn-snapshot";

describe("reconcileTurnSnapshot", () => {
  it("reconciles client identities across repeated text, partial snapshots, and pending display ids", () => {
    const messages = fc.array(fc.record({ text: fc.string(), observed: fc.boolean(), pending: fc.boolean() }), { maxLength: 20 });
    fc.assert(
      fc.property(messages, (specs) => {
        const locals = specs.map(({ text, pending }, index) =>
          Object.freeze({
            ...userDialogue(`${pending ? "local-web" : "local-user"}-${index}`, text, "turn", `local-user-${index}`),
            contextAttachments: [{ label: `Context ${index}`, detail: text }],
            referencedFiles: [{ name: `Note ${index}`, path: `${index}.md` }],
            provenance: { source: "localUser", channel: "optimistic", interaction: "prompt", sourceId: `local-user-${index}` },
          } satisfies ThreadStreamItem),
        );
        const serverItems = specs.flatMap(({ text, observed }, index) =>
          observed ? [Object.freeze(userDialogue(`server-${index}`, text, "turn", `local-user-${index}`))] : [],
        );
        const assistant = Object.freeze({
          id: "assistant",
          kind: "dialogue",
          dialogueKind: "assistantResponse",
          role: "assistant",
          text: "done",
          dialogueState: "completed",
          turnId: "turn",
        } satisfies ThreadStreamItem);
        const turnItems = Object.freeze([...serverItems, assistant]);
        const next = reconcileTurnSnapshot(turnItems, Object.freeze(locals));
        expect(next).toEqual([
          ...locals.map((local, index) =>
            specs[index]?.observed
              ? {
                  ...userDialogue(`server-${index}`, local.text, "turn", local.clientId),
                  contextAttachments: local.contextAttachments,
                  referencedFiles: local.referencedFiles,
                }
              : local,
          ),
          assistant,
        ]);
        expect(reconcileTurnSnapshot(turnItems, next)).toEqual(next);
      }),
      {
        examples: [
          [
            [
              { text: "same text", observed: true, pending: false },
              { text: "same text", observed: true, pending: true },
              { text: "same text", observed: false, pending: false },
            ],
          ],
        ],
      },
    );
  });

  it("keeps file context on the corresponding occurrence of repeated input without client IDs", () => {
    const referencedFiles = [{ name: "Note", path: "Note.md" }];
    const first = userDialogue("server-first", "Continue", "turn");
    const second = userDialogue("server-second", "Continue", "turn");

    const items = reconcileTurnSnapshot(
      [first, second],
      [
        { ...userDialogue("local-user-first", "Continue", "turn"), referencedFiles },
        userDialogue("local-steer-second", "Continue", "turn"),
      ],
    );

    expect(items).toEqual([{ ...first, referencedFiles }, second]);
  });

  it.each([false, true])("uses text fallback only for snapshots without client IDs (identified message present: %s)", (identified) => {
    const completedTurnOptimistic = {
      ...userDialogue("local-user-completed", "same text", "completed"),
      contextAttachments: [{ label: "Completed context", detail: "completed" }],
      referencedFiles: [{ name: "Local", path: "Local.md" }],
    } satisfies ThreadStreamItem;
    const server = { ...userDialogue("server-user", "same text", "completed"), referencedFiles: [] };
    const identifiedMessage = userDialogue("server-second", "other text", "completed", "client-id");

    const next = reconcileTurnSnapshot(identified ? [server, identifiedMessage] : [server], [completedTurnOptimistic]);

    expect(next).toEqual(
      identified
        ? [completedTurnOptimistic, server, identifiedMessage]
        : [{ ...server, contextAttachments: completedTurnOptimistic.contextAttachments }],
    );
  });
});

function userDialogue(id: string, text: string, turnId: string, clientId?: string): Extract<ThreadStreamItem, { dialogueKind: "user" }> {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "user",
    role: "user",
    text,
    copyText: text,
    turnId,
    ...(clientId ? { clientId } : {}),
  };
}
