---
name: codex-panel-app-server-update
description: Use when updating Codex Panel for a new Codex CLI or app-server API version, regenerating app-server TypeScript bindings, handling generated binding diffs, adjusting app-server compatibility, or updating the README Compatibility table.
---

# Codex Panel App-Server Update

Use this skill when Codex Panel needs to follow Codex CLI or experimental `codex app-server` API changes.

## Ground Rules

- Treat `src/generated/app-server/` as generated output. Do not hand-edit generated bindings.
- Prefer current Codex CLI behavior over broad backward compatibility unless a concrete user need requires compatibility code.
- Separate required compatibility fixes from optional cleanup or product improvements.
- Do not rely on local Git hooks. Run required generation and verification commands explicitly.

## Procedure

1. Read the README Compatibility and Development sections, `package.json`, and app-server-related source around requests, notifications, threads, approvals, Plan mode, hooks, and model listing.
2. Compare the README Compatibility table's `codex.testedCliVersion` with the target `codex --version`.
3. Check official Codex CLI or app-server release information when the target version is newer or behavior is uncertain.
4. Regenerate bindings with `npm run generate:app-server-types`.
5. Review generated diffs for protocol changes that affect runtime behavior. If mechanical normalization is needed, update `scripts/normalize-generated-types.mjs` and regenerate instead of patching generated files by hand.
6. Implement only the compatibility changes needed for the target Codex CLI version.
7. Update the README Compatibility table's `codex.testedCliVersion` only after validating against that version.

## Verification

- Run `npm run check` after regenerated bindings or compatibility changes.
- If the change must be reflected in Obsidian, run `npm run build` and verify the plugin reload path separately.
- Report the tested Codex CLI version, the generation command used, and any app-server compatibility behavior that changed.
