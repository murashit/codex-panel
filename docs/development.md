# Development

Use this document for day-to-day implementation mechanics: commands, generated files, loaded artifacts, source layout, naming, validation, and common pitfalls. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run fix
npm run check
```

Use this as the normal edit loop. `npm run fix` applies Biome formatting, import organization, safe lint fixes, and Knip's safe unused-code cleanup. `npm run check` is the local preflight for type checking, tests, lint, format/assist checks, unused-code checks, CSS checks, and the production bundle.

Use focused scripts for tight loops: `npm run typecheck`, `npm run test`, `npm run build`, or the targeted `npm run check:*` scripts. CI and release preflight run the same `npm run check` command as local development.

`npm run check` combines Biome, TypeScript, Vitest, ESLint, Knip unused-code checks, CSS usage checks, and the production build. Biome warnings fail the check. Keep rule suppressions local and include the Obsidian-specific reason when a native Obsidian UI pattern intentionally diverges from a generic browser rule.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` before live Obsidian validation if you have not already run `npm run check` after the source change.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS; it also verifies the authored CSS order before writing `styles.css`.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields. Do not hand-edit generated bindings.

## Source Layout

The source tree is organized by implementation ownership, not by the single Obsidian plugin entrypoint:

- `src/main.ts` and `src/plugin-runtime.ts` own Obsidian plugin registration, lifecycle wiring, and cross-surface runtime coordination.
- `src/app-server/` owns the app-server boundary through responsibility subfolders such as `connection/`, `protocol/`, `query/`, `routing/`, and `services/`. Do not add root-level app-server modules.
- `src/features/` contains feature-owned surfaces and workflows. Feature-to-feature imports are acceptable only when the imported feature owns a concrete capability.
- `src/features/turn-diff/` owns the turn diff Obsidian view, renderer, and persisted view state; chat provides current turn diff state through its workspace contract.
- `src/workspace/` and `src/settings/` own Obsidian workspace coordination and settings-tab behavior.
- `src/domain/` contains panel-owned, generated-independent meaning models and pure derivations. Domain code must not import app-server protocol, generated bindings, feature modules, UI, or Obsidian APIs.
- `src/shared/` contains feature-neutral helpers. Move behavior here only when it is genuinely shared outside one feature.
- `src/styles/` contains authored CSS modules and `order.json`; `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css` release asset.

Within `src/features/chat/`:

- `domain/` owns chat-local meaning models and pure derivations for message stream items, pending request display facts, runtime intent, and local IDs.
- `application/` owns chat state transitions and workflow orchestration for composer input, turn submission, thread lifecycle, pending requests, runtime settings, connection status, and reducer state.
- `app-server/` adapts app-server notifications, requests, thread payloads, diagnostics, and turn items into chat-owned actions, projections, and message stream models.
- `host/` wires each chat session to Obsidian views, workspace services, app-server clients, plugin settings, shared runtime state, lifecycle cleanup, and cross-surface handles.
- `panel/` owns the Preact shell, shell-state projection, panel controllers, toolbar/composer/message-stream surface adapters, and Obsidian-facing panel snapshots.
- `presentation/` owns view-model projection, grouping, formatting, and status text for chat UI surfaces.
- `ui/` owns Preact and explicit DOM bridge rendering pieces for the composer, toolbar, goal view, and message stream.

Tests should mirror the ownership boundary of the code under test. Keep chat feature tests under `tests/features/chat/app-server/`, `application/`, `domain/`, `host/`, `panel/`, `presentation/`, or `ui/` instead of flattened shortcut folders such as `connection/`, `composer/`, `message-stream/`, `runtime/`, `threads/`, or `conversation/`. Feature-neutral tests belong under `tests/shared/`.

## Placement Rules

Keep new code near the state or API it owns. A feature may import another feature only for a capability that feature owns. Feature-neutral behavior belongs in `src/shared/`, `src/domain/`, or `src/app-server/`.

Generated app-server types should stay behind app-server connection and protocol adapter modules. Chat-local app-server integration modules may consume app-server protocol projections, but not raw generated bindings. If a domain, shared, settings, workspace, or UI module needs app-server payloads, add or reuse a panel-owned projection at the boundary instead of importing generated payload types directly.

Chat application workflows should not import root `src/app-server/` modules or receive `AppServerClient` access directly. Keep app-server client access, connection freshness checks, vault-path injection, and payload projection in `src/features/chat/app-server/` transports or host-owned wiring, then pass chat-owned workflow contracts into application modules.

Chat panel-visible state belongs in `ChatStateStore` and should flow through named reducer actions and the shell-state adapter. Use Preact Signals only in `src/features/chat/panel/shell-state.tsx`; lint enforces this boundary. When a surface needs fewer dependencies, add or reuse a named shell-state projection instead of importing `@preact/signals` elsewhere.

