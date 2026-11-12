import { afterEach, expect, spyOn, test } from "bun:test"
import azureGPT from "./index.js"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const input = { client: { app: { log: async () => {} } } }
const authAt = (baseURL) => ({ type: "api", key: "test-relay-key", metadata: { baseURL } })
let fetchMock
afterEach(() => fetchMock?.mockRestore())

// The same Codex identity applies independently of the upstream hostname.
for (const base of ["https://resource.openai.azure.com/openai/v1", "https://relay.example/proxy/v1", "https://agentrouter.org/v1"]) {
  test(`account URL ${base} retains the user's connection settings`, async () => {
    const plugin = await azureGPT(input)
    const auth = authAt(base)
    const loader = await plugin.auth.loader(async () => auth)
    expect(loader.baseURL).toBe(base)
    expect(loader.apiKey).toBe(auth.key)
    expect(loader.headers).toEqual({})
    expect(plugin.auth.methods[0].prompts.map((prompt) => prompt.key)).toEqual(["baseURL"])
  })

  test(`model discovery at ${base} uses the user's headers and deployment metadata`, async () => {
    fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url).toBe(base + "/models")
      const headers = new Headers(init.headers)
      expect(headers.get("authorization")).toBe("Bearer test-relay-key")
      expect(headers.get("x-client")).toBe("user-selected-client")
      expect(headers.get("originator")).toBe("codex_cli_rs")
      return Response.json({ data: [{ id: "custom-deployment", reasoning: true, context_window: 64000,
        max_output_tokens: 8192, reasoning_levels: ["medium"], tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] } }] })
    })
    const plugin = await azureGPT(input, { headers: { "X-Client": "user-selected-client" } })
    const models = await plugin.provider.models({ models: {} }, { auth: authAt(base) })
    expect(Object.keys(models)).toEqual(["custom-deployment"])
    expect(models["custom-deployment"].api).toEqual({ id: "custom-deployment", npm: "@ai-sdk/openai", url: base })
    expect(models["custom-deployment"].limit).toEqual({ context: 64000, output: 8192 })
    expect(models["custom-deployment"].capabilities.reasoning).toBe(true)
    expect(Object.keys(models["custom-deployment"].variants)).toEqual(["medium"])
    const loader = await plugin.auth.loader(async () => authAt(base))
    expect(loader.headers).toEqual({ "x-client": "user-selected-client" })
  })
}

test("a configured base URL skips the URL prompt and normalizes its trailing slash", async () => {
  const plugin = await azureGPT(input, { baseURL: "https://relay.example/v1/" })
  const loader = await plugin.auth.loader(async () => ({ type: "api", key: "test-key" }))
  expect(loader.baseURL).toBe("https://relay.example/v1")
  expect(loader.headers).toEqual({})
  expect(plugin.auth.methods[0].prompts).toEqual([])
})

test("different accounts retain their own URL and key", async () => {
  const plugin = await azureGPT(input)
  for (const [base, key] of [["https://first.example/v1", "first-key"], ["https://second.example/openai/v1", "second-key"]]) {
    const loader = await plugin.auth.loader(async () => ({ ...authAt(base), key }))
    expect(loader.baseURL).toBe(base)
    expect(loader.apiKey).toBe(key)
  }
})

test("sparse model discovery retains metadata already supplied by the user", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [{ id: "custom-deployment" }] }))
  const previous = { limit: { context: 64000, output: 8192 }, variants: { medium: {} },
    capabilities: { reasoning: true, input: { text: true, image: true }, toolcall: true } }
  const plugin = await azureGPT(input)
  const models = await plugin.provider.models({ models: { "custom-deployment": previous } }, { auth: authAt("https://relay.example/v1") })
  expect(models["custom-deployment"].limit).toEqual(previous.limit)
  expect(models["custom-deployment"].variants).toEqual(previous.variants)
  expect(models["custom-deployment"].capabilities).toEqual(previous.capabilities)
})

