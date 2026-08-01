# Design

Codex Panel is an Obsidian surface for Codex. It exists to put Codex beside vault notes without becoming a separate AI client, runtime policy editor, terminal, search product, or writing suite.

This document records durable design direction. User-facing behavior belongs in `README.md`; daily workflow, source layout, generated files, and compatibility checks belong in `docs/development.md`. Do not record current call paths or transient mechanisms that are readily derived from code and likely to drift.

## Product Boundary

Keep the panel thin. Codex Panel owns the Obsidian experience around Codex: panels, composing, vault-aware link handoff, approvals and user input, file-change review, archive export, panel preferences, diagnostics, and selection rewrite.

Codex owns runtime behavior and thread state: models, credentials, sandboxing, approval policy, MCP servers, hooks, providers, agent-initiated network access, thread history, archived state, goals, and runtime settings. The panel should read and update that state through `codex app-server`, not redefine it.

The panel may provide a narrow management surface for Codex-owned state when direct configuration is impractical, provided app-server retains the semantics. Hook controls are one such surface: they help users recognize and manage hooks they added or changed without turning the panel into a code-audit surface or runtime policy editor.

The panel may acquire bounded prompt context through explicit user action. It remains untrusted reference material and ephemeral turn context, not user authorization, agent network policy, or durable thread metadata. Compatibility for context persisted by older Panel versions should remain read-only and must not shape new submissions.

Vault file and thread references are prompt handoff data, not Panel-owned durable metadata. Preserve their human-readable representation and keep derived display state local.

Panel settings should store only panel-specific preferences. Do not mirror Codex configuration in Obsidian settings just to display or inspect it.

## Sources of Truth

`codex app-server` is the source of truth for Codex state. Panel-side caches exist to keep the UI stable across transient failures; failed reads or stale panels must not become authoritative empty state.

Panel-originated commands should project their successful results promptly into the shared read model. Independent clients are not part of the same immediate-consistency boundary: their changes may appear through app-server notifications, an explicit refresh, or a later manual sync, and intermediate cross-client ordering is not guaranteed.

The app-server API is experimental, so favor a clean current flow over broad compatibility layers; preserve compatibility when it is a supported product contract.

Runtime controls should express visible user intent for the active thread rather than copy Codex configuration. Diagnostics should expose only actionable troubleshooting facts.

An app-server context is the pair of Codex executable and Vault root. Replacing it invalidates old context-bound work before publishing the new context and keeps events and metadata attributed to their source context. Preserve last-known-good state only across transient failures within the same context.

Vault root is the Panel-owned workspace root for that context. Panel operations always use it as the thread working directory and do not project mutable protocol thread cwd values into panel state.

## Code Boundaries

Translate app-server payloads into Panel-owned domain data before they reach feature state or UI. Turn stream conversion is the narrow exception because Codex's event set is broad and experimental; it must still reduce payloads into Panel-owned display and diagnostic models.

Server request adapters should expose user-answerable intent while leaving protocol decisions and response payloads at the boundary.

Organize modules by reason to change. Add an abstraction only when it owns a lifecycle, boundary, state transition, or reusable capability.

## UI Ownership

Runtime UI composition is Preact-owned. Obsidian and app-server lifecycles and imperative host bridges stay outside components; those bridges should remain narrow rather than becoming a second UI composition system.

The chat host owns session lifecycle and the display projections that adapt application state to pure UI contracts. Do not insert a separate panel presentation layer between host and UI; keep projection helpers local to host and keep UI independent of host, application, app-server, and Obsidian ownership.

Chat-visible state should have one authoritative owner. Components should consume narrow projections of that state rather than mirror it into another reactive store.

Panel-side cached app-server resources have one authoritative owner. Reads with different completeness or freshness requirements must not overwrite one another's contracts; reconcile partial read models only at explicit lifecycle boundaries. Features may project authoritative event results into that state without introducing parallel caches or global continuous synchronization.

Thread lifecycle changes should be projected from authoritative lifecycle facts into the shared read model. When one Panel action replaces multiple visible projections, publish that result coherently without building a general transaction layer for independently initiated client changes.

## Interaction Principles

Multiple panels are separate Obsidian leaves. Treat each panel as its own Codex working surface with independent connection, turn state, composer, and pending requests. A persistent thread has one panel owner at a time, while different threads remain independent.

Asynchronous work may publish panel-local results only while the panel still owns their target. Facts completed in the current app-server context remain shared truth even if the initiating view has moved on, and cleanup created by a committed state transition must outlive the action that initiated it.

Coordinate work only where a user-visible invariant is genuinely shared, and do so at the narrowest semantic owner. Keep independent panels and threads independent.

Prefer interface structure and state over explanatory copy. Add text only for irreducible information that materially helps users decide, act, or recover; do not expose implementation concepts merely to explain current behavior.

Agent activity may use temporary panels outside ordinary thread history. Such panels preserve their visible parent relationship but do not become ordinary persistent targets.

Restrictions derived from the active thread's mode must remain consistent across actions and UI and belong to one owning policy.

Selection rewrite is intentionally scoped to a focused edit-and-review workflow. Avoid expanding it into a broader writing assistant without a separate design decision.

Server requests should become panel UI only when the user can naturally answer them in context. Unknown or unsupported requests should stay diagnostic instead of pretending to be normal conversation text.

Thread stream display should separate primary conversation from diagnostic detail and progress/status. Preserve stable item identity across history, streaming, and rendering updates.

Codex Panel UI should feel native inside Obsidian. Prefer Obsidian variables, standard classes, and side-panel patterns. Add custom visual treatment only when Codex-specific state would otherwise be hard to read.

## Testing Direction

Tests should protect user-visible behavior, app-server/Panel responsibility boundaries, and state-transition invariants across panels, threads, requests, streams, and display fallbacks.

Use representative cases for durable contracts without freezing incidental implementation details.

Panel tests may define how received structured values are displayed, retained, or normalized. They should not redefine Codex-owned runtime policy, model lists, sandbox behavior, approval policy, or thread history semantics.
