# Release

GitHub Releases attach only `main.js`, `manifest.json`, and `styles.css` as Obsidian install assets. `LICENSE` and `NOTICE` are kept in the repository and source archives for license distribution.

Release work is Jujutsu-first in a colocated Git repository; Git is still used to push the tag that triggers the GitHub Release workflow. If the checkout has not been initialized for Jujutsu yet, run `jj git init --colocate` and `jj bookmark track main --remote=origin` once.

Plugin versions are for Obsidian distribution, not a library API compatibility contract. Use patch releases for workflow-preserving changes, minor releases for visible capabilities or raised runtime baselines, and major releases for disruptive workflow, settings, storage, or support-policy changes.

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

`release:prepare` updates version files and drafts `## Changes` from selected Conventional Commits since the previous version. Use those commits to locate candidate changes, then compare the resulting user-visible behavior with the previous release before choosing the version. Review the draft against the full diff for complete, user-facing notes; consolidate and reorder entries as needed, and replace an empty placeholder.

Run `release:preflight` after the release commit is on `main`; it validates the commit range and release readiness.

Release notes should normally include only user-facing changes. Internal implementation changes, validation details, and release procedure notes should be omitted when minor; when they are important enough to mention, group them into at most one concise bullet.

The release notes file must contain a single `## Changes` section. The tag-triggered workflow validates and publishes the install assets. If it fails before creating the GitHub Release, fix the commit, move the local tag with `jj tag set --allow-move -r main X.Y.Z`, then update the remote tag with `git push --force origin X.Y.Z`.
