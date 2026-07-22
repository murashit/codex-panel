# Design

Codex Panel is an Obsidian surface for Codex. It exists to put Codex beside vault notes without becoming a separate AI client, runtime policy editor, terminal, search product, or writing suite.

This document records durable design direction. User-facing behavior belongs in `README.md`; daily workflow, source layout, generated files, and compatibility checks belong in `docs/development.md`.

## Product Boundary

Keep the panel thin. Codex Panel owns the Obsidian experience around Codex: panels, composing, vault-aware link handoff, approvals and user input, file-change review, archive export, panel preferences, diagnostics, and selection rewrite.

Codex owns runtime behavior and thread state: models, credentials, sandboxing, approval policy, MCP servers, hooks, providers, agent-initiated network access, thread history, archived state, goals, and runtime settings. The panel should read and update that state through `codex app-server`, not redefine it.

The panel may provide a narrow management surface when direct configuration of Codex-owned state is impractical and app-server still owns the semantics. Hook controls serve this role: help users recognize and manage hooks they added or changed without presenting the panel as a code-audit surface.

The panel may acquire prompt context through an explicit user action. `/web` fetches the requested page through Obsidian and attaches the extracted content as untrusted turn context; it is not a search surface or agent network policy.

Panel-acquired context remains reference material rather than current user authorization. Send its bounded payload as untrusted app-server context without adding Panel-owned metadata envelopes to Codex history. Apply physical byte and part limits at the app-server boundary; keep source-specific selection and truncation policy with the context producer. Keep read-only compatibility for envelopes written by older Panel versions isolated at history projection boundaries.

Vault file references are prompt handoff data, not durable thread metadata. Keep their display state local; ordinary wikilinks remain represented by the user-authored message text. Thread references persist as ordinary, human-readable `codex://threads/` Markdown links, while their bounded transcript payload remains ephemeral turn context.

Panel settings should store only panel-specific preferences. Do not mirror Codex configuration in Obsidian settings just to display or inspect it.

## Sources of Truth

`codex app-server` is the source of truth for Codex state. Panel-side caches exist to keep the UI stable across transient failures; failed reads or stale panels must not become authoritative empty state.

The app-server API is experimental. The project tracks the supported Codex CLI minor and favors a clean current flow over broad old-protocol compatibility.

Runtime controls should express visible user intent for the active thread rather than copy Codex configuration. Diagnostics should expose only actionable troubleshooting facts.

An app-server context is the pair of Codex executable and Vault root. Replacing it must invalidate context-bound connections and work before publishing the new context, keep events attributed to their source context, and discard old runtime metadata. Preserve last-known-good state only across transient failures within the same context.

Vault root is the Panel-owned workspace root for that context. Panel operations always use it as the thread working directory and do not project mutable protocol thread cwd values into panel state.

## Code Boundaries

Raw app-server protocol belongs at the app-server boundary. Boundary code should adapt protocol payloads into panel-owned domain models or small projections before those values reach features, workspace coordination, settings, or UI.

Application workflows should depend on feature-owned contracts rather than app-server clients, RPC details, connection checks, vault-path wiring, or raw protocol projections.

Turn stream conversion is the main exception: raw app-server stream payloads may be consumed at the conversion boundary because the event set is broad and changes with Codex. The converter should still reduce them into panel-owned display and diagnostic models before they reach chat state or UI.

Server request adapters should turn app-server requests into coarse panel models before they reach pending request state. The UI handles user-facing intent; app-server-specific decisions and response payloads stay boundary-owned.

Source modules should be organized by reason to change, not by the single Obsidian plugin entrypoint. Boundaries should stay close to the state, lifecycle, or external API they own.

Do not hide complexity behind forwarding layers. Add an abstraction only when it owns a lifecycle, boundary, state transition, or reusable domain capability.

## UI Ownership

Runtime UI composition is Preact-owned. Preact components should render the panel shell, toolbar, thread stream, composer, and request controls.

