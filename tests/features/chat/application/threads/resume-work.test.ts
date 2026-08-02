import { describe, expect, it } from "vitest";

import { ChatResumeWorkTracker } from "../../../../../src/features/chat/application/threads/resume-work";

describe("ChatResumeWorkTracker", () => {
  it("tracks resume work by identity", () => {
    const tracker = new ChatResumeWorkTracker();
    const resume = tracker.begin("thread");

    expect(tracker.isCurrent(resume)).toBe(true);
    tracker.invalidate();
    expect(tracker.isCurrent(resume)).toBe(false);
  });
});
