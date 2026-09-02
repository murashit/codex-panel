---
name: codex-panel-app-server-update
description: Use when updating Codex Panel for a new Codex CLI or app-server API version, regenerating app-server TypeScript bindings, handling generated binding diffs, adjusting app-server compatibility, or updating the README Compatibility table.
---

# Codex Panel App-Server Update

## Ground Rules

- Treat `src/generated/app-server/` as generated output. Do not hand-edit generated bindings.
- Use `docs/design.md` for app-server boundary and source-of-truth decisions before adding compatibility layers or product behavior.
- Prefer a simple, coherent design and implementation for current Codex CLI behavior over broad backward compatibility unless a concrete user need requires compatibility code. Treat obsolete compatibility removal and worthwhile implementation simplification as valid follow-up opportunities.
- Separate required compatibility fixes from optional cleanup or product improvements.

## Procedure

1. Read the README Compatibility section and the relevant design and development guidance, then trace the affected app-server paths.
2. Confirm the recorded, installed, and target Codex CLI versions. Check official release information when behavior is uncertain.
3. Regenerate bindings with `npm run generate:app-server-types`.
4. Review generated diffs for protocol changes that affect runtime behavior. If mechanical normalization is needed, update the normalization code in `scripts/generate-app-server-types.mjs` and regenerate instead of patching generated files by hand.
5. Implement only the required compatibility changes and record the target version after validating it.
6. Report optional simplification, cleanup, or product follow-ups separately using the criteria below; do not implement them unless requested.

## Follow-Up Proposals

- Make each proposal decision-ready. Explain the capability's intent, the user workflow or problem it serves, and the expected Panel behavior; use protocol types, method names, and generated diffs as supporting evidence rather than presenting API names as the proposal itself. State material tradeoffs, prerequisites, and unknowns.
- Prioritize and shape proposals against the product boundaries in `docs/design.md`: Codex Panel is a thin Obsidian surface for Codex, Codex owns runtime semantics and state, and Obsidian supplies the host interaction model. Account for user value, ownership fit, whether Codex or Obsidian already provides the capability, implementation and maintenance cost, and compatibility risk. Recommend deferring or omitting a surface when that is the better product decision.
- For any proposal involving UI, inspect the relevant feature, state, host, component, and styling paths in the current codebase before proposing a design. Describe the existing interaction and ownership model, the concrete integration point, and how the proposal follows established Preact composition, Obsidian-native patterns, and Panel display conventions. Release notes or generated bindings alone are not sufficient UI design evidence.
- Keep required compatibility work, optional product opportunities, and speculative possibilities visibly distinct. Rank optional proposals and explain why their order fits Codex Panel, Codex, and Obsidian rather than ranking them only by API novelty or implementation ease.

## Verification

- Run `npm run check` after regenerated bindings or compatibility changes.
- Use the live Obsidian workflow when runtime behavior needs verification.
- Report the tested Codex CLI version, changed compatibility behavior, and optional follow-ups.
