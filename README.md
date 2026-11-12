# Azure GPT — recover rejected history without changing Magpie

An **OpenCode-compatible provider plugin for official Magpie**. It sends native
Responses requests to your Azure API or relay, preserves normal reasoning,
and repairs a request only after a specific cross-resource or decryption error.
No Magpie source patch or separate request proxy is required.

The upstream URL and model IDs come from your sign-in, upstream discovery
or plugin options. Known model specifications are supplemented from Magpie's
models.dev catalog. The provider sends Codex's client
identity on discovery and requests; explicit client headers take precedence.
Recovery uses the
Responses protocol and error content, independently of the upstream domain
or deployment name.

```text
Codex → official Magpie → Azure GPT provider plugin → your Responses API
```

## Install and connect

```sh
magpie plugin add github:wmfan2002-cloud/azure-gpt#main
```

In **Providers → Add provider → From plugins**, select **Azure GPT**.
Use Magpie's normal URL and API-key sign-in. On an empty profile the Add
your first provider sheet opens automatically. The command-line equivalent is:

```sh
magpie plugin login azure-gpt
```

That sign-in first asks for your **Responses API base URL**, such as
`https://your-resource.openai.azure.com/openai/v1` or
`https://relay.example.com/v1`. Click Next, then enter the upstream's API key
in Magpie's normal key field. Use the original provider's API base, not your
Magpie server's address or the full `/responses` endpoint. The key and URL are
kept by Magpie's normal plugin sign-in store. The upstream's
`/models` endpoint supplies the model list by default.

If that endpoint returns only model IDs, the plugin matches known models
against Magpie's local models.dev catalog. Names, reasoning capability,
input/output modalities, tool support, sampling support and token limits
are filled from that catalog. Magpie supplies reasoning levels using its
maker and model-family rules, including Codex Ultra where supported. The
plugin keeps the original model ID and API URL for requests.

Explicit upstream metadata and configured values take precedence over
catalog defaults; changes in the normal provider editor still apply.
Magpie seeds the catalog on first run and updates it through `magpie sync`.
Update the plugin and refresh the provider's models to apply the new
defaults to an existing sign-in.

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

### Configure an added provider

Open the added **Azure GPT** provider, using the same editor as official
provider plugins. **Models** manages model selection, display names,
reasoning levels and capabilities. **Advanced** provides:

- Context window, maximum output and where conversations compact.
- Fallback, provider and per-account proxies.
- Concurrency, accounts at once, requests per minute, queue size and wait.
- Price rate, billing, free-model accounting and rate windows.

Use `model-id=128k` to set one model's context window explicitly. A common
window for all models is capped by the window each model's vendor lists,
as Magpie's regular editor specifies. Routing and conversation affinity
appear when multiple accounts are enabled. Each key for the same URL can
be added as another account through the normal sign-in; routing chooses
among enabled accounts that serve the selected model.

The provider's native **Plugin options** supplies the history-repair switch
and **Send Codex client identity**. The latter defaults on and sends
`originator: codex_cli_rs` for both discovery and requests. Some Responses
relays reject discovery with HTTP 401 without this identity; with an empty
model catalog Magpie can report `Azure GPT has no endpoint configured`.
An explicitly configured `originator` header keeps its value.

The default display name is **Azure GPT**, and the provider ID is
`azure-gpt`. An existing `name` plugin option still customizes the display
name. Magpie's native plugin account editor has no provider-name field;
account and model names can be edited there.

### Connection and model options

Use **Plugins → Installed → Options** or `magpie plugin options` for
connection fields that the native plugin editor does not expose: shared
`baseURL`, `headers`, `authHeader`, `apiVersion`, `modelsURL` and explicit
`models`. The provider uses Responses; custom-provider protocol selection,
TLS certificate and balance-query fields are not exposed by its native
plugin editor.

Authentication defaults to `authorization: Bearer <key>`. Set `authHeader`
to `api-key` for an endpoint that expects Azure key authentication. An
explicit `apiVersion` adds `api-version` to requests and discovery. A custom
`modelsURL` must use the same origin as the API base URL. `headers` applies
to both discovery and requests.

