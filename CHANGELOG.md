# Changelog

## 0.4.1 — 2026-11-12

- Fix the new settings page reporting an account added before Magpie had
  published its models. On a first install with slow model discovery, an
  immediate request could hold a provider with no interface and fail with
  `Azure GPT has no endpoint configured` even after discovery completed.
- Wait for both account discovery and Magpie's published model list before
  completing Add account. Show the discovery error when the key was saved
  but models could not load.
- Reject an empty manual model form and report an empty upstream list with
  a model-configuration message.
- Add first-request checks with delayed discovery, explicit discovery
  failures, and native URL/key sign-in plus existing-account compatibility.

## 0.4.0 — 2026-11-12

- Use **Azure GPT** as the English default provider display name. Preserve
  existing custom names and the `azure-gpt` provider ID.
- Add a visual plugin page and provider-menu action. Set the display name,
  account name, URL and key together when adding an account; rename later
  without editing JSON.
- Edit existing accounts' URLs, authentication headers, API versions,
  model listing URLs and extra request headers. Optional key replacement
  preserves account identity; an empty replacement keeps the stored key.
- Support Azure `api-key` authentication and explicitly configured
  `api-version` on discovery and Responses requests.
- Add manual model forms for deployments, names, token limits, reasoning,
  image input, tool calls, reasoning levels and service tiers. Other basic
  account settings use Magpie's regular provider editor.
- Store keys through Magpie's auth SDK. Serve the settings page in the
  existing plugin host and retain unedited plugin options. Handle sandboxed
  page actions, options-write throttling and host restarts. Transfer the
  settings listener when an old host is still finishing a model request.
- Check settings and authenticated recovery through real Magpie browser
  flows with an isolated profile and simulated upstream.

## 0.3.4 — 2026-11-12

- Allow a custom provider display name through the `name` plugin option.
  Omitted or blank names use the default. Provider IDs, model selections,
  sign-ins and history recovery remain the same.

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
