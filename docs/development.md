# Development

Use this document for day-to-day implementation mechanics: commands, generated files, loaded artifacts, source layout, naming, validation, and common pitfalls. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, lint checks, Prettier check, CSS verification, and the production esbuild bundle. `npm run check:ci` uses the same checks without local caches.

## Generated and Loaded Files

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` after source changes.

CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS; it also verifies the authored CSS order before writing `styles.css`.

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields. Do not hand-edit generated bindings.

## Source Layout

The source tree is organized by implementation ownership:

- `src/main.ts` registers Obsidian views, commands, settings, and lifecycle hooks.
- `src/app-server/` owns the app-server boundary, protocol adapters, connection/client code, app-server services, and generated payload adaptation.
- `src/features/chat/` owns the main Codex chat surface, including panel orchestration, app-server event handling, composer behavior, chat state, message display, pending requests, runtime controls, and thread actions. `src/features/chat/app-server/` is chat-local integration code that routes app-server projections into chat-owned state and display models.
- `src/features/thread-picker/` owns the Obsidian thread picker modal and its thread search/opening behavior.
- `src/features/threads/` contains thread-related services shared by chat, the thread picker, and the Threads view, including archive export settings, thread operations, and title generation.
- `src/features/threads-view/` owns the dedicated Obsidian thread list view, including app-server thread list rendering and live open-panel snapshot aggregation.
- `src/features/selection-rewrite/` owns the Markdown editor selection rewrite command, popover, prompt/output handling, and ephemeral rewrite thread runner.
- `src/workspace/` owns Obsidian workspace coordination across Codex surfaces, including panel discovery/opening, open-panel snapshots, and thread surface broadcasts.
- `src/shared/` contains feature-neutral helpers, including reusable DOM pieces and unified diff display helpers shared by chat and selection rewrite.
- `src/settings/` contains Obsidian settings models, settings-tab rendering, and app-server-backed dynamic settings data.
- `src/domain/` contains panel-owned, generated-independent meaning models and pure derivations shared by app-server, features, workspace, and settings code. Domain code must not import app-server protocol, generated bindings, feature modules, UI, or Obsidian APIs.
- `src/styles/` contains the authored CSS modules and `order.json` concatenation order. `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css`, which remains the Obsidian release asset.

## Placement Rules

Keep new code near the state or API it owns. A feature may import another feature only for a capability that feature owns. Feature-neutral behavior belongs in `src/shared/`, `src/domain/`, or `src/app-server/`.

Generated app-server types should stay behind `src/app-server/` or chat-local app-server integration modules. If a domain, shared, settings, workspace, or UI module needs app-server data, add or reuse a panel-owned projection at the boundary instead of importing generated payload types directly.

Chat panel-visible state belongs in `ChatStateStore` and should flow through named reducer actions and the shell-state adapter. Use Preact Signals only in `src/features/chat/panel/shell-state.tsx`; lint enforces this boundary. When a surface needs fewer dependencies, add or reuse a named shell-state projection instead of importing `@preact/signals` elsewhere.

Use imperative DOM writes only for explicit bridge modules, Obsidian-owned API boundaries, or rendering and measurement code that cannot be expressed cleanly as Preact components.

## Naming Conventions

Name modules by responsibility: use `Controller` only for stateful lifecycle/control surfaces, `Handler` for inbound event or request entrypoints, `Actions` for caller-facing command or callback bundles without lifecycle ownership, `Coordinator` for stateful background or cross-surface coordination, `Service` for reusable domain capabilities, `Presenter` for UI state projection, `Renderer` for render-only UI contracts, and `Host`/`Ports` for dependency boundary objects. Use `State`, `Snapshot`, `Projection`, `ViewModel`, `Options`, `Context`, `Result`, `Target`, `Capabilities`, or `ActionTargets` for data/value objects; do not use `Actions` for passive data. Use boundary/infrastructure nouns such as `Client`, `Transport`, `Cache`, `Store`, `Catalog`, `Manager`, `Bridge`, `Tracker`, `Session`, `Runtime`, `Provider`, or `Adapter` only when the object owns that concrete boundary or lifecycle role.

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
