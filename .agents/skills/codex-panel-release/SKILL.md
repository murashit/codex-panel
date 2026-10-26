---
name: codex-panel-release
description: Prepare, publish, or repair a Codex Panel release, including version selection and public release notes.
---

# Codex Panel Release

Use [Release](../../../docs/release.md) to prepare the candidate and public notes. Inspect relevant implementation, tests, and callers so the proposed notes describe verified user-visible behavior rather than hidden agent context or protocol metadata.

Finalize the notes and release-branch history together under the guide, leaving tagpr generation unchanged until that phase. Every release PR must end as one commit directly changing the previous released version to the final target, with subject `chore(release): X.Y.Z` matching that target.

Present the exact final notes, selected version, previous tag, and proposed head/range to the user and obtain explicit approval before merging the release PR or initiating tagging/publication. A general release request authorizes preparation only; do not enable auto-merge while waiting.

Apply the guide's finalization checks immediately before merging, including successful required CI for the exact final remote head. Compare the re-fetched body byte-for-byte with the approved text and verify the approved version and included changes still match. After any head or main/base change or tagpr regeneration, repeat the affected finalization and verification; reuse approval if the exact notes, version, and included changes are unchanged. Neither a SHA match nor passing CI proves body approval. Present changed release contents for renewed approval; if exact-content verification is uncertain, stop and resolve it with the user.

Follow the guide through merged-body verification and the publication result before reporting completion. On a content mismatch, stop publication/recovery and resolve it with the user. Inspect uncertain merge or publication outcomes before retrying.

Recover only within valid approval of the exact release contents and recovery action. Reuse that approval; ask only if it is absent or uncertain, or the scope changes. Do not infer permission to move tags or overwrite published releases from release preparation approval.
