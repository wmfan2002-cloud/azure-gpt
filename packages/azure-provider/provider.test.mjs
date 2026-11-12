import { afterEach, expect, spyOn, test } from "bun:test"
import azureGPT from "./index.js"
import options from "../../configs/agentrouter.json"

const input = { client: { app: { log: async () => {} } } }
const auth = { type: "api", key: "test-relay-key", metadata: { baseURL: "https://agentrouter.org/v1" } }
let fetchMock
afterEach(() => fetchMock?.mockRestore())

test("AgentRouter model discovery carries the client header required by the real relay", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const headers = new Headers(init.headers)
    if (headers.get("originator") !== "codex_cli_rs") {
      return Response.json({ type: "unauthorized_client_error", message: "UNAUTHENTICATED" }, { status: 401 })
    }
    expect(headers.get("authorization")).toBe("Bearer test-relay-key")
    // AgentRouter's actual /models rows omit reasoning and token limits.
    return Response.json({ data: [{ id: "gpt-6.1-sol", object: "model", created: 1626777600,
      owned_by: "custom", supported_endpoint_types: ["openai"] }] })
  })
  const plugin = await azureGPT(input)
  const models = await plugin.provider.models({ models: {} }, { auth })
  expect(Object.keys(models)).toEqual(["gpt-6.1-sol"])
  const loader = await plugin.auth.loader(async () => auth)
  expect(new Headers(loader.headers).get("originator")).toBe("codex_cli_rs")
  expect(loader.apiKey).toBe(auth.key)
  expect(loader.baseURL).toBe(auth.metadata.baseURL)
})

test("a configured AgentRouter URL also carries the client header", async () => {
  const plugin = await azureGPT(input, { baseURL: "https://agentrouter.org/v1/" })
  const loader = await plugin.auth.loader(async () => ({ type: "api", key: auth.key }))
  expect(new Headers(loader.headers).get("originator")).toBe("codex_cli_rs")
  expect(loader.baseURL).toBe("https://agentrouter.org/v1")
})

test("user headers override the AgentRouter default case insensitively", async () => {
  const plugin = await azureGPT(input, { headers: { Originator: "my-client", "X-Client": "custom" } })
  const loader = await plugin.auth.loader(async () => auth)
  const headers = new Headers(loader.headers)
  expect(headers.get("originator")).toBe("my-client")
  expect(headers.get("x-client")).toBe("custom")
})

test("other relay hosts keep their configured headers", async () => {
  const plugin = await azureGPT(input, { baseURL: "https://relay.example/v1", headers: { "X-Client": "custom" } })
  const loader = await plugin.auth.loader(async () => auth)
  const headers = new Headers(loader.headers)
  expect(headers.get("x-client")).toBe("custom")
  expect(headers.has("originator")).toBe(false)
})

test("manual metadata retains the original channel's limits, reasoning levels and service tiers", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Manual models must not fetch /models") })
  const plugin = await azureGPT(input, options)
  const config = {}
  plugin.config(config)
  expect(config.provider["azure-gpt"].models["gpt-6.1-sol"].limit).toEqual({ context: 512000, output: 128000 })
  expect(config.provider["azure-gpt"].models["gpt-6.1-sol"].reasoning).toBe(true)
  const models = await plugin.provider.models({ models: {
    "gpt-6-astra": { variants: options.models["gpt-6-astra"].variants },
    "gpt-6.1-sol": { variants: options.models["gpt-6.1-sol"].variants },
  } }, { auth })
  expect(models["gpt-6-astra"].serviceTiers).toEqual(["priority"])
  expect(Object.keys(models["gpt-6.1-sol"].variants)).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"])
})
