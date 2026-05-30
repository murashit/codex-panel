import { describe, expect, it } from "vitest";

import { displayDiffLines } from "../../../src/shared/diff/unified";

describe("unified diff display lines", () => {
  it("simplifies git diff file headers for turn diff display", () => {
    expect(
      displayDiffLines(
        "diff --git a/days/2026-05-16.md b/days/2026-05-16.md\nindex 111..222\n--- a/days/2026-05-16.md\n+++ b/days/2026-05-16.md\n@@\n-old\n+new",
      ),
    ).toEqual([{ text: "days/2026-05-16.md", kind: "file" }, { text: "@@" }, { text: "-old" }, { text: "+new" }]);
  });

  it("keeps added-file diffs readable after simplifying headers", () => {
    expect(
      displayDiffLines(
        "diff --git a/new-note.md b/new-note.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/new-note.md\n@@\n+hello",
      ),
    ).toEqual([{ text: "new-note.md", kind: "file" }, { text: "new file mode 100644" }, { text: "@@" }, { text: "+hello" }]);
  });

  it("keeps body lines that look like file markers after the hunk starts", () => {
    expect(
      displayDiffLines(
        "diff --git a/note.md b/note.md\nindex 111..222\n--- a/note.md\n+++ b/note.md\n@@\n+++ frontmatter\n--- removed marker",
      ),
    ).toEqual([{ text: "note.md", kind: "file" }, { text: "@@" }, { text: "+++ frontmatter" }, { text: "--- removed marker" }]);
  });
});