test("ID-only discovery fills capabilities from Magpie while retaining upstream and configured metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "azure-metadata-"))
  try {
    await mkdir(path.join(directory, "cache"))
    await writeFile(path.join(directory, "cache/models.json"), JSON.stringify({ openai: { models: {
      "gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", reasoning: true, temperature: false,
        tool_call: true, limit: { context: 100000, input: 90000, output: 10000 }, modalities: { input: ["text", "image", "pdf"], output: ["text"] } },
      "gpt-4o": { id: "gpt-4o", reasoning: false },
    } } }))
    const base = "https://relay.example/v1"
    fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [{ id: "openai/GPT-6.1-Sol" }, { id: "gpt-4o" }, { id: "my-deployment" }] }))
    const plugin = await azureGPT({ ...input, directory })
    let models = await plugin.provider.models({ models: {} }, { auth: authAt(base) })
    const known = models["openai/GPT-6.1-Sol"]
    expect(known.name).toBe("GPT-6.1 Sol")
    expect(known.capabilities.reasoning).toBe(true)
    expect(known.capabilities.input.pdf).toBe(true)
    expect(known.limit).toEqual({ context: 100000, input: 90000, output: 10000 })
    expect(known.api).toEqual({ id: "openai/GPT-6.1-Sol", npm: "@ai-sdk/openai", url: base })
    expect(known.variants).toBeUndefined()
    expect(models["gpt-4o"].capabilities.reasoning).toBe(false)
    expect(models["my-deployment"].capabilities.reasoning).toBeUndefined()

    fetchMock.mockResolvedValue(Response.json({ data: [{ id: "gpt-6.1-sol", reasoning: false, temperature: true, context_window: 60000, max_output_tokens: 4000, reasoning_levels: [], modalities: { input: ["text"] } }] }))
    models = await plugin.provider.models({ models: {} }, { auth: authAt(base) })
    expect(models["gpt-6.1-sol"].capabilities.reasoning).toBe(false)
    expect(models["gpt-6.1-sol"].capabilities.input.image).toBe(false)
    expect(models["gpt-6.1-sol"].limit.context).toBe(60000)
    expect(models["gpt-6.1-sol"].limit.output).toBe(4000)
    expect(models["gpt-6.1-sol"].temperature).toBe(true)
    expect(models["gpt-6.1-sol"].variants).toEqual({})

    fetchMock.mockResolvedValue(Response.json({ data: [{ id: "gpt-6.1-sol" }, { id: "levels-only", supported_reasoning_levels: [{ effort: "high" }] }] }))
    const previous = { name: "My Sol", limit: { context: 50000, input: 0, output: 0 }, capabilities: { reasoning: false }, variants: {} }
    models = await plugin.provider.models({ models: { "gpt-6.1-sol": previous } }, { auth: authAt(base) })
    expect(models["gpt-6.1-sol"].name).toBe("My Sol")
    expect(models["gpt-6.1-sol"].limit).toEqual({ context: 50000, input: 90000, output: 10000 })
    expect(models["gpt-6.1-sol"].capabilities.reasoning).toBe(false)
    expect(models["levels-only"].capabilities.reasoning).toBe(true)
    expect(Object.keys(models["levels-only"].variants)).toEqual(["high"])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("manual model metadata is supplied by the user and bypasses discovery", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Manual models must not fetch /models") })
  const model = { name: "My deployment", reasoning: true, tool_call: true,
    limit: { context: 64000, output: 8192 }, modalities: { input: ["text", "image"], output: ["text"] },
    variants: { medium: {} }, serviceTiers: ["priority"] }
  const plugin = await azureGPT(input, { models: { "custom-deployment": model } })
  const config = {}
  plugin.config(config)
  expect(config.provider["azure-gpt"].models).toEqual({ "custom-deployment": model })
  const models = await plugin.provider.models({ models: { "custom-deployment": { variants: model.variants } } })
  expect(models["custom-deployment"].serviceTiers).toEqual(["priority"])
  expect(models["custom-deployment"].variants).toEqual(model.variants)
})

test("per-account connection edits override shared settings without changing the key", async () => {
  const plugin = await azureGPT({ ...input, magpie: { account: () => "azure-gpt#second" } }, {
    baseURL: "https://shared.example/v1", headers: { "X-Client": "shared" },
    connections: { "azure-gpt#second": { baseURL: "https://account.example/openai/v1", headers: { "X-Client": "account" } } },
  })
  const loader = await plugin.auth.loader(async () => authAt("https://original.example/v1"))
  expect(loader.baseURL).toBe("https://account.example/openai/v1")
  expect(loader.apiKey).toBe("test-relay-key")
  expect(loader.headers).toEqual({ "x-client": "account" })
})

