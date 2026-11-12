import { createRecoveryFetch } from "./transport.js"

const ID = "azure-gpt"
const NPM = "@ai-sdk/openai"

// Use Magpie's built-in API-key sign-in. Credentials are supplied by getAuth;
// this plugin never reads a provider file or copies another channel's key.
export default async function azureGPT(input, options = {}) {
  const log = (level, message) => input.client.app.log({ body: { service: ID, level, message } }).catch(() => {})
  const configuredBase = options.baseURL ? baseURL(options.baseURL) : ""
  const configuredHeaders = Object.fromEntries(new Headers(options.headers ?? {}))
  const configuredModels = options.models && typeof options.models === "object" && !Array.isArray(options.models)
    ? options.models : null
  return {
    config(config) {
      config.provider ??= {}
      config.provider[ID] = { ...config.provider[ID], name: "Azure GPT · 按报错修复", npm: NPM,
        ...(configuredBase ? { api: configuredBase } : {}),
        searches: options.searches === true,
        models: { ...(config.provider[ID]?.models ?? {}), ...(configuredModels ?? {}) } }
    },
    auth: {
      provider: ID,
      options: [{ key: "recovery", label: "Repair Azure history errors", labels: { zh: "遇到 Azure 历史错误时修复" },
        description: "Preserve normal requests; repair and retry only a rejected request, before output starts.",
        descriptions: { zh: "正常请求保留完整推理；仅在指定报错且尚未输出时修复重试。" }, default: true }],
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
        const base = configuredBase || baseURL(auth.metadata?.baseURL)
        return { baseURL: base, apiKey: auth.key,
          headers: { ...configuredHeaders },
          fetch: createRecoveryFetch(globalThis.fetch, {
            enabled: () => input.magpie?.option(ID, "recovery") !== false,
            log,
          }) }
      },
    },
    provider: {
      id: ID,
      async models(provider, context = {}) {
        if (configuredModels) return Object.fromEntries(Object.entries(provider.models).map(([id, model]) => [id, {
          ...model,
          ...(Array.isArray(configuredModels[id]?.serviceTiers) ? { serviceTiers: configuredModels[id].serviceTiers } : {}),
        }]))
        if (context.auth?.type !== "api") return provider.models
        const base = configuredBase || baseURL(context.auth.metadata?.baseURL)
        const headers = new Headers(configuredHeaders)
        headers.set("authorization", "Bearer " + context.auth.key)
        const response = await fetch(base + "/models", { signal: context.signal,
          headers })
        if (!response.ok) throw new Error(`Azure GPT model listing returned HTTP ${response.status}.`
          + ([401, 403].includes(response.status) ? " Check the relay API key and its required client headers in plugin options." : ""))
        const list = await response.json()
        if (!Array.isArray(list.data)) throw new Error("Azure GPT expects /models to return a data array; configure models in plugin options if the relay has no model list.")
        return Object.fromEntries(list.data.filter((row) => typeof row?.id === "string" && row.id)
          .map((row) => [row.id, listedModel(row, provider.models[row.id], base)]))
      },
    },
  }
}

function baseURL(value) {
  let url
  try { url = new URL(value) } catch { throw new Error("Enter a valid Responses API base URL, including its /v1 path.") }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query parameters or a fragment.")
  }
  return url.href.replace(/\/+$/, "")
}

function listedModel(row, previous = {}, base) {
  const levels = row.reasoning_levels ?? row.supported_reasoning_levels?.map((item) => item.effort)
  const variants = Array.isArray(levels) ? Object.fromEntries(levels.filter((x) => typeof x === "string").map((x) => [x, {}])) : previous.variants
  const modalities = (list) => Object.fromEntries(["text", "image", "audio", "video", "pdf"].map((kind) => [kind, list.includes(kind)]))
  return { ...previous, id: row.id, providerID: ID, name: row.display_name ?? row.name ?? row.id,
    api: { id: row.id, npm: NPM, url: base },
    ...(variants ? { variants } : {}),
    limit: { ...previous.limit,
      ...(row.context_window || row.context_length ? { context: row.context_window ?? row.context_length } : {}),
      ...(row.max_input_tokens ? { input: row.max_input_tokens } : {}),
      ...(row.max_output_tokens ? { output: row.max_output_tokens } : {}) },
    capabilities: { ...previous.capabilities,
      ...(typeof row.reasoning === "boolean" ? { reasoning: row.reasoning } : {}),
      ...(typeof row.tool_call === "boolean" ? { toolcall: row.tool_call } : {}),
      ...(Array.isArray(row.modalities?.input) ? { input: modalities(row.modalities.input) } : {}),
      ...(Array.isArray(row.modalities?.output) ? { output: modalities(row.modalities.output) } : {}) },
    ...(Array.isArray(row.service_tiers) ? { serviceTiers: row.service_tiers.map((tier) => typeof tier === "string" ? tier : tier.id) } : {}),
  }
}
