import { onProviderError } from "../codex-strip/codex-strip.middleware.js"

const PREFIX_LIMIT = 64 * 1024
const ERROR_LIMIT = 32 * 1024
const decoder = new TextDecoder()

// Called by Magpie's existing provider transport. Every invocation starts
// with the original body; no session, failure or cleaned-history cache exists.
export function createRecoveryFetch(fetchUpstream, { enabled = () => true, log = () => {} } = {}) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    const method = (init.method || input?.method || "GET").toUpperCase()
    const eligible = enabled() && method === "POST" && /\/responses(?:\/compact)?\/?$/.test(url.pathname)
    const first = await fetchUpstream(input, init)
    if (!eligible) return first
    const observed = await inspectResponse(first)
    if (!observed.failure) return observed.response
    if (init.signal?.aborted) {
      await observed.discard()
      init.signal.throwIfAborted()
    }

    let body
    try {
      const raw = typeof init.body === "string" ? init.body
        : ArrayBuffer.isView(init.body) ? decoder.decode(init.body)
          : init.body instanceof ArrayBuffer ? decoder.decode(init.body) : ""
      body = JSON.parse(raw)
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Not a request object")
    } catch {
      await observed.discard()
      return terminalError(first, "azure_gpt_history_unavailable", "The rejected request body cannot be safely replayed. Its history was preserved.")
    }
    const decision = onProviderError(body, {
      protocol: "responses",
      provider: { id: "azure-gpt", model: body.model },
      options: { providers: ["azure-gpt"], mode: "on-error" },
      failure: observed.failure,
    })
    await observed.discard()
    if (decision?.action !== "retry") {
      log("warn", "History recovery stopped: protected checkpoint/reference or no safe repair.")
      return terminalError(first, "azure_gpt_history_unavailable",
        "This history needs its original Azure resource or the complete earlier messages. No history was dropped and no repair retry was sent.")
    }

    init.signal?.throwIfAborted()
    const headers = new Headers(init.headers ?? input?.headers)
    headers.delete("content-length")
    log("info", `Repairing one rejected request (${observed.failure.kind}); model and reasoning settings retained.`)
    const second = await fetchUpstream(input, { ...init, headers, body: JSON.stringify(decision.body) })
    const retried = await inspectResponse(second)
    if (!retried.failure) return retried.response
    await retried.discard()
    log("warn", "The repair retry was rejected. No second repair was attempted.")
    return terminalError(second, "azure_gpt_recovery_failed",
      "Azure rejected the history after one repair attempt. Resume on its original resource or restore the full conversation history.")
  }
}

// Match only error objects/HTTP error bodies, never successful model text.
function failureOf(error, status) {
  if ([401, 403, 408, 429, 504].includes(status)) return null
  const text = typeof error === "string" ? error : JSON.stringify(error)
  if (!text || text.length > ERROR_LIMIT) return null
  const lower = text.toLowerCase()
  let kind
  // Relays may redact Azure to "***" while retaining the resource error.
  if (lower.includes("created under a different") && lower.includes("openai resource")) kind = "foreign_resource"
  else if (lower.includes("invalid_encrypted_content")
    || lower.includes("encrypted content could not be decrypted or parsed")
    || (lower.includes("encrypted content") && lower.includes("could not be verified"))
    || (lower.includes("could not decrypt") && lower.includes("encrypted_content"))
    || lower.includes("invalid encrypted summary")) kind = "invalid_encrypted_content"
  if (!kind) return null
  return { kind, status: status >= 400 ? status : 400, attempt: 1, outputStarted: false,
    itemID: text.match(/\b(?:rs|msg|fc|ctc|ws|cmp)_[A-Za-z0-9_-]{1,160}\b/)?.[0] ?? "" }
}

function hasOutput(value) {
  return Array.isArray(value?.output) && value.output.length > 0
}

