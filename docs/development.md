# Development

Use this document for day-to-day implementation workflow: commands, source layout, generated files, naming, and common pitfalls. For the rationale behind responsibility boundaries and UI/runtime ownership, see `docs/design.md`.

## Commands

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, lint checks, Prettier check, CSS build verification, and a production esbuild bundle. The local `npm run check` path runs checks in parallel and uses local caches where available. Use `npm run check:ci` when you need to reproduce the sequential, non-cached CI validation path.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` after source changes.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS, or `npm run build:styles:check` to verify that the authored CSS can be rendered.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields. Do not hand-edit generated bindings.

## Source Layout

The source tree is organized by responsibility rather than by the original single Obsidian plugin entrypoint:

- `src/main.ts` registers Obsidian views, commands, settings, and lifecycle hooks.
- `src/app-server/` owns the app-server boundary. Generated app-server payloads should stay behind this boundary; exported app-server services should expose panel-owned domain models or small local projection types unless an explicit boundary exception is documented. Server request protocol adapters in `src/app-server/protocol/` own method-specific request normalization and response payload construction.
- `src/features/chat/` owns the main Codex chat surface: Obsidian `ItemView` classes, panel orchestration, request/app-server controllers, composer behavior, display models, chat-only UI renderers, runtime state and status projection, approvals, user input, thread actions, and panel-specific state. Chat modules under `features/chat/app-server/` are feature-local integration code: they route app-server events and convert app-server projections into chat state, pending requests, and display models.
- `src/features/thread-picker/` owns the Obsidian thread picker modal and its thread search/opening behavior.
- `src/features/threads/` contains thread-related services shared by chat, the thread picker, and the Threads view, including archive export settings, thread operations, and title generation.
- `src/features/threads-view/` owns the dedicated Obsidian thread list view, including app-server thread list rendering and live open-panel snapshot aggregation.
- `src/features/selection-rewrite/` owns the Markdown editor selection rewrite command, popover, prompt/output handling, and ephemeral rewrite thread runner.
- `src/workspace/` owns Obsidian workspace coordination across Codex surfaces, including panel discovery/opening, open-panel snapshots, and thread surface broadcasts.
- `src/shared/` contains feature-neutral helpers, including reusable DOM pieces and unified diff display helpers shared by chat and selection rewrite.
- `src/settings/` contains Obsidian settings models, settings-tab rendering, and app-server-backed dynamic settings data.
- `src/domain/` contains panel-owned, generated-independent meaning models and pure derivations shared by app-server, features, workspace, and settings code. Domain code must not import app-server protocol, generated bindings, feature modules, UI, or Obsidian APIs; app-server protocol and service modules adapt generated payloads into domain models at the boundary.
- `src/styles/` contains the authored CSS modules and `order.json` concatenation order. `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css`, which remains the Obsidian release asset.

## Implementation Conventions

Keep new code near the state or API it owns. A feature may import another feature only for a capability that feature owns; feature-neutral behavior belongs in `src/shared/`, `src/domain/`, or `src/app-server/`. Lower-level modules must not import `src/features/`, and generated app-server types should stay behind `src/app-server/`. `docs/design.md` records the rationale and exception rules for these boundaries.

Codex Panel's runtime UI is Preact-owned. Use imperative DOM writes only for explicit bridge modules, Obsidian-owned API boundaries, or rendering and measurement code that cannot be expressed cleanly as Preact components. Chat panel-visible state belongs in `ChatStateStore` and should flow through named reducer actions and the shell-state adapter. Revisit `docs/design.md` before adding a parallel UI state or runtime path.

## Naming Conventions

Name modules by responsibility: use `Controller` only for stateful lifecycle/control surfaces, `Handler` for inbound event or request entrypoints, `Actions` for caller-facing command or callback bundles without lifecycle ownership, `Coordinator` for stateful background or cross-surface coordination, `Service` for reusable domain capabilities, `Presenter` for UI state projection, `Renderer` for render-only UI contracts, and `Host`/`Ports` for dependency boundary objects. Use `State`, `Snapshot`, `Projection`, `ViewModel`, `Options`, `Context`, `Result`, `Target`, `Capabilities`, or `ActionTargets` for data/value objects; do not use `Actions` for passive data. Use boundary/infrastructure nouns such as `Client`, `Transport`, `Cache`, `Store`, `Catalog`, `Manager`, `Bridge`, `Tracker`, `Session`, `Runtime`, `Provider`, or `Adapter` only when the object owns that concrete boundary or lifecycle role.

Prefer functions and factory-created objects over classes. Use a class only when it owns mutable lifecycle/resource state, extends or implements an external class-based API such as Obsidian views/modals/tabs, or represents an `Error`; do not use a class merely to group pure functions or dependencies.

## Common Pitfalls

- Build before Obsidian validation. Obsidian loads ignored root assets, not the TypeScript or authored CSS sources directly.
- Keep generated app-server types behind `src/app-server/` unless `docs/design.md` documents a boundary exception.
- Preserve last-known-good app-server state on refresh failure. Do not turn disconnected reads into authoritative empty thread lists, settings snapshots, hook inventories, or diagnostics.
- Normalize optional and nullable app-server values before display. Users should not see raw `undefined`, `null`, protocol enum gaps, or fallback labels that imply Panel owns a Codex runtime setting.
- Route chat-visible state through `ChatStateStore` when it must synchronize with app-server notifications, turns, pending requests, runtime settings, history cursors, or open details.
- Do not use DOM order as message history state. Message stream virtualization means offscreen items may not exist in the DOM, and delayed Markdown rendering can change heights after initial render.

## API Baselines

Use the local API baseline report when checking whether the development environment matches the supported API policy:

```sh
npm run api:baseline
npm run api:baseline:check
```

Obsidian API compatibility follows semver within the guaranteed minor. `manifest.json` and `versions.json` define the minimum supported Obsidian app minor with a `.0` patch version, while the `obsidian` npm dev dependency tracks the latest patch in that same minor using a `~` range. When the Obsidian API minor is raised, update `manifest.json`, `versions.json`, README requirements, and the `obsidian` dev dependency together.

Codex app-server compatibility is managed by Codex CLI minor version. README records the tested Codex CLI patch version, and the baseline check verifies that the local `codex --version` is in the same minor before app-server binding or compatibility work.
