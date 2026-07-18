# Development

Use this document for day-to-day implementation mechanics: commands, generated files, loaded artifacts, source layout, naming, validation, and common pitfalls. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run fix
npm run check
npm run test:coverage
```

Use the Node.js version in `.node-version`.

Use `npm run fix` for mechanical cleanup, review its diff, and run `npm run check` before handoff.

Use `npm run test:coverage` to identify source modules and branches that lack exercised behavior. It reports every authored TypeScript source file, including files not imported by tests, while excluding generated app-server bindings. Open `coverage/index.html` to inspect line-level gaps. Coverage is diagnostic and has no pass/fail threshold; prioritize user-visible behavior and state-transition invariants rather than raising the aggregate percentage.

## Commit Messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for new commits:

```text
feat(composer): add daily note context suggestions
fix: prevent manual titles from being overwritten
```

Use one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, or `test`. Scopes are optional. Keep the description concise and omit a trailing period; capitalization is unrestricted. Use `!` before the colon or a `BREAKING CHANGE:` footer for a disruptive change.

CI checks commits introduced by pull requests and direct pushes; GitHub-generated pull-request merge commits are exempt. To check a range locally, run `npm run commitlint -- --from <base> --to <head> --verbose`.

Use focused scripts while iterating, but run `npm run check` before handoff. CI and release preflight use the same check.

Keep rule suppressions local and include the Obsidian-specific reason when a native Obsidian UI pattern intentionally diverges from a generic browser rule.

Grit policy cases protect matcher semantics rather than diagnostic wording, source locations, or the exact shape of Biome configuration. Keep one valid and invalid source case for each policy, and change a case only when that policy's accepted or rejected source shape intentionally changes.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` before live Obsidian validation if you have not already run `npm run check` after the source change.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS; it also verifies the authored CSS order before writing `styles.css`.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run generate:app-server-types:check
npm run check
```

Do not hand-edit the bindings. `src/app-server/connection/compatibility.json` records their CLI patch and generation arguments; the check command regenerates and compares them without replacing tracked files.

## Placement Rules

Follow the ownership boundaries in `docs/design.md` and the import and source-shape lint rules. Put behavior where its reason to change lives, and update the lint policy and its tests when intentionally changing a boundary.

Keep generated protocol types behind app-server adapters and expose panel-owned contracts or projections to features. Keep direct DOM work in explicit bridge, measurement, or rendering modules; use the established filename suffixes for those boundaries and reserve `.tsx` for rendering.

## CSS Rules

CSS should stay native to Obsidian. Prefer Obsidian variables and Codex Panel tokens for color, typography, spacing, and layout dimensions instead of hardcoded values.

Keep selectors shallow and scoped to Codex Panel classes. Add new authored CSS files to `src/styles/order.json`, and remove unused or test-only classes.

## Naming Conventions

Name modules by owned responsibility. Use lifecycle or boundary nouns only when the object owns that lifecycle or boundary, and passive-data names for values.

Prefer functions and factories. Reserve classes for mutable resource ownership, external class APIs, and `Error` types.

## Common Pitfalls

- Build before Obsidian validation. Obsidian loads ignored root assets, not the TypeScript or authored CSS sources directly.
- Preserve last-known-good app-server state on refresh failure. Do not turn disconnected reads into authoritative empty thread lists, settings snapshots, hook inventories, or diagnostics.
- Normalize optional and nullable app-server values before display. Users should not see raw `undefined`, `null`, protocol enum gaps, or fallback labels that imply Panel owns a Codex runtime setting.
- Do not use DOM order as thread history state. Thread stream DOM is a presentation surface, and delayed Markdown rendering can change heights after initial render.

## API Baselines

```sh
npm run api:baseline
```

Obsidian runtime compatibility is declared through `manifest.json` and `versions.json`. The `obsidian` npm package provides compile-time TypeScript API definitions; it is not runtime validation for an Obsidian app-version matrix. Because the project does not run app-version smoke tests, keep the API type package in the same minor as `manifest.minAppVersion` and use the latest patch in that minor for local type checking. `npm run api:baseline` exits non-zero when the local environment or recorded baselines drift. Raise `manifest.minAppVersion` only when intentionally adopting a newer Obsidian app/API minor.

Codex app-server compatibility is managed by CLI minor version. `src/app-server/connection/compatibility.json` is the source of truth for the exact generation patch and app-server capabilities; README displays that patch.

Local compatibility work should run `npm run api:baseline` and `npm run generate:app-server-types:check`; CI runs the same verification with the recorded CLI.
