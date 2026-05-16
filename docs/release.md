# Release

GitHub Releases attach only `main.js`, `manifest.json`, and `styles.css` as Obsidian install assets. `LICENSE` and `NOTICE` are kept in the repository and source archives for license distribution.

Create a release by preparing the next version, editing the generated release notes, committing the release changes, then running the preflight before pushing the matching tag:

```sh
npm run release:prepare -- X.Y.Z
# Edit .github/release-notes/X.Y.Z.md.
git status --short
git add package.json package-lock.json manifest.json versions.json .github/release-notes/X.Y.Z.md
git commit -m "Bump version to X.Y.Z"
npm run release:preflight
git tag X.Y.Z
git push origin main X.Y.Z
```

`release:prepare` updates the version files and creates a `## Changes` release notes template. `release:preflight` verifies the local Git state, release metadata, lockfile, and full build once after the release commit is on `main`.

The release workflow runs `npm ci`, `npm run release:check`, `npm run check`, attaches the install assets, and generates GitHub artifact attestations for them. The release notes file is required and must contain a single `## Changes` section. If a tag-triggered release fails before creating the GitHub Release, fix the commit, move the local tag with `git tag -f X.Y.Z`, then update the remote tag with `git push --force origin X.Y.Z`.