Obsidian and app-server boundaries stay outside Preact components. External lifecycles, app-server connections, editor/workspace APIs, and rendering bridges belong in boundary modules.

Chat-visible state should have one authoritative owner. Components should consume narrow projections of that state rather than mirror it into another reactive store.

TanStack Query is the single panel-side owner of cached app-server resources. Features may project authoritative event results into that state, but should not introduce parallel cache or synchronization mechanisms. Partial read models are reconciled at explicit lifecycle boundaries rather than kept globally and continuously consistent.

Thread lifecycle changes should be projected from completed operation facts into the shared read model. When one user action changes multiple visible projections, publish them coherently without delaying live operational state or coupling independent panels.

Reads with different completeness requirements have separate lifecycles. Complete operation-local reads must not replace bounded shared history, and transient activity should come from its owning live state rather than forcing history refreshes.

Imperative UI bridges are allowed only where the host platform requires them. They should remain narrow boundary adapters, not a second UI composition system inside Preact-owned surfaces.

## Interaction Principles

Multiple panels are separate Obsidian leaves. Treat each panel as its own Codex working surface with independent connection, thread, turn state, composer, and pending requests.

Long-running actions must preserve the user intent that started them. Panel-local results may affect a panel only while that intent still owns its target; Codex facts completed in the current app-server context remain shared truth even if the initiating panel has moved on.

Coordinate conflicting work at the narrowest shared semantic owner. Independent panels should not block one another, and stale reads or writes must not overwrite newer shared state. Coalesce work only when replacement is part of the operation's meaning.

Foreground reveal and focus are the narrow workspace-wide exception: the latest user intent wins without serializing unrelated panel or app-server work. Cleanup obligations created by a committed state transition must survive the UI action that initiated them.

Do not use explanatory copy as the default remedy for an unclear or incoherent interface. Before adding instructions, warnings, status text, validation messages, confirmations, or diagnostics, determine why the interface does not communicate the necessary behavior through its structure and state. Prefer improving information hierarchy, labels, defaults, available choices, affordances, validation timing, progress indication, and feedback. Add text only when irreducible information remains and it materially helps the user decide, act, or recover; do not expose implementation concepts merely because they explain the current behavior.

Subagent threads opened from agent activity remain persistent and restorable but stay outside ordinary thread history. Use the app-server direct-input capability when available, falling back to read-only subagent panels for older servers, while preserving parent and agent provenance for other specialized behavior.

Mode-derived restrictions for the active panel thread must remain consistent across actions and UI. Keep connection state, turn busy state, and operations targeting another listed thread in their owning workflows.

Thread history and other app-server resources should follow app-server semantics. Panel-side views are read models over app-server snapshots and lifecycle events; stale or partial refreshes must not overwrite newer state. Obsidian integrations such as archive note export are convenience views, not replacements for Codex history.

Routine thread lists should load a bounded recent set and paginate older threads on demand instead of eagerly fetching complete inventories.

Selection rewrite is intentionally scoped to a focused edit-and-review workflow. Avoid expanding it into a broader writing assistant without a separate design decision.

Server requests should become panel UI only when the user can naturally answer them in context. Unknown or unsupported requests should stay diagnostic instead of pretending to be normal conversation text.

Thread stream display should separate primary conversation from diagnostic detail and progress/status. Preserve stable item identity across history, streaming, and rendering updates.

Codex Panel UI should feel native inside Obsidian. Prefer Obsidian variables, standard classes, and side-panel patterns. Add custom visual treatment only when Codex-specific state would otherwise be hard to read.

## Testing Direction

Tests should protect user expectations, app-server/panel responsibility boundaries, and state-transition invariants.

Prefer tests for visible behavior and state-transition invariants across panels, threads, requests, streams, and display fallbacks.

Avoid tests that freeze incidental implementation details unless those details directly protect a user-visible invariant.

Panel tests may define how received structured values are displayed, retained, or normalized. They should not redefine Codex-owned runtime policy, model lists, sandbox behavior, approval policy, or thread history semantics.
