# Automation

Use this guide to diagnose CI and operate scheduled workflows. For ordinary change validation, see [Development](development.md#validate-a-change); for publication and release recovery, see [Release](release.md).

## Diagnose a CI Failure

Local `check` uses Vitest's default worker count for the available CPUs. GitHub Actions uses one worker and shuffles files and tests. To reproduce a CI test failure locally, use `npm run test:order -- --sequence.seed <reported-seed>`. On POSIX shells, `CI=1 npm run check` runs that test mode alongside the other local checks when diagnosis requires them. Use shuffled single-worker tests when investigating order dependence or relevant changes to shared test setup or runner configuration; a successful ordinary check does not routinely require a second run in CI mode.

## Weekly Mutation Runs

The [Mutation workflow](../.github/workflows/mutation.yml) runs the full configured scope every Monday at 04:00 JST (Sunday 19:00 UTC).

Run it manually with `gh workflow run mutation.yml`. Add `-f force=true` to rerun every mutant without restoring a checkpoint.

Download a run's artifact:

```sh
gh run list --workflow mutation.yml --limit 5
gh run download RUN_ID --pattern 'mutation-*' --dir /tmp/mutation-RUN_ID
```

Check the execution step's outcome and `run.json` (`commit` and `completed`) before opening `mutation.html` or reading `mutation.json`. Completion requires successful execution and a final report. Finalization records available diagnostics and checkpoints even when execution is incomplete. Metadata also records the baseline source, whether reuse was enabled, and Stryker's reused-mutant count (unknown if interrupted before analysis).

The workflow restores the newest valid checkpoint from its completed runs on `main`, including timed-out runs. Stryker decides which results to reuse from changes to mutated source, tests, and their coverage; expanding the mutation scope preserves eligible previous results. Missing, expired, or invalid checkpoints start a cold run.

[Stryker's incremental analysis](https://stryker-mutator.io/docs/stryker-js/incremental/#limitations) compares mutant and test ranges, without inferring effects from shared setup, dependencies, or other configuration and environment changes. When those changes can affect results, use `-f force=true` for the workflow or `--force` locally.

Result and `mutation-baseline-*` checkpoint artifacts are retained for 90 days, subject to repository limits. Execution is limited to 120 minutes plus 60 seconds of termination grace so Stryker can save partial progress. Failed runs retain available checkpoints, metadata, and full logs; forced termination or cancellation can prevent checkpoint saving or artifact upload.

For occasional local runs on Linux with GNU `timeout`, `node scripts/mutation/run.mjs` uses a valid local checkpoint; add `--force` to rerun every mutant. Use the native `npm run test:mutation -- <Stryker options>` command for focused diagnostics.

## Codex CLI Update Automation

The Codex CLI update workflow checks upstream stable releases every four hours and can be dispatched on main. It proposes only a newer major/minor series, using the latest stable patch, with the marker `<!-- codex-cli-update: X.Y -->` and branch `automation/codex-cli-X.Y`. Generated bindings and metadata are a starting point for compatibility review, not runtime verification; follow the [App-Server Update skill](../.agents/skills/codex-panel-app-server-update/SKILL.md). Existing PRs and branches are never overwritten. If a run pushed a branch but could not create its PR, inspect the branch and create the PR manually or remove the branch before retrying. Acquisition or generation failures leave no branch and can be retried.

## GitHub App Setup

To enable update PR creation, install the dedicated GitHub App only on this repository with Contents and Pull requests write and Issues read. Store its client ID and private key in Actions secrets `CODEX_PANEL_APP_CLIENT_ID` and `CODEX_PANEL_APP_PRIVATE_KEY`. The workflow requires both; it does not fall back to `GITHUB_TOKEN`. After setup, dispatch it on main when a newer series is available and verify the generated PR and its automatically started checks. No App setup, runtime compatibility, or end-to-end PR creation is verified by merging the workflow alone.

Tagpr uses this dedicated GitHub App when both App secrets are configured. Its PR checks then start automatically. With neither secret configured, tagpr retains `GITHUB_TOKEN`: the repository must enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General → Workflow permissions, and release-PR checks may require approval. Configuring only one secret fails the release job rather than silently switching credentials. After App setup, verify a subsequent tagpr PR update and its checks; release publishing continues to use `GITHUB_TOKEN`. Do not grant the App branch-protection bypass.
