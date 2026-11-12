import { afterEach, expect, spyOn, test } from "bun:test"
import azureGPT from "./index.js"

const input = { client: { app: { log: async () => {} } } }
const authAt = (baseURL) => ({ type: "api", key: "test-relay-key", metadata: { baseURL } })
let fetchMock
afterEach(() => fetchMock?.mockRestore())

// Include the former special-case host to catch client headers being added
// implicitly. All connection settings belong to the user.
for (const base of ["https://resource.openai.azure.com/openai/v1", "https://relay.example/proxy/v1", "https://agentrouter.org/v1"]) {
  test(`account URL ${base} is used without implicit client headers`, async () => {
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
      expect(headers.has("originator")).toBe(false)
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
