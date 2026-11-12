---
name: codex-panel-app-server-update
description: Update Codex Panel's CLI compatibility baseline and generated app-server bindings for a requested Codex version.
---

# Codex Panel App-Server Update

Follow the [compatibility policy](../../../docs/development.md#codex-app-server). Compare recorded, installed, and requested CLI versions before editing.

1. Set the target in `src/app-server/compatibility.json`, including generation arguments and capabilities where affected, and align the README Compatibility table.
2. Use that exact installed CLI patch to regenerate and verify bindings:

   ```sh
   npm run generate:app-server-types
   npm run generate:app-server-types:check
   npm run api:baseline
   ```

3. Review protocol changes in affected adapters, callers, and runtime paths. Update their behavior and tests where needed; generated types and self-authored fixtures alone do not establish runtime compatibility. Use [Design](../../../docs/design.md) when ownership or product behavior changes.
4. Complete [change validation](../../../docs/development.md#validate-a-change) and report the tested CLI version, changed compatibility behavior, and material verification limits.

Do not hand-edit `src/generated/app-server/`; put necessary output normalization in `scripts/app-server/normalize-types.mjs` and regenerate. The check command compares fresh output without replacing tracked bindings.

Evaluate feature or simplification opportunities only when requested. Ground proposals in current paths, supported users, and upstream contracts using the [review criteria](../../../docs/development.md#review-and-simplify-a-change). Rank worthwhile proposals by concrete benefit and complete maintenance cost; keep them separate from required compatibility work.

For scheduled update PRs and recovery, see [Automation](../../../docs/automation.md#codex-cli-update-automation).
