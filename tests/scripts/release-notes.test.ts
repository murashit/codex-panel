import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { releaseNoteForCommit, renderReleaseNotes } = (await import(
  pathToFileURL(path.join(process.cwd(), "scripts", "release", "notes.mjs")).href
)) as {
  releaseNoteForCommit(message: string): string | null;
  renderReleaseNotes(messages: string[]): string;
};

describe("release notes", () => {
  it("renders user-facing conventional commits and breaking changes", () => {
    expect(
      renderReleaseNotes([
        "feat(chat): add side chat support",
        "fix: prevent stale titles",
        "perf(stream): reduce rendering work",
        "refactor!: remove the legacy settings format",
        "docs: explain side chats",
        "chore(deps): update development dependencies",
      ]),
    ).toBe(
      [
        "## Changes",
        "",
        "- Add side chat support.",
        "- Prevent stale titles.",
        "- Reduce rendering work.",
        "- Remove the legacy settings format.",
        "",
      ].join("\n"),
    );
  });

  it("uses a breaking footer to include an otherwise hidden type", () => {
    expect(releaseNoteForCommit("refactor: replace settings storage\n\nBREAKING-CHANGE: existing settings are reset")).toBe(
      "Replace settings storage.",
    );
  });

  it("leaves an editable placeholder when no commits belong in the notes", () => {
    expect(renderReleaseNotes(["test: cover release generation", "ci: validate commit messages"])).toBe("## Changes\n\n- \n");
  });
});
