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
- Treat the release notes produced by `release:prepare` as a draft. Conventional Commit types select candidate bullets, but the full release diff remains the source for checking completeness and user-facing accuracy.

## Delegation Procedure

1. Read `docs/release.md`, `package.json`, `manifest.json`, `versions.json`, and existing `.github/release-notes/` files.
2. Identify the target release version and the commit range since the previous released tag.
3. Inspect the full diff since the previous released tag, then follow the preparation step in `docs/release.md`; it updates version files and generates `.github/release-notes/X.Y.Z.md` from Conventional Commits.
4. Review the generated draft against the full diff. Rewrite bullets for users, combine related implementation commits, reorder by importance, add an omitted user-facing change when a commit was misclassified, and replace the empty placeholder when no candidate commit was generated.
5. Before committing, ask the user to approve the release version, reviewed release-note bullets, and included commit range.
6. After approval, follow `docs/release.md` for the Conventional Commit, preflight, tag, and push sequence. Do not rely on a local hook; preflight explicitly checks commits since the previous version in `versions.json`.
7. After pushing, let GitHub Actions create or update the GitHub Release.

## Failure Handling

- If a release script or preflight fails, fix the cause and rerun the explicit failed command.
- If the tag-triggered workflow fails before GitHub Release creation, use the repair procedure in `docs/release.md`.
- If a GitHub Release already exists or was partially created, inspect the state before taking action; do not assume local asset upload is the right recovery path.
