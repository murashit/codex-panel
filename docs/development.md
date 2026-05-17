# Development

```sh
npm ci
npm run format
npm run check
npm run build
```

Run `npm run format` after edits and before `npm run check` so Prettier-only issues are fixed upfront. `npm run check` runs TypeScript type checking, unit tests, ESLint, Prettier check, and a production esbuild bundle.

`main.js`, `data.json`, and `node_modules/` are ignored by Git. `main.js` is still the file Obsidian loads, so run `npm run build` or `npm run build:prod` after source changes.

## Source Layout

The source tree is organized by responsibility rather than by the original single Obsidian plugin entrypoint:

- `src/main.ts` registers Obsidian views, commands, settings, and lifecycle hooks.
- `src/app-server/` owns app-server transport, connection lifecycle, compatibility helpers, and RPC facades.
- `src/panel/` owns Codex panel orchestration, Obsidian `ItemView` classes, request/session controllers, thread actions, and panel-specific state.
- `src/runtime/` owns Codex runtime configuration projection, model metadata, collaboration mode, and compact labels used by views.
- `src/display/` converts app-server turn items and streaming deltas into display model objects.
- `src/ui/` contains pure DOM renderers for reusable panel UI pieces.
- `src/composer/` contains composer input behavior, slash command definitions, suggestions, and Obsidian wikilink resolution.
- `src/settings/` contains Obsidian settings models, settings-tab rendering, and app-server-backed dynamic settings data.
- `src/threads/` contains thread title and list presentation helpers shared outside the panel.

Keep new code near the state or API it owns. Shared domain helpers should not be placed under `src/panel/` unless they are panel-specific orchestration.

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
