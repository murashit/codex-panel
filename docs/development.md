# Development

Start with the behavior the change must support. The [README](../README.md) describes supported use, [Design](design.md) identifies the product boundaries, and [AGENTS.md](../AGENTS.md#review-and-completion) defines when to involve independent reviewers.

## Work locally

Use the Node.js version in `.node-version` and install dependencies with `npm ci` before running project tools. Read-only investigation and prose edits can proceed without installing dependencies or the CLI. The project’s `.npmrc` disables install scripts and automatic audits. Explicit npm scripts run without pre/post hooks. Use `npm audit` when investigating dependency vulnerabilities.

While editing, use the focused commands in [package.json](../package.json) or run `npm run check` for lint, CSS usage, unused code, types, tests, and a build. Edit styles in `src/styles/`. The numbered filenames set the cascade order. Run `npm run build:styles` to regenerate the stylesheet. Obsidian loads the built `main.js` and `styles.css`. Keep these local build products out of version control.

## Implement the behavior

Trace the existing path from the caller to the code responsible for the result. Keep feature-specific rules with that feature. Shared values, rules, and their pure calculations belong in `src/domain/`. Reusable execution and UI support belong in `src/shared/`. Keep both roots independent of feature implementations and group related types and helpers by responsibility, even when a directory contains a single module.

Translate the app-server protocol at its adapters. Let the runtime and workspace owners coordinate behavior that spans features. Place host adapters beside the code they connect, using `.obsidian`, `.dom`, or `.measure` to identify the boundary. Component-specific DOM work stays with the component. In Chat, application code owns state and workflows and connects to the host through contracts. Give the UI the values and actions it needs. Group host selectors and projections by area, keep screen composition and session lifetime with their owners, and put display transformations beside their UI consumers.

Name modules for the responsibility they own. Reserve lifecycle and boundary names for objects that manage them, and use data names for values. Prefer functions and factories. Use classes for mutable resource ownership, external class APIs, and `Error` types.

[Biome](../biome.jsonc), [ESLint](../eslint.config.mjs), [Grit matchers](../scripts/grit/), and the CSS checks enforce source patterns and import boundaries. Review ownership against the actual behavior as well. Fix diagnostics in the code. If a concrete constraint requires a suppression, keep it local and explain the constraint, including any Obsidian-specific reason for departing from a browser rule.

### UI changes

Inspect the existing flow and apply the [interaction principles](design.md#interaction-principles). Follow the action from its placement and accessible name through keyboard use, narrow layouts, visibility settings, and the resulting selection or input state. On failure, tell the user what happened to the operation and what they can do with the resource now. Include implementation details in product copy only when they help the user act. Verify material desktop interactions [in Obsidian](#validate-in-obsidian).

### Tests

Exercise reachable user actions, external contracts, and meaningful state transitions through production code. For timing or captured state, cross the actual wait or capture boundary and assert its consequence. Prefer real collaborators and assert observable outcomes. When an external effect, failure, or timing boundary is impractical to exercise in a fast, deterministic test, double only that boundary and explain what the test covers. Retire the double once a test using the real implementation catches the same regression. Check app-server semantics against the supported producer and version.

Vitest reuses workers with `isolate: false`. Restore spies, timers, globals, and DOM overrides after each test. If shared setup registers hooks, export an installer and call it from each test file so module caching cannot skip registration. For development scripts, exercise the real tool with representative inputs. Keep a permanent test when it protects a concrete product or source-policy contract worth maintaining.

### Focused test runs

Run `npm test -- <test-file>` for a single pass. Both Vitest projects work offline with installed dependencies. Use the `.obsidian.test.ts` or `.obsidian.test.tsx` suffix for suites that load the simulated Obsidian runtime. Other suites resolve their regular dependencies.

To exercise the production transport locally, set `PANEL_CODEX_BINARY` to the absolute path of the native executable for the version in `src/app-server/compatibility.json` and run `npm run test:cli`. The smoke test uses a temporary profile. On Windows it also exercises command scripts in a path containing spaces. The Native CLI workflow runs this check on Linux, macOS and Windows for changes affecting startup.

## Review and simplify a change

Review the resulting behavior across owners, callers, related tests, and fixtures, including paths outside the diff. For a behavioral finding, identify a reachable failure and the contract it violates. Reproduce it at the cheapest reliable layer. For a structural finding, identify the maintenance cost. For a performance concern, establish the expected workload and frequency and measure where needed.

Try promising simplifications within scope. Compare repair, removal, and consolidation against requirements, failure paths, and concurrent use. Check which guarantees an existing owner or dependency provides and which responsibilities the caller still needs. If a simpler version loses a guarantee, record the concrete reason for retaining the responsibility. Where callers repeatedly reconstruct the same coordination, examine the owning API. Document coupled assumptions where the next maintainer will encounter them. Report demonstrated problems, optional improvements, and missing evidence separately, keeping unrelated work out of the change.

Two commands support implementation review. Both compare the working tree, including untracked, non-ignored files, with the merge base of HEAD and `origin/main`. Pass `-- --base HEAD` to either command to inspect local edits. Deleted lines and pure renames have no changed lines in the current source.

### Investigate duplication

After changing product or test structure, run `npm run review:duplication`. It scans authored source and tests and prints clone pairs when either side touches an added or modified line. The other side may be unchanged code. For a repository-wide design review, use `npm run review:duplication:all`. Both exclude generated app-server code. Reuse findings while the source is unchanged.

Read both sites and their callers. Extract shared rules or setup when one owner can maintain them more reliably. Keep local repetition when it preserves independent test expectations or makes the order of actions and observations clear.

### Evaluate what the tests protect

For behavior changes, consider `npm run review:mutation`. It mutates changed lines in authored TypeScript and TSX under `src/`, excluding generated bindings and declarations. Read the location and replacement in the terminal alongside the affected tests. Vitest reports when it finds no related tests. Clear `reports/review-mutation/stryker-incremental.json` if setup, dependency, or configuration changes could affect cached results.

For each relevant mutation, identify the observable behavior a caller relies on. A test can verify that a helper ran and still pass when the user sees the wrong result. Replace that assertion with one on the result. A helper-call expectation can also kill a mutant while blocking a valid refactor. Remove expectations that impose this cost. Merge or delete tests when the remaining cases still detect each distinct regression independently.

If the original and mutated code behave identically for supported inputs, look for a redundant branch or operation to simplify. Add a case when a specific regression warrants independent protection. Leave a mutation alone when changing the tests or implementation would add no value. There is no target score.

Use `npm run test:coverage` when you need to locate unexercised authored source, including modules the tests never import. The terminal report lists coverage by file and uncovered lines. For broader mutation analysis, `npm run test:mutation` uses the directories in [the Stryker configuration](../stryker.config.mjs) and writes `reports/mutation/mutation.html`. [Automation](automation.md) covers scheduled runs and checkpoints.

## Validate a change

For source, test, dependency, or executable configuration changes, run `npm run fix`, inspect the resulting diff, then run `npm run check` on the final result. For prose-only edits, verify local links, anchors, and instructions against the implementation and complete the applicable review. For a read-only investigation, choose checks that establish the finding.

Select additional checks by the affected contract, including changes to declarations in documentation.

| Affected contract | Validation |
| --- | --- |
| README compatibility table, compatibility declarations, related dependency or lockfile inputs, API-baseline logic | `npm run api:baseline` checks recorded compatibility metadata and dependency pins. |
| Version files, Obsidian runtime floor or compatibility history, release-check logic | `npm run release:check` checks version consistency and the last compatible release boundary using Git tags. |
| Release preparation | Run `fix`, inspect the diff, run `check`, and run both metadata checks. Follow [Release](release.md) for publication. |
| Biome configuration or version, Grit matchers, policy scenarios or their runner, Node.js version used by those tools | `npm run test:policies` checks the policy configuration against fixed examples. |
| API baselines or generated bindings | Follow the [compatibility procedures](#update-api-compatibility) for the affected integration. |

The [Check workflow](../.github/workflows/check.yml) runs the ordinary checks, both metadata checks, and policy scenarios on every change. Biome within `check` applies the policies to project source. CI verifies generated bindings on main, on recovery runs, and on PRs that change generation inputs (the workflow, Node version, manifests, app-server scripts, the shared version parser, compatibility metadata, or bindings). Use the [CI reproduction instructions](automation.md#diagnose-a-ci-failure) when investigating a CI-specific failure.

### Validate in Obsidian

Use a deterministic test when it reproduces the cause of a defect. Exercise the plugin in Obsidian when material integration behavior depends on the real desktop, DOM, or vault. Build the current source with `npm run build` if `check` has not already built it. Follow the [Obsidian Dev skill](../.agents/skills/codex-panel-obsidian-dev/SKILL.md) for artifact checks, CLI commands, and interaction inspection.

The Obsidian smoke workflow is manually dispatchable and runs on PRs that change its harness. It resolves the latest stable Linux AppImage, verifies its release digest and opens the plugin in a disposable vault. The desktop container runs without external networking. Failed desktop runs upload the app log and, when the renderer is reachable, a screenshot.

## Update API compatibility

Keep compatibility declarations and the README Compatibility table aligned. Metadata checks establish consistency. Runtime behavior and generated bindings need verification against their own integrations.

### Obsidian

`manifest.minAppVersion` defines the runtime floor. Keep the `obsidian` type package current independently. The `obsidianmd/no-unsupported-api` rule checks annotated APIs against the floor and permits guarded calls through `requireApiVersion()`. Review type-only, dynamic, unannotated, and runtime-dependent uses manually. When raising the floor, record the current released plugin version and its old minimum in `versions.json`, which tracks compatibility boundaries.

### Codex App-Server

Manage compatibility by CLI minor version and verify generated bindings against an exact patch. `src/app-server/compatibility.json` records the tested version, generation arguments, and capabilities. Follow the [App-Server Update skill](../.agents/skills/codex-panel-app-server-update/SKILL.md) to align versions, regenerate bindings, and review affected runtime paths. Generate binding changes through that procedure. [Automation](automation.md#codex-cli-update-automation) describes scheduled updates and GitHub App setup.

## Prepare the pull request

Group commits by concern and fold corrections into the change they complete. Prefer Jujutsu when available. Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) with concise subjects such as `feat(composer): add daily note context suggestions`. Scopes are optional. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer. Use commit bodies for rationale that the diff cannot convey.

Check the final range with `npm run commitlint -- --from <base> --to <head> --verbose`. CI also validates introduced commit messages on PRs and pushes. Write the PR description from the final diff, covering purpose, resulting behavior, validation, and material limitations. Follow recent PRs for language and detail, and verify the description before publication.
