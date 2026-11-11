# @magpie-community/middleware-codex-strip

Codex on a relay that spreads one conversation's turns over several **Azure OpenAI resources**, as [magpie](https://usemagpie.ai) gateway middleware. Azure's Responses API keeps an answer's state on the resource that made it; a relay without session affinity sends later turns to a resource that can't read it, and the turn is refused:

```
The requested item was created under a different Azure OpenAI resource.
Use the same resource that created the item to access it.
The encrypted content for item rs_… could not be verified. Reason: …
```

The middleware removes replayed reasoning and portable item IDs on selected providers. Messages, instructions, tools, `call_id` pairs, arguments and tool results stay in order. Readable reasoning is carried as ordinary text rather than an incomplete `reasoning` item. Native compaction checkpoints stay intact because they can be the only remaining record of earlier work.

Install this repository with `magpie plugin add github:wmfan2002-cloud/azure-gpt`, or install a local clone with `magpie plugin add ./azure-gpt`. Set options under **Plugins › Installed › Options**, or with `magpie plugin options codex-strip '<json>'`.

## Only the providers you name

```json
{ "providers": ["azure-relay"] }
```

**`providers`** are magpie provider **ids** — the `azure-relay` of `azure-relay/gpt-5.4`, the id the Providers list shows in `provider/<id>`, never the display name. With no `providers`, the middleware changes nothing.

It acts in `onProvider`, which magpie runs once for each provider a request is tried on, and every try starts again from the body the agent sent. So:

- A request straight to `azure-relay/gpt-5.4` is stripped for `azure-relay`.
- A request through a **group** or a **fallback** is stripped on the tries that reach a provider named here, and on no other member's — the member beside it is sent the conversation with its ids and seals, so a session that also goes to OpenAI, or to a relay that keeps its own state, keeps working there.
- An unrelated request, to any provider not named, is not touched at all.

A provider renamed in magpie keeps sending the old id for a while: `{"providers": ["relay-new"], "aliases": {"relay-old": "relay-new"}}` follows it. Aliases only choose the rule; they change no model name.

## Options

| Option | Default | |
| --- | --- | --- |
| `providers` | — | The provider ids it acts on: a list, one string, or `{"id": true}`. Empty changes nothing. |
| `ids` | `true` | Strip IDs from content-bearing items. `true` and omission use the same whitelist; `"all"` includes unknown kinds, `false` keeps IDs. Compaction is always preserved. |
| `keepIds` | `[]` | Retain IDs on these surviving item types. Does not prevent reasoning or search conversion. |
| `encrypted` | `true` | Remove reasoning items, keeping readable text as notes; strip other `encrypted*` fields and encrypted content parts. Compaction is preserved. `false` keeps encrypted state. |
| `itemReferences` | `"drop"` | `item_reference` holds nothing but an id on the resource, so it goes. `"keep"` sends it. |
| `store` | `"off"` | Sends `"store": false`. `"keep"` leaves the field as the agent sent it. |
| `previousResponse` | `false` | `"drop"` removes a top-level `previous_response_id`. Leave it off (see below). |
| `historySearch` | `"note"` when `encrypted` is enabled; otherwise `"keep"` | Carry past `web_search_call` records as text. Explicit `"keep"` preserves native search items. |
| `aliases` | `{}` | `{"old-id": "new-id"}`. |

```json
{ "providers": ["azure-relay"], "ids": true, "encrypted": true, "store": "off" }
```

### Which ids go

The whitelist covers messages, function/custom-tool calls and outputs, tool-search calls and outputs, additional tool definitions, and reasoning items retained with `encrypted: false`. Unknown tool kinds keep their IDs unless `ids: "all"` is explicit. `keepIds` takes precedence over either setting. Compaction checkpoints bypass all ID and encryption stripping, including `ids: "all"`.

`include` is unchanged: it controls the **reply**. Newly returned encrypted reasoning is cleaned when it is replayed in the next request.

### Reasoning is removed as an item, not left as an empty shell

With encryption cleanup enabled, a reasoning item with no readable text is removed whole. Its `summary` and textual `content`, when present, become an assistant history note. A request never receives `{"type":"reasoning","summary":[]}` as a result of this cleanup.

This works even when Magpie sees a generic relay domain rather than an Azure endpoint. It does not depend on Magpie detecting Azure and removing bare reasoning later. `ids: false` applies to surviving items; it does not stop reasoning conversion. Use `encrypted: false` to retain reasoning as a native item and keep its ciphertext.

### Why `store` is off, and `previousResponse` is not

