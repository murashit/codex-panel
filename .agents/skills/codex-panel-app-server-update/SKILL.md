---
name: codex-panel-app-server-update
description: Use when updating Codex Panel for a new Codex CLI or app-server API version, regenerating app-server TypeScript bindings, handling generated binding diffs, adjusting app-server compatibility, or updating the README Compatibility table.
---

# Codex Panel App-Server Update

## Ground Rules

- Treat `src/generated/app-server/` as generated output. Do not hand-edit generated bindings.
- Use `docs/design.md` for app-server boundary and source-of-truth decisions before adding compatibility layers or product behavior.
- Prefer current Codex CLI behavior over broad backward compatibility unless a concrete user need requires compatibility code.
- Separate required compatibility fixes from optional cleanup or product improvements.

## Procedure

1. Read the README Compatibility section and the relevant design and development guidance, then trace the affected app-server paths.
2. Confirm the recorded, installed, and target Codex CLI versions. Check official release information when behavior is uncertain.
3. Regenerate bindings with `npm run generate:app-server-types`.
4. Review generated diffs for protocol changes that affect runtime behavior. If mechanical normalization is needed, update the normalization code in `scripts/generate-app-server-types.mjs` and regenerate instead of patching generated files by hand.
5. Implement only the required compatibility changes and record the target version after validating it.
6. Report optional cleanup or product follow-ups separately; do not implement them unless requested.

## Verification

- Run `npm run check` after regenerated bindings or compatibility changes.
- Use the live Obsidian workflow when runtime behavior needs verification.
- Report the tested Codex CLI version, changed compatibility behavior, and optional follow-ups.
