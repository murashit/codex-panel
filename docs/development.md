# Development

Use this guide to implement, validate, and maintain changes to Codex Panel. See [README](../README.md) for supported behavior and requirements, [Design](design.md) for product and ownership decisions, and [Release](release.md) for version selection and publication.

## Set Up and Iterate

For code execution and tool-based checks, use the Node.js version in `.node-version` and install dependencies with `npm ci`. Read-only investigation and prose-only changes do not themselves require dependency or CLI installation.

Use `npm run check` for ordinary local iteration. It runs lint, CSS usage, unused-code and type checks, and product tests, then builds the plugin. Use focused scripts from `package.json` for narrower feedback while editing.

The project `.npmrc` disables lifecycle scripts and automatic install-time audits. Explicit `npm run` commands still run, without pre/post hooks. Run `npm audit` separately when reviewing dependency vulnerabilities.

Obsidian loads the generated `main.js` and `styles.css`, not the TypeScript or authored CSS. Run `npm run build` before live validation unless `npm run check` has already built the current source. Edit CSS in `src/styles/`; `npm run build:styles` regenerates only the stylesheet and checks its source order. Keep generated load artifacts out of version control.

## Choose the Owner of a Change

Choose ownership from required behavior and existing contracts. Use [Design](design.md) for product boundaries and [AGENTS.md](../AGENTS.md#review-and-completion) for independent review requirements.

Keep feature-specific behavior with its feature. Extract shared values and rules, including the pure calculations they need, to root `domain/`, and reusable execution or UI support to `shared/`; neither should depend on a feature's implementation. Group those roots by responsibility and keep related types and helpers together, even when a directory contains only one cohesive module.

Keep protocol translation in app-server adapters. Wire behavior spanning features through the plugin's runtime and workspace owners rather than making one feature coordinate another. Put host adapters beside the code they connect; `.obsidian`, `.dom`, and `.measure` suffixes identify integration boundaries without making the host library a directory category. Keep component-specific DOM operations with their UI owner.

In Chat, keep state and workflows in application code and connect them to the host through contracts. Supply UI with values and actions rather than letting it reach into application, app-server, host, or Obsidian. Within host, keep area-specific selectors and projections together, separate from screen composition and session lifetime. Put display-only transformations beside their UI consumers.

Name modules by their owned responsibility. Use lifecycle or boundary nouns only for objects that own that lifecycle or boundary, and passive-data names for values. Prefer functions and factories; reserve classes for mutable resource ownership, external class APIs, and `Error` types.

Source-policy diagnostics come from [Biome](../biome.jsonc), [ESLint](../eslint.config.mjs), [Grit matchers](../scripts/grit/), and the CSS checks. These enforce source patterns and import boundaries, not semantic ownership. Fix the code rather than suppressing a diagnostic. When a concrete constraint prevents a conforming implementation, keep the suppression local and explain the constraint, including why an Obsidian UI pattern needs to differ from a generic browser rule.

## Design a UI Change

Inspect the existing flow and apply the [interaction principles](design.md#interaction-principles) before proposing or changing UI.

Design the complete interaction, including relevant placement, accessible names, keyboard access, narrow widths, visibility settings, and resulting selection, input, and recovery state. Failure feedback should distinguish the operation's result from the resource's state. Implementation details belong in product copy only when they support a user decision or action. Use [live Obsidian validation](#validate-in-obsidian) for material integration behavior that source inspection and automation cannot establish.

## Review and Simplify a Change

Trace affected owners, callers, contracts, tests, and consequential failure or concurrency paths, including relevant paths outside the diff. Reproduce defects at the cheapest reliable layer and verify assumptions against actual producers and the supported dependency version. For performance concerns, establish expected size and frequency and measure where needed.

A behavioral finding needs a reachable path and violated contract; a structural finding needs a concrete maintenance cost. Compare repair, removal, or consolidation across the resulting implementation and related existing code, tests, and fixtures. Identify which existing owner or dependency can supply the required guarantees, and which responsibilities, state, or coordination callers still need. Distinguish demonstrated problems, optional improvements, and questions blocked by missing evidence; keep unrelated work separate. Make coupled assumptions discoverable where they affect maintenance.

For promising simplification candidates within the implementation task, the primary agent tries the change before deciding to keep the current model. Check requirements, failure and concurrency paths, and existing guarantees; passing tests alone does not establish equivalence. Resolve candidates through an applied simplification or a concrete reason to retain the responsibility, including any guarantee the simpler version would lose. Report material decisions without requiring a quota of alternatives, findings, or deleted lines. When the same issue recurs, look for an owner or API change that removes the need for callers to reconstruct the coordination.

### Investigate Duplication

During implementation review, run `npm run review:duplication` after changing product or test structure. It scans authored source and tests for pairs touching an added or modified line, including copies of unchanged code. Use `npm run review:duplication:all` for the full report.

Both diff review commands compare the current working tree (including untracked, non-ignored files) to the merge base of HEAD and `origin/main`. Pass e.g. `-- --base HEAD` for just local edits. Deleted lines have no current location to review.

Read both matches and their callers, applying the criteria above equally to existing and new code. Extract shared setup or rules when that improves ownership and maintenance; preserve independent test expectations and meaningful operation and observation order. Use matches as review evidence and retain useful local repetition. Reuse the report for an unchanged source state; generated app-server code is excluded by the script.

## Validate a Change

For source, test, dependency, or executable configuration changes, run `npm run fix`, inspect its diff, then run `npm run check` before handoff. For prose-only changes, check local links and anchors, verify instructions against the current implementation, and complete the applicable review in AGENTS.md; product tests are not required. Read-only investigations need checks that establish their findings, not a blanket handoff suite.

Select additional checks by the affected contract, even when the edited file is documentation. Release preparation always requires `fix`, diff review, and `check`, plus its metadata checks. CI test mode is a diagnostic, not an extra gate for every change.

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

### Validate in Obsidian

Use live Obsidian validation when material integration behavior is not covered by automation; a deterministic test that exercises the cause is sufficient for an otherwise reproducible defect. Automated tests use mocked Obsidian and DOM boundaries and do not establish desktop integration behavior.

Use the [Obsidian Dev skill](../.agents/skills/codex-panel-obsidian-dev/SKILL.md) for vault/artifact checks, CLI commands, and interaction inspection.

### Write Tests That Survive Refactoring

Test reachable user actions, external contracts, and meaningful state transitions through production code without redefining app-server semantics. Use minimal doubles for external effects or timing/failure conditions that cannot be exercised reliably at reasonable cost; explain their reason and verification limits in the change discussion. Self-authored responses do not establish API compatibility.

Review changed and related existing tests together. Identify the regression each case detects and whether strengthening or combining an existing case can cover it. Weigh that protection against maintenance cost and restrictions on valid refactoring; remove redundant, unreachable, or implementation-coupled cases. Consolidation must preserve independent detection of failures. Timing and captured-state assertions must cross the actual wait or capture boundary and observe its consequence.

For development scripts, prefer direct validation with real tools and representative inputs. Retain permanent tests only for concrete product or source-policy risks that justify their maintenance.

Vitest reuses workers with `isolate: false`. Restore boundary spies, timers, globals, and DOM overrides after each test. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

### Review Test Quality with Mutation Testing

For behavior changes, consider `npm run review:mutation` during implementation review to see which changes to production code the tests can distinguish. It targets changed lines in authored TypeScript and TSX under `src/` and skips generated bindings and declarations. Read the source location and replacement in the terminal alongside the affected tests. If Vitest finds no related tests, it reports that directly.

For each relevant mutation, name the observable behavior a caller relies on. If the mutation breaks that behavior and the tests still pass, inspect what the existing test actually observes. For example, a test that checks a helper was called can pass even when the user sees the wrong result. Replace that assertion with one on the result. An expectation tied to that helper can kill a mutant yet block a valid refactor. Remove it once the observable result is protected. Merge or delete a whole test when it protects no distinct behavior.

If the original and mutated code are equivalent for supported inputs, look for a redundant branch or operation to simplify. Leave the result alone when changing the tests or implementation would add no value. Add a case when a specific regression warrants its own protection. The mutation score is a diagnostic, with no target.

For a broader review, `npm run test:mutation` uses the directory globs in `stryker.config.mjs` and writes `reports/mutation/mutation.html`. For line coverage, `npm run test:coverage` prints file coverage and uncovered line numbers in the terminal. Both are optional diagnostics.

See [Automation](automation.md) for CI failure reproduction, scheduled mutation runs, and checkpoint handling.

## Update API Compatibility

Run `npm run api:baseline` after changing compatibility metadata and keep the README Compatibility table aligned. This checks recorded metadata; it does not prove runtime compatibility or replace regenerating bindings.

### Obsidian

`manifest.minAppVersion` is the runtime floor; keep the `obsidian` type package current independently. `obsidianmd/no-unsupported-api` checks annotated APIs against that floor and permits guarded use through `requireApiVersion()`. Manually review type-only, dynamic, unannotated, and runtime-dependent behavior that lint cannot verify.

`versions.json` records compatibility boundaries, not every release. When raising the floor, map the current released plugin version to its old `minAppVersion`.

### Codex App-Server

Compatibility is managed by CLI minor version, while bindings are generated and verified against an exact patch. `src/app-server/compatibility.json` records the tested version, generation arguments, and capabilities.

Use the [App-Server Update skill](../.agents/skills/codex-panel-app-server-update/SKILL.md) for version alignment, generation, affected runtime review, and validation. Do not hand-edit generated bindings. See [Automation](automation.md#codex-cli-update-automation) for scheduled update PRs and GitHub App setup.

## Record the Change

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat(composer): add daily note context suggestions`. Scopes are optional; mark disruptive changes with `!` or a `BREAKING CHANGE:` footer.

Keep final commits coherent, normally folding corrections into their concern and splitting unrelated changes. Prefer Jujutsu when available. Use concise subjects; reserve bodies for rationale not evident in the diff, and put routine check results in the PR or work report.

CI validates introduced commit messages on pull requests and pushes. Check a range locally with `npm run commitlint -- --from <base> --to <head> --verbose`. Follow [Release](release.md) when preparing a version for publication.

Write PR descriptions from the final diff: purpose, resulting behavior, validation, and material limitations. Follow recent PRs for language and detail; include references only when needed to understand the change. Verify the body against the final diff before publication.
