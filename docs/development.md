# Development

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, lint checks, Prettier check, CSS build verification, and a production esbuild bundle.
The local `npm run check` path runs checks in parallel and uses local caches where available. Use `npm run check:ci` when you need to reproduce the sequential, non-cached CI validation path.

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` after source changes.
CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS, or `npm run build:styles:check` to verify that the authored CSS can be rendered.

## Source Layout

The source tree is organized by responsibility rather than by the original single Obsidian plugin entrypoint:

- `src/main.ts` registers Obsidian views, commands, settings, and lifecycle hooks.
- `src/app-server/` owns the app-server boundary: transport, connection lifecycle, compatibility helpers, runtime payload helpers, RPC facades, protocol adapters, and shared app-server-backed cache state. Generated app-server payloads should stay behind this boundary; exported app-server services should expose panel-owned domain models or small local projection types unless an explicit boundary exception is documented.
- `src/features/chat/` owns the main Codex chat surface: Obsidian `ItemView` classes, panel orchestration, request/app-server controllers, composer behavior, display models, chat-only UI renderers, runtime state and status projection, approvals, user input, thread actions, and panel-specific state.
- `src/features/threads-view/` owns the dedicated Obsidian thread list view, including app-server thread list rendering and live open-panel snapshot aggregation.
- `src/features/selection-rewrite/` owns the Markdown editor selection rewrite command, popover, prompt/output handling, and ephemeral rewrite thread runner.
- `src/workspace/` owns Obsidian workspace coordination across Codex surfaces, including panel discovery/opening, open-panel snapshots, and thread surface broadcasts.
- `src/shared/` contains feature-neutral helpers, including reusable DOM pieces and unified diff display helpers shared by chat and selection rewrite.
- `src/settings/` contains Obsidian settings models, settings-tab rendering, and app-server-backed dynamic settings data.
- `src/domain/` contains panel-owned, generated-independent meaning models and pure derivations shared by app-server, features, workspace, and settings code. This includes catalog metadata, runtime policy/settings/metrics, server metadata/diagnostics, chat input, and thread title/history/reference/transcript/archive helpers. Domain code must not import app-server protocol, generated bindings, feature modules, UI, or Obsidian APIs; app-server protocol and service modules adapt generated payloads into domain models at the boundary.
- `src/styles/` contains the authored CSS modules and `order.json` concatenation order. `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css`, which remains the Obsidian release asset.

Keep new code near the state or API it owns. Feature-to-feature imports are allowed when the imported feature owns a concrete capability or integration point, such as thread export, thread title generation, or an Obsidian view. Do not use another feature as a generic utility bucket; move truly feature-neutral behavior to `src/shared/`, `src/domain/`, or `src/app-server/`. Lower-level modules in `src/app-server/`, `src/domain/`, and `src/shared/` must remain independent from `src/features/`; ESLint enforces that dependency direction. Within the lower-level modules, `src/domain/` and `src/shared/` remain below the app-server boundary: app-server code may depend on domain models to adapt protocol data, but domain and shared code must not depend on app-server modules or generated app-server bindings.

Codex Panel's runtime UI is Preact-owned through direct Preact APIs. Keep chat panel UI, the Threads view, and the selection rewrite popover in Preact components; use imperative DOM writes only for explicit bridge modules or Obsidian-owned API boundaries such as `MarkdownRenderer`, message content rendering and measurement, virtualizer measurement glue, diff rendering, icon rendering, `SuggestModal`, and the Obsidian `Setting`-based settings tab.

Chat message stream rendering is split by display family. Presentation modules project domain message stream items into `text`, `detail`, and `status` views, and UI modules render those families from `text.tsx`, `detail.tsx`, and `status.tsx`. Keep Codex-specific item shape knowledge inside the presentation family projection, not in UI components. Keep imperative text content rendering and overflow measurement in the explicit `text-content.tsx` bridge rather than in the family renderer.

Chat panel state belongs in `ChatStateStore`. Panel-visible state changes should dispatch named reducer actions and flow through the shell-state adapter; do not add controller-owned signals, ad hoc Preact state mirrors, generic state patch actions, or a non-Preact UI runtime without revisiting the project design notes.

## App-Server Bindings

The app-server TypeScript bindings in `src/generated/app-server/` are generated from the installed Codex CLI:

```sh
npm run generate:app-server-types
npm run check
```

The generation script uses `codex app-server generate-ts --experimental` because the panel depends on experimental app-server fields such as collaboration mode and generated v2 types.

## API Baselines

Use the local API baseline report when checking whether the development environment matches the supported API policy:

```sh
npm run api:baseline
npm run api:baseline:check
```

Obsidian API compatibility follows semver within the guaranteed minor. `manifest.json` and `versions.json` define the minimum supported Obsidian app minor with a `.0` patch version, while the `obsidian` npm dev dependency tracks the latest patch in that same minor using a `~` range. When the Obsidian API minor is raised, update `manifest.json`, `versions.json`, README requirements, and the `obsidian` dev dependency together.

Codex app-server compatibility is managed by Codex CLI minor version. README records the tested Codex CLI patch version, and the baseline check verifies that the local `codex --version` is in the same minor before app-server binding or compatibility work.
