# Development

Use this document for day-to-day implementation mechanics: commands, generated files, loaded artifacts, source layout, naming, validation, and common pitfalls. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run fix
npm run check
```

Use Node.js 26, matching `.node-version`, CI, and the installed Node type definitions.

Use this as the normal edit loop: make the change, run `npm run fix`, then run `npm run check`. Treat `npm run fix` as trusted mechanical cleanup for formatting, import ordering, and Knip safe fixes; review the resulting diff at normal change-boundary checkpoints rather than after each tool adjustment.

## Commit Messages

Commits after the `5.0.0` tag follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
feat(composer): add daily note context suggestions
fix(threads): prevent manual titles from being overwritten
refactor(chat): move session wiring into the runtime
chore(release): 5.0.1
```

Use one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, or `test`. Scopes are optional and are not restricted to a fixed list. Keep the description concise and omit a trailing period. Both lowercase and uppercase starts are accepted so Dependabot's generated `Bump ...` descriptions follow the same validation path. Use `!` before the colon or a `BREAKING CHANGE:` footer for a disruptive change.

CI checks every commit introduced by a pull request or direct push. GitHub-generated `Merge pull request ...` commits are the only format exemption; write manual reverts as `revert: ...`, and rewrite `fixup!` or `squash!` commits before publication. Run `npm run commitlint -- --from <base> --to <head> --verbose` for the same local check; local Git hooks are optional and are not a substitute for CI in the Jujutsu-first workflow.

Use focused scripts such as `npm run typecheck`, `npm run test`, or `npm run build` only when diagnosing a specific failure or when a full check would obscure the signal while iterating. Do not treat focused scripts as a substitute for the final `npm run check`. CI and release preflight run the same `npm run check` command as local development.

