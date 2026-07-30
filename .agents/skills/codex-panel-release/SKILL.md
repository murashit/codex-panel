---
name: codex-panel-release
description: Use when preparing, checking, committing, tagging, pushing, or repairing a Codex Panel release, including version bumps, release notes, release preflight, tag-triggered GitHub Releases, or Obsidian Community release review.
---

# Codex Panel Release

`docs/release.md` is the public procedure and source of truth for the release command sequence. This skill adds agent-facing gates, review duties, and failure handling.

## Ground Rules

- Read and follow `docs/release.md`; do not maintain a parallel release command sequence here.
- Do not create GitHub Releases locally with `gh release create`; the tag-triggered GitHub Actions workflow owns release creation and asset attachment.
- Treat generated release-note entries as search candidates, not evidence of user-facing behavior. Commit type and subject can both misclassify the audience or impact.
- Distinguish behavior visible in Panel UI from hidden context, protocol, or agent-facing behavior. Describe the actual user benefit without implying a UI notification or control that does not exist.
- Keep one short, public-facing `## Changes` section. Group related commits by behavior and omit internal or procedural detail.
- Treat the lockfile as authoritative: run the preflight only after it has replaced `node_modules` with `npm ci --ignore-scripts`.
- Keep the release commit limited to `chore(release): X.Y.Z`, version metadata, and `.github/release-notes/X.Y.Z.md`; formatting and generated changes must be separate earlier commits.

## Review And Release Procedure

1. Read `docs/release.md`, inspect the current version metadata, and read the previous three release-note files to establish the established style before inspecting the candidate range.
2. Identify the previous released tag and complete commit range, then run `npm run release:notes -- <previous-tag>` without choosing the target version yet.
3. Audit the range before drafting:
   - Read each candidate's full diff, relevant tests, and call path far enough to determine the previous and new user-observable behavior and the audience of any messages or metadata.
   - Scan non-candidate commits, including `refactor`, `chore`, dependency, merge, and documentation changes, for hidden capabilities, regressions, baseline changes, or disruptive behavior.
   - Combine related implementation commits into behavioral changes instead of producing one bullet per commit.
   - Keep an evidence map from each proposed bullet to its implementation and tests; classify omitted work as intentionally internal when it has no public-facing effect.
4. Choose the target version from the highest-impact behavior using the policy in `docs/release.md`, and draft the public-facing bullets from the audited behavior rather than commit subjects.
5. Run `npm run release:prepare -- X.Y.Z`, replace its generated draft with the reviewed bullets in the established release-note style, and inspect the complete release diff.
6. Ask once for approval of the version, final bullets, and included range before committing. If the user approves subject to a concrete wording correction, apply it and continue without another approval unless the correction makes scope, version, or meaning ambiguous.
7. After approval, follow `docs/release.md` through preflight, tag, and push. Let GitHub Actions create or update the GitHub Release, then verify the workflow and expected assets.

## Release-note style

Use the recent release notes as a consistency check, not as a source of commit-by-commit wording. Before drafting, read the latest 20–30 files:

```sh
for file in $(rg --files .github/release-notes | sort -V | tail -n 30); do
  sed -n '1,120p' "$file"
done
```

Write a short, user-facing `## Changes` section with 1–5 bullets. Keep each bullet to one sentence, start with a direct present-tense verb (`Add`, `Improve`, `Fix`, `Prevent`, `Keep`, or `Update`), and end it with a period. Describe the visible outcome and the affected workflow in plain English; combine related fixes into one outcome when useful.

Omit implementation mechanics and internal work such as query/cache layers, coordinators, invalidation notifications, DOM order, refactors, tests, and release plumbing. Mention a protocol or compatibility detail only when it changes what users can run or do. Prefer concrete product terms such as thread lists, chat panels, settings, archived threads, the composer, and diff views. Do not claim a notification, control, or user-facing behavior that the implementation does not provide.

Before committing, read the notes as a user: remove details that explain how the change works rather than why it matters, check that every bullet is supported by the audited diff and tests, and confirm there is only one `## Changes` heading.

## Failure Handling

- If the tag-triggered workflow fails before GitHub Release creation, use the repair procedure in `docs/release.md`.
- If a GitHub Release already exists or was partially created, inspect the state before taking action; do not assume local asset upload is the right recovery path.
