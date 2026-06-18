---
name: codex-panel-app-server-update
description: Use when updating Codex Panel for a new Codex CLI or app-server API version, regenerating app-server TypeScript bindings, handling generated binding diffs, adjusting app-server compatibility, or updating the README Compatibility table.
---

# Codex Panel App-Server Update

Use this skill when Codex Panel needs to follow Codex CLI or experimental `codex app-server` API changes.

## Ground Rules

- Treat `src/generated/app-server/` as generated output. Do not hand-edit generated bindings.
- Use `docs/design.md` for app-server boundary and source-of-truth decisions before adding compatibility layers or product behavior.
- Prefer current Codex CLI behavior over broad backward compatibility unless a concrete user need requires compatibility code.
- Separate required compatibility fixes from optional cleanup or product improvements.
- Do not rely on local Git hooks. Run required generation and verification commands explicitly.

## Procedure

1. Read the README Compatibility section, `docs/design.md`, `docs/development.md`, `package.json`, and app-server-related source around requests, notifications, threads, approvals, runtime settings, hooks, and model listing.
2. Compare the README Compatibility table's `codex.testedCliVersion` with the target `codex --version`.
3. Check official Codex CLI or app-server release information when the target version is newer or behavior is uncertain.
4. Regenerate bindings with `npm run generate:app-server-types`.
5. Review generated diffs for protocol changes that affect runtime behavior. If mechanical normalization is needed, update `scripts/normalize-generated-types.mjs` and regenerate instead of patching generated files by hand.
6. Implement only the compatibility changes needed for the target Codex CLI version.
7. Update the README Compatibility table's `codex.testedCliVersion` only after validating against that version.
8. Identify optional follow-ups separately from required compatibility work:
   - API changes that allow removing compatibility shims, fallback code, or local workarounds.
   - New routes, notifications, fields, or lifecycle signals that could simplify existing implementation.
   - New app-server capabilities that could enable Codex Panel product improvements.
9. Report optional follow-ups as proposals only, grouped separately from implemented required fixes unless the user explicitly asks to implement them.

## Verification

- Run `npm run check` after regenerated bindings or compatibility changes.
- If the change must be reflected in Obsidian, run `npm run build` and verify the plugin reload path separately.
- Report the tested Codex CLI version, the generation command used, any app-server compatibility behavior that changed, and any optional simplification or feature proposals found.
