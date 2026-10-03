import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { reconcileCompletedTurnItems } from "../../../../../src/features/chat/domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

describe("reconcileCompletedTurnItems", () => {
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
        const unrelated = Object.freeze(userDialogue("local-user-other", "same text", "other", "other-client"));
        const currentItems = Object.freeze([...locals, unrelated]);
        const serverItems = specs.flatMap(({ text, observed }, index) =>
          observed ? [Object.freeze(userDialogue(`server-${index}`, text, "turn", `local-user-${index}`))] : [],
        );
        const assistant = Object.freeze(assistantDialogue("assistant", "done", "turn"));
        const turnItems = Object.freeze([...serverItems, assistant]);
        const next = reconcileCompletedTurnItems({ currentItems, completedTurnId: "turn", turnItems });
        expect(next).toEqual([
          unrelated,
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
        expect(next[0]).toBe(unrelated);
        expect(reconcileCompletedTurnItems({ currentItems: next, completedTurnId: "turn", turnItems })).toEqual(next);
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

  it("keeps local attachment and file-reference metadata when replacing an optimistic user dialogue", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "https://example.com/ summarize this", "turn", "local-user-1"),
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("u1", "https://example.com/ summarize this", "turn", "local-user-1");

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next).toEqual([
      expect.objectContaining({
        id: "u1",
        contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
        referencedFiles: [{ name: "Note", path: "Note.md" }],
      }),
    ]);
  });

  it("keeps fallback reconciliation scoped to the completed turn", () => {
    const completedTurnOptimistic = {
      ...userDialogue("local-user-completed", "same text", "completed"),
      contextAttachments: [{ label: "Completed context", detail: "completed" }],
    } satisfies ThreadStreamItem;
    const otherTurnOptimistic = {
      ...userDialogue("local-user-other", "same text", "other"),
      contextAttachments: [{ label: "Other context", detail: "other" }],
    } satisfies ThreadStreamItem;
    const server = userDialogue("server-user", "same text", "completed");

    const next = reconcileCompletedTurnItems({
      currentItems: [completedTurnOptimistic, otherTurnOptimistic],
      completedTurnId: "completed",
      turnItems: [server],
    });

    expect(next).toEqual([
      otherTurnOptimistic,
      expect.objectContaining({
        id: "server-user",
        contextAttachments: [{ label: "Completed context", detail: "completed" }],
      }),
    ]);
  });

  it("keeps the optimistic reference title while accepting server truncation metadata", () => {
    const optimistic = {
      ...userDialogue("local-user-1", "continue", "turn", "local-user-1"),
      referencedThread: { threadId: "thread-reference", title: "Readable title", includedTurns: 2, turnLimit: 20 },
    } satisfies ThreadStreamItem;
    const server = {
      ...userDialogue("u1", "continue", "turn", "local-user-1"),
      referencedThread: {
        threadId: "thread-reference",
        title: "thread-r",
        includedTurns: 2,
        turnLimit: 20,
        omittedTurns: 3,
        truncated: true,
      },
    } satisfies ThreadStreamItem;

    const next = reconcileCompletedTurnItems({ currentItems: [optimistic], completedTurnId: "turn", turnItems: [server] });

    expect(next[0]).toMatchObject({
      referencedThread: {
        title: "Readable title",
        threadId: "thread-reference",
        omittedTurns: 3,
        truncated: true,
      },
    });
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

function assistantDialogue(id: string, text: string, turnId: string): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text,
    dialogueState: "completed",
    turnId,
  };
}
