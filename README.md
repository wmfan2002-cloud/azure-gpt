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

The middleware strips that resource-bound state (item `id`s,
`encrypted_content`, `item_reference`) from the request, **only on the
providers you name** — every other provider, and every other member of a
route group, gets the request exactly as the agent sent it.

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

With no options set it changes nothing at all, so installing it is safe.
Check it loaded under **Plugins › Installed** (`gateway middleware ·
onProvider`), and that requests are being stripped in magpie's log:

```
codex-strip: azure-relay (gpt-5.4) 3 ids, 1 encrypted field
```

## Options

| Option | Default | |
| --- | --- | --- |
| `providers` | — | Provider ids it acts on: a list, one string, or `{"id": true}`. |
| `ids` | `true` | Strip each input item's `id` on the kinds that carry their own contents. `"all"` takes every kind's, `false` none. |
| `keepIds` | `[]` | Item types whose `id` stays anyway. |
| `encrypted` | `true` | Strip `encrypted*` fields and `type: "encrypted_content"` parts. |
| `itemReferences` | `"drop"` | Drop `item_reference` items; `"keep"` sends them. |
| `store` | `"off"` | Send `store: false`; `"keep"` leaves it as sent. |
| `previousResponse` | `false` | `"drop"` removes a top-level `previous_response_id`. |
| `historySearch` | `"keep"` | `"note"` turns a past `web_search_call` into an assistant message carrying its own record. |
| `aliases` | `{}` | `{"old-id": "new-id"}`, for a renamed provider. |

The package README has the reasoning behind each default, what it costs, and
what it deliberately does not do.

## Tests

```sh
bun test packages/codex-strip
```

`packages/codex-strip/cases.json` is also run in magpie's own JavaScript
engine as part of magpie; the cases are written so both engines agree.

## What was run

- `bun test packages/codex-strip` — 30 cases, 0 failures.
- The same 30 cases through magpie's engine (`internal/middleware`), 30/30.
- A sandboxed `magpie serve` with two providers: the named one received the
  conversation with ids and seals removed, the other byte-identical to what
  was sent.
- Not tried: a real multi-resource Azure OpenAI relay (no account here), and
  Windows.
