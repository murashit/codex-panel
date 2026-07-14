---
name: codex-panel-release
description: Use when preparing, checking, committing, tagging, pushing, or repairing a Codex Panel release, including version bumps, release notes, release preflight, tag-triggered GitHub Releases, or Obsidian Community release review.
---

# Codex Panel Release

`docs/release.md` is the public procedure and source of truth for the release command sequence. This skill adds agent-facing gates, review duties, and failure handling.

## Ground Rules

- Read and follow `docs/release.md`; do not maintain a parallel release command sequence here.
- Do not create GitHub Releases locally with `gh release create`; the tag-triggered GitHub Actions workflow owns release creation and asset attachment.
- Treat generated release notes as a draft. Review the full release diff and keep one short, public-facing `## Changes` section without internal or procedural detail.

## Delegation Procedure

1. Read `docs/release.md` and inspect the current version metadata and recent release notes.
2. Identify the target release version and the commit range since the previous released tag.
3. Inspect the full release diff, run preparation as documented, and edit the draft for completeness, accuracy, and user-facing wording.
4. Before committing, ask the user to approve the release version, reviewed release-note bullets, and included commit range.
5. After approval, follow `docs/release.md` through preflight, tag, and push. Let GitHub Actions create or update the GitHub Release.

## Failure Handling

- If the tag-triggered workflow fails before GitHub Release creation, use the repair procedure in `docs/release.md`.
- If a GitHub Release already exists or was partially created, inspect the state before taking action; do not assume local asset upload is the right recovery path.
