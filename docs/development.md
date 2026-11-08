# Development

Use this guide to implement, validate, and maintain changes to Codex Panel. See [README](../README.md) for supported behavior and requirements, [Design](design.md) for product and ownership decisions, and [Release](release.md) for version selection and publication.

## Set Up and Iterate

Use the Node.js version in `.node-version` and install dependencies with `npm ci`.

Use `npm run check` for ordinary local iteration. It runs lint, CSS usage, unused-code and type checks, and product tests, then builds the plugin. Use focused scripts from `package.json` for narrower feedback while editing.

The project `.npmrc` disables lifecycle scripts and automatic install-time audits. Explicit `npm run` commands still run, without pre/post hooks. Run `npm audit` separately when reviewing dependency vulnerabilities.

Obsidian loads the generated `main.js` and `styles.css`, not the TypeScript or authored CSS. Run `npm run build` before live validation unless `npm run check` has already built the current source. Edit CSS in `src/styles/`; `npm run build:styles` regenerates only the stylesheet and checks its source order. Keep generated load artifacts out of version control.

## Choose the Owner of a Change

Choose ownership from the required behavior and the guarantees already supplied by existing contracts. Compare repair, removal, or consolidation where the choice materially affects maintenance cost; assess the complete behavior path, not just the patch. Keep unrelated defects and additional guarantees separate from the requested outcome. Use [Design](design.md) for product boundaries and [AGENTS.md](../AGENTS.md#review-and-completion) for review requirements.

Keep feature-specific behavior with its feature. Extract shared values and rules, including the pure calculations they need, to root `domain/`, and reusable execution or UI support to `shared/`; neither should depend on a feature's implementation. Group those roots by responsibility and keep related types and helpers together, even when a directory contains only one cohesive module.

Keep protocol translation in app-server adapters. Wire behavior spanning features through the plugin's runtime and workspace owners rather than making one feature coordinate another. Put host adapters beside the code they connect; `.obsidian`, `.dom`, and `.measure` suffixes identify integration boundaries without making the host library a directory category. Keep component-specific DOM operations with their UI owner.

In Chat, keep state and workflows in application code and connect them to the host through contracts. Supply UI with values and actions rather than letting it reach into application, app-server, host, or Obsidian. Within host, keep area-specific selectors and projections together, separate from screen composition and session lifetime. Put display-only transformations beside their UI consumers.

Name modules by their owned responsibility. Use lifecycle or boundary nouns only for objects that own that lifecycle or boundary, and passive-data names for values. Prefer functions and factories; reserve classes for mutable resource ownership, external class APIs, and `Error` types.

Source-policy diagnostics come from [Biome](../biome.jsonc), [ESLint](../eslint.config.mjs), [Grit matchers](../scripts/grit/), and the CSS checks. These enforce source patterns and import boundaries, not semantic ownership. Fix the code rather than suppressing a diagnostic. When a concrete constraint prevents a conforming implementation, keep the suppression local and explain the constraint, including why an Obsidian UI pattern needs to differ from a generic browser rule.

## Design a UI Change

Inspect the existing flow before proposing or changing UI. Give each control or message a distinct purpose in what the user needs to understand or do, and prefer improving existing interaction and state over adding explanatory copy.

Design the complete interaction, including relevant placement, accessible names, keyboard access, narrow widths, visibility settings, and resulting selection, input, and recovery state. Failure feedback should distinguish the operation's result from the resource's state. Implementation details belong in product copy only when they support a user decision or action. Use [live Obsidian validation](#validate-in-obsidian) for material integration behavior that source inspection and automation cannot establish.

## Review and Simplify a Change

Review the required behavior across its owners, callers, contracts, tests, and relevant paths outside the diff. Include consequential failure, interruption, and concurrency behavior; assess performance risks against expected data size, frequency, and measurements. Make non-obvious intent and coupled assumptions discoverable where they affect maintenance.

A behavioral finding needs a reachable user or lifecycle path, a violated contract, and a material consequence. A structural finding needs a concrete maintenance activity and cost. Verify consequential assumptions against real producers and authoritative contracts for the dependency version; a synthetic reproduction establishes behavior under its assumptions, not whether those assumptions describe supported use.

Assess improvements against the strongest keep-current case and plausible alternatives, including guarantees already supplied by existing owners. Favor a simpler complete model over local guards that add state or coordination. Apply the same criteria to existing and new code, tests, and fixtures; line counts and coverage are investigation signals, not targets. Distinguish demonstrated problems, optional improvements, and material questions blocked by specific missing evidence.

### Investigate Duplication

Run `npm run review:duplication` during review after implementation and during daily simplification review.

Read both matches and their callers, applying the criteria above equally to existing and new code. Extract shared setup or rules when that improves ownership and maintenance; preserve independent test expectations and meaningful operation and observation order. Use matches as review evidence and retain useful local repetition. Reuse the report for an unchanged source state; generated app-server code is excluded by the script.

## Validate a Change

Before handoff, run `npm run fix`, review its diff, then run `npm run check`. Select additional local checks for the affected contracts below; metadata checks and CI test mode are not extra gates for every ordinary change.

`api:baseline` checks compatibility declarations and dependency pins; `release:check` checks version-file consistency and the last-compatible release boundary using Git tags. They do not establish runtime API compatibility or readiness to publish.

Run additional checks for the affected contracts:

| Change | Additional validation |
| --- | --- |
| Compatibility declarations (including the README Compatibility table), related dependency or lockfile inputs, or API-baseline validation logic | `npm run api:baseline` |
| Version files, Obsidian runtime floor or compatibility history, or release validation logic | `npm run release:check` |
| Release preparation | Both metadata checks; follow [Release](release.md) |
| Biome configuration or version, Grit matchers, policy scenarios/runner, or their Node.js version | `npm run test:policies` |
| API baselines or generated bindings | Follow the compatibility procedure below |

[GitHub Actions](../.github/workflows/check.yml) runs `check`, both metadata checks, and source-policy scenarios as separate steps on every change. The scenarios validate policy configuration against fixed examples; Biome within `check` applies those policies to the source. CI also checks generated bindings on main and recovery runs, and on PRs changing binding-generation inputs: the Check workflow, Node version, package manifests, app-server scripts, compatibility metadata, or generated bindings. These CI conditions are distinct from the local validation requirements above.

### Diagnose a CI Failure

Local `check` uses Vitest's default worker count for the available CPUs. GitHub Actions uses one worker and shuffles files and tests. To reproduce a CI test failure locally, use `npm run test:order -- --sequence.seed <reported-seed>`. On POSIX shells, `CI=1 npm run check` runs that test mode alongside the other local checks when diagnosis requires them. Use shuffled single-worker tests when investigating order dependence or relevant changes to shared test setup or runner configuration; a successful ordinary check does not routinely require a second run in CI mode.

### Validate in Obsidian

Use live Obsidian validation when material integration behavior is not covered by automation; a deterministic test that exercises the cause is sufficient for an otherwise reproducible defect. Automated tests use mocked Obsidian and DOM boundaries and do not establish desktop integration behavior.

In a supported Obsidian desktop app, enable Codex Panel in the test vault and make sure its plugin directory loads the checkout's current `main.js`, `manifest.json`, and `styles.css`. Make sure the current source is built, then reload the plugin before testing the affected interaction. Model interactions require an authenticated Codex CLI on that host.

When the Obsidian CLI is available and targets that vault, use the relevant commands below. Reload after building the current source; open only the surface needed for the interaction:

```sh
obsidian plugin:reload id=codex-panel
obsidian command id=codex-panel:open-panel
obsidian command id=codex-panel:open-threads-view
```

Inspect runtime health and the affected UI with commands such as:

```sh
obsidian plugin id=codex-panel
obsidian dev:errors
obsidian dev:dom selector=.codex-panel total
obsidian dev:css selector=.codex-panel
obsidian dev:screenshot path=<scratch-path>/codex-panel.png
```

Use focused Codex Panel-owned selectors found in the relevant implementation or styles. When behavior depends on layout, asynchronous rendering, or virtualized DOM state, capture the visible state and relevant DOM metrics before and after the real input path, then again after rendering settles. Compare framework or data state with the DOM where possible. Remove temporary probes and instrumentation before final validation and re-check runtime errors.

### Write Tests That Survive Refactoring

Protect reachable user actions, external contracts, and meaningful state transitions with tests that exercise production code and its ordinary dependencies. Use minimal doubles only when real external effects or meaningful failure, timing, or ordering cannot be exercised reliably at reasonable cost; explain the protected regression, reason for the double, and verification limits in the change discussion. Self-authored responses do not establish API compatibility.

Evaluate existing, added, and changed tests as a suite: protect important behavior with maintainable coverage. Consider strengthening, combining, or parameterizing existing cases before retaining separate setups. A distinct failure signal is evidence of value, not by itself a reason to keep a standalone case; weigh the importance of the protected guarantee against setup cost and implementation coupling. Remove or consolidate low-value tests, including redundant cases and those protecting unreachable situations or incidental structure, even when they are not duplicates. Preserve important guarantees through the resulting suite rather than preserving individual cases.

Timing and captured-state assertions must exercise the actual capture or wait boundary and observe the consequential result. A test suite should protect durable behavior without freezing implementation choices.

Do not add permanent tests for development scripts by default. Validate with real tools and representative inputs; retain a suite only when it protects a concrete product or source-policy risk that direct validation would miss and justifies its maintenance cost.

Vitest reuses workers with `isolate: false`. Restore boundary spies, timers, globals, and DOM overrides after each test. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

### Investigate Coverage Gaps

These are optional diagnostics, not additional handoff gates:

- `npm run test:coverage` reports unexercised authored source, including modules not imported by tests, in `coverage/index.html`. Use it to find missing behavior coverage; there is no percentage threshold.
- `npm run test:mutation` explores authored runtime and interaction code selected by directory-level globs in `stryker.config.mjs` and writes `reports/mutation/mutation.html`. Targets include chat host integration, selection-rewrite UI, workspace coordination, and plugin entry points; generated bindings remain outside the scope. Review surviving mutants individually: add tests for meaningful gaps, simplify equivalent or redundant code, and leave cases alone when neither improves the contract. Do not optimize for the aggregate score.

### Weekly Mutation Runs

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

## Update API Compatibility

Run `npm run api:baseline` after changing compatibility metadata and keep the README Compatibility table aligned. This checks recorded metadata; it does not prove runtime compatibility or replace regenerating bindings.

### Obsidian

`manifest.minAppVersion` is the runtime floor; keep the `obsidian` type package current independently. `obsidianmd/no-unsupported-api` checks annotated APIs against that floor and permits guarded use through `requireApiVersion()`. Manually review type-only, dynamic, unannotated, and runtime-dependent behavior that lint cannot verify.

`versions.json` records compatibility boundaries, not every release. When raising the floor, map the current released plugin version to its old `minAppVersion`.

### Codex App-Server

Compatibility is managed by CLI minor version, while bindings are generated and verified against an exact patch. Set the target in `src/app-server/compatibility.json`, update the README, and use that exact installed CLI version before regenerating:

```sh
npm run generate:app-server-types
npm run generate:app-server-types:check
npm run api:baseline
```

The compatibility file also records generation arguments and capabilities. Do not hand-edit `src/generated/app-server/`; put necessary output normalization in `scripts/app-server/normalize-types.mjs` and regenerate. The check command compares fresh output without replacing tracked bindings.

Review protocol changes in their affected adapters and runtime paths, then complete the standard handoff validation before reporting the new baseline as verified.

The Codex CLI update workflow checks upstream stable releases every four hours and can be dispatched on main. It proposes only a newer major/minor series, using the latest stable patch, with the marker `<!-- codex-cli-update: X.Y -->` and branch `automation/codex-cli-X.Y`. Generated bindings and metadata are a starting point for compatibility review, not runtime verification; follow the normal review and validation above. Existing PRs and branches are never overwritten. If a run pushed a branch but could not create its PR, inspect the branch and create the PR manually or remove the branch before retrying. Acquisition or generation failures leave no branch and can be retried.

To enable update PR creation, install the dedicated GitHub App only on this repository with Contents and Pull requests write and Issues read. Store its client ID and private key in Actions secrets `CODEX_PANEL_APP_CLIENT_ID` and `CODEX_PANEL_APP_PRIVATE_KEY`. The workflow requires both; it does not fall back to `GITHUB_TOKEN`. After setup, dispatch it on main when a newer series is available and verify the generated PR and its automatically started checks. No App setup, runtime compatibility, or end-to-end PR creation is verified by merging the workflow alone.

## Record the Change

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat(composer): add daily note context suggestions`. Scopes are optional; mark disruptive changes with `!` or a `BREAKING CHANGE:` footer.

Make each final commit a coherent review unit with an honest description. Normally fold corrective follow-ups into the concern they complete, split mixed changes, and keep follow-ups separate only when meaningful on their own.

Prefer a concise subject. Add a brief body only when future maintainers need rationale, constraints, or tradeoffs that are not evident from the diff. Keep routine check results, test counts, and work logs in the task or pull request report, not the commit message.

CI validates introduced commit messages on pull requests and pushes. Check a range locally with `npm run commitlint -- --from <base> --to <head> --verbose`. Follow [Release](release.md) when preparing a version for publication.

Write PR descriptions for reviewers from the final diff. Explain purpose, changes, validation, and limitations accurately and concisely, following repository guidance and recent PRs for language and level of detail. Include Issue or PR references when needed to understand the change or its dependencies. Compare the final diff and body before publication for accurate scope, expected language, and unnecessary references; conversation and work reports are not substitutes for that explanation.
