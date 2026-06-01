---
name: codex-panel-release
description: Use when preparing, checking, committing, tagging, pushing, or repairing a Codex Panel release, including version bumps, release notes, release preflight, tag-triggered GitHub Releases, or Obsidian Community release review.
---

# Codex Panel Release

Use this skill when delegating Codex Panel release work to an agent. `docs/release.md` is the public procedure and source of truth for the release command sequence. This skill adds agent-facing gates, review duties, and failure handling.

## Ground Rules

- Read and follow `docs/release.md`; do not maintain a parallel release command sequence here.
- Do not assume local Git hooks exist or ran. Run required verification commands explicitly.
- Do not create GitHub Releases locally with `gh release create`; the tag-triggered GitHub Actions workflow owns release creation and asset attachment.
- Keep internal validation notes, procedural details, and implementation reasoning out of release notes.
- Release notes must be short, public-facing bullets under the single `## Changes` section required by `docs/release.md`.

## Delegation Procedure

1. Read `docs/release.md`, `package.json`, `manifest.json`, `versions.json`, and existing `.github/release-notes/` files.
2. Identify the target release version and the commit range since the previous released tag.
3. Follow the preparation step in `docs/release.md`.
4. Draft `.github/release-notes/X.Y.Z.md` from the full diff since the previous released tag, not only the latest commit.
5. Before committing, ask the user to approve the release version, release-note bullets, and included commit range.
6. After approval, follow `docs/release.md` for the commit, preflight, tag, and push sequence.
7. After pushing, let GitHub Actions create or update the GitHub Release.

## Failure Handling

- If a release script or preflight fails, fix the cause and rerun the explicit failed command.
- If the tag-triggered workflow fails before GitHub Release creation, use the repair procedure in `docs/release.md`.
- If a GitHub Release already exists or was partially created, inspect the state before taking action; do not assume local asset upload is the right recovery path.
