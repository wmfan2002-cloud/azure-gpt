import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { settingsService, startSettingsService } from "./settings-service.js"

const fixtures = []
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.service.stop(); rmSync(fixture.directory, { recursive: true, force: true }) } })
const fixture = (options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "azure-settings-test-")), saved = []
  const input = { directory, client: { auth: { set: async (value) => { saved.push(value); return { data: true } } } } }
  const service = startSettingsService(input, { ...options, uiPort: 0 })
  const token = readFileSync(join(directory, "plugin-work/azure-gpt-settings.token"), "utf8")
  const base = `http://127.0.0.1:${service.server.port}`
  const ask = (method = "GET", body, extra = {}, route = "accounts") => fetch(base + "/api/" + route, { method, headers: { "x-azure-settings-token": token, "content-type": "application/json", ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const result = { directory, saved, input, service, token, base, ask }; fixtures.push(result); return result
}

test("settings reads and writes require the page's token", async () => {
  const f = fixture()
  for (const token of ["", "invalid", "e".repeat(64)]) {
    const r = await fetch(f.base + "/api/accounts", { headers: { "x-azure-settings-token": token } })
    expect(r.status).toBe(403)
  }
  expect((await f.ask("GET", undefined, { origin: "https://unrelated.example" })).status).toBe(403)
  expect((await f.ask("GET", undefined, { origin: "null" })).status).toBe(200)
  expect(f.saved).toEqual([])
  expect(statSync(join(f.directory, "plugin-work/azure-gpt-settings.token")).mode & 0o777).toBe(0o600)
})

test("account information omits keys and their fingerprints", async () => {
  const f = fixture()
  f.service.observe("azure-gpt#one", { type: "api", key: "private-test-key", accountId: "Work", metadata: { baseURL: "https://relay.example/v1" } })
  const r = await f.ask(), text = await r.text(), data = JSON.parse(text)
  expect(text).not.toContain("private-test-key")
  expect(text).not.toContain("signature")
  expect(data.accounts[0]).toMatchObject({ id: "azure-gpt#one", label: "Work", hasKey: true, baseURL: "https://relay.example/v1" })
})

test("adding a key uses Magpie's auth SDK and the previously saved connection URL", async () => {
  const id = "azure-gpt#0123456789abcdef"
  const f = fixture({ baseURL: "https://old.example/v1", connections: { [id]: { baseURL: "https://new.example/openai/v1" } } })
  const r = await f.ask("POST", { newAccount: id, accountName: "New account", baseURL: "https://new.example/openai/v1/", key: "new-private-key" })
  expect(r.status).toBe(200)
  expect(f.saved).toEqual([{ path: { id }, body: { type: "api", key: "new-private-key", accountId: "New account", metadata: { baseURL: "https://new.example/openai/v1", accountName: "New account" } } }])
  expect(await r.text()).not.toContain("new-private-key")
})

test("a key replacement keeps the account identity and works after the settings host restarts", async () => {
  const id = "azure-gpt#existing"
  const f = fixture({ connections: { [id]: { baseURL: "https://relay.example/v1" } } })
  const r = await f.ask("POST", { account: id, accountId: "Existing account", baseURL: "https://relay.example/v1", key: "replacement-key" })
  expect(r.status).toBe(200)
  expect(f.saved[0].path.id).toBe(id)
  expect(f.saved[0].body.accountId).toBe("Existing account")
  expect(f.saved[0].body.key).toBe("replacement-key")
})

test("invalid connection requests do not write credentials", async () => {
  const f = fixture()
  for (const body of [{ baseURL: "ftp://relay.example/v1", key: "test" }, { baseURL: "https://relay.example/v1", key: "" },
    { newAccount: "azure-gpt#0123456789abcdef", baseURL: "https://relay.example/v1", key: "test" }]) {
    expect((await f.ask("POST", body)).status).toBe(400)
  }
  expect(f.saved).toEqual([])
})

test("a replacement host takes over only its own settings listener", async () => {
  const f = fixture()
  const replacement = await settingsService(f.input, { uiPort: f.service.server.port })
  expect(replacement).not.toBeNull()
  replacement.observe("azure-gpt#new", { type: "api", key: "test-key", metadata: { baseURL: "https://new.example/v1" } })
  f.service = replacement
  expect((await (await f.ask()).json()).accounts[0].id).toBe("azure-gpt#new")
})

test("a service from another profile cannot be retired", async () => {
  const f = fixture(), other = fixture(), warnings = []
  const blocked = await settingsService(other.input, { uiPort: f.service.server.port }, (...message) => warnings.push(message))
  expect(blocked).toBeNull()
  expect(warnings.length).toBe(1)
  expect((await f.ask()).status).toBe(200)
  expect((await other.ask()).status).toBe(200)
})

test("readiness uses Magpie's published models, not just a stored account", async () => {
  const f = fixture(), previous = process.env.MAGPIE_ADDR
  let models = [{ id: "other/deployment", owned_by: "other" }]
  const gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ data: models }) })
  process.env.MAGPIE_ADDR = "127.0.0.1:" + gateway.port
  try {
    f.service.listed("azure-gpt#one")
    let catalog = await (await f.ask("GET", undefined, {}, "catalog")).json()
    expect(catalog.models).toEqual([])
    expect(catalog.accounts["azure-gpt#one"]).toEqual({ done: true, error: "" })
    models.push({ id: "azure-gpt/deployment", owned_by: "azure-gpt" })
    catalog = await (await f.ask("GET", undefined, {}, "catalog")).json()
    expect(catalog.models).toEqual(["azure-gpt/deployment"])
    f.service.listed("azure-gpt#one", "model listing returned HTTP 401")
    catalog = await (await f.ask("GET", undefined, {}, "catalog")).json()
    expect(catalog.accounts["azure-gpt#one"].error).toContain("HTTP 401")
    expect((await fetch(f.base + "/api/catalog")).status).toBe(403)
  } finally {
    gateway.stop(true)
    if (previous === undefined) delete process.env.MAGPIE_ADDR; else process.env.MAGPIE_ADDR = previous
  }
})
