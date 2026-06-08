import { describe, expect, it } from "vitest";

import { statusValue, usageLimitStatusLines } from "../../../../src/features/chat/panel/model/status-lines";
import type { RateLimitSummary } from "../../../../src/runtime/status-summary";

describe("status line helpers", () => {
  it("formats primitive and structured diagnostic values", () => {
    expect(statusValue("gpt-5.5", "(default)")).toBe("gpt-5.5");
    expect(statusValue(42, "(default)")).toBe("42");
    expect(statusValue(false, "(default)")).toBe("false");
    expect(statusValue(null, "(default)")).toBe("(default)");
    expect(statusValue({ provider: "openai" }, "(default)")).toBe('{"provider":"openai"}');
  });

  it("formats usage limit rows for slash command output", () => {
    const summary: RateLimitSummary = {
      title: "Codex usage limits",
      level: "warn",
      rows: [
        {
          label: "5h",
          value: "72%",
          percent: 72,
          meterDivisions: 5,
          level: "warn",
          title: "5h usage",
          resetLabel: "reset in 2h",
        },
        { label: "1w", value: "15%", percent: 15, meterDivisions: 7, level: "ok", title: "1w usage", resetLabel: null },
      ],
    };

    expect(usageLimitStatusLines(summary)).toEqual(["Usage limits", "5h: 72% (reset in 2h)", "1w: 15%"]);
  });
});
