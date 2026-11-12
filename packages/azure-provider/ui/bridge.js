// The public Magpie page-message protocol. The service page uses the same
// owning frame as its static launcher, so options remain scoped to this plugin.
(() => {
  let next = 0
  const pending = new Map()
  const listeners = []
  const actions = []
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    parent.postMessage({ magpie: 1, id, method, params }, "*")
  })
  const theme = (value) => {
    api.theme = value
    document.documentElement.lang = value.lang || "en"
    document.documentElement.dataset.theme = value.dark ? "dark" : "light"
    document.documentElement.style.colorScheme = value.dark ? "dark" : "light"
    for (const [key, text] of Object.entries(value.tokens || {})) document.documentElement.style.setProperty("--magpie-" + key, text)
    for (const listener of listeners) listener(value)
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.magpie !== 1) return
    const message = event.data
    if (message.event === "theme") { theme(message.data); return }
    if (message.event === "action") { for (const handler of actions) handler(message.data); return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.result)
  })
  const api = { theme: {}, options: { get: () => call("options.get"), set: (options) => call("options.set", { options }) },
    read: (name, params) => call("read", { name, params }), onTheme: (fn) => listeners.push(fn), onAction: (fn) => actions.push(fn) }
  api.ready = call("hello").then((value) => { theme(value); return value })
  window.magpie = api
})()
