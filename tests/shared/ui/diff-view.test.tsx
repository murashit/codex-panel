// @vitest-environment jsdom

import { describe, expect, it, onTestFinished } from "vitest";

import { UnifiedDiffView, unifiedDiffDisplayLines } from "../../../src/shared/ui/diff-view";
import { renderUiRoot, unmountUiRoot } from "../../../src/shared/ui/preact-root.dom";

describe("unified diff display lines", () => {
  it("keeps added-file diffs readable after simplifying headers", () => {
    expect(
      unifiedDiffDisplayLines(
        "diff --git a/new-note.md b/new-note.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/new-note.md\n@@\n+hello",
      ),
    ).toEqual([
      { text: "new-note.md", kind: "file" },
      { text: "new file mode 100644", kind: "context" },
      { text: "@@", kind: "hunk" },
      { text: "+hello", kind: "added" },
    ]);
  });

  it("keeps body markers distinct from headers across Git hunks and files", () => {
    expect(
      unifiedDiffDisplayLines(
        "diff --git a/note.md b/note.md\nindex 111..222\n--- a/note.md\n+++ b/note.md\n@@ -1 +1 @@\n+++ frontmatter\n--- removed marker\n@@ -3 +3 @@\n-old\n+new\ndiff --git a/next.md b/next.md\n--- a/next.md\n+++ b/next.md\n@@ -1 +1 @@\n-before\n+after",
      ),
    ).toEqual([
      { text: "note.md", kind: "file" },
      { text: "@@ -1 +1 @@", kind: "hunk" },
      { text: "+++ frontmatter", kind: "added" },
      { text: "--- removed marker", kind: "removed" },
      { text: "@@ -3 +3 @@", kind: "hunk" },
      { text: "-old", kind: "removed" },
      { text: "+new", kind: "added" },
      { text: "next.md", kind: "file" },
      { text: "@@ -1 +1 @@", kind: "hunk" },
      { text: "-before", kind: "removed" },
      { text: "+after", kind: "added" },
    ]);
  });

  it("decodes Git-quoted non-ASCII file paths", () => {
    expect(
      unifiedDiffDisplayLines(
        'diff --git "a/\\346\\227\\245\\346\\234\\254\\350\\252\\236.md" "b/\\346\\227\\245\\346\\234\\254\\350\\252\\236.md"\nindex 111..222 100644\n--- "a/\\346\\227\\245\\346\\234\\254\\350\\252\\236.md"\n+++ "b/\\346\\227\\245\\346\\234\\254\\350\\252\\236.md"\n@@ -1 +1 @@\n-old\n+new',
      ),
    ).toEqual([
      { text: "日本語.md", kind: "file" },
      { text: "@@ -1 +1 @@", kind: "hunk" },
      { text: "-old", kind: "removed" },
      { text: "+new", kind: "added" },
    ]);
  });

  it("uses authoritative rename and deleted-file paths from parsed Git metadata", () => {
    expect(
      unifiedDiffDisplayLines(
        "diff --git a/old.md b/old.md\nsimilarity index 100%\nrename from old.md\nrename to renamed.md\ndiff --git a/deleted.md b/deleted.md\ndeleted file mode 100644\n--- a/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-old",
      ),
    ).toEqual([
      { text: "renamed.md", kind: "file" },
      { text: "similarity index 100%", kind: "context" },
      { text: "rename from old.md", kind: "context" },
      { text: "rename to renamed.md", kind: "context" },
      { text: "deleted.md", kind: "file" },
      { text: "deleted file mode 100644", kind: "context" },
      { text: "@@ -1 +0,0 @@", kind: "hunk" },
      { text: "-old", kind: "removed" },
    ]);
  });

  it("keeps malformed patches readable as raw text", () => {
    const malformed = 'diff --git "unterminated\nindex 111..222\n-old\n+new';

    expect(unifiedDiffDisplayLines(malformed).map((line) => line.text)).toEqual(malformed.split("\n"));
  });

  it("keeps parsed patches with an empty filename readable as raw text", () => {
    const malformed = "diff --git a/ b/\nindex 111..222\n--- a/\n+++ b/\n@@ -1 +1 @@\n-old\n+new";

    expect(unifiedDiffDisplayLines(malformed).map((line) => line.text)).toEqual(malformed.split("\n"));
  });
});

describe("shared diff rendering", () => {
  it.each([
    { name: "English words", before: "The quick brown fox", after: "The quick red fox", removed: "brown", added: "red" },
    { name: "Japanese words", before: "吾輩は猫である", after: "吾輩は犬である", removed: "猫", added: "犬" },
    { name: "whitespace-only changes", before: "alpha beta", after: "alpha  beta", removed: " ", added: "  " },
  ])("highlights changed $name", ({ before, after, removed, added }) => {
    const parent = renderDiff(`diff --git a/Note.md b/Note.md\n@@\n-${before}\n+${after}`);

    expect(parent.textContent).toContain(before);
    expect(parent.textContent).toContain(after);
    expect(parent.querySelector(".codex-panel-diff__word--removed")?.textContent).toBe(removed);
    expect(parent.querySelector(".codex-panel-diff__word--added")?.textContent).toBe(added);
  });

  it("pairs changed words by line inside multi-line replacement blocks", () => {
    const parent = renderDiff(
      [
        "diff --git a/Note.md b/Note.md",
        "@@",
        "-これはdiffのテストです。",
        "-今日は元気です。",
        "-とても元気です。",
        "+これはdiffのてすとです。",
        "+きょうはげんきです。",
        "+とてもげんきです。",
      ].join("\n"),
    );

    const removedHighlights = Array.from(parent.querySelectorAll(".codex-panel-diff__word--removed"), (element) => element.textContent);
    const addedHighlights = Array.from(parent.querySelectorAll(".codex-panel-diff__word--added"), (element) => element.textContent);

    expect(removedHighlights).toEqual(["テスト", "今日", "元気", "元気"]);
    expect(addedHighlights).toEqual(["てすと", "きょう", "げんき", "げんき"]);
    expect(removedHighlights).not.toContain("これはdiffのテスト");
  });

  it("falls back to line-level rendering for large intraline candidates", () => {
    const oldText = `start ${"old ".repeat(600)}end`;
    const newText = `start ${"new ".repeat(600)}end`;
    const parent = renderDiff(`diff --git a/Note.md b/Note.md\n@@\n-${oldText}\n+${newText}`);

    expect(parent.textContent).toContain(oldText);
    expect(parent.textContent).toContain(newText);
    expect(parent.querySelector(".codex-panel-diff__word")).toBeNull();
  });
});

function renderDiff(diff: string): HTMLElement {
  const parent = document.createElement("div");
  onTestFinished(() => unmountUiRoot(parent));
  renderUiRoot(parent, <UnifiedDiffView diff={diff} />);
  return parent;
}
