---
name: codex-panel-app-server-update
description: Update Codex Panel's CLI compatibility baseline and generated app-server bindings for a requested Codex version.
---

# Codex Panel App-Server Update

Compare recorded, installed, and target CLI versions with the README Compatibility section. Follow [Codex App-Server compatibility](../../../docs/development.md#codex-app-server) for exact-version generation, affected runtime paths, and validation. Use [Design](../../../docs/design.md) when protocol changes affect ownership or product behavior.

Complete required compatibility work before reporting the target baseline as verified. Report the tested CLI version, changed compatibility behavior, and material verification limits. Keep optional follow-ups separate from required compatibility work; a bindings-only update does not require an opportunity audit.

## Optional follow-up proposals

When the task includes evaluating upstream changes, assess concrete user benefits, internal simplification, and obsolete responsibilities under the [shared review criteria](../../../docs/development.md#review-and-simplify-a-change). A new API name or easy implementation alone does not establish value. Consider supported users, including managed deployments, and whether existing Codex or Obsidian functionality already serves the need.

Trace relevant current paths and contracts to establish what becomes possible, what is added or removed, and which maintenance work becomes easier. For UI proposals, apply [Design a UI Change](../../../docs/development.md#design-a-ui-change); release notes and generated bindings alone are insufficient. Resolve material unknowns where possible and state remaining uncertainty without turning it into an unsupported recommendation.

Present worthwhile proposals in familiar behavior or maintenance terms: current limitation, proposed change, benefit and cost, integration point, and prerequisites. Rank by concrete benefit and cost, including compatibility impacts of removals. No proposals is a valid outcome.
