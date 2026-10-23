# Release

The [release workflow](../.github/workflows/check.yml) uses tagpr to maintain the release PR and tag the approved merge. The [publisher](../scripts/release/publish.mjs) alone creates the draft with the merged PR body, attaches the checked `main.js`, `manifest.json`, and `styles.css`, verifies their digests, and publishes it. This follows [tagpr’s downstream release ownership](https://github.com/Songmu/tagpr/blob/v1.21.3/docs/guides/immutable-releases.md#let-another-workflow-create-the-release); tagpr does not generate a separate release draft.

The repository must enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General → Workflow permissions. Approve release-PR check runs if GitHub requires it.

## Prepare the release PR and notes

Audit the complete range from the previous release tag to the proposed head before choosing the version and notes. Plugin versions describe Obsidian distribution, not a library API contract: use patch releases for workflow-preserving changes, minor releases for visible capabilities or raised runtime baselines, and major releases for disruptive workflow, settings, storage, or support-policy changes.

Review tagpr's proposed version. The `tagpr:minor` and `tagpr:major` labels take effect on the next refresh; wait for it and verify the version. Adding a label immediately before merge does not change the version. Alternatively, edit `package.json` and `manifest.json` on the PR branch, then run `node scripts/release/sync-lock.mjs` there. For runtime-floor changes, follow [Obsidian compatibility](development.md#obsidian).

Read the previous three published [GitHub Releases](https://github.com/murashit/codex-panel/releases) for style. Summarize user-visible outcomes in the same language, grouping related changes and omitting internal work unless it changes a visible contract or support baseline. Thank relevant Issue authors by GitHub handle for reports or proposals that contributed to the release; verify authors from the Issues.

Replace the entire PR body with the final public notes: one `## Changes` section, a blank line, and concrete bullets. The merged PR body becomes the release notes; no new per-version note file is needed.

## Make the publication decision

Merge only when the final notes, version, included range, and checks are ready: merging initiates tagging and publication automatically through the [workflow](../.github/workflows/check.yml) and [draft publisher](../scripts/release/publish.mjs).

Finalize immediately before merging because tagpr refreshes overwrite edited PR bodies. Avoid concurrent main pushes and PR-body edits during finalization. Re-fetch the body, head, version files, main/base SHA, and check results before merging; reconsider the decision if the contents or range changed. An expected-head merge guard (`gh pr merge --match-head-commit HEAD_SHA`) protects the head SHA, not body edits.

## Verify the result or recover

Monitor the run, verify the merged PR body still matches the final notes, and confirm the published release has those notes and all three install assets before considering the release complete.

If interrupted, inspect the run, exact tag, merged PR, and current release/assets before retrying, especially if publication may have succeeded. Do not rerun tagpr to recreate an existing tag, move a tag, or overwrite a published release as a routine retry.

For an existing tag, dispatch Check on main with only the tag:

```sh
gh workflow run check.yml --ref main -f tag=X.Y.Z
```

Normal publication and recovery both obtain the notes from the unique tagpr PR merged at that tag's commit. Recovery uses main's workflow and publisher to rebuild and check the immutable tag; it must be an ancestor of main. The attestation records both the repaired workflow and the actual tagged build source. Standard attestation defaults alone would identify main, not the separately checked-out tag.

The publisher creates a missing draft, resumes partial uploads only while the same release is a draft, and requires its notes to remain identical to the merged PR body. An already published release is verified without modification; any notes, asset, or source mismatch fails instead of overwriting it. Do not manually replace draft metadata to bypass a mismatch.

Rerunning a failed job uses that run's original workflow code. After a workflow or publisher repair, merge the reviewed fix first and start a new dispatch on main. Keep the existing tag unchanged; no PR number or release ID is needed.

## Verify Community publication

GitHub publication and the Community directory are separate states. In the [Codex Panel management dashboard](https://community.obsidian.md/account/plugins/codex-panel), check for an existing submission before submitting or publishing the version. If the directory has not detected the GitHub release, use **Check for new releases** as described in the [Community FAQ](https://docs.obsidian.md/community-directory/faq). After publication, verify **Current release**, review **Completed**, and build match **Pass**; report any pending review or verification separately. This requires the owner's signed-in Obsidian account; GitHub credentials do not grant access to the dashboard.