`store: false` is what makes the rest hold. For a provider magpie takes to be Azure, OpenAI's own API or Ark's `/api/v3`, magpie keeps each response itself and sends the next turn as **the new input alone under the id it keeps it by** — exactly the state this middleware exists to remove, added after this hook has run. `store: false` stops that, and gives a relay nothing to keep either way. Codex already sends `store: false` on every turn, so for Codex the field changes nothing.

`previousResponse` stays off because magpie has already dealt with the field by the time a hook sees it: once magpie holds the response, it deletes `previous_response_id` and hands the conversation over whole. One still present here is a response **magpie does not hold**, so a client that sent only its new turn would lose everything before it — and a provider that keeps responses would be asked to continue from an id it never made. Codex replays the whole conversation every turn over HTTP and names no previous response, so there is nothing there to remove in the first place. `"drop"` is for a client you know replays its whole history: it removes the field and sends the conversation whole.

### Preserve a sealed compaction checkpoint

`{"type":"compaction","encrypted_content":…}` can replace the entire earlier context. The plugin preserves that item, its ID and all its fields, and logs a warning when encryption cleanup encounters it. A readable field beside the ciphertext is not proof that it contains the complete checkpoint, so that item also stays whole.

If Azure refuses the checkpoint, resume on the resource that created it. If that resource is unavailable, restore the original history and create a portable text summary before continuing. This plugin has no history store and cannot decrypt an Azure checkpoint. `onProvider` cannot reject a request in the reviewed Magpie host; throwing would merely forward the original request. Preserving the checkpoint keeps an upstream refusal from silently becoming a conversation with missing history.

Magpie expands its own text summaries before this hook. Prefer text compaction for multi-resource relays. Some Magpie text-compaction calls bypass JS middleware; the repository includes a [host integration patch](../../patches/README.md) for that path. The standalone native `/responses/compact` endpoint remains a separate host path.

### A past web search

Removing reasoning can leave a native `web_search_call` without the reasoning item it requires. Therefore, when encryption cleanup is enabled, the default converts each past search into an assistant message carrying its recorded query, status and sources. It neither searches again nor invents results. The search's resource ID is excluded from the note.

Explicit `historySearch: "keep"` preserves the native call for a provider that supports it. With `encrypted: false`, search items also stay native by default; `historySearch: "note"` still enables conversion independently.

## Cost

- The model no longer continues encrypted reasoning across turns. Readable reasoning and search records remain as text; ordinary messages and tool results remain in their original order.
- Cleanup reduces encrypted replay data. Converting items to notes changes the prompt representation, including its cache prefix when upgrading from `0.1.0`.
- Turning the middleware off, or taking a provider out of `providers`, stops it at once; nothing is written into the conversation or into Codex's folder.

## What it does not do

- It only acts on **Responses** requests (`/v1/responses`). A Chat or Messages request carries no Azure resource state; magpie translates those itself.
- It acts where Magpie invokes agent middleware. The supplied host patch adds agent-requested text compaction; titles, routing classifiers, search and vision helper calls keep their original paths.
- It cannot make an account's or a resource's own refusal go away, and it doesn't retry. A hook that throws or runs past its 250 ms leaves the request as it came.
- It processes the supplied request in memory. It does not persist history or read credentials. Logs contain counts and recovery guidance, not message text, ciphertext or tool results.

Ported from [codex-strip-proxy](https://github.com/AnnaofArendelle/codex-strip-proxy) (AnnaofArendelle), which does the same by putting a local proxy in front of the relay and moving Codex's `base_url` to it. What is different is listed in `PROVENANCE.json`.

## 中文使用要点

只需在插件 Options 中填写实际渠道 ID：`{"providers":["azure-relay"]}`。默认整项清理 reasoning，把可读摘要和历史原生搜索转成文本，保留普通消息、工具参数、结果与 `call_id` 配对。`ids: true` 与省略配置均使用白名单；只有 `"all"` 才扩大 ID 清理范围。

原生加密压缩摘要始终完整保留。如果它属于另一个 Azure 资源，需要回到原资源续写，或恢复原历史后生成文本摘要。插件不会通过删除摘要来掩盖错误。Magpie 部分内部压缩请求需要应用仓库附带的宿主补丁才能经过插件；安装插件本身不会修改 Magpie 主程序。

`previous_response_id` 默认保留：Magpie 无法展开的引用可能是增量客户端唯一的旧历史入口。只有确认客户端每次完整回放历史时才使用 `previousResponse: "drop"`。停用插件或移除 `providers` 中的渠道即可停止处理。
