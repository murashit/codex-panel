# Development

Use this guide to implement, validate, and maintain changes to Codex Panel. See [README](../README.md) for supported behavior and requirements, [Design](design.md) for product and ownership decisions, and [Release](release.md) for version selection and publication.

## Set Up and Iterate

Use the Node.js version in `.node-version` and install dependencies with `npm ci`.

Use `npm run check` for ordinary local iteration. It runs lint, CSS usage, unused-code and type checks, and product tests, then builds the plugin. Use focused scripts from `package.json` for narrower feedback while editing.

The project `.npmrc` disables lifecycle scripts and automatic install-time audits. Explicit `npm run` commands still run, without pre/post hooks. Run `npm audit` separately when reviewing dependency vulnerabilities.

`package.json` overrides Obsidian's pinned Moment dependency with 2.31.0 to address [GHSA-4p3w-j4w9-5jqw](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw). Remove the override when Obsidian depends on a patched version.

Obsidian loads the generated `main.js` and `styles.css`, not the TypeScript or authored CSS. Run `npm run build` before live validation unless `npm run check` has already built the current source. Edit CSS in `src/styles/`; `npm run build:styles` regenerates only the stylesheet and checks its source order. Keep generated load artifacts out of version control.

## Choose the Owner of a Change

Before choosing an implementation, trace the required user behavior through existing owners, callers, boundary contracts, and tests, including relevant paths and fixtures outside the expected diff. Establish which guarantees the change needs and which existing mechanisms already provide them. Distinguish related design work from independent defects or additional guarantees that need their own justification; a real neighboring problem does not automatically become a condition of this fix.

Compare keeping or repairing the current structure with concrete alternatives using existing boundaries or consolidating related responsibility. Weigh responsibilities, state, dependencies, coordination, duplication, and test guarantees added against what is removed or improved across the whole behavior path. Prefer the simplest total structure meeting the required behavior, whether that calls for a narrow repair or a broader reorganization. Before rejecting an alternative for cost or missing guarantees, check whether those are inherent to the problem or only to that formulation, including guarantees already supplied by existing owners. Use enough source tracing to make the comparison credible without fully designing every candidate. Revisit it when implementation evidence or review findings invalidate an assumption; use `AGENTS.md` and the change workflow for review roles and timing.

Keep feature-specific behavior with its feature. Extract shared values and rules, including the pure calculations they need, to root `domain/`, and reusable execution or UI support to `shared/`; neither should depend on a feature's implementation. Group those roots by responsibility and keep related types and helpers together, even when a directory contains only one cohesive module.

Keep protocol translation in app-server adapters. Wire behavior spanning features through the plugin's runtime and workspace owners rather than making one feature coordinate another. Put host adapters beside the code they connect; `.obsidian`, `.dom`, and `.measure` suffixes identify integration boundaries without making the host library a directory category. Keep component-specific DOM operations with their UI owner.

In Chat, keep state and workflows in application code and connect them to the host through contracts. Supply UI with values and actions rather than letting it reach into application, app-server, host, or Obsidian. Within host, keep area-specific selectors and projections together, separate from screen composition and session lifetime. Put display-only transformations beside their UI consumers.

Name modules by their owned responsibility. Use lifecycle or boundary nouns only for objects that own that lifecycle or boundary, and passive-data names for values. Prefer functions and factories; reserve classes for mutable resource ownership, external class APIs, and `Error` types.

Source-policy diagnostics come from `biome.jsonc`, `eslint.config.mjs`, `scripts/grit/`, and the CSS checks. Fix the code rather than suppressing a diagnostic. When a concrete constraint prevents a conforming implementation, keep the suppression local and explain the constraint, including why an Obsidian UI pattern needs to differ from a generic browser rule.

## Design a UI Change

Before proposing or changing UI, inspect the affected flow in the current components, styles, settings, and related actions. Establish what the user needs to understand or do, how existing controls and feedback serve that need, and what remains missing. Reuse or reshape those surfaces when appropriate; a new message, banner, or button needs a distinct purpose in the flow.

Consider the complete interaction: placement among existing actions, icon and accessible name, visibility settings, narrow widths, keyboard access, and the resulting selection, input, and recovery state. Apply the relevant dimensions to the change rather than treating this as a checklist requiring new mechanisms. For failures, distinguish the operation's result from the resource's state and check existing feedback before adding another display.

Prefer correcting behavior or state structure when that resolves the confusion. Add explanatory copy only when it supports a concrete user decision or action; describing an implementation detail does not itself justify product copy or a README addition. Use source inspection and automated checks first; live Obsidian validation is needed only for material integration behavior those checks cannot establish.

## Review and Simplify a Change

Review behavior, responsibility boundaries, implementation quality, and regression risk against the required outcome. Bound the review by that behavior and its related responsibilities, rather than the patch or unrelated repository-wide exploration. Select angles according to the behavior and risk; not every angle applies to every change. Look beyond the diff at paired or analogous paths, callers, boundary definitions, and configuration. Check unintended asymmetry, duplicated sources of truth, ineffective indirection, and changed defaults affecting untouched consumers. Verify consequential claims in the change description and tests against implementation, relevant history, or authoritative documentation for the actual dependency version.