Chat feature folders should keep dependencies flowing toward owned adapters and render surfaces: `application/` must not import app-server, host, panel, presentation, or UI layers; `app-server/` must not import host, panel, presentation, or UI layers; `panel/` must not import app-server adapters or host internals; `presentation/` must not import application, app-server, host, panel, or UI layers; and `ui/` must not import application, app-server, host, or panel layers. Biome enforces these folder-scoped import boundaries with per-folder plugin includes.

Chat modules should not import `src/workspace/` directly; workspace operations enter chat through host contracts, while workspace modules may coordinate concrete Obsidian chat views.

Use DOM reads, writes, measurements, hit-tests, focus/selection operations, and DOM event listener wiring only from explicit bridge modules, Obsidian-owned API boundaries, or rendering and measurement code that cannot be expressed cleanly as Preact components. Normal `.ts` and `.tsx` modules may keep refs and call named adapters, but they should not interpret DOM structure or layout directly. Name bridge files with a `.dom`, `.obsidian`, or `.measure` suffix so Biome can enforce the boundary without file-specific allowlists.

Use `.tsx` only in rendering-owned source folders: chat panel and UI modules, Obsidian/settings surfaces, shared UI components, and explicit `.dom.tsx` rendering boundaries such as the selection rewrite popover and threads view shell. Non-rendering source should use `.ts`; Biome enforces this so lower-level app-server, domain, application, presentation, workspace, and generic shared modules do not grow JSX dependencies.

## CSS Rules

CSS should stay native to Obsidian. Prefer Obsidian variables and Codex Panel tokens for color, typography, spacing, and layout dimensions instead of hardcoded values.

Keep selectors shallow and specific to Codex Panel classes. Avoid broad invalidation patterns such as `:has()`, hidden specificity inside `:where()`, IDs, universal selectors, and unnecessary type selectors. Add new authored CSS files to `src/styles/order.json`, and remove unused or test-only `codex-panel` classes instead of keeping dead styles.

## Naming Conventions

Name modules by responsibility: use `Controller` only for stateful lifecycle/control surfaces, `Handler` for inbound event or request entrypoints, `Actions` for caller-facing command or callback bundles without lifecycle ownership, `Coordinator` for stateful background or cross-surface coordination, `Service` for reusable domain capabilities, `Presenter` for UI state projection, `Renderer` for render-only UI contracts, and `Host`/`Ports` for dependency boundary objects. Use `State`, `Snapshot`, `Projection`, `ViewModel`, `Options`, `Context`, `Result`, `Target`, `Capabilities`, or `ActionTargets` for passive value objects; do not use `Actions` for passive values. Use boundary/infrastructure nouns such as `Client`, `Transport`, `Cache`, `Store`, `Catalog`, `Manager`, `Bridge`, `Tracker`, `Session`, `Runtime`, `Provider`, or `Adapter` only when the object owns that concrete boundary or lifecycle role.

Prefer functions and factory-created objects over classes. Use a class only when it owns mutable lifecycle/resource state, extends or implements an external class-based API such as Obsidian views/modals/tabs, or represents an `Error`; do not use a class merely to group pure functions or dependencies.

## Common Pitfalls

- Build before Obsidian validation. Obsidian loads ignored root assets, not the TypeScript or authored CSS sources directly.
- Keep generated app-server types behind `src/app-server/` unless `docs/design.md` documents a boundary exception.
- Preserve last-known-good app-server state on refresh failure. Do not turn disconnected reads into authoritative empty thread lists, settings snapshots, hook inventories, or diagnostics.
- Normalize optional and nullable app-server values before display. Users should not see raw `undefined`, `null`, protocol enum gaps, or fallback labels that imply Panel owns a Codex runtime setting.
- Route chat-visible state through `ChatStateStore` when it must synchronize with app-server notifications, turns, pending requests, runtime settings, history cursors, or open details.
- Do not use DOM order as message history state. Message stream DOM is a presentation surface, and delayed Markdown rendering can change heights after initial render.

## API Baselines

Use the local API baseline report when checking whether the development environment matches the supported API policy:

```sh
npm run api:baseline
```

Obsidian runtime compatibility is declared through `manifest.json` and `versions.json`. The `obsidian` npm package provides compile-time TypeScript API definitions; it is not runtime validation for an Obsidian app-version matrix. Because the project does not run app-version smoke tests, keep the API type package in the same minor as `manifest.minAppVersion` and use the latest patch in that minor for local type checking. `npm run api:baseline` exits non-zero when the local environment or recorded baselines drift. Raise `manifest.minAppVersion` only when intentionally adopting a newer Obsidian app/API minor.

Codex app-server compatibility is managed by Codex CLI minor version. README records the tested Codex CLI patch version, and the baseline check verifies that the local `codex --version` is in the same minor before app-server binding or compatibility work.