Keep rule suppressions local and include the Obsidian-specific reason when a native Obsidian UI pattern intentionally diverges from a generic browser rule.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` before live Obsidian validation if you have not already run `npm run check` after the source change.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS; it also verifies the authored CSS order before writing `styles.css`.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields. Do not hand-edit generated bindings.

## Placement Rules

The source tree is organized by implementation ownership, not by the single Obsidian plugin entrypoint. Put behavior where its reason to change lives: app-server protocol adaptation at the app-server boundary, app-server-independent domain models in domain code, cross-feature reusable adapters and primitives under `src/shared/`, and feature workflows under their owning feature. Keep shared subfolders named by the boundary or primitive they own, such as DOM, Obsidian, runtime, or UI rendering.

Within chat, keep state transitions and workflow orchestration separate from app-server adaptation, session/Obsidian wiring, and rendering surfaces. Tests should mirror the ownership boundary of the code under test.

Keep new code near the state or API it owns. A feature may import another feature only for a capability that feature owns. When moving behavior across an ownership boundary or adding a new shared classification, update the lint policy and its tests with that boundary in the same change.

Generated app-server types should stay behind app-server connection and protocol adapter modules. If domain, shared code, settings, workspace, or feature code needs app-server data, add or reuse a panel-owned projection at the boundary instead of importing generated payload types directly.

Chat application workflows should receive chat-owned contracts, not root `src/app-server/` modules or direct `AppServerClient` access. Keep app-server access, connection freshness checks, vault-path injection, and payload projection in `src/features/chat/app-server/` transports or host-owned wiring.

Thread workflows should likewise depend on contracts under `src/features/threads/workflows/`. Keep thread RPC sequencing, client continuity, persisted transcript reads, and Codex-backed title generation in `src/features/threads/app-server/` adapters.

Keep shared thread query records as raw last-known-good app-server snapshots. `ThreadCatalog` owns lifecycle-event overlays and publishes the resulting projection immediately; chat panels, the Threads view, and settings consume that projection without writing optimistic state back into the query cache.

Selection rewrite sessions should depend on the feature-owned transport contract. Keep executable-path and vault-path wiring, short-lived app-server lifecycle, runtime override resolution, and server-request policy in the selection rewrite app-server adapter.

Chat panel-visible state belongs in `ChatStateStore` and should flow through named reducer actions and the panel read model adapter. Use Preact Signals only in chat panel rendering adapters such as the shell read model and surface projections. When a surface needs fewer dependencies, narrow the read model instead of passing broad reducer slices.

Each `ChatPanelSession` owns one concrete `ChatPanelSessionRuntime`. That runtime is the per-leaf composition owner for the connection, responder registry, controllers, presenters, shared subscriptions, and disposal ordering; do not add a parallel session graph or late-bound connection bootstrap registry.

Chat feature dependencies should flow from pure workflow and meaning code toward owned adapters and render surfaces. Lower layers must not reach into host/session wiring, panel internals, or UI implementation details.

Chat modules should not import `src/workspace/` directly; workspace operations enter chat through host contracts, while workspace modules may coordinate concrete Obsidian chat views.

Use DOM reads, writes, measurements, hit-tests, focus/selection operations, and DOM event listener wiring only from explicit bridge modules, Obsidian-owned API boundaries, or rendering and measurement code that cannot be expressed cleanly as Preact components. Normal modules may keep refs and call named adapters, but they should not interpret DOM structure or layout directly. Name bridge files with a `.dom`, `.obsidian`, or `.measure` suffix.

Use `.tsx` only where the module owns rendering or a host rendering bridge. Non-rendering source should use `.ts`; when a new rendering-owned location is intentional, update the source-shape lint policy and its tests rather than relying on convention alone.

## CSS Rules

CSS should stay native to Obsidian. Prefer Obsidian variables and Codex Panel tokens for color, typography, spacing, and layout dimensions instead of hardcoded values.

Keep selectors shallow and specific to Codex Panel classes. Avoid broad invalidation patterns such as `:has()`, hidden specificity inside `:where()`, IDs, and universal selectors. Keep needed type selectors under Codex Panel-owned class roots for Obsidian-rendered or semantic child DOM. Add new authored CSS files to `src/styles/order.json`, and remove unused or test-only `codex-panel` classes instead of keeping dead styles.

## Naming Conventions

Name modules by responsibility: use `Controller` only for stateful lifecycle/control surfaces, `Handler` for inbound event or request entrypoints, `Actions` for caller-facing command or callback bundles without lifecycle ownership, `Coordinator` for stateful background or cross-surface coordination, `Service` for reusable domain capabilities, `Presenter` for UI state projection, `Renderer` for render-only UI contracts, and `Host`/`Ports` for dependency boundary objects. Use `State`, `Snapshot`, `Projection`, `ViewModel`, `Options`, `Context`, `Result`, `Target`, `Capabilities`, or `ActionTargets` for passive value objects; do not use `Actions` for passive values. Use boundary/infrastructure nouns such as `Client`, `Transport`, `Cache`, `Store`, `Catalog`, `Manager`, `Bridge`, `Tracker`, `Session`, `Runtime`, `Provider`, or `Adapter` only when the object owns that concrete boundary or lifecycle role.

Prefer functions and factory-created objects over classes. Use a class only when it owns mutable lifecycle/resource state, extends or implements an external class-based API such as Obsidian views/modals/tabs, or represents an `Error`; do not use a class merely to group pure functions or dependencies.

## Common Pitfalls

- Build before Obsidian validation. Obsidian loads ignored root assets, not the TypeScript or authored CSS sources directly.
- Preserve last-known-good app-server state on refresh failure. Do not turn disconnected reads into authoritative empty thread lists, settings snapshots, hook inventories, or diagnostics.
- Normalize optional and nullable app-server values before display. Users should not see raw `undefined`, `null`, protocol enum gaps, or fallback labels that imply Panel owns a Codex runtime setting.
- Do not use DOM order as thread history state. Thread stream DOM is a presentation surface, and delayed Markdown rendering can change heights after initial render.

## API Baselines

Use the local API baseline report when checking whether the development environment matches the supported API policy:

```sh
npm run api:baseline
```

Obsidian runtime compatibility is declared through `manifest.json` and `versions.json`. The `obsidian` npm package provides compile-time TypeScript API definitions; it is not runtime validation for an Obsidian app-version matrix. Because the project does not run app-version smoke tests, keep the API type package in the same minor as `manifest.minAppVersion` and use the latest patch in that minor for local type checking. `npm run api:baseline` exits non-zero when the local environment or recorded baselines drift. Raise `manifest.minAppVersion` only when intentionally adopting a newer Obsidian app/API minor.

Codex app-server compatibility is managed by Codex CLI minor version. README records the tested Codex CLI patch version, `src/app-server/connection/compatibility.json` records the machine-readable app-server capability baseline used by the panel client profile, and the baseline check verifies that the local `codex --version` is in the same minor before app-server binding or compatibility work.

Pull-request CI runs `npm run api:baseline -- --recorded-only`, which validates checked-in compatibility declarations without requiring a Codex CLI installation. Local compatibility work should still run `npm run api:baseline` so the installed CLI is checked too.