A nonempty `models` object supplies a manual list shared by the plugin's
accounts and bypasses discovery. An empty object uses discovery with
automatic catalog matching. For an Azure deployment whose custom ID is
absent from the catalog, set its capabilities and limits in the normal
**Model settings**, or supply explicit metadata in `models`. For example:

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
key. Enter keys in Magpie's sign-in dialog, not in plugin options or shell
arguments. `connections[accountID]` overrides shared connection options for
an individual account.

### Upgrade from 0.4.0 / 0.4.1

The separate Azure GPT page and its local settings service are removed.
Use the normal Providers editor and its Advanced section. Accounts added
through the removed page and their connection overrides remain usable;
`uiPort` is no longer used. Update the plugin, refresh models in Providers
and select the model from the refreshed list. A discovery failure should
be checked using the upstream HTTP error shown by Magpie.

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
“添加供应商 → 来自插件”选择 **Azure GPT**，依次填写原上游的 API 基础地址
（例如 `https://中转域名/v1`）和 API Key，再给 Codex 选用该渠道。
上游地址、模型和额外请求头可以自行配置，
修复逻辑依据 Responses 协议与报错内容工作，不绑定特定渠道或模型。
正常请求保留完整 reasoning；遇到对应错误且尚未输出时才修复并重试一次。
不会把整个会话切成永久清理模式，也不会改本地对话历史。

默认英文名称为 **Azure GPT**，渠道 ID 仍为 `azure-gpt`。账号及模型的名称、
模型选择和推理档位在原供应商编辑器中设置；上下文、输出、压缩、回退、代理、
并发、排队和价格等在其“高级”中设置。要明确覆盖一个模型的上下文，可以填
`模型ID=128k`；统一窗口遵循 Magpie 的上游窗口上限规则。

0.4.3 起，上游只返回模型 ID 时，自动从 Magpie 的 models.dev 目录匹配模型
名称、推理能力、输入输出类型、工具及采样支持、token 上限；推理档位由 Magpie
按原厂及模型系列规则补全。更新插件后，在供应商中刷新模型即可。上游明确提供
的参数和自行配置的值优先。目录中没有的自定义部署 ID，可以在原生“模型设置”
中配置能力和限制，或通过 Options 的 `models` 提供完整参数。

0.4.2 移除了独立设置页，0.4.0/0.4.1 添加的账号和连接配置继续沿用。
默认发送 Codex 的 `originator: codex_cli_rs`，同时用于模型发现和请求；
某些上游缺少这个标识时会拒绝 `/models`，导致模型接口无法注册。
该开关在原编辑器的“插件选项”中，自行配置的同名请求头优先。

供应商总显示名称仍可通过插件 Options 的 `name` 设置。原生插件编辑器
未提供总名称、URL、额外请求头、证书等全部自定义供应商字段；URL 和 Key
通过登录填写，特殊认证、API 版本、模型发现地址及手动模型可通过 Options 配置。

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
authentication and API versions, model metadata, Codex client identity,
HTTP/SSE recovery across different API base paths, and the
legacy middleware.

The browser check starts an installed Magpie with a temporary profile and a
simulated upstream that requires Codex client identity. It exercises the
actual native URL/key form and Advanced editor, saved limits and queues,
the published Responses endpoint and authenticated history recovery, in
English and Chinese. Install Playwright and its browsers in your test
environment, then run:

```sh
npm run test:ui
BROWSER=webkit npm run test:ui
npm run test:native
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright installation.
`MAGPIE_BIN` and `MAGPIE_BUN` select test executables; `CHROMIUM_EXECUTABLE`
and `WEBKIT_EXECUTABLE` override browser paths when needed.
`test:native` checks Magpie's original URL/key sign-in, saved model selections,
accounts with connection overrides created by the removed page, and ID-only
discovery against an isolated synthetic Magpie catalog. The browser check
also verifies the borrowed reasoning levels in the native Model settings.
`PLUGIN_ROOT` can select a local checkout for that check.
