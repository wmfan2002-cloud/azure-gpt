# Azure GPT — recover rejected history without changing Magpie

An **OpenCode-compatible provider plugin for official Magpie**. It sends native
Responses requests to your Azure API or relay, preserves normal reasoning,
and repairs a request only after a specific cross-resource or decryption error.
No Magpie source patch or separate request proxy is required.

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
```

Open **Azure GPT** in the sidebar's Plugins group. In the page, choose a
**Display name**, then fill in the account name, **API base URL** and **API
key**. Click **Add account and save name**. You can name the provider while
adding its first account, and rename it later with **Save name**. The default
display name is **Azure GPT**; the provider ID stays `azure-gpt`.

Existing accounts appear under **Existing connections**. You can also open
the page from a provider row's menu with **Azure GPT settings**. The page
uses English or Chinese according to Magpie's language.

Adding waits for the models to appear in Magpie's own catalog before showing
**Account added**. If discovery fails, the page says that the key was saved
and shows the discovery error; check the connection or use manual models.

If a first request after adding through the 0.4.0 page failed with
`Azure GPT has no endpoint configured`, update to 0.4.1, reopen the page,
refresh the model list in Providers and retry. Existing sign-ins and URLs
are retained.

The standard Magpie sign-in remains available:

```sh
magpie plugin login azure-gpt
```

That sign-in first asks for your **Responses API base URL**, such as
`https://your-resource.openai.azure.com/openai/v1` or
`https://relay.example.com/v1`. Click Next, then enter the upstream's API key
in Magpie's normal key field. Use the original provider's API base, not your
Magpie server's address or the full `/responses` endpoint. The key and URL are
kept by Magpie's normal plugin sign-in store. Keys entered in the visual
page use the same store; the page never displays a saved key. The upstream's
`/models` endpoint supplies the model list by default.

In Magpie, select **Azure GPT** (or your chosen name) as the provider for Codex, then
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

Use the **Azure GPT** page to edit each account's API base URL, authentication
header, optional API version, optional model list URL and extra request
headers. Leave **Replacement API key** empty to keep the stored key.
Connection edits apply to the selected account.

The default authentication is `authorization: Bearer <key>`. For an Azure
endpoint that expects an API key header, set **Authentication header** to
`api-key`. An explicitly configured **API version** adds `api-version` to
requests and model discovery. A custom model list URL must use the same
origin as the API base URL.

Under **Model discovery**, choose upstream discovery or **Manual models**.
The manual form covers model/deployment IDs, display names, context and
output limits, reasoning, image input, tool calls, reasoning levels and
service tiers. Keep the upstream's actual limits and supported levels. Manual
models are shared by this plugin's accounts and replace discovery. Extra
request headers are sent on both discovery and model requests.

Magpie's regular **Providers** editor supplies the other account controls:
model selection and aliases, reasoning levels, context/output/compaction
limits, fallback and routing, per-account proxies, concurrency, queues,
pricing and the history-repair switch. The plugin uses the same account
editor as official provider plugins. Custom-provider-only fields, such as
protocol selection, TLS certificates and balance-query endpoints, are not
exposed by this plugin; its transport is Responses.

Advanced users can still edit **Plugins → Installed → Options** or use
`magpie plugin options`. The visual page preserves options it does not edit.
Shared `baseURL`, `authHeader`, `apiVersion`, `modelsURL` and `headers` options
provide defaults; `connections[accountID]` contains per-account overrides.
An omitted or blank `name` uses **Azure GPT**. For example:

```json
{
  "name": "My Azure",
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

After configuring a shared URL here, standard sign-in only asks for the API
key. Enter keys in the visual page or Magpie's sign-in dialog, not in plugin
options or shell arguments.

The settings page is served inside Magpie's existing plugin host. Its local
port defaults to `3487`; if that port is in use, set `uiPort` in plugin
options and reopen the page. Magpie web exposes the page through its plugin
service bridge, so a remote browser uses the same page.

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
**Azure GPT** 页面填写显示名称、账号名称、原上游的 API 基础地址
（例如 `https://中转域名/v1`）和 API Key，点击“添加账号并保存名称”，
再给 Codex 选用该渠道。标准登录也可用，依次填写 URL 和 Key。
上游地址、模型和额外请求头由用户自行配置，
修复逻辑依据 Responses 协议与报错内容工作，不绑定特定渠道或模型。
正常请求保留完整 reasoning；遇到对应错误且尚未输出时才修复并重试一次。
不会把整个会话切成永久清理模式，也不会改本地对话历史。

默认英文名称为 **Azure GPT**。改名直接在页面填写“显示名称”并保存，
渠道 ID 仍为 `azure-gpt`，已有登录和模型选择沿用原 ID。
在“已有连接”中可修改 URL、认证请求头、API 版本、模型列表地址及额外请求头，
替换 Key 留空即保留原 Key。需要 Azure Key 认证时将认证请求头设为 `api-key`。

“模型发现”提供上游列表和手动模型两种方式，可填写部署 ID、名称、Token
上限、推理/图像/工具能力和推理档位。账号的模型选择、别名、压缩、回退、
路由、代理、并发、排队和价格等继续在 Magpie 的供应商编辑器中设置。
插件采用 Responses 协议，自定义供应商专有的协议切换、证书和余额查询
等字段没有全部复刻。

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
authentication and API versions, model metadata, settings access and key
replacement, HTTP/SSE recovery across different API base paths, and the
legacy middleware.

The browser check starts an installed Magpie with a temporary profile and a
simulated upstream. It checks adding and renaming, URL/key edits, manual
models, preserved settings, authenticated recovery, settings-host transfer
during a running request and a narrow layout, in English and Chinese.
Install Playwright and its browsers in your test
environment, then run:

```sh
npm run test:ui
BROWSER=webkit npm run test:ui
npm run test:native
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright installation.
`MAGPIE_BIN` and `MAGPIE_BUN` select test executables; `CHROMIUM_EXECUTABLE`
and `WEBKIT_EXECUTABLE` override browser paths when needed.
`test:native` checks Magpie's original URL/key sign-in and a saved account
with its existing model selection. `PLUGIN_ROOT` can select a local baseline
checkout for that compatibility check.
