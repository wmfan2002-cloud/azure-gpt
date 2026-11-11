# @magpie-community/middleware-codex-strip

Codex on a relay that spreads one conversation's turns over several **Azure OpenAI resources**, as [magpie](https://usemagpie.ai) gateway middleware. Azure's Responses API keeps an answer's state on the resource that made it; a relay without session affinity sends later turns to a resource that can't read it, and the turn is refused:

```
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it.
The encrypted content for item rs_… could not be verified. Reason: …
```

The middleware sends such a provider the same conversation with that resource-bound state left out, so every turn is one any resource in the pool can read. Messages, instructions, tools, a call's `call_id` and arguments, tool results and the reasoning **summaries** all go as they were; only the `id`s, the `encrypted_content`, `item_reference`s and (if you turn it on) `previous_response_id` are removed.

Install it from magpie's **Plugins › Discover**, or with `magpie plugin add @magpie-community/middleware-codex-strip`. Set its options under **Plugins › Installed › Options**, or with `magpie plugin options codex-strip '<json>'`.

## Only the providers you name

```json
{ "providers": ["azure-relay"] }
```

**`providers`** are magpie provider **ids** — the `azure-relay` of `azure-relay/gpt-5.4`, the id the Providers list shows in `provider/<id>`, never the display name. Nothing else is needed to be safe: with no `providers`, the middleware changes nothing at all.

It acts in `onProvider`, which magpie runs once for each provider a request is tried on, and every try starts again from the body the agent sent. So:

- A request straight to `azure-relay/gpt-5.4` is stripped for `azure-relay`.
- A request through a **group** or a **fallback** is stripped on the tries that reach a provider named here, and on no other member's — the member beside it is sent the conversation with its ids and seals, so a session that also goes to OpenAI, or to a relay that keeps its own state, keeps working there.
- An unrelated request, to any provider not named, is not touched at all.

A provider renamed in magpie keeps sending the old id for a while: `{"providers": ["relay-new"], "aliases": {"relay-old": "relay-new"}}` follows it. Aliases only choose the rule; they change no model name.

## Options

| Option | Default | |
| --- | --- | --- |
| `providers` | — | The provider ids it acts on: a list, one string, or `{"id": true}`. Empty changes nothing. |
| `ids` | `true` | Takes each input item's `id` (`msg_…`, `rs_…`, `fc_…`, `ctc_…`) from the kinds that carry their own contents. `"all"` takes every kind's, `false` none. |
| `keepIds` | `[]` | Item types whose `id` stays anyway. |
| `encrypted` | `true` | Takes each input item's `encrypted*` fields, and a content part of type `encrypted_content`. |
| `itemReferences` | `"drop"` | `item_reference` holds nothing but an id on the resource, so it goes. `"keep"` sends it. |
| `store` | `"off"` | Sends `"store": false`. `"keep"` leaves the field as the agent sent it. |
| `previousResponse` | `false` | `"drop"` removes a top-level `previous_response_id`. Leave it off (see below). |
| `historySearch` | `"keep"` | `"note"` turns a past `web_search_call` into an assistant message carrying its own record (see below). |
| `aliases` | `{}` | `{"old-id": "new-id"}`. |

```json
{ "providers": ["azure-relay"], "ids": true, "encrypted": true, "store": "off" }
```

### Which ids go

An id is only ever removed from items that carry their own contents — a message, a call, a result, the tool list, and the reasoning and compaction items, which *are* the resource's state. Other kinds may need their id to be read at all, so theirs stays: a `web_search_call`, or a tool item a relay added. `"ids": "all"` removes every one, for a relay where even those are per-resource.

`include` is never changed. It asks for reasoning in the **reply**, not for the history's ciphertext, and some upstreams turn a Codex request away over a changed `include` — the same note `codex-history` (packages/codex-history) carries.

### Why `store` is off, and `previousResponse` is not

`store: false` is what makes the rest hold. For a provider magpie takes to be Azure, OpenAI's own API or Ark's `/api/v3`, magpie keeps each response itself and sends the next turn as **the new input alone under the id it keeps it by** — exactly the state this middleware exists to remove, added after this hook has run. `store: false` stops that, and gives a relay nothing to keep either way. Codex already sends `store: false` on every turn, so for Codex the field changes nothing.