// Prefix-only inspection: release the original bytes as soon as any output
// item, reasoning, tool activity, unknown event, or the size bound is reached.
async function inspectResponse(response) {
  if (!response.body || [401, 403, 408, 429, 504].includes(response.status)) return { response }
  const type = response.headers.get("content-type")?.toLowerCase() ?? ""
  const sse = response.ok && type.includes("text/event-stream")
  const json = response.ok && (type.includes("application/json") || type.includes("+json"))
  if (response.ok && !sse && !json) return { response }
  const reader = response.body.getReader()
  const chunks = []
  const textDecoder = new TextDecoder()
  let text = ""
  let bytes = 0
  let done = false
  const parser = sse ? new EventPrefix() : null
  const discard = async () => {
    try { if (!done) await reader.cancel() } catch {} finally { reader.releaseLock() }
  }
  try {
    while (true) {
      const next = await reader.read()
      done = next.done
      if (!done) {
        chunks.push(next.value)
        bytes += next.value.byteLength
        // Do not decode a giant incoming chunk into another giant string.
        // Replay it as received once the inspection budget is exceeded.
        if (bytes > (sse ? PREFIX_LIMIT : ERROR_LIMIT)) break
      }
      const part = done ? textDecoder.decode() : textDecoder.decode(next.value, { stream: true })
      if (sse) {
        const event = parser.push(part, done)
        if (event?.failure) return { failure: event.failure, discard }
        if (event?.started || bytes >= PREFIX_LIMIT || done) break
      } else {
        text += part
        if (bytes > ERROR_LIMIT) break
        if (done) {
          let error
          try {
            const value = JSON.parse(text)
            // A completed success that quotes an error is still a success.
            if (!response.ok) error = value.error ?? value
            else if (!hasOutput(value) && !hasOutput(value.response)) {
              if (value.type === "response.failed" || value.status === "failed") error = value.error ?? value.response?.error
              else if (value.error && !value.output) error = value.error
            }
          } catch { if (!response.ok) error = text }
          const failure = failureOf(error, response.status)
          if (failure) return { failure, discard }
          break
        }
      }
    }
  } catch (error) {
    await discard()
    throw error
  }
  return { response: replayPrefix(response, reader, chunks, done) }
}

// SSE lines can be split anywhere, including between CR and LF. Only the
// standard pre-output lifecycle events are safe to hold for error recovery.
class EventPrefix {
  pending = ""
  event = ""
  data = []

  push(text, eof) {
    this.pending += text
    while (true) {
      const at = this.pending.search(/[\r\n]/)
      if (at < 0 || (!eof && at === this.pending.length - 1 && this.pending[at] === "\r")) break
      const line = this.pending.slice(0, at)
      const width = this.pending[at] === "\r" && this.pending[at + 1] === "\n" ? 2 : 1
      this.pending = this.pending.slice(at + width)
      const result = this.line(line)
      if (result) return result
    }
    if (eof) {
      if (this.pending) this.line(this.pending)
      this.pending = ""
      return this.dispatch()
    }
    return null
  }

  line(line) {
    if (!line) return this.dispatch()
    if (line.startsWith(":")) return null
    const colon = line.indexOf(":")
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "")
    if (field === "event") this.event = value
    if (field === "data") this.data.push(value)
    return null
  }

  dispatch() {
    const event = this.event
    const raw = this.data.join("\n")
    this.event = ""
    this.data = []
    if (!raw) return null
    if (raw === "[DONE]") return { started: true }
    let value
    try { value = JSON.parse(raw) } catch {
      const failure = event === "error" ? failureOf(raw, 400) : null
      return failure ? { failure } : { started: true }
    }
    if (hasOutput(value) || hasOutput(value.response)) return { started: true }
    const kind = value.type ?? event
    if (["error", "response.failed"].includes(kind)) {
      const status = Number(value.status_code ?? value.response?.status_code ?? value.error?.status ?? 400)
      const failure = failureOf(value.error ?? value.response?.error ?? value, status)
      return failure ? { failure } : { started: true }
    }
    if (["response.created", "response.in_progress", "ping", "keepalive"].includes(kind)) return null
    return { started: true }
  }
}

function replayPrefix(response, reader, chunks, done) {
  let index = 0
  let released = false
  const release = () => { if (!released) { reader.releaseLock(); released = true } }
  return new Response(new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) { controller.enqueue(chunks[index++]); return }
      if (done) { release(); controller.close(); return }
      try {
        const next = await reader.read()
        if (next.done) { done = true; release(); controller.close() }
        else controller.enqueue(next.value)
      } catch (error) { release(); controller.error(error) }
    },
    async cancel(reason) {
      try { if (!done) await reader.cancel(reason) } finally { release() }
    },
  }), { status: response.status, statusText: response.statusText, headers: response.headers })
}

// Stock Magpie learns to remove rejected seals when it sees the upstream's
// decryption wording. Once this plugin has stopped, expose a specific terminal
// history error instead, so the host does not start a broader lossy cleanup.
function terminalError(upstream, code, message) {
  const headers = new Headers(upstream.headers)
  for (const key of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(key)
  headers.set("content-type", "application/json")
  return new Response(JSON.stringify({ error: { type: "invalid_request_error", code, message,
    upstream_status: upstream.status } }), { status: upstream.status >= 400 ? upstream.status : 400, headers })
}
