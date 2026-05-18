---
name: codex-panel-release
description: Use when preparing, checking, committing, tagging, pushing, or repairing a Codex Panel release, including version bumps, release notes, release preflight, tag-triggered GitHub Releases, or Obsidian Community release review.
---

# Codex Panel Release

Use this skill for Codex Panel release work. `docs/release.md` is the public procedure and source of truth for user-facing release commands. This skill adds Codex-facing gates and handling details.

## Ground Rules

- Do not assume local Git hooks exist or ran. Run required verification commands explicitly.
- Do not create GitHub Releases locally with `gh release create`; the tag-triggered GitHub Actions workflow creates or updates the GitHub Release and attaches `main.js`, `manifest.json`, and `styles.css`.
- Keep internal validation notes, procedural details, and implementation reasoning out of release notes.
- Release notes must be short, public-facing bullets under a single `## Changes` section.

## Procedure

1. Read `docs/release.md`, `package.json`, `manifest.json`, `versions.json`, and existing `.github/release-notes/` files.
2. Identify the target release version and the commit range since the previous released tag.
3. Run `npm run release:prepare -- X.Y.Z`.
4. Draft `.github/release-notes/X.Y.Z.md` from the full diff since the previous released tag, not only the latest commit.
5. Before committing, ask the user to approve the release version, release-note bullets, and included commit range. Do not commit, tag, or push before this approval.
6. Commit only intended release metadata and release notes with `Bump version to X.Y.Z`.
7. Run `npm run release:preflight` after the release commit and before tagging.
8. Tag with `X.Y.Z`, then push `main` and the tag together.
9. Let GitHub Actions create or update the GitHub Release.

## Failure Handling

- If `release:prepare`, `release:check`, or `release:preflight` fails, fix the cause and rerun the explicit command.
- If the tag-triggered workflow fails before GitHub Release creation, fix the release commit, move the local tag with `git tag -f X.Y.Z`, and force-update the remote tag.
- If a GitHub Release already exists or was partially created, inspect the state before taking action; do not assume local asset upload is the right recovery path.
