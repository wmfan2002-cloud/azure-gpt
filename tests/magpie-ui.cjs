// Real Magpie + a temporary profile + a simulated upstream. No real keys.
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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "azure-ui-")), config = path.join(temp, "config/magpie")
  const seen = [], errors = []
  let releaseHeld, markHeld
  const heldStarted = new Promise((resolve) => { markHeld = resolve })
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    seen.push({ method: req.method, url: req.url, body, headers: req.headers })
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET") {
      if (req.headers["api-key"] === "reject-model-key") { res.statusCode = 401; return res.end(JSON.stringify({ error: "model discovery refused" })) }
      // Reproduce a first install whose discovery finishes after key storage.
      await sleep(Number(process.env.MODEL_LIST_DELAY ?? 1200))
      return res.end(JSON.stringify({ data: [{ id: "test-deployment", reasoning: true, reasoning_levels: ["medium"], context_window: 64000, max_output_tokens: 8192, tool_call: true }] }))
    }
    if (body?.input?.some((item) => item.type === "reasoning")) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: { code: "invalid_encrypted_content", message: "Encrypted content could not be decrypted or parsed." } }))
    }
    if (JSON.stringify(body?.input).includes("hold-for-settings")) await new Promise((resolve) => { releaseHeld = resolve; markHeld() })
    res.end(JSON.stringify({ id: "resp_ok", object: "response", status: "completed", model: body.model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "repaired", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }))
  })
  const upstreamPort = await listen(upstream), gatewayPort = await freePort(), webPort = await freePort(), uiPort = await freePort()
  const base = `http://127.0.0.1:${webPort}`, upstreamBase = `http://127.0.0.1:${upstreamPort}`
  await fs.mkdir(config, { recursive: true }); await fs.mkdir(path.join(temp, "home"))
  await fs.writeFile(path.join(config, "plugins.json"), JSON.stringify({ plugins: [{ spec: root, options: { uiPort, preserved: { keep: true } } }] }))
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ lang, autoRestart: false, updateEvery: 0, codexAgentsV1: false }))
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("MAGPIE_")))
  const env = { ...inherited, ...(process.env.MAGPIE_BUN ? { MAGPIE_BUN: process.env.MAGPIE_BUN } : {}), HOME: path.join(temp, "home"), XDG_CONFIG_HOME: path.join(temp, "config"), XDG_CACHE_HOME: path.join(temp, "cache"), XDG_STATE_HOME: path.join(temp, "state"), MAGPIE_ADDR: `127.0.0.1:${gatewayPort}`, MAGPIE_WEB_KEY: "test-web-access-key" }
  const processHandle = spawn(process.env.MAGPIE_BIN || "magpie", ["serve", `--web=127.0.0.1:${webPort}`], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  let logs = "", browser, page
  const network = []
  processHandle.stdout.on("data", (chunk) => { logs += chunk }); processHandle.stderr.on("data", (chunk) => { logs += chunk })
  try {
    let signIn
    for (let n = 0; n < 100; n++) {
      try { signIn = await fetch(base + "/?k=test-web-access-key", { redirect: "manual" }); break } catch { await sleep(100) }
    }
    assert(signIn, "Magpie web started")
    const cookie = signIn.headers.get("set-cookie").split(";")[0]
    const notes = await fetch(base + "/api/whatsnew/seen", { method: "POST", headers: { cookie } })
    assert.equal(notes.status, 204)
    const get = async (route) => { const r = await fetch(base + route, { headers: { cookie } }); assert.equal(r.status, 200); return r.json() }
    const entry = (await get("/api/plugin-pages")).find((p) => p.spec === root)
    assert(entry, "settings page registered")
    const executablePath = engine === "webkit" ? process.env.WEBKIT_EXECUTABLE : process.env.CHROMIUM_EXECUTABLE
    browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: lang === "zh" ? "zh-CN" : "en-US" })
    page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); page.setDefaultTimeout(20000)
    page.on("response", (response) => { if (response.url().includes("/api/accounts") || response.url().includes("plugin-pages/options")) network.push(`${response.status()} ${response.request().method()} ${response.url()}`) })
    await page.goto(base + "/?k=test-web-access-key")
    await page.locator(`#nav button[data-view="${entry.key}"]`).click()
    const frame = page.frameLocator("iframe.plugin-frame")
    await frame.locator("#provider-name").waitFor()
    assert.equal(await frame.locator("#provider-name").inputValue(), "Azure GPT")
    await frame.locator("#provider-name").fill("My Azure")
    await frame.locator("#account-name").fill("Work")
    await frame.locator("#add-url").fill(upstreamBase + "/openai/v1/")
    await frame.locator("#add-key").fill("fake-private-key-one")
    await frame.locator("#add-extra summary").click()
    await frame.locator('#add-extra input').nth(0).fill("api-key")
    await frame.locator('#add-extra input').nth(1).fill("test-version")
    await frame.locator("#add-form [data-save]").click()
    await frame.locator("#connections .connection").waitFor()
    await frame.locator("#add-form [data-save]:enabled").waitFor()
    await frame.locator("#status[data-error=false]").waitFor()
    assert.equal(await frame.locator("#add-key").inputValue(), "")
    const saved = JSON.parse(await fs.readFile(path.join(config, "plugins.json")))
    assert.equal(saved.plugins[0].options.name, "My Azure")
    assert.equal(saved.plugins[0].options.preserved.keep, true)
    assert(!JSON.stringify(saved).includes("fake-private-key-one"), "API key is outside package options")
    let auth = JSON.parse(await fs.readFile(path.join(config, "plugin-auth.json")))
    const account = Object.keys(auth)[0]
    assert.equal(auth[account].key, "fake-private-key-one")
    assert.equal(auth[account].accountId, "Work")
    const first = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "azure-gpt/test-deployment", stream: false, input: [{ role: "user", content: "first request after adding" }] }) })
    assert.equal(first.status, 200, await first.text())
    seen.length = 0
    const connection = frame.locator("#connections .connection").first()
    await connection.locator('input[type=url]').first().fill(upstreamBase + "/changed/v1")
    await connection.locator('[data-save]').click()
    await frame.locator("#status[data-error=false]").waitFor()
    await connection.locator('input[type=password]').fill("fake-private-key-two")
    await connection.locator('[data-save]').click()
    for (let n = 0; n < 100; n++) { auth = JSON.parse(await fs.readFile(path.join(config, "plugin-auth.json"))); if (auth[account].key === "fake-private-key-two") break; await sleep(100) }
    assert.equal(auth[account].key, "fake-private-key-two")
    assert.equal(auth[account].accountId, "Work")
    await frame.locator("#manual").click()
    await frame.locator("#models-form [data-save]").click()
    await frame.locator("#status[data-error=true]").waitFor()
    assert((await frame.locator("#status").textContent()).includes(lang === "zh" ? "至少添加一个" : "at least one"))
    await frame.locator("#add-model").click()
    const model = frame.locator("#model-rows .model").first(), inputs = model.locator(".grid input")
    await inputs.nth(0).fill("test-deployment"); await inputs.nth(1).fill("Test deployment")
    await inputs.nth(2).fill("64000"); await inputs.nth(3).fill("8192"); await inputs.nth(4).fill("medium")
    await model.locator('input[type=checkbox]').nth(0).check()
    await frame.locator("#models-form [data-save]").click()
    await frame.locator("#status[data-error=false]").waitFor()
    const models = (await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`).then((r) => r.json())).data
    assert(models.some((m) => m.id === "azure-gpt/test-deployment"), "new SDK account is offered by Magpie")
    const body = { model: "azure-gpt/test-deployment", stream: false, store: false, reasoning: { effort: "medium" }, input: [{ role: "user", content: "continue" }, { type: "reasoning", id: "rs_previous", summary: [], encrypted_content: "old-seal" }] }
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "codex_cli_rs/0.167.2" }, body: JSON.stringify(body) })
    const answer = await response.json(); assert.equal(response.status, 200, JSON.stringify(answer))
    const attempts = seen.filter((record) => record.method === "POST")
    assert.equal(attempts.length, 2)
    assert(attempts.every((record) => record.url === "/changed/v1/responses?api-version=test-version"))
    assert(attempts.every((record) => record.headers["api-key"] === "fake-private-key-two" && !record.headers.authorization))
    assert(attempts[0].body.input.some((item) => item.type === "reasoning"))
    assert(!attempts[1].body.input.some((item) => item.type === "reasoning"))
    const heldResponse = fetch(`http://127.0.0.1:${gatewayPort}/v1/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, input: [{ role: "user", content: "hold-for-settings" }] }) })
    await Promise.race([heldStarted, sleep(10000).then(() => { throw new Error("The held request did not reach the upstream") })])
    await frame.locator("#provider-name").fill("Renamed Azure")
    await frame.locator("#provider-form [data-save]").click()
    await frame.locator("#status[data-error=false]").waitFor()
    await frame.locator("#refresh").click()
    await frame.locator("#connections .connection").waitFor()
    const names = await frame.locator("main").evaluate(() => magpie.read("providers:list"))
    assert(names.some((provider) => provider.id === "azure-gpt" && provider.name.startsWith("Renamed Azure")), "provider rename reaches Magpie while the previous host is serving a request")
    releaseHeld()
    assert.equal((await heldResponse).status, 200, "settings host transfer preserves the running model request")
    await page.setViewportSize({ width: 420, height: 900 })
    assert(await frame.locator("main").evaluate((el) => el.scrollWidth <= document.documentElement.clientWidth), "mobile layout fits")
    if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT, fullPage: true })
    await frame.locator("#discovery").click()
    await frame.locator("#models-form [data-save]").click()
    await frame.locator("#status[data-error=false]").waitFor()
    await frame.locator("#account-name").fill("Discovery refused")
    await frame.locator("#add-key").fill("reject-model-key")
    await frame.locator("#add-form [data-save]").click()
    await frame.locator("#add-form [data-save]:enabled").waitFor()
    await frame.locator("#status[data-error=true]").waitFor()
    assert((await frame.locator("#status").textContent()).includes("HTTP 401"), "discovery failures explain why the saved account is not ready")
    assert.equal(await frame.locator("#add-key").inputValue(), "")
    assert.equal(errors.length, 0, errors.join("\n"))
    console.log(`PASS ${engine} ${lang}: first discovered request, discovery errors, add and rename, account URL/key editing, model form validation, preserved options, authenticated recovery, host transfer during a request, narrow layout`)
  } catch (error) {
    if (page) for (const frame of page.frames()) {
      const status = await frame.locator("#status").textContent().catch(() => "")
      console.error("Frame:", frame.url(), "Settings page:", status)
    }
    if (page) await page.screenshot({ path: "/tmp/azure-gpt-ui-failure.png", fullPage: true }).catch(() => {})
    console.error("Settings requests:", network)
    console.error("Saved options:", await fs.readFile(path.join(config, "plugins.json"), "utf8"))
    console.error("Saved accounts:", Object.keys(JSON.parse(await fs.readFile(path.join(config, "plugin-auth.json"), "utf8").catch(() => "{}"))))
    console.error("Upstream requests:", seen.map(({ method, url }) => ({ method, url })))
    const catalog = JSON.parse(await fs.readFile(path.join(config, "plugin-providers.json"), "utf8").catch(() => "[]"))
    console.error("Plugin catalog:", catalog.map(({ id, fellBack, listError, models }) => ({ id, fellBack, listError, models: models?.map(({ id, npm }) => ({ id, npm })) })))
    console.error("Browser errors:", errors)
    console.error(logs.slice(-4000)); throw error
  } finally {
    releaseHeld?.()
    await browser?.close()
    try { process.kill(-processHandle.pid, "SIGTERM") } catch {}
    await Promise.race([new Promise((resolve) => processHandle.once("exit", resolve)), sleep(3000)])
    try { process.kill(-processHandle.pid, "SIGKILL") } catch {}
    await new Promise((resolve) => upstream.close(resolve))
    await fs.rm(temp, { recursive: true, force: true })
  }
}

(async () => { for (const engine of (process.env.BROWSER || "chromium").split(",")) for (const lang of ["en", "zh"]) await run(engine, lang) })().catch((error) => { console.error(error); process.exitCode = 1 })
