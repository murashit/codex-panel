# Development

Use this guide to implement, validate, and maintain changes to Codex Panel. See [README](../README.md) for supported behavior and requirements, [Design](design.md) for product and ownership decisions, and [Release](release.md) for version selection and publication.

## Set Up and Iterate

Use the Node.js version in `.node-version` and install dependencies with `npm ci`.

Use `npm run check` for ordinary local iteration. It runs lint, CSS usage, unused-code and type checks, and product tests, then builds the plugin. Use focused scripts from `package.json` for narrower feedback while editing.

The project `.npmrc` disables lifecycle scripts and automatic install-time audits. Explicit `npm run` commands still run, without pre/post hooks. Run `npm audit` separately when reviewing dependency vulnerabilities.

`package.json` overrides Obsidian's pinned Moment dependency with 2.31.0 to address [GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw). Remove the override when Obsidian depends on a patched version.

Obsidian loads the generated `main.js` and `styles.css`, not the TypeScript or authored CSS. Run `npm run build` before live validation unless `npm run check` has already built the current source. Edit CSS in `src/styles/`; `npm run build:styles` regenerates only the stylesheet and checks its source order. Keep generated load artifacts out of version control.

## Choose the Owner of a Change

Trace the required behavior through existing owners, callers, boundary contracts, and tests, including relevant paths outside the diff. Establish which guarantees already exist and which the change needs; justify neighboring fixes separately.