`previousResponse` stays off because magpie has already dealt with the field by the time a hook sees it: once magpie holds the response, it deletes `previous_response_id` and hands the conversation over whole. One still present here is a response **magpie does not hold**, so a client that sent only its new turn would lose everything before it — and a provider that keeps responses would be asked to continue from an id it never made. Codex replays the whole conversation every turn over HTTP and names no previous response, so there is nothing there to remove in the first place. `"drop"` is for a client you know replays its whole history: it removes the field and sends the conversation whole.

### A sealed compaction goes with its summary

`{"type":"compaction","encrypted_content":…}` is the summary of the turns before it, and only its writer can open it. Its ciphertext is removed; an item left holding nothing else is removed with it, so the conversation goes on without that summary instead of being refused. The turns since are still there. magpie's own compaction (`compaction=magpie`, the default) is text any resource reads; only `compaction=native` with a relay in front of several resources runs into this.

### A past web search

`historySearch: "note"` turns each `web_search_call` already in the history into an assistant message that carries the item's own record — its query, status and sources — and nothing else. It is for a relay that refuses such a call as "provided without its required reasoning item": that happens when the reasoning items it named are taken out whole. This plugin does **not** take them out (they stay, their ciphertext gone), so the default is `"keep"`; `codex-history`, which does remove them, ran into exactly this and does the same conversion. No result is reconstructed and nothing is searched again.

## Cost

- The model no longer continues a sealed train of thought across turns: it reasons again each turn. What was said and done is unchanged, and the reasoning **summaries** stay in the history.
- Each turn's history is a few bytes smaller per item (its ids) and one ciphertext smaller per reasoning item, so the prompt is slightly shorter and the cache prefix is unchanged from turn to turn.
- Turning the middleware off, or taking a provider out of `providers`, stops it at once; nothing is written into the conversation or into Codex's folder.

## What it does not do

- It only acts on **Responses** requests (`/v1/responses`). A Chat or Messages request carries no Azure resource state; magpie translates those itself.
- It only acts on requests agents send. magpie's own asks (a thread title, the routing classifier, a search or a vision stand-in) run no agent middleware.
- It cannot make an account's or a resource's own refusal go away, and it doesn't retry. A hook that throws or runs past its 250 ms leaves the request as it came.
- It never reads or keeps a request, a reply, a credential or a conversation. The only thing it writes is one line in magpie's log per changed try, counting what it took out.

Ported from [codex-strip-proxy](https://github.com/AnnaofArendelle/codex-strip-proxy) (AnnaofArendelle), which does the same by putting a local proxy in front of the relay and moving Codex's `base_url` to it. What is different is listed in `PROVENANCE.json`.

中文：这是给「一个中转后面挂着多个 Azure OpenAI 资源、且不做会话粘性」的 Codex 场景用的 magpie 网关中间件。Azure Responses API 把每条回答的状态（item 的 `id`、`encrypted_content` 加密思维链）存在创建它的那个资源上，下次请求落到另一个资源就会被 400 拒绝。中间件只对 **options 里点名的供应商** 生效：`onProvider` 在每一次供应商尝试时运行，而且每次尝试都从 agent 发来的原始请求体重新开始，所以直连某个供应商、走路由组或 fallback、以及同一次请求里的其它成员，都各按各的规则来——没点名的供应商收到的请求与原来一字不差。

默认去掉每个 input item 的 `id`、`encrypted*` 字段、`item_reference`（它只有指向资源上条目的 id），并发送 `"store": false`；消息正文、工具调用与 `call_id`、工具结果、reasoning `summary`、请求头与响应流都原样保留。`previous_response_id` 默认不动：magpie 在钩子之前就把 magpie 自己持有的那条响应展开成整段对话并删掉了该字段，钩子里还留着它的，是 magpie 没有的响应，而客户端可能只发了新的一轮，删掉就会丢上下文；Codex 走 HTTP 时每轮都重放整段历史、也从不带这个字段。只处理 Responses 请求；不会重试，也不会读取或保存请求、回复、凭据。代价是模型不再跨轮接续被密封的思维链，每轮重新推理。关掉插件或把某个供应商从 `providers` 里去掉，立刻停止。
