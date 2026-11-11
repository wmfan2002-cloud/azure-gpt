# Preserve normal reasoning; repair rejected requests once

Use this configuration with a Magpie build that includes the
[provider-recovery patch](patches/README.md):

```json
{ "providers": ["azure-relay"], "mode": "on-error" }
```

Normal requests remain unchanged, including IDs, reasoning, searches,
storage settings, `include`, model, reasoning effort and token limits.
`onProvider` returns no replacement body. Current stock Magpie has no
`onProviderError` hook; on-error mode logs a capability warning there and
cannot initiate recovery. It never silently switches to pre-cleaning.

## The error determines the smallest repair

1. **A named invalid reasoning item:** remove that item and retain its readable
   `summary` and textual `content` as an assistant history note. Other reasoning
   items remain intact. Native search records become text so they no longer
   refer to the removed reasoning.
2. **A named foreign message or call ID:** remove only that ID. Keep encrypted
   reasoning and native search records.
3. **A resource/decryption error without a usable item identity:** clear
   replayed reasoning and portable IDs for this single repair attempt, retaining
   text, tool parameters, results and `call_id` pairs in order.

Native compaction checkpoints, encrypted-only messages, `item_reference`,
and unresolved `previous_response_id` stop automatic repair. Their missing
history cannot be reconstructed by stripping. Resume on their original resource or restore
complete history before replacing it with text.

A repair cannot recover unreadable encrypted reasoning. Keeping all native
reasoning across requests requires routing to the Azure resource that created
it. Normal requests incur none of the plugin's cleanup losses.

## One retry, with request-local state

The host accepts only explicit Azure cross-resource or encrypted-content
validation failures. Authentication, quota, generic server errors, timeouts
and safety refusals do not trigger this repair.

Retry requires an active request and no output, reasoning or tool activity,
even if buffered. `errors=pass` remains pass-through. HTTP validation errors
and SSE failures held before output use the same recovery path.

The host retries once on the same provider/account/model using its existing
lane limits, cancellation and usage accounting. A failed repair returns an
error. No repaired body or cleanup flag is carried into a new request or a
different route candidate.

## Plugin/host interface

The host invokes `onProviderError(body, ctx)` with:

```js
{
  protocol: "responses",
  provider: { id: "azure-relay", model: "gpt-6-astra", recoverySupported: true },
  options: { providers: ["azure-relay"], mode: "on-error" },
  failure: {
    kind: "invalid_encrypted_content", // or "foreign_resource"
    status: 400,
    attempt: 1,
    outputStarted: false,
    itemID: "rs_rejected_item" // optional
  }
}
```

The failure metadata comes from the actual rejected attempt, never from user
JSON. Raw error bodies, headers and credentials are not exposed to the hook.

- `undefined`: leave this failure to the host's existing handling.
- `{action:"stop"}`: return the upstream failure without a lossy repair.
- `{action:"retry", body}`: retry with this repaired body once.

The host accepts history/storage changes only (`input`, `store`,
`previous_response_id`). It refuses changes to model, tools, effort, limits
or other settings. The plugin itself refuses unresolved history references.

## 中文说明

正常请求保留完整 reasoning；仅当明确出现跨资源／解密错误，且尚未开始输出时，
才修复这次请求并重试一次。能定位到具体条目就只清理该条；无法定位时仅这次
重试做较广清理。下一条请求恢复原样发送，不记住永久清理状态。

此模式需要配套的 Magpie 主程序补丁。只安装 JS 插件不会获得自动重试能力；
`mode:"always"` 才会显式恢复旧的每次清理行为。原生压缩摘要和无法展开的历史
引用会保留并返回错误，避免删除工作历史。
