# Design

Codex Panel is an Obsidian surface for Codex. It exists to put Codex beside vault notes without becoming a separate AI client, runtime policy editor, terminal, search product, or writing suite.

This document records durable design direction. User-facing behavior belongs in `README.md`; daily workflow, source layout, generated files, and compatibility checks belong in `docs/development.md`.

## Product Boundary

Keep the panel thin. Codex Panel owns the Obsidian experience around Codex: panels, composing, vault-aware link handoff, approvals and user input, file-change review, archive export, panel preferences, diagnostics, and selection rewrite.

Codex owns runtime behavior and thread state: models, credentials, sandboxing, approval policy, MCP servers, hooks, providers, network access, thread history, archived state, goals, and runtime settings. The panel should read and update that state through `codex app-server`, not redefine it.

Panel settings should store only panel-specific preferences. Do not mirror Codex configuration in Obsidian settings just to display or inspect it.

## Sources of Truth

`codex app-server` is the source of truth for Codex state. Panel-side caches exist to keep the UI stable across transient failures; failed reads or stale panels must not become authoritative empty state.

The app-server API is experimental. The project tracks the supported Codex CLI minor and favors a clean current flow over broad old-protocol compatibility.

Runtime controls should express visible user intent for the active thread rather than copy Codex configuration. Diagnostics should expose only actionable troubleshooting facts.

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

Chat-visible state belongs in the chat state store and named reducer actions. Signals and components may project that state, but they should not become parallel sources of truth.

Each shared app-server resource should have one authoritative query record. Derived metadata may report status but must not duplicate its snapshot.

Preact Signals are a chat panel rendering adapter, not a second state system. Panel surfaces may read narrow signal-backed read models, but application workflows, domain code, presentation helpers, and pure UI components must not depend on broad reducer slices or reactive state primitives.

Imperative DOM bridges are allowed when an external API, host lifecycle, hit-test, focus/selection operation, or measurement problem requires an `HTMLElement`. They should remain narrow boundary adapters, not a second UI composition system inside Preact-owned surfaces.

## Interaction Principles

Multiple panels are separate Obsidian leaves. Treat each panel as its own Codex working surface with independent connection, thread, turn state, composer, and pending requests.

Subagent threads opened from agent activity remain persistent and restorable but stay outside ordinary thread history. Treat their panels as read-only conversation surfaces while preserving their parent and agent provenance for future specialized behavior.

Thread history and other app-server resources should follow app-server semantics. Panel-side views are read models over app-server snapshots and lifecycle events; stale or partial refreshes must not overwrite newer state. Obsidian integrations such as archive note export are convenience views, not replacements for Codex history.

Routine thread lists should load a bounded recent set and paginate older threads on demand instead of eagerly fetching complete inventories.

Selection rewrite is intentionally scoped to a focused edit-and-review workflow. Avoid expanding it into a broader writing assistant without a separate design decision.

Server requests should become panel UI only when the user can naturally answer them in context. Unknown or unsupported requests should stay diagnostic instead of pretending to be normal conversation text.

Thread stream display should separate primary conversation from diagnostic detail and progress/status. Preserve stable item identity across history, streaming, and rendering updates.

Codex Panel UI should feel native inside Obsidian. Prefer Obsidian variables, standard classes, and side-panel patterns. Add custom visual treatment only when Codex-specific state would otherwise be hard to read.

## Testing Direction

Tests should protect user expectations, app-server/panel responsibility boundaries, and state-transition invariants.

Prefer tests for visible behavior and state-transition invariants across panels, threads, requests, streams, and display fallbacks.

Avoid tests that freeze incidental implementation details such as exact DOM nesting, render counts, node reuse, helper decomposition, or no-op array updates unless those details directly protect a user-visible invariant.

Panel tests may define how received structured values are displayed, retained, or normalized. They should not redefine Codex-owned runtime policy, model lists, sandbox behavior, approval policy, or thread history semantics.