test("Azure API-key authentication and an explicit API version preserve the Responses body", async () => {
  const calls = []
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => { calls.push({ url, ...init }); return Response.json({ status: "completed", output: [] }) })
  const plugin = await azureGPT(input, { authHeader: "api-key", apiVersion: "test-version", baseURL: "https://resource.openai.azure.com/openai" })
  const loader = await plugin.auth.loader(async () => authAt("https://relay.example/v1"))
  const body = JSON.stringify({ model: "deployment", input: "hello", reasoning: { effort: "medium" } })
  const response = await loader.fetch(loader.baseURL + "/responses", { method: "POST", body, headers: { authorization: "Bearer client-key", "x-client": "custom" } })
  await response.text()
  expect(calls[0].url).toBe("https://resource.openai.azure.com/openai/responses?api-version=test-version")
  expect(calls[0].body).toBe(body)
  expect(new Headers(calls[0].headers).get("api-key")).toBe("test-relay-key")
  expect(new Headers(calls[0].headers).has("authorization")).toBe(false)
  expect(new Headers(calls[0].headers).get("x-client")).toBe("custom")
})

test("model listing URL and API-key authentication are configurable", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe("https://relay.example/catalog?api-version=test-version")
    expect(new Headers(init.headers).get("api-key")).toBe("test-relay-key")
    expect(new Headers(init.headers).has("authorization")).toBe(false)
    return Response.json({ data: [{ id: "deployment" }] })
  })
  const plugin = await azureGPT(input, { modelsURL: "https://relay.example/catalog", authHeader: "api-key", apiVersion: "test-version" })
  expect(Object.keys(await plugin.provider.models({ models: {} }, { auth: authAt("https://relay.example/v1") }))).toEqual(["deployment"])
})

test("an empty upstream model list reports why the provider has no models", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [] }))
  const plugin = await azureGPT(input)
  await expect(plugin.provider.models({ models: {} }, { auth: authAt("https://relay.example/v1") })).rejects.toThrow("model listing returned no models")
})

test("a fresh URL/key sign-in identifies Codex for discovery and requests", async () => {
  const calls = []
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const headers = new Headers(init.headers)
    calls.push({ url, headers, body: init.body })
    if (headers.get("originator") !== "codex_cli_rs") return Response.json({ error: "unauthorized_client_error" }, { status: 401 })
    return url.endsWith("/models") ? Response.json({ data: [{ id: "arbitrary-deployment" }] }) : Response.json({ status: "completed", output: [] })
  })
  const plugin = await azureGPT(input)
  const auth = authAt("https://new-relay.example/v1")
  const models = await plugin.provider.models({ models: {} }, { auth })
  expect(Object.keys(models)).toEqual(["arbitrary-deployment"])
  const loader = await plugin.auth.loader(async () => auth)
  const body = JSON.stringify({ model: "arbitrary-deployment", input: "hello", reasoning: { effort: "medium" } })
  expect((await loader.fetch(loader.baseURL + "/responses", { method: "POST", body })).status).toBe(200)
  expect(calls[1].body).toBe(body)
  expect(calls.every((call) => call.headers.get("authorization") === "Bearer test-relay-key")).toBe(true)
})

test("explicit client identity is retained and the default can be disabled through the provider editor", async () => {
  let enabled = true
  const calls = []
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => { calls.push(new Headers(init.headers)); return Response.json({ status: "completed", output: [] }) })
  const plugin = await azureGPT({ ...input, magpie: { option: (_provider, key) => key === "codex_headers" ? enabled : true } })
  const loader = await plugin.auth.loader(async () => authAt("https://relay.example/v1"))
  await loader.fetch(loader.baseURL + "/responses", { method: "POST", body: "{}" })
  enabled = false
  await loader.fetch(loader.baseURL + "/responses", { method: "POST", body: "{}" })
  await loader.fetch(loader.baseURL + "/responses", { method: "POST", body: "{}", headers: { Originator: "user-selected-client" } })
  expect(calls[0].get("originator")).toBe("codex_cli_rs")
  expect(calls[1].has("originator")).toBe(false)
  expect(calls[2].get("originator")).toBe("user-selected-client")
  const configured = await azureGPT(input, { headers: { Originator: "configured-client", Authorization: "Custom test-auth" } })
  const configuredLoader = await configured.auth.loader(async () => authAt("https://relay.example/v1"))
  await configuredLoader.fetch(configuredLoader.baseURL + "/responses", { method: "POST", body: "{}" })
  expect(calls[3].get("originator")).toBe("configured-client")
  expect(calls[3].get("authorization")).toBe("Custom test-auth")
})

test("an empty manual list saved by the old page restores upstream discovery", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [{ id: "discovered-deployment" }] }))
  const plugin = await azureGPT(input, { models: {} })
  const models = await plugin.provider.models({ models: {} }, { auth: authAt("https://relay.example/v1") })
  expect(Object.keys(models)).toEqual(["discovered-deployment"])
  expect(models["discovered-deployment"].api.npm).toBe("@ai-sdk/openai")
})
