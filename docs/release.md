# Release

The [release workflow](../.github/workflows/check.yml) maintains a tagpr release PR as main advances. GitHub Releases attach `main.js`, `manifest.json`, and `styles.css`; Community publication remains a separate operation.

The repository must enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General → Workflow permissions. Approve release-PR check runs if GitHub requires it.

## Prepare the release PR and notes

Audit the complete range from the previous release tag to the proposed head before choosing the version and notes. Plugin versions describe Obsidian distribution, not a library API contract: use patch releases for workflow-preserving changes, minor releases for visible capabilities or raised runtime baselines, and major releases for disruptive workflow, settings, storage, or support-policy changes.

Review tagpr's proposed version. The `tagpr:minor` and `tagpr:major` labels take effect on the next refresh; wait for it and verify the version. Adding a label immediately before merge does not change the version. Alternatively, edit `package.json` and `manifest.json` on the PR branch, then run `node scripts/release/sync-lock.mjs` there. For runtime-floor changes, follow [Obsidian compatibility](development.md#obsidian).

Read the previous three published releases or historical `.github/release-notes/` files for style. Summarize user-visible outcomes in the same language, grouping related changes and omitting internal work unless it changes a visible contract or support baseline. Thank relevant Issue authors by GitHub handle for reports or proposals that contributed to the release; verify authors from the Issues.

Replace the entire PR body with the final public notes: one `## Changes` section, a blank line, and concrete bullets. The merged PR body becomes the release notes; no new per-version note file is needed.

## Make the publication decision

Merge only when the final notes, version, included range, and checks are ready: merging initiates tagging and publication automatically through the [workflow](../.github/workflows/check.yml) and [draft publisher](../scripts/release/publish.mjs).

Finalize immediately before merging because tagpr refreshes overwrite edited PR bodies. Avoid concurrent main pushes and PR-body edits during finalization. Re-fetch the body, head, version files, main/base SHA, and check results before merging; reconsider the decision if the contents or range changed. An expected-head merge guard (`gh pr merge --match-head-commit HEAD_SHA`) protects the head SHA, not body edits.

## Verify the result or recover

Monitor the run, verify the merged PR body still matches the final notes, and confirm the published release has those notes and all three install assets before considering the release complete.

If interrupted, inspect the run, exact tag, merged PR, and current release/assets before retrying, especially if publication may have succeeded. Do not rerun tagpr to recreate an existing tag, move a tag, or overwrite a published release as a routine retry.

For an existing tag and draft, dispatch Check on main with the tag and merged release PR number:

```sh
gh workflow run check.yml --ref main -f tag=X.Y.Z -f release_pr=NUMBER
```

Recovery uses main's workflow and publisher, rebuilds the specified tag, and replaces partial draft uploads before publishing. The tag must be an ancestor of main and match the checked assets and merged release PR. Merge any workflow or publisher repair through a reviewed PR first; keep the existing tag unchanged.

If the tag exists but its draft is missing, verify the merged PR's final notes and create only that draft with `gh release create X.Y.Z --draft --verify-tag --notes-file FINAL_NOTES_FILE`, then use recovery above.
