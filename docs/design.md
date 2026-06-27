# Design

Codex Panel is an Obsidian surface for Codex. It exists to put Codex beside vault notes without becoming a separate AI client, runtime policy editor, terminal, search product, or writing suite.

This document records durable design direction. User-facing behavior belongs in `README.md`; daily workflow, source layout, generated files, and compatibility checks belong in `docs/development.md`.

## Product Boundary

Keep the panel thin. Codex Panel owns the Obsidian experience around Codex: panels, thread display, composing, approvals and user input, vault-aware link handoff, archive export, settings for panel preferences, diagnostics, and selection rewrite review.

Codex owns runtime policy and thread truth. Model defaults, sandboxing, approvals, MCP servers, hooks, providers, network access, thread history, archived threads, effective configuration, goals, and runtime settings should come from Codex through `codex app-server`.

Panel settings should store only panel-specific preferences. Do not duplicate Codex configuration into Obsidian settings just because a value is useful to display or inspect.

## Sources of Truth

The repository checkout is the source of truth for implementation, version control, and release work. Ignored release assets are generated outputs, even when Obsidian loads them at runtime.

`codex app-server` is the source of truth for Codex state. Panel-side caches exist to keep the UI stable across transient failures; failed reads or stale panels must not become authoritative empty state.

The app-server API is experimental. The project tracks the supported Codex CLI minor and favors a clean current flow over broad old-protocol compatibility. Current optional and nullable fields are still part of the contract and must be normalized before display.

Runtime controls should represent visible user intent layered over Codex's active thread state and effective configuration. They should not become a parallel copy of Codex configuration or policy. Codex-owned policy structures should stay at the app-server boundary unless the panel owns a concrete workflow for them. Diagnostics should include only actionable troubleshooting facts, not broad raw snapshots kept because they are available.

Fast mode is a user-facing runtime intent, not a general service-tier editor. Codex owns service tier identifiers, names, and defaults; the panel should express whether the user wants the Fast experience without redefining those semantics.

## Code Boundaries

Generated app-server protocol types should stay behind `src/app-server/`. Services at that boundary adapt protocol payloads into panel-owned domain models or small projections before payloads reach features, workspace coordination, settings, or UI.

Chat application workflows should express turn, thread, goal, runtime-setting, and reference-thread needs as chat-owned contracts. Root app-server clients, RPC method names, connection freshness checks, vault-path injection, and protocol projection belong in chat app-server transports or host wiring, not in application state-transition code.

Turn stream conversion is the main exception: raw app-server stream payloads may be consumed at the conversion boundary because the event set is broad and changes with Codex. The converter should still reduce them into panel-owned display and diagnostic models before they reach chat state or UI.

Server request adapters should normalize method-specific app-server requests into coarse panel models before they reach pending request state. The UI should handle user-facing intent; app-server-specific decisions and response payloads should remain boundary-owned.

Source modules should be organized by reason to change, not by the single Obsidian plugin entrypoint. Boundaries should stay close to the state, lifecycle, or external API they own.

Feature-to-feature imports are acceptable when the imported feature owns a real capability. Generic helpers belong in `src/shared/`, generated-independent meaning belongs in `src/domain/`, and protocol adaptation belongs in `src/app-server/`.

Do not hide complexity behind forwarding layers. Add an abstraction only when it owns a lifecycle, boundary, state transition, or reusable domain capability.

## UI Ownership

Runtime UI composition is Preact-owned. Preact components should render the panel shell, toolbar, message stream, composer, and request controls.

Obsidian and app-server boundaries stay outside Preact components. `ItemView` classes, plugin lifecycle, app-server connections, controllers, `MarkdownRenderer`, editor APIs, notices, and workspace operations belong in boundary modules.

Chat-visible state belongs in `ChatStateStore` and named reducer actions. Signals and components may project that state, but they should not become parallel sources of truth for turns, pending requests, runtime settings, history cursors, or open details.

Preact Signals are a shell-local projection adapter, not a second state system. Surface projections should read narrow shell-state contracts instead of making components or presenters depend on broad reducer slices. Domain, application, host, presentation, and component modules should keep using pure selectors, reducer actions, and explicit props rather than importing signals directly.

Imperative DOM bridges are allowed when an external API, host lifecycle, hit-test, focus/selection operation, or measurement problem requires an `HTMLElement`. Normal modules should keep DOM meaning behind named adapters; files that read, measure, write, query, focus, or wire DOM directly should be named with a `.dom`, `.obsidian`, or `.measure` suffix and should not become a second UI composition system inside Preact-owned surfaces.

## Interaction Principles

Multiple panels are separate Obsidian leaves. Treat each panel as its own Codex working surface with independent connection, thread, turn state, composer, and pending requests.

Thread history, archived state, forks, and catalog snapshots should follow app-server semantics. The thread catalog is a read model over app-server list snapshots and lifecycle events; callers submit events instead of choosing cache mutations or refreshes themselves. One list response must not discard newer app-server state. Obsidian integrations such as archive note export are convenience views of Codex state, not replacements for Codex history.

Shared app-server resources should follow the same rule. Notifications should describe resource events such as skill changes, sparse rate-limit updates, or MCP startup status updates; the app-server resource actions decide whether to use cached metadata, refresh a probe, or update diagnostics.

Selection rewrite is intentionally scoped to a focused edit-and-review workflow. Avoid expanding it into a broader writing assistant without a separate design decision.

Server requests should become panel UI only when the user can naturally answer them in context. Unknown or unsupported requests should stay diagnostic instead of pretending to be normal conversation text.

Message stream display should separate primary conversation from diagnostic detail and progress/status. Preserve stable item identity across history, streaming, and rendering updates.

Codex Panel UI should feel native inside Obsidian. Prefer Obsidian variables, standard classes, and side-panel patterns. Add custom visual treatment only when Codex-specific state would otherwise be hard to read.

## Testing Direction

Tests should protect user expectations, app-server/panel responsibility boundaries, and state-transition invariants.

Prefer tests for visible behavior: independent panels, thread-scoped resets, pending request handling, approval flows, readable transcript/detail/status grouping, scroll preservation, and display fallbacks for structured app-server values.

Avoid tests that freeze incidental implementation details such as exact DOM nesting, render counts, node reuse, helper decomposition, or no-op array updates unless those details directly protect a user-visible invariant.

Panel tests may define how received structured values are displayed, retained, or normalized. They should not redefine Codex-owned runtime policy, model lists, sandbox behavior, approval policy, or thread history semantics.
