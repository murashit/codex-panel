# Development

Use this document for day-to-day implementation mechanics: commands, generated and loaded artifacts, executable policies, naming, validation, and compatibility. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run fix
npm run check
npm run test:coverage
npm run test:mutation
```

Use the Node.js version in `.node-version`.

Use focused scripts while iterating. Before handoff, run `npm run fix`, review its diff, and run the full `npm run check`; focused or ad hoc checks do not replace this standard sequence unless validation is explicitly scoped otherwise.

Vitest reuses workers with `isolate: false`. Keep boundary spies, timers, globals, and DOM overrides local to each test and restore them afterward. Avoid per-file `vi.mock` replacements of shared modules; use scoped spies or existing dependency injection instead. Shared setup modules that register hooks must export an installer called by each test file, because importing a cached module does not register its hooks again.

Run `npm run test:order` after changing test fixtures or shared state. It runs the full suite in one worker with shuffled files and tests; CI also runs it with a fresh seed. Replay a failure with `npm run test:order -- --sequence.seed <reported-seed>`. This complements the normal six-worker run by forcing test files to share the same worker within each environment.

Use `npm run test:coverage` to identify source modules and branches that lack exercised behavior. It reports every authored TypeScript source file, including files not imported by tests, while excluding generated app-server bindings. Open `coverage/index.html` to inspect line-level gaps. Coverage is diagnostic and has no pass/fail threshold; prioritize user-visible behavior and state-transition invariants rather than raising the aggregate percentage.

Use `npm run test:mutation` for exploratory mutation testing of correctness-critical logic. Configure mutation targets by responsibility directory in `stryker.config.mjs`. Review surviving mutants individually instead of treating the aggregate score as a quality gate: add tests for meaningful behavior gaps, simplify equivalent or redundant code, and leave mutants alone when neither change improves the durable contract. The run skips static mutants to avoid costly module reinitialization, is intentionally manual, and writes its ignored HTML report to `reports/mutation/mutation.html`.

When reviewing tests, map each case to a reachable user action, external boundary, or distinct state transition. Keep representative coverage of normal workflows before adding variants; remove cases that only exercise test doubles, impossible configuration, duplicate ownership, or wording and internal shape without a durable contract.

Extracting a module does not by itself justify a new test suite. Before adding tests, identify the behavior existing tests do not protect and exercise it at the appropriate layer. Consolidate or remove overlapping cases and fixtures while preserving meaningful behavior coverage.

## Commit Messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for new commits:

```text
feat(composer): add daily note context suggestions
fix: prevent manual titles from being overwritten
```

Scopes are optional. Keep the description concise, and mark disruptive changes with the standard `!` or `BREAKING CHANGE:` form.

CI checks commits introduced by pull requests and direct pushes; GitHub-generated pull-request merge commits are exempt. To check a range locally, run `npm run commitlint -- --from <base> --to <head> --verbose`.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` before live Obsidian validation if you have not already run `npm run check` after the source change.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS; it also verifies the authored CSS order before writing `styles.css`.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI. Generation requires its exact version to match `codexAppServer.testedCliVersion` in `src/app-server/connection/compatibility.json`. For an upgrade, set that generation target and use the matching CLI before regenerating; keep the README Compatibility table aligned with the target before baseline checks. Treat the update as verified only after the required validation succeeds:

```sh
npm run generate:app-server-types
npm run generate:app-server-types:check
npm run check
```

Do not hand-edit the bindings. Put necessary output normalization in `scripts/generate-app-server-types.mjs` and regenerate. `src/app-server/connection/compatibility.json` records their CLI patch and generation arguments; the check command regenerates and compares them without replacing tracked files.

## Executable Policies

Executable source policies live in `biome.jsonc`, `eslint.config.mjs`, `scripts/grit/`, and the CSS checks. When intentionally changing one, update the implementation, matcher, and its representative policy case together.

Fix the code rather than suppress diagnostics. Suppressions are exceptional: use one only when a concrete constraint prevents a reasonable implementation that satisfies the rule. Keep it local and explain that constraint in the directive, including the Obsidian-specific reason when a native Obsidian UI pattern diverges from a generic browser rule.

Keep one representative rejection and acceptance per Grit policy. Add another case only when it protects a materially different matcher behavior; do not mirror every regex branch or diagnostic detail in tests.

## Naming Conventions

Name modules by owned responsibility. Use lifecycle or boundary nouns only when the object owns that lifecycle or boundary, and passive-data names for values.

Prefer functions and factories. Reserve classes for mutable resource ownership, external class APIs, and `Error` types.

## Chat Source Layout

Chat is organized by responsibility: `domain/` defines Panel-owned models and rules, `application/` owns state and workflows, `app-server/` adapts the protocol, `host/` connects application behavior to Obsidian and UI, and `ui/` renders supplied values and actions. UI must not import application, app-server, host, or Obsidian directly.

Within host, group area-specific selectors, models, and view projections together. Keep screen composition and session lifecycle separate from those area-specific details. Display-only transformations belong beside their UI consumers.

## API Baselines

```sh
npm run api:baseline
```

`manifest.minAppVersion` is the Obsidian runtime floor; keep the `obsidian` type package current independently. `obsidianmd/no-unsupported-api` compares API `@since` annotations with that floor and allows guarded use through `requireApiVersion()`. Manually review type-only, dynamic, unannotated, and runtime-dependent behavior that lint cannot verify.

`versions.json` records only compatibility boundaries. When raising the runtime floor, map the current released plugin version to its old `minAppVersion`; do not add every plugin release.

Codex app-server compatibility is managed by CLI minor version. `src/app-server/connection/compatibility.json` records the exact generation patch and capabilities.

For compatibility changes, run `npm run api:baseline` and `npm run generate:app-server-types:check`. These validate recorded versions and generated artifacts, not runtime behavior; CI runs them against the recorded CLI.
