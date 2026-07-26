import { describe, expect, it } from "vitest";

import {
  parseThreadTitleArgument,
  partialThreadTitleQuery,
  quotedThreadTitleArgument,
  threadCommandTargetForDraft,
} from "../../../../../src/features/chat/application/slash-commands/thread-arguments";

describe("slash command thread arguments", () => {
  it("round-trips quoted titles containing escaped characters", () => {
    const title = 'A "quoted" \\ title';

    expect(parseThreadTitleArgument(`${quotedThreadTitleArgument(title)} message`)).toEqual({ title, rest: "message" });
  });

  it("rejects incomplete or attached quoted arguments", () => {
    expect(parseThreadTitleArgument('"unfinished')).toBeNull();
    expect(parseThreadTitleArgument('"title"attached')).toBeNull();
    expect(parseThreadTitleArgument('"title\\')).toBeNull();
  });

  it("keeps completed thread targets exact while suggesting partial titles", () => {
    const target = { command: "resume" as const, threadId: "thread-1", title: "Thread title" };

    expect(threadCommandTargetForDraft('/resume "Thread title"', target)).toEqual(target);
    expect(threadCommandTargetForDraft('/archive "Thread title"', target)).toBeNull();
    expect(threadCommandTargetForDraft("/resume Other", target)).toBeNull();
    expect(partialThreadTitleQuery('"Thread')).toBe("Thread");
    expect(partialThreadTitleQuery('"A \\"quoted')).toBe('A "quoted');
    expect(partialThreadTitleQuery('"A \\n')).toBe("A \\n");
    expect(partialThreadTitleQuery('"Thread title"')).toBeNull();
    expect(partialThreadTitleQuery("Thread title")).toBeNull();
  });
});
