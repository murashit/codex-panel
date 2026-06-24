# Development

Use this document for day-to-day implementation mechanics: commands, generated files, loaded artifacts, source layout, naming, validation, and common pitfalls. For product boundaries and design rationale, see `docs/design.md`.

## Commands

```sh
npm ci
npm run format
npm run check
```

Use this as the normal edit loop. `npm run format` applies Biome formatting and import organization; `npm run check` is the local preflight for type checking, tests, lint, format/assist checks, CSS checks, and the production bundle.

Use focused scripts for tight loops: `npm run typecheck`, `npm run test`, `npm run lint`, or `npm run build`. The `*:ci` variants match CI cache behavior.

Biome owns formatting, import organization, general JavaScript/TypeScript/JSON/CSS linting, GritQL source-shape plugins, GritQL import-boundary restrictions, and GritQL CSS source policy. Biome warnings fail `npm run lint` and `npm run check`; info diagnostics stay advisory, including accessibility while Obsidian-specific UI semantics are reviewed rule by rule. The CSS usage script still checks dead authored classes. ESLint remains for typed unsafe-any checks, Obsidian plugin policy, and Codex Panel responsibility-boundary rules that need TypeScript type information.

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
- `src/app-server/` owns the app-server boundary, including connection code, protocol adapters, app-server services, shared queries, and generated payload adaptation.
- `src/features/` contains feature-owned surfaces and workflows. Feature-to-feature imports are acceptable only when the imported feature owns a concrete capability.
- `src/workspace/` and `src/settings/` own Obsidian workspace coordination and settings-tab behavior.
- `src/domain/` contains panel-owned, generated-independent meaning models and pure derivations. Domain code must not import app-server protocol, generated bindings, feature modules, UI, or Obsidian APIs.
- `src/shared/` contains feature-neutral helpers. Move behavior here only when it is genuinely shared outside one feature.
- `src/styles/` contains authored CSS modules and `order.json`; `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css` release asset.

Within `src/features/chat/`:

- `domain/` owns chat-local meaning models and pure derivations for message stream items, pending request display facts, runtime intent, local IDs, and turn diffs.
- `application/` owns chat state transitions and workflow orchestration for composer input, turn submission, thread lifecycle, pending requests, runtime settings, connection status, and reducer state.
- `app-server/` adapts app-server notifications, requests, thread payloads, diagnostics, and turn items into chat-owned actions, projections, and message stream models.
- `host/` wires each chat session to Obsidian views, workspace services, app-server clients, plugin settings, shared runtime data, lifecycle cleanup, and cross-surface handles.
- `panel/` owns the Preact shell, shell-state projection, panel controllers, toolbar/composer/message-stream surface adapters, and Obsidian-facing panel snapshots.
- `presentation/` owns view-model projection, grouping, formatting, and status text for chat UI surfaces.
- `ui/` owns Preact and explicit DOM bridge rendering pieces for the composer, toolbar, goal view, message stream, and turn diff view.

## Placement Rules

Keep new code near the state or API it owns. A feature may import another feature only for a capability that feature owns. Feature-neutral behavior belongs in `src/shared/`, `src/domain/`, or `src/app-server/`.

Generated app-server types should stay behind `src/app-server/` or chat-local app-server integration modules. If a domain, shared, settings, workspace, or UI module needs app-server data, add or reuse a panel-owned projection at the boundary instead of importing generated payload types directly.

Chat panel-visible state belongs in `ChatStateStore` and should flow through named reducer actions and the shell-state adapter. Use Preact Signals only in `src/features/chat/panel/shell-state.tsx`; lint enforces this boundary. When a surface needs fewer dependencies, add or reuse a named shell-state projection instead of importing `@preact/signals` elsewhere.

Use imperative DOM writes only for explicit bridge modules, Obsidian-owned API boundaries, or rendering and measurement code that cannot be expressed cleanly as Preact components.

## CSS Rules

CSS should stay native to Obsidian. Prefer Obsidian variables and Codex Panel tokens for color, typography, spacing, and layout dimensions instead of hardcoded values.

Keep selectors shallow and specific to Codex Panel classes. Avoid broad invalidation patterns such as `:has()`, hidden specificity inside `:where()`, IDs, universal selectors, and unnecessary type selectors. Add new authored CSS files to `src/styles/order.json`, and remove unused or test-only `codex-panel` classes instead of keeping dead styles.

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
