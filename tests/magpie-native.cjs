// Exercise the existing Magpie sign-in API and a previously saved account.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const http = require("node:http")
const { spawn } = require("node:child_process")
const root = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const freePort = async () => { const server = http.createServer(); const port = await listen(server); await new Promise((r) => server.close(r)); return port }

async function run(existing) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "azure-native-")), config = path.join(temp, "config/magpie")
  const calls = []
  const upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) {} // Consume the body before answering.
    calls.push({ url: req.url, authorization: req.headers.authorization, originator: req.headers.originator })
    res.setHeader("content-type", "application/json")
    if (req.headers.originator !== "codex_cli_rs") { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized_client_error" })) }
    if (req.method === "GET") {
      await sleep(1200)
      return res.end(JSON.stringify({ data: [{ id: "deployment-test", reasoning: true, reasoning_levels: ["medium"] }] }))
    }
    res.end(JSON.stringify({ id: "resp_ok", object: "response", status: "completed", model: "deployment-test",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }] }))
  })
  const upstreamPort = await listen(upstream), gatewayPort = await freePort(), webPort = await freePort(), uiPort = await freePort()
  const base = `http://127.0.0.1:${webPort}`, gateway = `http://127.0.0.1:${gatewayPort}`, apiBase = `http://127.0.0.1:${upstreamPort}/v1`
  await fs.mkdir(config, { recursive: true })
  const account = existing === "page" ? "azure-gpt#0123456789abcdef" : "azure-gpt"
  const options = { name: "Work Azure", ...(existing === "page" ? { uiPort, models: {}, connections: { [account]: { baseURL: apiBase } } } : {}) }
  await fs.writeFile(path.join(config, "plugins.json"), JSON.stringify({ plugins: [{ spec: root, options }] }))
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ autoRestart: false, updateEvery: 0, codexAgentsV1: false }))
  if (existing) {
    await fs.writeFile(path.join(config, "plugin-auth.json"), JSON.stringify({ [account]: { type: "api", key: "fake-native-api-key", ...(existing === "page" ? { accountId: "Work" } : {}), metadata: { baseURL: existing === "page" ? "http://127.0.0.1:1/old/v1" : apiBase } } }))
    await fs.writeFile(path.join(config, "providers.json"), JSON.stringify({ providers: [{ id: "azure-gpt", models: ["deployment-test"] }] }))
  }
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA"].includes(key)))
  const env = { ...inherited, ...(process.env.MAGPIE_BUN ? { MAGPIE_BUN: process.env.MAGPIE_BUN } : {}),
    HOME: path.join(temp, "home"), XDG_CONFIG_HOME: path.join(temp, "config"), XDG_CACHE_HOME: path.join(temp, "cache"), XDG_STATE_HOME: path.join(temp, "state"),
    MAGPIE_ADDR: `127.0.0.1:${gatewayPort}`, MAGPIE_WEB_KEY: "test-web-access-key" }
  const child = spawn(process.env.MAGPIE_BIN || "magpie", ["serve", `--web=127.0.0.1:${webPort}`], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  let logs = ""
  child.stdout.on("data", (chunk) => { logs += chunk }); child.stderr.on("data", (chunk) => { logs += chunk })
  try {
    let login
    for (let n = 0; n < 100; n++) { try { login = await fetch(base + "/?k=test-web-access-key", { redirect: "manual" }); break } catch { await sleep(100) } }
    assert(login, "Magpie web started")
    const cookie = login.headers.get("set-cookie").split(";")[0]
    const get = async (route) => { const response = await fetch(base + route, { headers: { cookie } }); assert.equal(response.status, 200); return response.json() }
    if (!existing) {
      let registered = false
      for (let n = 0; n < 100; n++) {
        await get("/api/providers?wait=1")
        const catalog = JSON.parse(await fs.readFile(path.join(config, "plugin-providers.json"), "utf8").catch(() => "[]"))
        if (catalog.some((provider) => provider.id === "azure-gpt")) { registered = true; break }
        await sleep(100)
      }
      assert(registered, "native Add provider tile is registered")
      const signed = await fetch(base + "/api/plugin-signin", { method: "POST", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ provider: "azure-gpt", method: 0, inputs: { baseURL: apiBase }, key: "fake-native-api-key" }) })
      assert.equal(signed.status, 200, await signed.text())
    }
    // Magpie's native model picker waits for discovery. Select its listed ID.
    await get("/api/providers?wait=1")
    let offered = false
    for (let n = 0; n < 100; n++) {
      const catalog = await fetch(gateway + "/v1/models").then((response) => response.json())
      if (catalog.data?.some((model) => model.id === "azure-gpt/deployment-test")) { offered = true; break }
      await sleep(100)
    }
    assert(offered, "the saved account offers its discovered model")
    const response = await fetch(gateway + "/v1/responses", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "azure-gpt/deployment-test", stream: false, input: [{ role: "user", content: "hello" }] }) })
    assert.equal(response.status, 200, await response.text())
    assert(calls.some((call) => call.url === "/v1/responses" && call.authorization === "Bearer fake-native-api-key" && call.originator === "codex_cli_rs"))
    const auth = JSON.parse(await fs.readFile(path.join(config, "plugin-auth.json"), "utf8"))
    assert.equal(auth[account].metadata.baseURL, existing === "page" ? "http://127.0.0.1:1/old/v1" : apiBase)
    assert.equal(auth[account].key, "fake-native-api-key")
    const version = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version
    console.log(`PASS ${version}: ${existing === "page" ? "account created by the removed page with a connection override" : existing ? "existing native sign-in and model selection" : "native URL + Key sign-in"}, discovered model, authenticated request`)
  } catch (error) { console.error(logs.slice(-3000)); throw error } finally {
    try { process.kill(-child.pid, "SIGTERM") } catch {}
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(1000)])
    try { process.kill(-child.pid, "SIGKILL") } catch {}
    await new Promise((resolve) => upstream.close(resolve))
    await fs.rm(temp, { recursive: true, force: true })
  }
}

;(async () => { await run(false); await run(true); await run("page") })().catch((error) => { console.error(error); process.exitCode = 1 })
