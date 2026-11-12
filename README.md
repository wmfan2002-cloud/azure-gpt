# Azure GPT — recover rejected history without changing Magpie

An **OpenCode-compatible provider plugin for official Magpie**. It sends native
Responses requests to your existing Azure relay, preserves normal reasoning,
and repairs a request only after a specific cross-resource or decryption error.
No Magpie source patch or separate proxy service is required.

```text
Codex → official Magpie → Azure GPT provider plugin → your Azure relay
```

## Install and connect

```sh
magpie plugin add github:wmfan2002-cloud/azure-gpt#main
magpie plugin login azure-gpt
```

The sign-in first asks for your **upstream relay's Responses base URL**, such
as `https://relay.example.com/v1`. Click Next, then enter the relay's API key
in Magpie's normal key field. Use the original provider's API base, not your
Magpie server's address or the full `/responses` endpoint. The key and URL are
kept by Magpie's normal plugin sign-in store. The plugin never reads another
channel's keys. The relay's `/models` endpoint supplies the model list.

Installing from GitHub on another computer does not copy your local Magpie
options or sign-ins. A fresh server therefore asks for the URL even when your
local installation already has it configured.

**Upgrading from 0.3.0:** update the plugin, close the old sign-in form, and
start sign-in again. Version 0.3.1 fixes the first-install flow that skipped
the API-key field after a valid URL and failed with "sign-in gave no key".

**AgentRouter:** version 0.3.2 includes its required
`originator: codex_cli_rs` header for model discovery and requests. Existing
0.3.1 installations can also set this header in plugin options. The same
key can otherwise work on a custom Codex channel while `/models` fails with
`401 unauthorized_client_error` on the plugin.

AgentRouter's inspected `/models` response contains model IDs but omits
reasoning capabilities, levels and token limits. Configure those explicitly
to retain the original channel's settings. [configs/agentrouter.json](configs/agentrouter.json)
contains the inspected channel's two models, 512000 context, 128000 output,
image input and six reasoning levels. Adjust the limits to your own channel,
then apply it from this checkout:

```sh
magpie plugin options azure-gpt "$(cat configs/agentrouter.json)"
```

In Magpie, select **Azure GPT · 按报错修复** as the provider for Codex, then
choose the original model and reasoning level. This is a new provider: merely
installing it does not intercept an existing `agent/...` channel.

To install local unpublished changes:

```sh
magpie plugin off azure-gpt
magpie plugin add /path/to/azure-gpt
magpie plugin options /path/to/azure-gpt "$(cat /path/to/azure-gpt/configs/agentrouter.json)"
```

Magpie registers a local path separately from a GitHub package. Turn the
GitHub installation off first so the two copies do not compete to serve
`azure-gpt`. The local installation uses the existing provider sign-in.

### A relay with a manual model list

Use **Plugins → Installed → Options** to set non-secret connection details and
model metadata. Keep the upstream's actual limits and supported reasoning
levels. A `models` object disables `/models` discovery; the supplied list is
used as written. `headers` can carry required non-secret client headers.

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
点击“下一步”后再输入 API Key。本机的插件配置不会随 Git push 自动带到服务器。
正常请求保留完整 reasoning；遇到对应错误且尚未输出时才修复并重试一次。
不会把整个会话切成永久清理模式，也不会改本地对话历史。

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

`bun test packages` covers the provider, HTTP/SSE recovery transport and legacy
middleware. Current build/load evidence and deployment state are in
[BUILD-STATUS.md](patches/BUILD-STATUS.md).
