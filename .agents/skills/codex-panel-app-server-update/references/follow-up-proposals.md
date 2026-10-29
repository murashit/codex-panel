## Follow-Up Proposals

Evaluate candidates in this order before describing them as proposals:

1. Establish from actual application behavior what a user cannot do well in a concrete Panel interaction, or what would clearly improve. A reported bug or complete certainty is not required, but a new API, ease of implementation, or an imagined user alone does not establish value.
2. Check whether existing Codex or Obsidian functionality already serves that need sufficiently. If it does, do not add a Panel surface. Apply the boundaries in `docs/design.md`: Panel is a thin Obsidian surface, Codex owns runtime semantics and state, and Obsidian supplies the host interaction model.
3. Retain only candidates whose value justifies their implementation, ongoing maintenance, and compatibility risks. If none pass, report no proposals as a normal outcome; do not report unsubstantiated value as a deferred idea or possibility.

For a UI candidate, inspect the relevant feature, state, host, component, and styling paths in the current codebase before proposing a design. Establish the existing interaction and ownership model and how the candidate fits established Preact composition, Obsidian-native patterns, and Panel display conventions. Release notes or generated bindings alone are not sufficient evidence.

For each candidate that passes, describe the concrete user action and expected Panel behavior, how it differs from existing functionality, its integration point, benefits, costs, prerequisites, and material unknowns. Use protocol types, method names, and generated diffs as supporting evidence rather than the proposal itself. Rank multiple proposals by user value in the context of Panel, Codex, and Obsidian. Keep these optional proposals separate from required compatibility work.

