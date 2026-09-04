# Design

Codex Panel is the Obsidian interaction surface for Codex, not an independent runtime or general-purpose productivity suite.

This document records durable design direction and responsibility boundaries. `README.md` introduces the product, its requirements, setup, and essential usage. `docs/development.md` explains how to develop, validate, and maintain the project. Keep implementation details and change history out of these documents unless they are necessary for the document's purpose.

## Product Boundary

Keep the Panel thin. It owns interaction and presentation in Obsidian; `codex app-server` owns runtime behavior and thread semantics.

The panel may provide a narrow management surface for Codex-owned state when direct configuration is impractical, provided app-server retains the semantics. Panel settings should contain only Panel-owned preferences.

User-supplied context and bounded, read-only Obsidian tool results are untrusted prompt input. They confer no authority, do not become Panel-owned thread metadata, and leave resource access governed by Codex permissions.

## Sources of Truth

`codex app-server` is the source of truth for Codex state. Each cached resource has one Panel owner; transient failures and partial reads must not replace a more authoritative view.

Successful Panel actions should appear coherently across affected surfaces. Changes from independent clients may converge eventually; do not impose global ordering unless a user-visible invariant requires it.

Because app-server is experimental, favor a clean current flow over speculative compatibility layers.

The Codex executable and Vault root define an app-server context, with the Vault root as its workspace and working directory. Retired contexts must not change active UI or shared state.

## Code Boundaries

Translate app-server payloads at the boundary into Panel-owned concepts suitable for user interaction. Keep protocol decisions and response shapes inside adapters.

Share domain vocabulary only when multiple boundaries genuinely use the same contract.

## UI Ownership

Keep declarative UI composition under one owner and imperative Obsidian integration at the boundary.

Chat-visible state should have one authoritative owner. Components should consume narrow projections of that state rather than mirror it into another reactive store.

Thread-state restrictions must remain consistent wherever an action is offered and be defined in one place.

## Interaction Principles

Each panel is an independent Codex working surface. A persistent thread has at most one panel owner, while different threads remain independent.

Asynchronous work may publish local results only while its owner still targets them. Committed shared facts and required cleanup must not depend on the initiating view remaining open.

Runtime controls should express visible intent for the active thread rather than copy Codex configuration. Diagnostics should expose only actionable troubleshooting facts.

Prefer interface structure and state over explanatory copy. Normalize absent or unknown protocol values before display rather than exposing transport details.

Server requests should become Panel UI only when the user can naturally answer them in context; unsupported requests remain diagnostic.

Thread streams should separate conversation from diagnostics and preserve item identity across history and streaming updates.

Follow Obsidian's interaction and visual conventions; reserve custom treatment for Codex-specific states.

## Testing Direction

Tests should protect user-visible behavior, ownership boundaries, and meaningful state transitions without freezing implementation details or redefining app-server semantics.
