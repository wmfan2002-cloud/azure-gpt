# azure-gpt — error-triggered recovery for Magpie

A [magpie](https://usemagpie.ai) gateway middleware for one case: Codex talks
to a relay that spreads a conversation's turns over several **Azure OpenAI
resources**, and Azure's Responses API refuses every turn that lands on a
resource other than the one that made the items it carries.

```
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it.
The encrypted content for item rs_… could not be verified. Reason: …
```

**Normal requests are unchanged.** On a supporting Magpie host, an explicit
cross-resource or decryption rejection triggers one repaired retry on the
same provider/model, before any output or tool activity. Only the providers
you name participate. The next request again starts with complete reasoning;
no permanent cleanup flag is remembered.

**Version 0.2.0 requires the Magpie provider-recovery hook.** Stock Magpie
currently lacks it. Installing the plugin alone preserves requests and logs
a capability warning; automatic retry requires the [host patch](patches/README.md).
See [the recovery contract](ERROR_RECOVERY.md).

**Native compaction checkpoints are preserved in full.** They may be the
only remaining record of earlier work. If one belongs to another Azure
resource, resume on its original resource or restore the original history
and create a text summary. Deleting the checkpoint would lose that history.

Ported from [codex-strip-proxy](https://github.com/AnnaofArendelle/codex-strip-proxy);
details and the differences are in
[`packages/codex-strip/PROVENANCE.json`](packages/codex-strip/PROVENANCE.json).

## Install on another machine

Two ways; both load the same file.

**From GitHub**, with magpie's Bun installer:

```sh
magpie plugin add github:wmfan2002-cloud/azure-gpt
```

**From a clone** (no Bun download; the plugin runs in magpie's own engine):

```sh
git clone https://github.com/wmfan2002-cloud/azure-gpt.git
magpie plugin add ./azure-gpt
```

Then name the providers it should act on — the **provider id**, as
`magpie providers` lists it (`provider/<id>`), not the display name:

```sh
magpie plugin options codex-strip '{"providers": ["azure-relay"]}'
```

`codex-strip` is the short name; the package's own name also works.

With no providers configured, it changes nothing.
On a patched host, **Plugins › Installed** lists `onProviderError` alongside
`onProvider`. A repaired request produces a log entry such as:

```
codex-strip: azure-relay recovery after invalid_encrypted_content; 1 reasoning item removed
```

For Windows, the same provider configuration can be pasted into
**Plugins › Installed › Options** without shell quoting:

```json
{ "providers": ["azure-relay"], "mode": "on-error" }
```

## Apply the host half for automatic retry

The host patch adds pre-output failure handling to the existing middleware
engine and connects agent-requested text compaction to that same chain.

[`patches/magpie-provider-recovery.patch`](patches/magpie-provider-recovery.patch)
is a **Magpie source patch**, to apply when building Magpie. It supersedes
the earlier compaction-only patch and is not installed by `magpie plugin add`.
See [the integration instructions](patches/README.md).

Prefer Magpie's text compaction for a relay that changes Azure resources.
The patch does not make native `/responses/compact` ciphertext portable.

## Options

Cleanup options below apply to the single repair attempt, not normal requests.
`mode:"always"` explicitly restores the 0.1.1 pre-cleaning behavior.

| Option | Default | |
| --- | --- | --- |
| `providers` | — | Provider ids it acts on: a list, one string, or `{"id": true}`. |
| `mode` | `"on-error"` | Preserve normal requests; repair after a host-confirmed rejection. `"always"` enables legacy pre-cleaning. |
| `ids` | `true` | Strip IDs of content-bearing items. `true` and omission use the same whitelist; `"all"` includes unknown item kinds, `false` keeps IDs. Compaction checkpoints are always preserved. |
| `keepIds` | `[]` | Retain IDs on these surviving item types. |
| `encrypted` | `true` | Remove reasoning items, retaining readable text as notes; strip other `encrypted*` fields and encrypted content parts. Compaction is preserved. `false` keeps encrypted state. |
| `itemReferences` | `"drop"` in legacy mode | Legacy pre-cleaning can drop references. On-error mode stops repair if a reference cannot be reconstructed. |
| `store` | `"off"` | Send `store: false`; `"keep"` leaves it as sent. |
| `previousResponse` | `false` | `"drop"` is legacy-only. On-error mode stops repair when a response reference remains unresolved. |
| `historySearch` | `"note"` when `encrypted` is enabled; otherwise `"keep"` | Convert past native searches to text records so they no longer require the removed reasoning. Explicit `"keep"` preserves native search items. |
| `aliases` | `{}` | `{"old-id": "new-id"}`, for a renamed provider. |

See the [package README](packages/codex-strip/README.md) for request handling
and the [changelog](CHANGELOG.md) for the `0.2.0` behavior changes.

## Tests

```sh
bun test packages/codex-strip
```

`packages/codex-strip/cases.json` contains the legacy pre-cleaning fixtures
with explicit `mode:"always"`. Earlier execution results are recorded under
`0.1.0` in the changelog.
