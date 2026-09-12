---
name: codex-panel-release
description: Prepare, publish, or repair a Codex Panel release, including version selection and public release notes.
---

# Codex Panel Release

Follow `docs/release.md` for version policy, commands, preflight, commit boundaries, and recovery. GitHub Actions owns release creation and asset attachment; do not create a release locally with `gh release create`.

## Determine the release contents

Use the range audit and release-note drafting procedure in `docs/release.md`. Inspect relevant diffs, tests, and callers to establish actual before/after behavior. Distinguish visible Panel behavior from hidden agent context or protocol metadata, and keep each proposed bullet traceable to implementation evidence.

## Prepare and publish

Prepare the version and final notes, then follow the approval checkpoint in `docs/release.md`: present the notes, version, and included range and stop before the release commit, tag, or push. A general request such as “let’s release” does not waive this checkpoint.

After approval, follow the documented commit, preflight, tag, and push procedure. Verify the Actions result and expected assets before reporting publication complete.

If publication fails, inspect whether a release or assets already exist before selecting the documented recovery procedure. Do not infer authorization to rewrite a published tag from authorization to prepare a release.
