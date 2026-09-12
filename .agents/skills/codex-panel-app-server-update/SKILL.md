---
name: codex-panel-app-server-update
description: Update Codex Panel's CLI compatibility baseline and generated app-server bindings for a new Codex version.
---

# Codex Panel App-Server Update

Compare the recorded, installed, and target CLI versions with the README Compatibility section. Use `docs/development.md` for generation and validation, and `docs/design.md` when protocol changes affect ownership or product behavior.

- Regenerate bindings using the Generated and Loaded Files procedure in `docs/development.md`; do not patch generated output by hand.
- Trace protocol changes into the affected runtime paths. Prefer current supported CLI behavior; retain compatibility code only for a concrete supported need.
- Complete required compatibility changes and validation before reporting the target version as verified. Keep optional product expansion separate from the update.
- When the task includes evaluating new capabilities, use [follow-up proposals](references/follow-up-proposals.md). A bindings-only update does not require a product opportunity audit.

Follow the validation requirements in `docs/development.md`, including API Baselines for compatibility changes. Use live Obsidian validation only for material integration behavior not covered by automation. Report the tested CLI version and changed compatibility behavior.
