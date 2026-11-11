# Changelog

## 0.1.1 — 2026-11-11

- Remove replayed reasoning items whole when encryption cleanup is enabled.
  Preserve readable summaries/content as ordinary assistant history notes.
- Convert past native search calls to recorded text by default alongside
  reasoning cleanup. Explicit `historySearch: "keep"` remains available;
  `encrypted: false` keeps native searches by default.
- Preserve native compaction checkpoints in full, including when
  `ids: "all"` is set. Warn with recovery steps instead of silently deleting
  the only remaining record of earlier context.
- Make `ids: true` use the same content-bearing whitelist as an omitted
  option. Only `ids: "all"` removes IDs from unknown item kinds.
- Correct the package repository URL and `previousResponse: "drop"`
  provenance example. Update the existing fixtures for the changed behavior.
- Include a separate Magpie source patch to run agent-requested text
  compaction through the existing JS middleware chain. The plugin installer
  does not apply this patch.

### Upgrade behavior

Empty reasoning items no longer appear in forwarded history. Readable
reasoning and native searches become text notes, changing the prompt
representation from `0.1.0`. Native compaction errors may remain visible
until their checkpoint is replayed on its original resource or the original
history is restored; the checkpoint is no longer discarded.

## 0.1.0

Initial provider-scoped Magpie port of codex-strip-proxy.

The original author reported these checks for `7492800`:

- Bun: 30 fixture cases, no failures.
- The same fixtures in Magpie's JavaScript engine: 30/30.
- A sandboxed Magpie server with two providers: selected-provider cleanup
  and unchanged requests to the unselected provider.
- Real multi-resource Azure relay and Windows execution were not checked.

Those results belong to the original version, not to the `0.1.1` changes.
