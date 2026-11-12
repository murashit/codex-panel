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

A behavioral finding needs a reachable path and violated contract; a structural finding needs a concrete maintenance cost. Compare repair, removal, or consolidation with keeping the current model, including guarantees supplied by existing owners. Apply this equally to code, tests, and fixtures. Distinguish demonstrated problems, optional improvements, and questions blocked by missing evidence; keep unrelated work separate. Make coupled assumptions discoverable where they affect maintenance.

### Investigate Duplication

Run `npm run review:duplication` when changing product or test structure, evaluating shared abstractions, or reviewing repository-wide simplification. It is optional for small local changes without structural impact.

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

Review the suite's guarantees rather than preserving every case. Strengthen or combine existing cases where useful; remove redundant, unreachable, or implementation-coupled cases. Timing and captured-state assertions must cross the actual wait or capture boundary and observe its consequence.

For development scripts, prefer direct validation with real tools and representative inputs. Retain permanent tests only for concrete product or source-policy risks that justify their maintenance.

Vitest reuses workers with `isolate: false`. Restore boundary spies, timers, globals, and DOM overrides after each test. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

### Investigate Coverage Gaps

These are optional diagnostics, not additional handoff gates:

- `npm run test:coverage` reports unexercised authored source, including modules not imported by tests, in `coverage/index.html`. Use it to find missing behavior coverage; there is no percentage threshold.
- `npm run test:mutation` explores authored runtime and interaction code selected by directory-level globs in `stryker.config.mjs` and writes `reports/mutation/mutation.html`. Targets include chat host integration, selection-rewrite UI, workspace coordination, and plugin entry points; generated bindings remain outside the scope. Review surviving mutants individually: add tests for meaningful gaps, simplify equivalent or redundant code, and leave cases alone when neither improves the contract. Do not optimize for the aggregate score.

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
