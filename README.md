# Azure GPT — recover rejected history without changing Magpie

An **OpenCode-compatible provider plugin for official Magpie**. It sends native
Responses requests to your Azure API or relay, preserves normal reasoning,
and repairs a request only after a specific cross-resource or decryption error.
No Magpie source patch or separate proxy service is required.

The upstream URL, model IDs, model limits and client headers come from your
sign-in, upstream model discovery or plugin options. Recovery uses the
Responses protocol and error content, independently of the upstream domain
or deployment name.

```text
Codex → official Magpie → Azure GPT provider plugin → your Responses API
```

## Install and connect

```sh
magpie plugin add github:wmfan2002-cloud/azure-gpt#main
magpie plugin login azure-gpt
```

The sign-in first asks for your **Responses API base URL**, such as
`https://your-resource.openai.azure.com/openai/v1` or
`https://relay.example.com/v1`. Click Next, then enter the upstream's API key
in Magpie's normal key field. Use the original provider's API base, not your
Magpie server's address or the full `/responses` endpoint. The key and URL are
kept by Magpie's normal plugin sign-in store. The plugin never reads another
channel's keys. The upstream's `/models` endpoint supplies the model list.

In Magpie, select **Azure GPT · 按报错修复** as the provider for Codex, then
choose the original model and reasoning level. This is a new provider: merely
installing it does not intercept another provider's requests.

To install local unpublished changes:

```sh
magpie plugin off azure-gpt
magpie plugin add /path/to/azure-gpt
```

Magpie registers a local path separately from a GitHub package. Turn the
GitHub installation off first so the two copies do not compete to serve
`azure-gpt`. The local installation uses the existing provider sign-in.

### Connection and model options

Use **Plugins → Installed → Options** to set non-secret connection details and
model metadata. Keep the upstream's actual limits and supported reasoning
levels. A `models` object disables `/models` discovery; the supplied list is
used as written. If discovery supplies only model IDs, configure the missing
metadata using your upstream's supported settings. `headers` carries the
client headers you configure, on both discovery and requests.

Add `"name": "My Azure"` to your existing options to customize the provider's
display name. An omitted or blank name uses **Azure GPT · 按报错修复**. The
provider ID remains `azure-gpt`, so existing model selections and sign-ins
continue to work. Keep your other connection and model options when editing.

```json
{
  "baseURL": "https://relay.example.com/v1",
  "models": {
    "your-model-id": {
      "name": "Your model",
      "reasoning": true,
      "tool_call": true,
      "modalities": { "input": ["text", "image"], "output": ["text"] },
      "variants": { "low": {}, "medium": {}, "high": {} }
    }
  }
}
```

After configuring the URL here, sign-in only asks for the API key. Enter keys
in Magpie's sign-in dialog, not in plugin options or shell arguments.

## What happens to reasoning

1. **Every request starts intact.** The plugin does not remove reasoning, IDs,
   searches, or history before sending it, and does not change model, effort,
   tools, output limits or `include`.
2. **Only the specified Azure errors trigger repair.** The plugin recognizes
   HTTP error responses and pre-output SSE failures, including HTTP 200 with
   `response.failed`.
3. **Only that transport call is retried, at most once.** A named bad item is
   repaired selectively; an unidentified rejection requires broader cleanup
   on that attempt. The next call again sends the original history.
4. **New output remains intact.** After any reasoning, output item or tool
   activity begins, the plugin passes the stream through and never replays it.

The inspected prefix is bounded to 64 KiB and is replayed byte-for-byte on
normal responses; the plugin does not buffer an entire successful stream.
Cancellation propagates to upstream fetch and stream reading.

Opaque compaction checkpoints, unresolved references and encrypted-only
messages are retained. If they prevent safe repair, the plugin returns
`azure_gpt_history_unavailable`. A repeated history rejection returns
`azure_gpt_recovery_failed`. These explicit errors also keep Magpie's built-in
decryption fallback from starting a broader history cleanup after the plugin
has stopped.

Magpie or Codex may independently retry a failed call according to their own
settings; this plugin does not install a gateway-wide retry policy. See
[the transport contract](ERROR_RECOVERY.md).

## Upgrade from 0.1.x / 0.2.0

The root package is now `@magpie-community/azure-gpt`, a provider plugin.
The old middleware remains separately available under `packages/codex-strip`
for existing explicit users. It is not loaded by the new root package.

1. Install the new provider plugin and sign in to the original relay.
2. Select its provider/model in Magpie; preserve the original reasoning level.
3. Disable the old `codex-strip` middleware so two repair mechanisms do not run.
4. If using the earlier patched executable, restore the original official
   Magpie after active requests finish. Restart once to load that executable.

Normal plugin updates then use Magpie's plugin manager; they need no custom
Magpie build. The source patches in `patches/` document the retired 0.2.0
approach and are not used by 0.3.0.

## 中文快速说明

这是渠道插件，不再是依赖主程序补丁的请求中间件。安装后在 Magpie 中为
**Azure GPT · 按报错修复** 登录原来的中转 API Key，再给 Codex 选用该渠道。
新服务器首次登录先填原上游的 API 基础地址（例如 `https://中转域名/v1`），
点击“下一步”后再输入 API Key。上游地址、模型和额外请求头由用户自行配置，
修复逻辑依据 Responses 协议与报错内容工作，不绑定特定渠道或模型。
正常请求保留完整 reasoning；遇到对应错误且尚未输出时才修复并重试一次。
不会把整个会话切成永久清理模式，也不会改本地对话历史。

渠道显示名称可在插件 Options 的现有 JSON 中添加 `"name": "自定义名称"`
来设置。未填写时使用默认名称；渠道 ID 仍为 `azure-gpt`。

跨资源报错可能在后续请求再次发生。要持续复用原始加密推理状态，上游仍需把
同一对话固定到兼容的 Azure 资源；插件在资源不兼容时负责恢复可继续的请求。

## Source and checks

The repair rules reuse this repository's 0.2.0 history handling; its original
source attribution is in [PROVENANCE.json](packages/codex-strip/PROVENANCE.json).
The provider adapter and bounded streaming transport were added in 0.3.0.

Parser checks can be run without sending a model request:

```sh
node --check packages/azure-provider/index.js
node --check packages/azure-provider/transport.js
```

`bun test packages` covers provider setup, account-specific URLs, custom
headers and model metadata, HTTP/SSE recovery across different API base
paths, and the legacy middleware.
