(() => {
  const words = {
    en: { intro: "Add accounts and edit their connections. History repair runs only after a matching error.", provider: "Provider", providerName: "Display name", saveName: "Save name", add: "Add account", accountName: "Account name", apiURL: "API base URL", apiKey: "API key", addSave: "Add account and save name", connections: "Existing connections", refresh: "Refresh", models: "Model discovery", upstream: "Use upstream model list", manual: "Manual models", modelsHint: "Use manual models if the upstream cannot list models or omits their capabilities.", addModel: "Add model", searches: "Upstream handles native web search", saveModels: "Save model settings", nativeTitle: "More settings in Providers", nativeHint: "Magpie's provider editor manages model selection and names, reasoning levels, context and output limits, compaction, fallback, routing, proxies, concurrency, queues, and pricing.", advanced: "Connection options", authHeader: "Authentication header", authHint: "authorization sends a Bearer token; api-key sends the key as an Azure API key header.", apiVersion: "API version (optional)", modelsURL: "Model list URL (optional)", extraHeaders: "Extra request headers", addHeader: "Add header", remove: "Remove", saveConnection: "Save connection", replaceKey: "Replacement API key (optional)", keyHint: "Leave empty to keep the existing key.", empty: "No accounts loaded. Add an account here or sign in from Providers.", saved: "Saved", added: "Account added", modelID: "Model / deployment ID", modelName: "Model display name", context: "Context window", output: "Maximum output tokens", reasoning: "Reasoning", image: "Image input", toolCalls: "Tool calls", efforts: "Reasoning levels, comma separated", tiers: "Service tiers, comma separated", missingID: "Enter a model ID.", duplicateID: "Model IDs must be unique.", number: "Token limits must be positive integers.", duplicateHeader: "Header names must be unique.", failed: "Settings service did not answer. Reopen the Azure GPT page.", scope: "This page configures Azure GPT. Use the selected provider's editor for its own settings." },
    zh: { intro: "添加账号并编辑连接。历史修复仅在匹配的报错后执行。", provider: "供应商", providerName: "显示名称", saveName: "保存名称", add: "添加账号", accountName: "账号名称", apiURL: "API 基础地址", apiKey: "API Key", addSave: "添加账号并保存名称", connections: "已有连接", refresh: "刷新", models: "模型发现", upstream: "使用上游模型列表", manual: "手动配置模型", modelsHint: "上游不能列出模型或缺少能力信息时，可手动配置。", addModel: "添加模型", searches: "上游自行处理原生网页搜索", saveModels: "保存模型设置", nativeTitle: "供应商页面中的更多设置", nativeHint: "Magpie 原有编辑器提供模型选择及名称、推理档位、上下文和输出上限、压缩、回退、路由、代理、并发、排队及价格设置。", advanced: "连接选项", authHeader: "认证请求头", authHint: "authorization 使用 Bearer Token；api-key 使用 Azure API Key 请求头。", apiVersion: "API 版本（可选）", modelsURL: "模型列表地址（可选）", extraHeaders: "额外请求头", addHeader: "添加请求头", remove: "移除", saveConnection: "保存连接", replaceKey: "替换 API Key（可选）", keyHint: "留空保留已有 Key。", empty: "尚未加载账号，可在此添加或从供应商页面登录。", saved: "已保存", added: "账号已添加", modelID: "模型 / 部署 ID", modelName: "模型显示名称", context: "上下文上限", output: "最大输出 Token", reasoning: "推理", image: "图像输入", toolCalls: "工具调用", efforts: "推理档位，以逗号分隔", tiers: "服务档位，以逗号分隔", missingID: "请填写模型 ID。", duplicateID: "模型 ID 不能重复。", number: "Token 上限必须为正整数。", duplicateHeader: "请求头名称不能重复。", failed: "设置服务未响应，请重新打开 Azure GPT 页面。", scope: "此页面配置 Azure GPT，其他供应商的设置请在其编辑器中修改。" },
  }
  Object.assign(words.en, { loadingModels: "Account saved; loading models…", modelFailure: "Account saved, but models are not ready: ", modelsPending: "Reopen the Azure GPT page and check model discovery, or configure manual models.", emptyModels: "Add at least one manual model before saving." })
  Object.assign(words.zh, { loadingModels: "账号已保存，正在加载模型…", modelFailure: "账号已保存，但模型尚不可用：", modelsPending: "请重新打开 Azure GPT 页面检查模型发现，或配置手动模型。", emptyModels: "请至少添加一个手动模型后再保存。" })
  let lang = "en", options = {}, accounts = [], manual = false
  const $ = (id) => document.getElementById(id)
  const t = (key) => words[lang][key] || words.en[key] || key
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el }
  const status = (text, error = false) => { $("status").textContent = text; $("status").dataset.error = String(error) }
  const field = (key, value = "", type = "text") => { const label = node("label"), input = node("input"); input.type = type; input.value = value; label.append(node("span", t(key)), input); return { label, input } }
  const check = (key, value) => { const label = node("label", "", "check"), input = node("input"); input.type = "checkbox"; input.checked = !!value; label.append(input, node("span", t(key))); return { label, input } }
  const button = (key, handler) => { const b = node("button", t(key)); b.type = "button"; b.onclick = handler; return b }
  const busy = async (button, fn) => { button.disabled = true; status(""); try { await fn() } catch (error) { status(error.message, true) } finally { button.disabled = false } }
  // Magpie sandboxes plugin pages without allow-forms. Use explicit button
  // actions so saving works in both the desktop window and the web frame.
  const onSave = (form, fn) => {
    const button = form.querySelector("[data-save]")
    const run = () => { if (!button.disabled && form.reportValidity()) busy(button, fn) }
    button.onclick = run
    form.onsubmit = (event) => event.preventDefault()
    form.onkeydown = (event) => { if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target.type !== "checkbox") { event.preventDefault(); run() } }
  }
  let saveQueue = Promise.resolve(), lastWrite = 0
  const save = (update) => {
    const task = saveQueue.then(async () => {
      // The public options API permits one write per second. Queue edits and
      // re-read after waiting so adjacent actions preserve each other's values.
      for (let attempt = 0; attempt < 3; attempt++) {
        const delay = 1100 - (Date.now() - lastWrite)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        const latest = await magpie.options.get(), next = update(latest)
        if (JSON.stringify(latest) === JSON.stringify(next)) { options = latest; return options }
        lastWrite = Date.now()
        try {
          options = await magpie.options.set(next)
          // On Magpie web the service root waits for the new host. A no-cors
          // warm-up avoids WebKit's CORS error on a transient proxy 502.
          await magpie.read("providers:list")
          await fetch(new URL("./", location.href), { mode: "no-cors", cache: "no-store" }).catch(() => {})
          return options
        } catch (error) {
          if (attempt === 2 || !error.message.includes("once a second")) throw error
        }
      }
    })
    saveQueue = task.catch(() => {})
    return task
  }
  const validated = (base, settings) => {
    const url = new URL(base)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(t("apiURL"))
    if (settings.modelsURL) { const listing = new URL(settings.modelsURL); if (listing.origin !== url.origin || listing.username || listing.password || listing.hash) throw new Error(t("modelsURL")) }
    new Headers({ [settings.authHeader]: "validate" })
    return { ...settings, baseURL: url.href.replace(/\/+$/, "") }
  }
  const api = async (method = "GET", body, route = "accounts") => {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const response = await fetch(new URL("api/" + route, location.href), { method, headers: { "content-type": "application/json", "x-azure-settings-token": document.querySelector('meta[name="azure-settings-token"]').content }, ...(body ? { body: JSON.stringify(body) } : {}) })
        if ([502, 503, 504].includes(response.status)) throw new TypeError(t("failed"))
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || t("failed"))
        return result
      } catch (error) { if (attempt === 11 || (error.message && error.message !== "Failed to fetch" && !(error instanceof TypeError))) throw error; await new Promise((resolve) => setTimeout(resolve, 250)) }
    }
  }
  const waitForModels = async (account) => {
    status(t("loadingModels"))
    for (let attempt = 0; attempt < 120; attempt++) {
      await magpie.read("providers:list")
      const catalog = await api("GET", undefined, "catalog"), listing = catalog.accounts[account]
      if (catalog.error || listing?.error) throw new Error(t("modelFailure") + (catalog.error || listing.error))
      if (listing?.done && catalog.models.length) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(t("modelFailure") + t("modelsPending"))
  }
  const headerEditor = (initial) => {
    const wrap = node("div"), rows = node("div", "", "headers")
    const add = (key = "", value = "") => {
      const row = node("div", "", "header-row"), name = node("input"), val = node("input")
      name.placeholder = "Header"; name.setAttribute("aria-label", "Header name"); name.value = key
      val.placeholder = "Value"; val.setAttribute("aria-label", "Header value"); val.value = value
      row.append(name, val, button("remove", () => row.remove())); rows.append(row)
    }
    Object.entries(initial || {}).forEach(([key, value]) => add(key, value))
    wrap.append(node("p", t("extraHeaders")), rows, button("addHeader", () => add()))
    return { wrap, value() {
      const result = {}, names = new Set()
      for (const row of rows.children) {
        const [key, val] = row.querySelectorAll("input"), name = key.value.trim()
        if (!name && !val.value) continue
        if (names.has(name.toLowerCase())) throw new Error(t("duplicateHeader"))
        names.add(name.toLowerCase()); new Headers({ [name]: val.value }); result[name] = val.value
      }
      return result
    } }
  }
  const extras = (initial = {}) => {
    const wrap = node("details"), grid = node("div", "", "grid")
    wrap.append(node("summary", t("advanced")))
    const auth = field("authHeader", initial.authHeader || "authorization"), version = field("apiVersion", initial.apiVersion || ""), listing = field("modelsURL", initial.modelsURL || "", "url")
    grid.append(auth.label, version.label, listing.label); wrap.append(grid, node("p", t("authHint"), "hint"))
    const headers = headerEditor(initial.headers); wrap.append(headers.wrap)
    return { wrap, value: () => ({ authHeader: auth.input.value.trim() || "authorization", apiVersion: version.input.value.trim(), modelsURL: listing.input.value.trim(), headers: headers.value() }) }
  }
  const renderConnections = () => {
    const container = $("connections"); container.replaceChildren()
    if (!accounts.length) { container.append(node("p", t("empty"), "hint")); return }
    for (const account of accounts) {
      const form = node("form", "", "connection"), heading = node("h3", account.label), url = field("apiURL", account.baseURL, "url"), key = field("replaceKey", "", "password")
      url.input.required = true; key.input.autocomplete = "off"
      const config = extras(account), submit = node("button", t("saveConnection")); submit.type = "button"; submit.dataset.save = ""
      form.append(heading, url.label, config.wrap, key.label, node("p", t("keyHint"), "hint"), submit)
      onSave(form, async () => {
        const settings = validated(url.input.value.trim(), config.value()), baseURL = settings.baseURL
        await save((latest) => ({ ...latest, connections: { ...latest.connections, [account.id]: { ...latest.connections?.[account.id], ...settings } } }))
        if (key.input.value.trim()) await api("POST", { account: account.id, accountId: account.accountId, baseURL, key: key.input.value })
        key.input.value = ""; await refresh(); status(t("saved"))
      })
      container.append(form)
    }
  }
  const list = (text) => [...new Set(text.split(",").map((value) => value.trim()).filter(Boolean))]
  const modelRow = (id = "", previous = {}) => {
    const row = node("div", "", "model"), grid = node("div", "", "grid"), fields = {}
    for (const [key, value, type] of [["modelID", id], ["modelName", previous.name || ""], ["context", previous.limit?.context || "", "number"], ["output", previous.limit?.output || "", "number"], ["efforts", Object.keys(previous.variants || {}).join(", ")], ["tiers", (previous.serviceTiers || []).map((tier) => typeof tier === "string" ? tier : tier.id).join(", ")]]) {
      fields[key] = field(key, value, type); if (type === "number") { fields[key].input.min = "1"; fields[key].input.step = "1" }; grid.append(fields[key].label)
    }
    const reasoning = check("reasoning", previous.reasoning), image = check("image", previous.modalities?.input?.includes("image")), tools = check("toolCalls", previous.tool_call !== false)
    row.append(grid, reasoning.label, image.label, tools.label, button("remove", () => row.remove()))
    row.model = () => {
      const id = fields.modelID.input.value.trim(); if (!id) throw new Error(t("missingID"))
      const limit = { ...previous.limit }
      for (const [field, key] of [["context", "context"], ["output", "output"]]) {
        const value = fields[field].input.value
        if (!value) delete limit[key]
        else { const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new Error(t("number")); limit[key] = n }
      }
      const modalities = new Set(previous.modalities?.input || ["text"])
      image.input.checked ? modalities.add("image") : modalities.delete("image")
      const variants = Object.fromEntries(list(fields.efforts.input.value).map((effort) => [effort, previous.variants?.[effort] || {}]))
      const serviceTiers = list(fields.tiers.input.value).map((id) => (previous.serviceTiers || []).find((tier) => (typeof tier === "string" ? tier : tier.id) === id) || id)
      return [id, { ...previous, name: fields.modelName.input.value.trim() || id, limit, variants, serviceTiers, reasoning: reasoning.input.checked, tool_call: tools.input.checked,
        modalities: { ...previous.modalities, input: [...modalities], output: previous.modalities?.output || ["text"] } }]
    }
    $("model-rows").append(row)
  }
  const setMode = (value) => { manual = value; $("manual-models").hidden = !value; $("manual").setAttribute("aria-pressed", String(value)); $("discovery").setAttribute("aria-pressed", String(!value)) }
  const refresh = async () => { await magpie.read("providers:list"); const result = await api(); accounts = result.accounts; renderConnections() }
  const start = async () => {
    await magpie.ready
    lang = magpie.theme.lang?.startsWith("zh") ? "zh" : "en"
    document.querySelectorAll("[data-text]").forEach((el) => { el.textContent = t(el.dataset.text) })
    options = await magpie.options.get()
    $("provider-name").value = options.name || "Azure GPT"
    $("add-url").value = options.baseURL || ""
    const addExtra = extras(options); $("add-extra").append(addExtra.wrap)
    onSave($("provider-form"), async () => { await save((latest) => ({ ...latest, name: $("provider-name").value.trim() || "Azure GPT" })); status(t("saved")) })
    onSave($("add-form"), async () => {
      const key = $("add-key").value, accountName = $("account-name").value.trim()
      const settings = validated($("add-url").value.trim(), addExtra.value()), baseURL = settings.baseURL
      const random = crypto.getRandomValues(new Uint8Array(8)), id = "azure-gpt#" + [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      await save((latest) => ({ ...latest, name: $("provider-name").value.trim() || "Azure GPT", connections: { ...latest.connections, [id]: settings } }))
      const added = await api("POST", { newAccount: id, baseURL, key, accountName })
      $("add-key").value = ""; $("account-name").value = ""; await refresh()
      await waitForModels(added.account.id)
      status(t("added"))
    })
    $("refresh").onclick = (event) => busy(event.currentTarget, refresh)
    setMode(!!options.models)
    Object.entries(options.models || {}).forEach(([id, model]) => modelRow(id, model))
    $("searches").checked = options.searches === true
    $("discovery").onclick = () => setMode(false); $("manual").onclick = () => setMode(true)
    $("add-model").onclick = () => modelRow()
    onSave($("models-form"), async () => {
      const models = {}
      if (manual) for (const row of $("model-rows").children) { const [id, model] = row.model(); if (id in models) throw new Error(t("duplicateID")); models[id] = model }
      if (manual && !Object.keys(models).length) throw new Error(t("emptyModels"))
      await save((latest) => { const next = { ...latest, searches: $("searches").checked }; if (manual) next.models = models; else delete next.models; return next })
      status(t("saved"))
    })
    magpie.onAction((action) => { if (action.provider?.id && !/^azure-gpt(?:-plugin)?$/.test(action.provider.id)) status(t("scope"), true) })
    await refresh()
  }
  start().catch((error) => status(error.message, true))
})()
