# azure-gpt — codex-strip for magpie

A [magpie](https://usemagpie.ai) gateway middleware for one case: Codex talks
to a relay that spreads a conversation's turns over several **Azure OpenAI
resources**, and Azure's Responses API refuses every turn that lands on a
resource other than the one that made the items it carries.

```
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it.
The encrypted content for item rs_… could not be verified. Reason: …
```

The middleware cleans replayed history **only on the providers you name**:
it removes portable item IDs and reasoning items, keeps readable reasoning
as text, and converts past native searches into recorded notes. Messages,
tool arguments, results and `call_id` pairs stay in order. Other providers
and route-group members receive the original request.

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
Check it loaded under **Plugins › Installed** (`gateway middleware ·
onProvider`), and that requests are being stripped in magpie's log:

```
codex-strip: azure-relay (gpt-5.4) 3 ids, 1 reasoning item removed
```

For Windows, the same provider configuration can be pasted into
**Plugins › Installed › Options** without shell quoting:

```json
{ "providers": ["azure-relay"] }
```

## Compaction needs the Magpie request path too

Ordinary `/v1/responses` summary requests pass through this plugin. In the
Magpie source reviewed at `60f0433d1`, a `compaction_trigger` handled by
Magpie's text-compaction path calls the upstream without JS middleware.
Installing this plugin alone does not change that path.

[`patches/magpie-compaction-middleware.patch`](patches/magpie-compaction-middleware.patch)
connects those compaction calls to the same middleware chain, including
per-provider selection. It is a **Magpie source patch**, to apply when
building Magpie; it is not installed by `magpie plugin add`.
See [the integration instructions](patches/README.md).

Prefer Magpie's text compaction for a relay that changes Azure resources.
The patch does not make native `/responses/compact` ciphertext portable.

## Options

| Option | Default | |
| --- | --- | --- |
| `providers` | — | Provider ids it acts on: a list, one string, or `{"id": true}`. |
| `ids` | `true` | Strip IDs of content-bearing items. `true` and omission use the same whitelist; `"all"` includes unknown item kinds, `false` keeps IDs. Compaction checkpoints are always preserved. |
| `keepIds` | `[]` | Retain IDs on these surviving item types. |
| `encrypted` | `true` | Remove reasoning items, retaining readable text as notes; strip other `encrypted*` fields and encrypted content parts. Compaction is preserved. `false` keeps encrypted state. |
| `itemReferences` | `"drop"` | Drop `item_reference` items; `"keep"` sends them. |
| `store` | `"off"` | Send `store: false`; `"keep"` leaves it as sent. |
| `previousResponse` | `false` | `"drop"` removes a top-level `previous_response_id`. |
| `historySearch` | `"note"` when `encrypted` is enabled; otherwise `"keep"` | Convert past native searches to text records so they no longer require the removed reasoning. Explicit `"keep"` preserves native search items. |
| `aliases` | `{}` | `{"old-id": "new-id"}`, for a renamed provider. |

See the [package README](packages/codex-strip/README.md) for request handling
and the [changelog](CHANGELOG.md) for the `0.1.1` behavior changes.

## Tests

```sh
bun test packages/codex-strip
```

`packages/codex-strip/cases.json` contains the shared fixtures for Bun and
Magpie's JavaScript engine. Earlier execution results are recorded under
`0.1.0` in the changelog.
