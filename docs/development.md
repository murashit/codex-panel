# Development

Use this guide to implement, validate, and maintain changes to Codex Panel. See [README](../README.md) for supported behavior and requirements, [Design](design.md) for product and ownership decisions, and [Release](release.md) for version selection and publication.

## Set Up and Iterate

Use the Node.js version in `.node-version` and install dependencies with `npm ci`. Use focused scripts from `package.json` while iterating; the handoff checks below still apply.

The project `.npmrc` disables lifecycle scripts and automatic install-time audits. Explicit `npm run` commands still run, without pre/post hooks. Run `npm audit` separately when reviewing dependency vulnerabilities; release preflight audits runtime dependencies explicitly.

Obsidian loads the generated `main.js` and `styles.css`, not the TypeScript or authored CSS. Run `npm run build` before live validation unless `npm run check` has already built the current source. Edit CSS in `src/styles/`; `npm run build:styles` regenerates only the stylesheet and checks its source order. Keep generated load artifacts out of version control.

## Choose the Owner of a Change

Keep feature-specific behavior with its feature. Extract shared values and rules, including the pure calculations they need, to root `domain/`, and reusable execution or UI support to `shared/`; neither should depend on a feature's implementation. Group those roots by responsibility and keep related types and helpers together, even when a directory contains only one cohesive module.

Keep protocol translation in app-server adapters. Wire behavior spanning features through the plugin's runtime and workspace owners rather than making one feature coordinate another. Put host adapters beside the code they connect; `.obsidian`, `.dom`, and `.measure` suffixes identify integration boundaries without making the host library a directory category. Keep component-specific DOM operations with their UI owner.

In Chat, keep state and workflows in application code and connect them to the host through contracts. Supply UI with values and actions rather than letting it reach into application, app-server, host, or Obsidian. Within host, keep area-specific selectors and projections together, separate from screen composition and session lifetime. Put display-only transformations beside their UI consumers.

Name modules by their owned responsibility. Use lifecycle or boundary nouns only for objects that own that lifecycle or boundary, and passive-data names for values. Prefer functions and factories; reserve classes for mutable resource ownership, external class APIs, and `Error` types.

Source-policy diagnostics come from `biome.jsonc`, `eslint.config.mjs`, `scripts/grit/`, and the CSS checks. Fix the code rather than suppressing a diagnostic. When a concrete constraint prevents a conforming implementation, keep the suppression local and explain the constraint, including why an Obsidian UI pattern needs to differ from a generic browser rule.

## Design a UI Change

Before proposing or changing UI, inspect the affected flow in the current components, styles, settings, and related actions. Establish what the user needs to understand or do, how existing controls and feedback serve that need, and what remains missing. Reuse or reshape those surfaces when appropriate; a new message, banner, or button needs a distinct purpose in the flow.

Consider the complete interaction: placement among existing actions, icon and accessible name, visibility settings, narrow widths, keyboard access, and the resulting selection, input, and recovery state. Apply the relevant dimensions to the change rather than treating this as a checklist requiring new mechanisms. For failures, distinguish the operation's result from the resource's state and check existing feedback before adding another display.

Prefer correcting behavior or state structure when that resolves the confusion. Add explanatory copy only when it supports a concrete user decision or action; describing an implementation detail does not itself justify product copy or a README addition. Use source inspection and automated checks first; live Obsidian validation is needed only for material integration behavior those checks cannot establish.

## Validate a Change

Before handoff, run `npm run fix`, review its diff, then run `npm run check`. Focused checks do not replace this sequence unless validation is explicitly scoped otherwise.

Run additional checks when the affected contract requires them:

| Change | Additional validation |
| --- | --- |
| Test fixtures or shared state | `npm run test:order`; replay a failure with `npm run test:order -- --sequence.seed <reported-seed>` |
| Biome configuration, Grit matchers, or Biome version | `npm run test:policies` |
| API baselines or generated bindings | Follow the compatibility procedure below |

`test:order` runs the suite in one worker with shuffled files and tests, matching the CI test mode. Use live Obsidian validation when material integration behavior is not covered by automation; a deterministic test that exercises the cause is sufficient for an otherwise reproducible defect.

### Write Tests That Survive Refactoring

Tie each case to a reachable user action, external boundary, or distinct state transition. Keep representative normal workflows and remove cases that only check test doubles, impossible configurations, or internal structure without a durable contract. Extracting or moving a module does not itself justify a new suite; first identify what existing tests fail to protect.

Vitest reuses workers with `isolate: false`. Restore boundary spies, timers, globals, and DOM overrides after each test. Avoid per-file `vi.mock` replacements of shared modules; use scoped spies or existing dependency injection. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

### Investigate Coverage Gaps

These are optional diagnostics, not additional handoff gates:

- `npm run test:coverage` reports unexercised authored source, including modules not imported by tests, in `coverage/index.html`. Use it to find missing behavior coverage; there is no percentage threshold.
- `npm run test:mutation` explores correctness-critical logic selected in `stryker.config.mjs` and writes `reports/mutation/mutation.html`. Review surviving mutants individually: add tests for meaningful gaps, simplify equivalent or redundant code, and leave cases alone when neither improves the contract. Do not optimize for the aggregate score.

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

The compatibility file also records generation arguments and capabilities. Do not hand-edit `src/generated/app-server/`; put necessary output normalization in `scripts/generate-app-server-types.mjs` and regenerate. The check command compares fresh output without replacing tracked bindings.

Review protocol changes in their affected adapters and runtime paths, then complete the standard handoff validation before reporting the new baseline as verified.

## Record the Change

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `feat(composer): add daily note context suggestions`. Scopes are optional; mark disruptive changes with `!` or a `BREAKING CHANGE:` footer.

Prefer a concise subject. Add a brief body only when future maintainers need rationale, constraints, or tradeoffs that are not evident from the diff. Keep routine check results, test counts, and work logs in the task or pull request report, not the commit message.

CI validates introduced commit messages on pull requests and pushes. Check a range locally with `npm run commitlint -- --from <base> --to <head> --verbose`. Follow [Release](release.md) when preparing a version for publication.
