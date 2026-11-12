export const DEFAULT_NAME = "Azure GPT"

export function baseURL(value) {
  let url
  try { url = new URL(value) } catch { throw new Error("Enter a valid Responses API base URL, including its API path.") }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query parameters or a fragment.")
  }
  return url.href.replace(/\/+$/, "")
}

export function connection(options, auth, account = "azure-gpt") {
  const own = options.connections?.[account] ?? {}
  const base = baseURL(own.baseURL || options.baseURL || auth?.metadata?.baseURL)
  const headers = new Headers(own.headers ?? options.headers ?? {})
  const authHeader = String(own.authHeader || options.authHeader || "authorization").toLowerCase()
  new Headers({ [authHeader]: "validate" })
  const apiVersion = String(own.apiVersion ?? options.apiVersion ?? "").trim()
  const modelsURL = own.modelsURL !== undefined ? own.modelsURL || base + "/models" : options.modelsURL || base + "/models"
  const listing = new URL(modelsURL)
  if (!["https:", "http:"].includes(listing.protocol) || listing.username || listing.password || listing.hash
    || listing.origin !== new URL(base).origin) throw new Error("The model list URL must use the same origin as the API base URL.")
  return { baseURL: base, modelsURL: versionedURL(listing.href, apiVersion), headers: Object.fromEntries(headers), authHeader, apiVersion }
}

export function versionedURL(value, version) {
  if (!version) return value
  const url = new URL(value)
  if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", version)
  return url.href
}

export function authenticatedHeaders(config, key, initial = config.headers) {
  const headers = new Headers(initial)
  headers.delete("authorization")
  headers.set(config.authHeader, config.authHeader === "authorization" ? "Bearer " + key : key)
  return headers
}
