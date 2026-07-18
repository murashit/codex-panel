import { describe, expect, it } from "vitest";

import { isPanelSubmissionClientId } from "../../../src/domain/chat/submission-id";

describe("Panel submission client IDs", () => {
  it.each(["local-user-1-seed-1-1", "local-steer-42-seed_value-a9-z0", "local-user-123-UPPER_lower-abc-123"])("accepts %s", (value) => {
    expect(isPanelSubmissionClientId(value)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "local-user-1-seed-1",
    "local-other-1-seed-1-1",
    "local-user-x-seed-1-1",
    "local-user-1-seed-1-1/extra",
    "prefix-local-user-1-seed-1-1",
    "local-user-1-seed-!-1",
    "local-user-1-seed-1-!",
  ])("rejects %s", (value) => {
    expect(isPanelSubmissionClientId(value)).toBe(false);
  });
});
