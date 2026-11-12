import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { baseURL, connection } from "./connection.js"

const ID = "azure-gpt"
const ui = join(dirname(fileURLToPath(import.meta.url)), "ui")

// The settings page runs in Magpie's existing Bun host. Keys go through its
// auth SDK; this service neither reads credential files nor returns keys.
export async function settingsService(input, options = {}, log = () => {}) {
  if (!input.directory || typeof globalThis.Bun?.serve !== "function") return null
  try { return startSettingsService(input, options) } catch (error) {
    // Magpie keeps a retired host alive while its model requests finish.
    // Transfer only that host's settings listener; its model fetches continue.
    if (error.code === "EADDRINUSE") {
      try {
        const token = readFileSync(join(input.directory, "plugin-work/azure-gpt-settings.token"), "utf8").trim()
        if (!/^[a-f0-9]{64}$/.test(token)) throw error
        const response = await fetch(`http://127.0.0.1:${options.uiPort ?? 3487}/api/retire`, {
          method: "POST", headers: { "x-azure-settings-token": token }, signal: AbortSignal.timeout(2000),
        })
        if (!response.ok) throw error
        await response.text()
        for (let attempt = 0; attempt < 20; attempt++) {
          try { return startSettingsService(input, options) } catch (retry) { if (retry.code !== "EADDRINUSE") throw retry }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      } catch {}
    }
    log("warn", "Azure GPT settings could not start: " + error.message)
    return null
  }
}

export function startSettingsService(input, options = {}) {
  const work = join(input.directory, "plugin-work")
  mkdirSync(work, { recursive: true, mode: 0o700 })
  const tokenFile = join(work, "azure-gpt-settings.token")
  let token
  try { token = readFileSync(tokenFile, "utf8").trim() } catch (error) {
    if (error.code !== "ENOENT") throw error
    const generated = randomBytes(32).toString("hex")
    try { writeFileSync(tokenFile, generated, { flag: "wx", mode: 0o600 }); token = generated } catch (error) {
      if (error.code !== "EEXIST") throw error
      token = readFileSync(tokenFile, "utf8").trim()
    }
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("The settings access token is invalid.")
  const accounts = new Map()
  const lists = new Map()
  const publicAccount = ({ signature: _signature, ...account }) => account
  const signature = (key, base) => createHash("sha256").update(key + "\0" + base).digest("hex")
  const observe = (id, auth) => {
    if (auth?.type !== "api" || !auth.key) return
    let config
    try { config = connection(options, auth, id) } catch { config = { baseURL: auth.metadata?.baseURL || "", modelsURL: "", headers: {} } }
    let label = auth.accountId || auth.metadata?.accountName || id
    if (label === id && config.baseURL) { try { label = new URL(config.baseURL).host } catch {} }
    const listing = options.connections?.[id]?.modelsURL ?? options.modelsURL ?? ""
    accounts.set(id, { id, label, accountId: auth.accountId || "", ...config, modelsURL: listing, hasKey: true, signature: signature(auth.key, config.baseURL) })
  }
  const listed = (id, error = "") => lists.set(id, { done: true, error })
  const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers })
  const server = Bun.serve({ hostname: "127.0.0.1", port: options.uiPort ?? 3487, maxRequestBodySize: 64 * 1024,
    async fetch(request, server) {
      const path = new URL(request.url).pathname
      if (!path.startsWith("/api/")) {
        if (request.method !== "GET") return new Response("Method not allowed", { status: 405 })
        const file = { "/": "settings.html", "/settings.html": "settings.html", "/app.js": "app.js", "/bridge.js": "bridge.js", "/style.css": "style.css" }[path]
        if (!file) return new Response("Not found", { status: 404 })
        const origin = "http://127.0.0.1:" + server.port
        const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff",
          "content-security-policy": `sandbox allow-scripts; default-src 'none'; script-src 'self' ${origin}; style-src 'self' ${origin} 'unsafe-inline'; connect-src 'self' ${origin}; img-src 'self' data:; form-action 'none'; base-uri 'none'`,
          "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8" }
        const text = readFileSync(join(ui, file), "utf8")
        return new Response(file.endsWith(".html") ? text.replace("@SETTINGS_TOKEN@", token) : text, { headers })
      }
      const origin = request.headers.get("origin")
      if (origin && origin !== "null" && origin !== new URL(request.url).origin) return json({ error: "Origin not allowed" }, 403)
      const headers = { "cache-control": "no-store", ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}) }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers,
        "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, x-azure-settings-token" } })
      const supplied = request.headers.get("x-azure-settings-token") || ""
      if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return json({ error: "Settings authentication required" }, 403, headers)
      if (path === "/api/retire" && request.method === "POST") {
        setTimeout(() => server.stop(false), 0)
        return json({ retired: true }, 200, headers)
      }
      if (path === "/api/catalog" && request.method === "GET") {
        try {
          // MAGPIE_ADDR is supplied by the official host, including custom
          // gateway ports. Read the published catalog that agents receive.
          const gateway = new URL("http://" + process.env.MAGPIE_ADDR)
          if (!gateway.port || !["127.0.0.1", "localhost", "[::1]"].includes(gateway.hostname) || gateway.username || gateway.password) throw new Error("Magpie's local gateway address is unavailable.")
          const response = await fetch(new URL("/v1/models", gateway), { signal: AbortSignal.timeout(3000) })
          if (!response.ok) throw new Error("Magpie's model catalog returned HTTP " + response.status + ".")
          const catalog = await response.json()
          if (!Array.isArray(catalog.data)) throw new Error("Magpie's model catalog is unavailable.")
          const models = catalog.data.filter((model) => [ID, ID + "-plugin"].includes(model.owned_by)).map((model) => model.id)
          return json({ models, accounts: Object.fromEntries(lists) }, 200, headers)
        } catch (error) { return json({ error: error.message, models: [], accounts: Object.fromEntries(lists) }, 200, headers) }
      }
      if (path === "/api/accounts" && request.method === "GET") return json({ accounts: [...accounts.values()].map(publicAccount) }, 200, headers)
      if (path !== "/api/accounts" || request.method !== "POST") return json({ error: "Not found" }, 404, headers)
      try {
        const body = await request.json()
        const base = baseURL(body.baseURL)
        if (typeof body.key !== "string" || !body.key.trim() || body.key.length > 8192) throw new Error("Enter the API key.")
        const key = body.key.trim()
        const label = typeof body.accountName === "string" ? body.accountName.trim() : ""
        if (label.length > 64) throw new Error("Account names can contain at most 64 characters.")
        const existing = body.account ? accounts.get(body.account)
          || (options.connections?.[body.account] && /^azure-gpt(?:#[a-z0-9_-]+)?$/.test(body.account)
            ? { id: body.account, accountId: typeof body.accountId === "string" ? body.accountId : "" } : undefined)
          : [...accounts.values()].find((a) => a.signature === signature(key, base))
        if (body.account && !existing) throw new Error("Refresh the account list before replacing its key.")
        if (body.newAccount && (!/^azure-gpt#[a-f0-9]{16}$/.test(body.newAccount)
          || baseURL(options.connections?.[body.newAccount]?.baseURL) !== base)) throw new Error("Save the new connection settings before adding its key.")
        const id = existing?.id || body.newAccount || ID + "#" + randomBytes(8).toString("hex")
        const auth = { type: "api", key, accountId: existing ? existing.accountId : label || new URL(base).host,
          metadata: { baseURL: base, ...(label ? { accountName: label } : {}) } }
        lists.delete(id)
        await input.client.auth.set({ path: { id }, body: auth })
        observe(id, auth)
        return json({ account: publicAccount(accounts.get(id)) }, 200, headers)
      } catch (error) {
        return json({ error: error instanceof SyntaxError ? "Invalid request" : error.message }, 400, headers)
      }
    },
  })
  return { observe, listed, server, stop: () => server.stop(true) }
}
