# Release

GitHub Releases attach only `main.js`, `manifest.json`, and `styles.css` as Obsidian install assets. `LICENSE` and `NOTICE` are kept in the repository and source archives for license distribution.

Release work is Jujutsu-first in a colocated Git repository; Git is still used to push the tag that triggers the GitHub Release workflow. If the checkout has not been initialized for Jujutsu yet, run `jj git init --colocate` and `jj bookmark track main --remote=origin` once.

Plugin versions are for Obsidian distribution, not a library API compatibility contract. Use patch releases for workflow-preserving changes, minor releases for visible capabilities or raised runtime baselines, and major releases for disruptive workflow, settings, storage, or support-policy changes.

Analyze the release before choosing its version or changing version files:

```sh
npm run release:notes -- <previous-tag>
jj log -r '<previous-tag>..main'
jj diff --from <previous-tag> --to main
```

`release:notes` produces a non-mutating candidate draft from selected Conventional Commits; it is neither exhaustive nor authoritative. Compare the full range with the previous release, confirm the actual user-facing changes, and scan omitted commits for changes that affect versioning or release notes. Choose the version using the policy above, group related commits by behavior, and draft concise public-facing notes.

## Release note drafting

Release notes are a short public summary of user-visible behavior, not a changelog of commit subjects. Review the previous three release-note files (or all available files when fewer exist) for style, then compare the complete release range with the implementation and tests. Group related commits into a small number of concrete before/after outcomes and omit internal work unless it changes a user-visible contract or support baseline.

Use the existing notes as the style reference and the audited diff as the factual reference. Keep the final file to one short `## Changes` section in the same language as the existing release notes.

After choosing the version, prepare it, replace the generated draft with the reviewed notes, commit the release changes, and run the preflight before pushing the matching tag:

```sh
npm run release:prepare -- X.Y.Z
# Replace .github/release-notes/X.Y.Z.md with the reviewed release notes.
jj status
jj commit -m "chore(release): X.Y.Z"
jj bookmark move main --to @-
npm run release:preflight
jj tag set X.Y.Z -r main
jj git push --remote origin --bookmark main
git push origin X.Y.Z
```

`release:prepare` updates version files and writes a replaceable `## Changes` draft from the same Conventional Commit candidates. It validates only that the requested version is the next patch, minor, or major version; it does not decide which increment is appropriate.

Run `release:preflight` after the release commit is on `main`; it validates the release commit, installs the exact lockfile dependencies with `npm ci --ignore-scripts`, fails if `npm audit --omit=dev --audit-level=low` finds a known vulnerability in a runtime dependency or cannot complete the audit, and runs the same checks used by the release workflow. Do not rely on an existing `node_modules` directory or on `npm ci --dry-run`.

The release commit must be named `chore(release): X.Y.Z` and may contain only the version metadata and `.github/release-notes/X.Y.Z.md`. Formatting, generated output, and unrelated fixes belong in earlier commits.

The release notes file must contain a single `## Changes` section. The tag-triggered workflow validates and publishes the install assets. If it fails before creating the GitHub Release, fix the commit, move the local tag with `jj tag set --allow-move -r main X.Y.Z`, then update the remote tag with `git push --force origin X.Y.Z`.