Follow failures and interrupted or concurrent operations through state changes to what users can see and do: can an error become apparent success, lose useful context, leave inconsistent data, or allow a conflicting action? Check that validation exercises the real contract and isolates external side effects. Assess relevant performance risks using expected data size, call frequency, and measurements. Keep non-obvious intent and coupled assumptions discoverable through explicit dependencies and explanation where the rationale would otherwise be lost.

Before acting on a behavioral finding, establish the reachable user or lifecycle path, violated contract and owner, and material consequence. For structural findings, identify the concrete maintenance activity and cost. A synthetic reproduction proves only the exercised behavior; check its assumptions against real producers and supported use. Separate demonstrated problems from hypotheses and optional improvements, and explain why material findings are addressed, rejected, or unresolved.

Use findings to reconsider the shared assumption or ownership that allowed the problem. Trace other paths relying on it and compare a correction at its owner with local guards, including the state and coordination each would add. Resolving one reproduction does not establish that the affected paths were reviewed; investigate according to consequence and uncertainty rather than enumerating every imaginable edge case.

During implementation and final review, reconsider the complete behavior path, including production code, tests, fixtures, documentation, and relevant pre-existing parts. Compare concrete alternatives meeting the same requirements at both responsibility boundaries and the level of functions, types, data flow, and repeated setup. A role for each piece, reviewer agreement, or passing checks does not establish the simplest coherent choice. Implementation and test line counts are prompts for investigation, not reduction targets. Implement worthwhile improvements, then review and validate the result; retain a structure when the comparison supports it.

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

Prefer tests that exercise real production code and its ordinary dependencies. Avoid test doubles, including internal module replacements and reimplementations of available libraries. Use minimal doubles only where a real external effect or meaningful failure, timing, or ordering cannot be exercised reliably at reasonable cost. Explain the protected regression, why the real alternative is unsuitable, and the remaining verification limits in the change discussion. Self-authored responses do not establish API compatibility.

Tie each case to a reachable user action, external boundary, or distinct state transition. Read existing and changed cases together and identify the concrete production failure each would detect: would its setup reach that failure and would its assertion fail? For timing or captured-state claims, vary the relevant value across the actual capture or wait boundary and observe the consequential result. Assess independent failure signals alongside the maintenance cost of fixtures, setup, and implementation coupling. Prefer strengthening an existing case or parameterizing a shared flow to adding another setup. Remove cases that only check test doubles, impossible configurations, or internal structure without a durable contract, or repeat a covered outcome without a distinct failure signal. Extracting code, passing tests, and increased coverage alone do not justify a suite.

Do not add permanent tests for development scripts by default. Validate changes with real tools and representative inputs. Add or retain a suite only when an independent check protects a concrete product or source-policy risk that direct change validation would miss, and its value justifies ongoing maintenance.

Vitest reuses workers with `isolate: false`. Restore boundary spies, timers, globals, and DOM overrides after each test. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

### Investigate Coverage Gaps

These are optional diagnostics, not additional handoff gates:

- `npm run test:coverage` reports unexercised authored source, including modules not imported by tests, in `coverage/index.html`. Use it to find missing behavior coverage; there is no percentage threshold.
- `npm run test:mutation` explores correctness-critical logic selected in `stryker.config.mjs` and writes `reports/mutation/mutation.html`. Review surviving mutants individually: add tests for meaningful gaps, simplify equivalent or redundant code, and leave cases alone when neither improves the contract. Do not optimize for the aggregate score.

### Weekly Mutation Runs

The [Mutation workflow](../.github/workflows/mutation.yml) runs the full configured scope every Monday at 04:00 JST (Sunday 19:00 UTC).

Run it manually with `gh workflow run mutation.yml`. Add `-f force=true` to rerun every mutant without restoring a checkpoint.

Download a run's artifact:

```sh
gh run list --workflow mutation.yml --limit 5
gh run download RUN_ID --pattern 'mutation-*' --dir /tmp/mutation-RUN_ID
```

Check the execution step's outcome and `run.json` (`commit` and `completed`) before opening `mutation.html` or reading `mutation.json`. Completion requires successful execution and a final report. Finalization records available diagnostics and checkpoints even when execution is incomplete. Metadata also records the baseline source, whether reuse was enabled, and Stryker's reused-mutant count (unknown if interrupted before analysis).

The workflow restores the newest compatible checkpoint from its completed runs on `main`, including timed-out runs. Stryker tracks changes to mutated source and tests; dependencies, configuration, runners, test helpers, fixtures, snapshots, and source outside the mutation scope invalidate reuse. Missing, expired, invalid, or incompatible baselines start a cold run.

Result and `mutation-baseline-*` checkpoint artifacts are retained for 90 days, subject to repository limits. Execution is limited to 120 minutes plus 60 seconds of termination grace so Stryker can save partial progress. Failed runs retain available checkpoints, metadata, and full logs; forced termination or cancellation can prevent checkpoint saving or artifact upload.

For occasional local runs on Linux with GNU `timeout`, `node scripts/mutation/run.mjs` uses a compatible local checkpoint; add `--force` to rerun every mutant. Use the native `npm run test:mutation -- <Stryker options>` command for focused diagnostics.

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