Compare repairing the current structure with alternatives using existing boundaries or consolidating responsibility. Weigh the state, dependencies, coordination, duplication, and test guarantees each adds or removes across the behavior path. Choose the simplest structure that meets the requirements and revisit it when implementation or review invalidates an assumption. Use [AGENTS](../AGENTS.md#review-responsibilities) for review roles and the change workflow for handoffs.

Keep feature-specific behavior with its feature. Extract shared values and rules, including the pure calculations they need, to root `domain/`, and reusable execution or UI support to `shared/`; neither should depend on a feature's implementation. Group those roots by responsibility and keep related types and helpers together, even when a directory contains only one cohesive module.

Keep protocol translation in app-server adapters. Wire behavior spanning features through the plugin's runtime and workspace owners rather than making one feature coordinate another. Put host adapters beside the code they connect; `.obsidian`, `.dom`, and `.measure` suffixes identify integration boundaries without making the host library a directory category. Keep component-specific DOM operations with their UI owner.

In Chat, keep state and workflows in application code and connect them to the host through contracts. Supply UI with values and actions rather than letting it reach into application, app-server, host, or Obsidian. Within host, keep area-specific selectors and projections together, separate from screen composition and session lifetime. Put display-only transformations beside their UI consumers.

Name modules by their owned responsibility. Use lifecycle or boundary nouns only for objects that own that lifecycle or boundary, and passive-data names for values. Prefer functions and factories; reserve classes for mutable resource ownership, external class APIs, and `Error` types.

Source-policy diagnostics come from `biome.jsonc`, `eslint.config.mjs`, `scripts/grit/`, and the CSS checks. Fix the code rather than suppressing a diagnostic. When a concrete constraint prevents a conforming implementation, keep the suppression local and explain the constraint, including why an Obsidian UI pattern needs to differ from a generic browser rule.

## Design a UI Change

Inspect the affected components, styles, settings, and actions to establish the user's task and what existing controls or feedback leave missing. Reuse or reshape them before adding a new surface. Check placement, accessible naming, narrow widths, keyboard access, and the resulting selection, input, and recovery state where relevant.

For failures, distinguish the operation's result from the resource's state. Prefer correcting behavior or state when that resolves confusion; add copy only to support a concrete user decision or action. Use [live Obsidian validation](#validate-in-obsidian) for material integration behavior that source inspection and automated checks cannot establish.

## Review and Simplify a Change

Review behavior, ownership, implementation quality, and regression risk across the affected path, including callers, analogous paths, contracts, configuration, tests, and documentation. Check duplicated sources of truth, unnecessary indirection, and changed defaults affecting other consumers. Verify consequential claims against implementation or authoritative contracts for the actual dependency version.

Trace failures and interrupted or concurrent operations through state changes to what users can see and do. Check for apparent success after errors, lost context, inconsistent data, and conflicting actions. Verify that tests exercise the real contract and isolate external effects; assess performance concerns using expected data size, call frequency, and measurements.

For a behavioral finding, establish the reachable path, violated contract, and material consequence; for a structural finding, identify the concrete maintenance cost. Check synthetic reproductions against real producers and supported use. Use findings to reconsider the responsible owner and compare shared corrections with local guards under [Choose the Owner of a Change](#choose-the-owner-of-a-change). Distinguish demonstrated problems from hypotheses and optional improvements, and record why material findings are addressed, rejected, or unresolved. Keep decision notes in the work discussion.

### Edit Documentation and Agent Instructions

Read the existing guidance and identify the reader's task and the supported gap or overlap before editing; leave useful guidance alone when no gap is evident. Integrate, shorten, or remove text to fit the document's purpose. Keep rules within the scope of their evidence and rationale only where it helps a reader decide or act.

Review the resulting section with its surroundings for necessity, scope, accuracy, and usability: can the reader find the required actions, their order, and conditions? Follow [AGENTS](../AGENTS.md#review-responsibilities) for independent review and resolve findings before handoff.

### Investigate Duplication

Run `npm run review:duplication` during review after implementation and during daily simplification review.

Read both matches and their callers, applying the criteria above equally to existing and new code. Extract shared setup or rules when that improves ownership and maintenance; preserve independent test expectations and meaningful operation and observation order. Use matches as review evidence and retain useful local repetition.

## Validate a Change

Before handoff, run `npm run fix`, review its diff, then run `npm run check`. Also run `npm run api:baseline` and `npm run release:check`.

`api:baseline` checks compatibility declarations and dependency pins; `release:check` checks version-file consistency and the last-compatible release boundary using Git tags. During iteration, run these metadata checks when changing those inputs. They do not establish runtime API compatibility or readiness to publish.

Run additional checks for the affected contracts:

| Change | Additional validation |
| --- | --- |
| Biome configuration or version, Grit matchers, policy scenarios/runner, or their Node.js version | `npm run test:policies` |
| API baselines or generated bindings | Follow the compatibility procedure below |

GitHub Actions runs `check`, both metadata checks, and source-policy scenarios as separate steps on every change. The scenarios validate the policy configuration against fixed examples; Biome within `check` applies those policies to the source.

### Diagnose a CI Failure

Local `check` uses Vitest's default worker count for the available CPUs. GitHub Actions uses one worker and shuffles files and tests. To reproduce a CI test failure locally, use `npm run test:order -- --sequence.seed <reported-seed>`. On POSIX shells, `CI=1 npm run check` runs that test mode alongside the other local checks when diagnosis requires them.

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

Exercise production code and its ordinary dependencies. Use minimal doubles for external effects or meaningful failure, timing, or ordering that cannot be exercised reliably at reasonable cost; explain the protected regression and verification limits in the change discussion.

Tie cases to reachable user actions, external boundaries, or distinct state transitions. Read existing and changed tests together and identify the production failure each would detect. For timing or captured-state claims, vary the value across the actual capture or wait boundary and observe the consequential result. Strengthen or parameterize an existing flow when possible. Remove cases that only test doubles, impossible configurations, or internal details without a durable contract, and repeated outcomes without a distinct failure signal.

Validate development scripts with real tools and representative inputs. Keep permanent tests when they protect a concrete product or source-policy risk that direct validation would miss.

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

Keep the README Compatibility table aligned with compatibility metadata. Follow the procedures below when changing either baseline.

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

To enable update PR creation, install the dedicated GitHub App only on this repository with Contents and Pull requests write and Issues read. Store its client ID and private key in Actions secrets `CODEX_PANEL_APP_CLIENT_ID` and `CODEX_PANEL_APP_PRIVATE_KEY`. The workflow requires both; it does not fall back to `GITHUB_TOKEN`. After setup, dispatch it on main when a newer series is available and verify the generated PR and its automatically started checks.

## Record the Change

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat(composer): add daily note context suggestions`. Scopes are optional; mark disruptive changes with `!` or a `BREAKING CHANGE:` footer.

Keep each final commit a coherent review unit: fold corrective follow-ups into the concern they complete and split mixed changes. Use a concise subject and add a body only for rationale or constraints the diff does not explain. Put validation results and work logs in the PR or task report.

CI validates introduced commit messages on pull requests and pushes. Check a range locally with `npm run commitlint -- --from <base> --to <head> --verbose`. Follow [Release](release.md) when preparing a version for publication.

Write the PR description from the final diff for a reviewer who has not seen the conversation. Explain the purpose, resulting behavior, validation, and material limitations concisely, following recent PRs for language and detail. Include Issue or PR references needed to understand the change. Check the body against the final diff before publication.
