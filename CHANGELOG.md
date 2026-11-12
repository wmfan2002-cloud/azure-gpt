# Changelog

## 0.3.3 — 2026-11-12

- Keep upstream URLs, deployment names, model metadata and extra client
  headers entirely user-configured. Remove channel-specific header defaults
  and bundled deployment configuration.
- Focus the public documentation on installation, connection options and
  error-triggered Azure Responses history recovery.
- Verify model discovery and HTTP/SSE recovery with native Azure `/openai/v1`
  and relay API prefixes, arbitrary deployment names and per-account URLs.

## 0.3.2 — 2026-11-12

- Recognize resource errors whose relay masks `Azure` as `***`; these actual
  HTTP 400 errors previously passed through without recovery.
- Cover provider setup and HTTP/SSE recovery in the root test command,
  including intact first requests, tool pairs, output-start boundaries,
  protected checkpoints and the single retry limit.

## 0.3.1 — 2026-11-12

- Fix fresh-server sign-in after entering a valid URL. In 0.3.0, the URL
  prompt plus a custom `authorize` made Magpie classify the method as asking
  for its own API key, so it skipped the key field and failed with no key.
- Use Magpie's built-in API-key method: ask for the URL, then the key, and
  retain the URL in account metadata. Preconfigured `baseURL` still skips
  only the URL question. Existing sign-ins remain compatible.
- Clarify the URL field and installation guide: use the upstream relay's
  API base, and configure a fresh server separately from a local checkout.

## 0.3.0 — 2026-11-11

- Replace the root middleware entry point with an OpenCode-compatible
  `azure-gpt` provider plugin for official Magpie; no application patch.
- Own upstream fetch so HTTP and pre-output SSE Azure history failures can
  be repaired internally. Normal requests and streamed output remain intact.
- Bound prefix inspection, propagate cancellation and never retry after
  reasoning/output/tool activity starts. Retry at most once per transport
  invocation; outer Magpie/client retries remain independently configured.
- Return explicit terminal history errors instead of triggering Magpie's
  broader decryption cleanup after safe repair stops.
- Use Magpie's standard API-key sign-in and configurable Responses endpoint,
  model metadata and client headers. No credential-file access.
- Keep `packages/codex-strip` as a separate legacy entry point. The root
  package name changes to `@magpie-community/azure-gpt`; disable the old
  middleware when switching to the new provider.

## 0.2.0 — 2026-11-11

- Default to `mode:"on-error"`: normal requests are unchanged, including
  reasoning, IDs, native searches, storage settings and effort.
- Add `onProviderError` for host-confirmed resource/decryption failures.
  Repair a named reasoning item selectively; retain other reasoning. A
  named foreign message/call ID can be removed without clearing reasoning.
- Stop recovery on opaque compaction or unresolved history references.
- Supply a Magpie source patch for pre-output error detection and one
  request-local repair retry on the same candidate, with no learned cleanup
  state carried into later requests. It also covers text compaction.
- Retain `mode:"always"` as the explicit 0.1.1 behavior. Existing pre-cleaning
  fixtures request that mode rather than redefining their expectations.

### Host compatibility

Stock Magpie, including reviewed source `5c02be05b`, lacks this new hook.
On-error mode preserves requests and warns on an unpatched host; automatic
recovery requires the companion host build. A plugin-only upgrade is not a
complete deployment of this mode.

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
