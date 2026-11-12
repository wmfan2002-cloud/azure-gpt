// Actual Magpie: native URL/key sign-in and its provider Advanced editor.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const http = require("node:http")
const { spawn } = require("node:child_process")
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const root = path.resolve(__dirname, "..")
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))
const freePort = async () => { const server = http.createServer(); const port = await listen(server); await new Promise((r) => server.close(r)); return port }

async function run(engine, lang) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "azure-native-ui-")), config = path.join(temp, "config/magpie")
  const calls = [], errors = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    calls.push({ url: req.url, body, headers: req.headers })
    res.setHeader("content-type", "application/json")
    if (req.headers.originator !== "codex_cli_rs") { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorized_client_error" })) }
    if (req.method === "GET") {
      await sleep(1200)
      return res.end(JSON.stringify({ data: [{ id: "test-deployment", reasoning: true, reasoning_levels: ["medium"], context_window: 64000, max_output_tokens: 8192 }] }))
    }
    if (body.input?.some((item) => item.type === "reasoning")) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: { code: "invalid_encrypted_content", message: "Encrypted content could not be decrypted or parsed." } }))
    }
    res.end(JSON.stringify({ id: "resp_ok", object: "response", status: "completed", model: body.model,
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }))
  })
  const upstreamPort = await listen(upstream), gatewayPort = await freePort(), webPort = await freePort()
  const base = `http://127.0.0.1:${webPort}`, gateway = `http://127.0.0.1:${gatewayPort}`, apiBase = `http://127.0.0.1:${upstreamPort}/openai/v1`
  await fs.mkdir(config, { recursive: true })
  await fs.writeFile(path.join(config, "plugins.json"), JSON.stringify({ plugins: [{ spec: root, options: {} }] }))
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ lang, autoRestart: false, updateEvery: 0, codexAgentsV1: false }))
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA"].includes(key)))
  const env = { ...inherited, ...(process.env.MAGPIE_BUN ? { MAGPIE_BUN: process.env.MAGPIE_BUN } : {}),
    HOME: path.join(temp, "home"), XDG_CONFIG_HOME: path.join(temp, "config"), XDG_CACHE_HOME: path.join(temp, "cache"), XDG_STATE_HOME: path.join(temp, "state"),
    MAGPIE_ADDR: `127.0.0.1:${gatewayPort}`, MAGPIE_WEB_KEY: "test-web-access-key" }
  const child = spawn(process.env.MAGPIE_BIN || "magpie", ["serve", `--web=127.0.0.1:${webPort}`], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  let logs = "", browser, page
  child.stdout.on("data", (chunk) => { logs += chunk }); child.stderr.on("data", (chunk) => { logs += chunk })
  try {
    let login
    for (let n = 0; n < 100; n++) { try { login = await fetch(base + "/?k=test-web-access-key", { redirect: "manual" }); break } catch { await sleep(100) } }
    assert(login, "Magpie web started")
    const cookie = login.headers.get("set-cookie").split(";")[0]
    await fetch(base + "/api/whatsnew/seen", { method: "POST", headers: { cookie } })
    const get = async (route) => { const response = await fetch(base + route, { headers: { cookie } }); assert.equal(response.status, 200); return response.json() }
    for (let n = 0; n < 100; n++) {
      await get("/api/providers?wait=1")
      const catalog = JSON.parse(await fs.readFile(path.join(config, "plugin-providers.json"), "utf8").catch(() => "[]"))
      if (catalog.some((provider) => provider.id === "azure-gpt")) break
      await sleep(100)
    }
    assert(!(await get("/api/plugin-pages")).some((entry) => entry.spec === root), "the plugin adds no separate settings page")
    const executablePath = engine === "webkit" ? process.env.WEBKIT_EXECUTABLE : process.env.CHROMIUM_EXECUTABLE
    browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce", locale: lang === "zh" ? "zh-CN" : "en-US" })
    page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(20000)
    await page.goto(base + "/?k=test-web-access-key&view=providers")
    // Magpie opens Add your first provider itself in an empty profile.
    await page.locator('#addSheet .tile[data-pick="Azure GPT"]').click()
    const signing = page.locator("#addSheet .signing")
    await signing.locator('input:not([type=password])').first().fill(apiBase)
    await signing.locator('input:not([type=password])').first().press("Enter")
    await signing.locator('input[type=password]').fill("fake-native-ui-key")
    await signing.getByRole("button", { name: lang === "zh" ? "登录" : "Sign in", exact: true }).click()
    const editor = page.locator("#modal .editor")
    await editor.waitFor()
    let model
    for (let n = 0; n < 100; n++) {
      model = (await fetch(gateway + "/v1/models").then((response) => response.json())).data?.find((row) => row.id === "azure-gpt/test-deployment")
      if (model?.native_endpoints?.includes("/v1/responses")) break
      await sleep(100)
    }
    assert(model?.native_endpoints?.includes("/v1/responses"), "discovery registers the actual Responses endpoint")
    const advanced = editor.locator("details.advanced")
    if (!await advanced.evaluate((element) => element.open)) await advanced.locator(":scope > summary").click()
    for (const [selector, value] of [["input.contexts", "test-deployment=128k"], ["input.outputs", "4096"], ["input.compacts", "48000"], ["input.concurrency", "2"], ["input.max-accounts", "2"], ["input.rpm", "120"], ["input.queue-limit", "4"], ["input.queue-wait", "30"], ["input.price-rate", "0.8"]]) {
      await advanced.locator(selector).fill(value)
    }
    assert.equal(await advanced.locator(".proxy-url").count(), 1, "the native proxy editor is available")
    assert.equal(await editor.locator('.plugin-option[data-key="recovery"]').count(), 1)
    assert.equal(await editor.locator('.plugin-option[data-key="codex_headers"]').count(), 1)
    await editor.locator(".bar").getByRole("button", { name: lang === "zh" ? "保存" : "Save", exact: true }).click()
    await editor.waitFor({ state: "hidden" })
    const saved = JSON.parse(await fs.readFile(path.join(config, "providers.json"), "utf8")).providers.find((provider) => provider.id === "azure-gpt")
    assert.equal(saved.contexts["test-deployment"], 128000)
    assert.equal(saved.maxConcurrency, 2)
    assert.equal(saved.maxAccounts, 2)
    assert.equal(saved.maxRPM, 120)
    assert.equal(saved.queueLimit, 4)
    assert.equal(saved.queueWait, 30)
    assert.equal(saved.priceRate, 0.8)
    let published
    for (let n = 0; n < 100; n++) {
      published = (await fetch(gateway + "/v1/models").then((response) => response.json())).data.find((row) => row.id === "azure-gpt/test-deployment")
      if (published.context_window === 128000 && published.max_output_tokens === 4096) break
      await sleep(100)
    }
    assert.equal(published.context_window, 128000)
    assert.equal(published.max_output_tokens, 4096)
    const state = await get("/api/providers")
    const provider = state.providers.find((row) => row.id === "azure-gpt")
    assert.equal(provider.compacts["*"], 48000)
    assert.equal(provider.outputs["*"], 4096)
    calls.length = 0
    const body = { model: "azure-gpt/test-deployment", stream: false, store: false, reasoning: { effort: "medium" }, input: [{ role: "user", content: "continue" }, { type: "reasoning", id: "rs_old", summary: [], encrypted_content: "old-seal" }] }
    const response = await fetch(gateway + "/v1/responses", { method: "POST", headers: { "content-type": "application/json", "user-agent": "codex_cli_rs/0.167.2" }, body: JSON.stringify(body) })
    assert.equal(response.status, 200, await response.text())
    const attempts = calls.filter((call) => call.body)
    assert.equal(attempts.length, 2)
    assert(attempts.every((call) => call.headers.authorization === "Bearer fake-native-ui-key" && call.headers.originator === "codex_cli_rs"))
    assert(attempts[0].body.input.some((item) => item.type === "reasoning"))
    assert(!attempts[1].body.input.some((item) => item.type === "reasoning"))
    assert(attempts.every((call) => call.body.reasoning.effort === "medium"))
    await page.setViewportSize({ width: 420, height: 900 })
    await page.locator(".row.provider", { hasText: "Azure GPT" }).click()
    await editor.waitFor()
    await page.waitForFunction(() => {
      const modal = document.getElementById("modal")
      return !modal.hidden && !modal.classList.contains("out") && Number(getComputedStyle(modal.firstElementChild).opacity) > 0.99
    })
    const reopened = editor.locator("details.advanced")
    if (!await reopened.evaluate((element) => element.open)) await reopened.locator(":scope > summary").click()
    await editor.locator("input.outputs").waitFor()
    assert.equal(await editor.locator("input.outputs").inputValue(), "4096")
    assert.equal(await editor.locator("input.contexts").inputValue(), "test-deployment=128k")
    if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT, fullPage: true, animations: "disabled" })
    assert.equal(errors.length, 0, errors.join("\n"))
    console.log(`PASS ${engine} ${lang}: native URL/key form, real endpoint, Advanced settings saved and published, authenticated recovery, settings retained on reopening`)
  } catch (error) {
    if (page) await page.screenshot({ path: "/tmp/azure-gpt-native-ui-failure.png", fullPage: true }).catch(() => {})
    console.error("Browser errors:", errors)
    console.error(logs.slice(-4000)); throw error
  } finally {
    await browser?.close()
    try { process.kill(-child.pid, "SIGTERM") } catch {}
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(1000)])
    try { process.kill(-child.pid, "SIGKILL") } catch {}
    await new Promise((resolve) => upstream.close(resolve))
    await fs.rm(temp, { recursive: true, force: true })
  }
}

;(async () => { for (const engine of (process.env.BROWSER || "chromium").split(",")) for (const lang of ["en", "zh"]) await run(engine, lang) })().catch((error) => { console.error(error); process.exitCode = 1 })
