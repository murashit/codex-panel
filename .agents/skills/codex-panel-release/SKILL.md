---
name: codex-panel-release
description: Prepare, publish, or repair a Codex Panel release, including version selection and public release notes.
---

# Codex Panel Release

Use [Release](../../../docs/release.md) to prepare the candidate and public notes. Inspect relevant implementation, tests, and callers so the proposed notes describe verified user-visible behavior rather than hidden agent context or protocol metadata.

Present the exact final notes, selected version, previous tag, and proposed head/range to the user and obtain explicit approval before merging the release PR or initiating tagging/publication. A general release request authorizes preparation only; do not enable auto-merge while waiting.

Apply the guide's finalization checks immediately before merging. Compare the re-fetched body byte-for-byte with the approved text and verify the approved version and range still match, including any head or main/base change. Neither a SHA match nor passing CI proves body approval. If the body, version, or range changes, present the changed contents for renewed approval. If exact-content verification is uncertain, stop and resolve it with the user.

Follow the guide through merged-body verification and the publication result before reporting completion. On a content mismatch, stop publication/recovery and resolve it with the user. Inspect uncertain merge or publication outcomes before retrying.

Recover only within valid approval of the exact release contents and recovery action. Reuse that approval; ask only if it is absent or uncertain, or the scope changes. Do not infer permission to move tags or overwrite published releases from release preparation approval.
