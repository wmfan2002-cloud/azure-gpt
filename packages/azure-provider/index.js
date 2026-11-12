import { createRecoveryFetch } from "./transport.js"
import { baseURL, connection, DEFAULT_NAME, authenticatedHeaders, versionedURL, clientHeaders } from "./connection.js"
import { createModelCatalog } from "./catalog.js"

const ID = "azure-gpt"
const NPM = "@ai-sdk/openai"

// Use Magpie's built-in API-key sign-in. Credentials are supplied by getAuth;
// this plugin never reads a provider file or copies another channel's key.
export default async function azureGPT(input, options = {}) {
  const catalog = createModelCatalog(input.directory)
  const log = (level, message) => input.client.app.log({ body: { service: ID, level, message } }).catch(() => {})
  const name = typeof options.name === "string" && options.name.trim() ? options.name.trim() : DEFAULT_NAME
  const configuredBase = options.baseURL ? baseURL(options.baseURL) : ""
  // 0.4.0's form could save models: {} before any rows were added. That
  // must not disable discovery and leave Magpie with no model interfaces.
  const configuredModels = options.models && typeof options.models === "object" && !Array.isArray(options.models) && Object.keys(options.models).length
    ? options.models : null
  const accountKey = () => input.magpie?.account?.(ID) || ID
  const codexHeaders = () => input.magpie?.option(ID, "codex_headers") !== false
  return {
    config(config) {
      config.provider ??= {}
      config.provider[ID] = { ...config.provider[ID], name, npm: NPM,
        ...(configuredBase ? { api: configuredBase } : {}),
        searches: options.searches === true,
        models: { ...(config.provider[ID]?.models ?? {}), ...(configuredModels ?? {}) } }
    },
    auth: {
      provider: ID,
      options: [{ key: "recovery", label: "Repair Azure history errors", labels: { zh: "遇到 Azure 历史错误时修复" },
        description: "Preserve normal requests; repair and retry only a rejected request, before output starts.",
        descriptions: { zh: "正常请求保留完整推理；仅在指定报错且尚未输出时修复重试。" }, default: true },
        { key: "codex_headers", label: "Send Codex client identity", labels: { zh: "发送 Codex 客户端标识" },
          description: "Send originator: codex_cli_rs on model discovery and requests. Explicit headers override this default.",
          descriptions: { zh: "模型发现和请求使用 originator: codex_cli_rs；自行配置的请求头优先。" }, default: true }],
      methods: [{ type: "api", label: "Azure Responses API key", labels: { zh: "Azure Responses API Key" },
        // Magpie treats prompts + authorize as a method that asks for its
        // own key. This prompt asks only for the URL: omit authorize so
        // Magpie asks for the key next and saves the URL in auth.metadata.
        prompts: configuredBase ? [] : [{ type: "text", key: "baseURL", message: "Responses API base URL (including its API path)",
          messages: { zh: "上游 Responses API 基础地址（包含 API 路径）" }, placeholder: "https://relay.example.com/v1",
          validate(value) { try { baseURL(value) } catch (error) { return error.message } } }],
      }],
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) throw new Error("Sign in to Azure GPT with your upstream API key.")
        const key = accountKey()
        const config = connection(options, auth, key)
        const recovery = createRecoveryFetch(globalThis.fetch, {
          enabled: () => input.magpie?.option(ID, "recovery") !== false,
          log,
        })
        return { baseURL: config.baseURL, apiKey: auth.key,
          headers: config.headers,
          fetch: (url, init = {}) => {
            const headers = new Headers(config.headers)
            new Headers(init.headers).forEach((value, name) => headers.set(name, value))
            if (config.authHeader === "authorization" && !headers.has("authorization")) headers.set("authorization", "Bearer " + auth.key)
            return recovery(versionedURL(url, config.apiVersion),
              { ...init, headers: clientHeaders(config.authHeader === "authorization" ? headers : authenticatedHeaders(config, auth.key, headers), codexHeaders()) })
          } }
      },
    },
    provider: {
      id: ID,
      async models(provider, context = {}) {
        const key = accountKey()
        if (configuredModels) {
          return Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, {
            ...model,
            ...(Array.isArray(configuredModels[id]?.serviceTiers) ? { serviceTiers: configuredModels[id].serviceTiers } : {}),
          }]))
        }
        if (context.auth?.type !== "api") return provider.models
        const config = connection(options, context.auth, key)
        const base = config.baseURL
        const headers = authenticatedHeaders(config, context.auth.key, clientHeaders(config.headers, codexHeaders()))
        const response = await fetch(config.modelsURL, { signal: context.signal,
          headers })
        if (!response.ok) throw new Error(`Azure GPT model listing returned HTTP ${response.status}.`
          + ([401, 403].includes(response.status) ? " Check the relay API key and its required client headers in plugin options." : ""))
        const list = await response.json()
        if (!Array.isArray(list.data)) throw new Error("Azure GPT expects /models to return a data array; configure models in plugin options if the relay has no model list.")
        const knownModel = await catalog()
        const models = Object.fromEntries(list.data.filter((row) => typeof row?.id === "string" && row.id)
          .map((row) => [row.id, listedModel(row, provider.models[row.id], base, knownModel(row.id))]))
        if (!Object.keys(models).length) throw new Error("Azure GPT model listing returned no models; configure manual models in plugin options.")
        return models
      },
    },
  }
}

function listedModel(row, previous = {}, base, known = {}) {
  const levels = row.reasoning_levels ?? row.supported_reasoning_levels?.map((item) => item.effort)
  const variants = Array.isArray(levels) ? Object.fromEntries(levels.filter((x) => typeof x === "string").map((x) => [x, {}])) : previous.variants
  const modalities = (list) => Object.fromEntries(["text", "image", "audio", "video", "pdf"].map((kind) => [kind, list.includes(kind)]))
  return { ...known, ...previous, id: row.id, providerID: ID, name: row.display_name ?? row.name ?? (previous.name !== row.id ? previous.name : undefined) ?? known.name ?? row.id,
    api: { id: row.id, npm: NPM, url: base },
    ...(typeof row.temperature === "boolean" ? { temperature: row.temperature } : {}),
    ...(variants ? { variants } : {}),
    limit: { ...known.limit, ...Object.fromEntries(Object.entries(previous.limit ?? {}).filter(([, value]) => value > 0)),
      ...(row.context_window || row.context_length ? { context: row.context_window ?? row.context_length } : {}),
      ...(row.max_input_tokens ? { input: row.max_input_tokens } : {}),
      ...(row.max_output_tokens ? { output: row.max_output_tokens } : {}) },
    capabilities: { ...known.capabilities, ...previous.capabilities,
      ...(typeof row.reasoning === "boolean" ? { reasoning: row.reasoning } : Array.isArray(levels) && levels.length ? { reasoning: true } : {}),
      ...(typeof row.tool_call === "boolean" ? { toolcall: row.tool_call } : {}),
      ...(Array.isArray(row.modalities?.input) ? { input: modalities(row.modalities.input) } : {}),
      ...(Array.isArray(row.modalities?.output) ? { output: modalities(row.modalities.output) } : {}) },
    ...(Array.isArray(row.service_tiers) ? { serviceTiers: row.service_tiers.map((tier) => typeof tier === "string" ? tier : tier.id) } : {}),
  }
}
