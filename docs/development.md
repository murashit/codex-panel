# Development

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, ESLint, Prettier check, and a production esbuild bundle.
The local `npm run check` path runs checks in parallel and uses local caches for TypeScript, Vitest, ESLint, and Prettier. Use `npm run check:ci` when you need to reproduce the sequential, non-cached CI validation path.

`main.js`, `styles.css`, `data.json`, and `node_modules/` are ignored by Git. `main.js` and `styles.css` are still the files Obsidian loads, so run `npm run build` after source changes.
CSS is authored in `src/styles/` and generated into the ignored root `styles.css` release asset. Use `npm run build:styles` when only regenerating CSS, or `npm run build:styles:check` to verify that the authored CSS can be rendered.

## Source Layout

The source tree is organized by responsibility rather than by the original single Obsidian plugin entrypoint:

- `src/main.ts` registers Obsidian views, commands, settings, and lifecycle hooks.
- `src/app-server/` owns app-server transport, connection lifecycle, compatibility helpers, and RPC facades.
- `src/features/chat/` owns the main Codex chat surface: Obsidian `ItemView` classes, panel orchestration, request/app-server controllers, composer behavior, display models, chat-only UI renderers, approvals, user input, thread actions, and panel-specific state.
- `src/features/threads-view/` owns the dedicated Obsidian thread list view, including app-server thread list rendering and live open-panel snapshot aggregation.
- `src/features/selection-rewrite/` owns the Markdown editor selection rewrite command, popover, prompt/output handling, and ephemeral rewrite thread runner.
- `src/runtime/` owns Codex runtime configuration projection, model metadata, collaboration mode, and compact labels used by views.
- `src/shared/` contains feature-neutral helpers, including reusable DOM pieces and unified diff display helpers shared by chat and selection rewrite.
- `src/settings/` contains Obsidian settings models, settings-tab rendering, and app-server-backed dynamic settings data.
- `src/domain/threads/` contains thread title, reference, and archive export helpers shared outside the chat feature.
- `src/styles/` contains the authored CSS modules and `order.json` concatenation order. `scripts/build-styles.mjs` concatenates them into the ignored root `styles.css`, which remains the Obsidian release asset.

Keep new code near the state or API it owns. Feature code should not import from another feature directly; move shared behavior to `src/shared/`, `src/domain/`, `src/app-server/`, or `src/runtime/` when more than one feature needs it.

Codex Panel's runtime UI is Preact-owned through the direct Preact APIs. Keep chat panel UI, the Threads view, and the selection rewrite popover in Preact components. Use `preact/hooks` for hooks, `preact` for component types and fragments, and the shared root adapter for mounting and unmounting Preact subtrees. Imperative DOM writes are limited to explicit bridge modules or Obsidian-owned API boundaries such as `MarkdownRenderer`, diff rendering, icon rendering, `SuggestModal`, and the Obsidian `Setting`-based settings tab. ESLint enforces this boundary with allowlisted bridge files; add a new allowlist entry only when the code is genuinely bridging an external DOM API.

The bundled UI runtime should stay on direct Preact APIs. This avoids browser runtime code that creates `<script>` elements and can be flagged by Obsidian Community plugin review automation, while preserving the current component model without a compatibility adapter layer. Do not add a non-Preact UI runtime or adapter layer unless the review tradeoff is explicitly revisited.

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
