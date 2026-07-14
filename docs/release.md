# Release

GitHub Releases attach only `main.js`, `manifest.json`, and `styles.css` as Obsidian install assets. `LICENSE` and `NOTICE` are kept in the repository and source archives for license distribution.

Release work is Jujutsu-first in a colocated Git repository; Git is still used to push the tag that triggers the GitHub Release workflow. If the checkout has not been initialized for Jujutsu yet, run `jj git init --colocate` and `jj bookmark track main --remote=origin` once.

Plugin versions use SemVer-shaped numbers for Obsidian distribution, but they are not a library API compatibility contract. Prefer patch releases for fixes, dependency updates, internal changes, and compatibility refreshes that preserve existing workflows, including routine Codex CLI app-server compatibility updates. Prefer minor releases for user-visible capabilities, settings, workflow additions, or supported-runtime baseline changes such as raising the minimum supported Obsidian app/API version. Reserve major releases for disruptive workflow, settings, storage, or support-policy changes.

Create a release by preparing the next version, reviewing and editing the generated release notes, committing the release changes, then running the preflight before pushing the matching tag:

```sh
npm run release:prepare -- X.Y.Z
# Review and edit .github/release-notes/X.Y.Z.md.
jj status
jj commit -m "chore(release): X.Y.Z"
jj bookmark move main --to @-
npm run release:preflight
jj tag set X.Y.Z -r main
jj git push --remote origin --bookmark main
git push origin X.Y.Z
```

`release:prepare` updates the version files and generates a `## Changes` release notes draft from Conventional Commits after the previous version tag. It includes `feat`, `fix`, `perf`, and commits marked as breaking changes; other commit types are omitted. Review the generated bullets for user-facing wording, combine related implementation commits, and reorder them by importance before committing. If there are no included commits, preparation leaves an empty bullet to replace manually.

`release:preflight` verifies all commit messages since the previous tag, the local Jujutsu/Git state, release metadata, API baselines, lockfile, and the same `npm run check` validation used by CI after the release commit is on `main`.

Release notes should normally include only user-facing changes. Internal implementation changes, validation details, and release procedure notes should be omitted when minor; when they are important enough to mention, group them into at most one concise bullet.

The release workflow runs `npm ci`, `npm run release:check`, `npm run check`, attaches the install assets, and generates GitHub artifact attestations for them. The release notes file is required and must contain a single `## Changes` section. If a tag-triggered release fails before creating the GitHub Release, fix the commit, move the local tag with `jj tag set --allow-move -r main X.Y.Z`, then update the remote tag with `git push --force origin X.Y.Z`.
