import { describe, expect, it } from "vitest";

import type { ServerNotification } from "../../../../src/app-server/connection/rpc-messages";
import { BUILT_IN_PINNED_THREAD_SECTION_ID } from "../../../../src/app-server/protocol/thread";
import { threadFactFromLifecycleNotification } from "../../../../src/features/threads/app-server/thread-lifecycle-notifications";

describe("thread lifecycle notifications", () => {
  it.each([
    [
      { method: "thread/archived", params: { threadId: "thread" } },
      { type: "thread-archived", threadId: "thread" },
    ],
    [
      { method: "thread/deleted", params: { threadId: "thread" } },
      { type: "thread-deleted", threadId: "thread" },
    ],
    [
      { method: "thread/unarchived", params: { threadId: "thread" } },
      { type: "thread-unarchived", threadId: "thread" },
    ],
    [
      { method: "thread/section/changed", params: { threadId: "thread", sectionId: BUILT_IN_PINNED_THREAD_SECTION_ID } },
      { type: "thread-pinned", threadId: "thread", isPinned: true },
    ],
    [
      { method: "thread/section/changed", params: { threadId: "thread", sectionId: null } },
      { type: "thread-pinned", threadId: "thread", isPinned: false },
    ],
    [
      { method: "thread/section/changed", params: { threadId: "thread", sectionId: "custom-section" } },
      { type: "thread-pinned", threadId: "thread", isPinned: false },
    ],
    [
      { method: "thread/name/updated", params: { threadId: "thread", threadName: "  Renamed   thread  " } },
      { type: "thread-renamed", threadId: "thread", name: "Renamed thread" },
    ],
  ] satisfies Array<[ServerNotification, ReturnType<typeof threadFactFromLifecycleNotification>]>)(
    "converts %s at the context boundary",
    (notification, expected) => {
      expect(threadFactFromLifecycleNotification(notification)).toEqual(expected);
    },
  );

  it("ignores panel-local notifications", () => {
    expect(
      threadFactFromLifecycleNotification({
        method: "skills/changed",
        params: {},
      }),
    ).toBeNull();
  });
});
