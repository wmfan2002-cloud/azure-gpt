import { expect, test } from "bun:test"
import { createRecoveryFetch } from "./transport.js"

// Azure resource errors, including the wording returned by a redacting relay.
const foreign = "The requested item was created under a different Azure OpenAI resource. Use the same resource that created the item to access it."
const masked = "OpenAI Responses bad request: The requested item was created under a different *** OpenAI resource. Use the same resource that created the item to access it. [hub-]"
const endpoint = "https://relay.example/v1/responses"
const history = () => ({ model: "custom-deployment", stream: true, store: false,
  reasoning: { effort: "medium" }, service_tier: "priority", max_output_tokens: 8192,
  include: ["reasoning.encrypted_content"], tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
  input: [
    { type: "message", role: "user", content: "Continue the project" },
    { type: "reasoning", id: "rs_old", summary: [{ type: "summary_text", text: "Inspect the project" }], encrypted_content: "sealed-old" },
    { type: "function_call", id: "fc_old", call_id: "call_read", name: "read", arguments: '{"path":"README.md"}' },
    { type: "function_call_output", call_id: "call_read", output: "Project documentation" },
  ] })
const rejected = (message, status = 400) => Response.json({ error: { type: "invalid_request_error", message } }, { status })
const event = (type, value) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`
const stream = (text, width = 13) => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width))
  controller.close()
} }), { headers: { "content-type": "text/event-stream" } })

for (const url of [endpoint, "https://resource.openai.azure.com/openai/v1/responses", "https://relay.example/proxy/api/v1/responses"]) {
  for (const [name, message] of [["Azure", foreign], ["relay-masked Azure", masked],
    ["encrypted reasoning", "Encrypted content could not be decrypted or parsed. invalid_encrypted_content"]]) {
    for (const format of ["http", "sse"]) {
      test(`${name} ${format} rejection at ${url} repairs history on the same transport once`, async () => {
        const original = history()
        const body = JSON.stringify(original)
        const calls = []
        const fetch = createRecoveryFetch(async (url, init) => {
          calls.push({ url, ...init })
          if (calls.length === 1) return format === "http" ? rejected(message)
            : stream(event("response.created", { response: { id: "resp_failed", output: [] } })
              + event("response.failed", { response: { status: "failed", output: [], error: { message } } }))
          const repaired = JSON.parse(init.body)
          expect(repaired.input.some((item) => item.type === "reasoning")).toBe(false)
          expect(repaired.input.some((item) => item.id === "fc_old")).toBe(false)
          expect(repaired.input.find((item) => item.type === "function_call").call_id).toBe("call_read")
          expect(repaired.input.find((item) => item.type === "function_call_output").output).toBe("Project documentation")
          expect(repaired.input.some((item) => item.content?.[0]?.text?.includes("Inspect the project"))).toBe(true)
          const { input: _before, ...settings } = original
          const { input: _after, ...retrySettings } = repaired
          expect(retrySettings).toEqual(settings)
          return Response.json({ status: "completed", output: [{ type: "message", content: "Resumed" }] })
        })
        const controller = new AbortController()
        const response = await fetch(url, { method: "POST", body, signal: controller.signal,
          headers: { authorization: "Bearer test-key", "content-length": String(body.length) } })
        expect(calls).toHaveLength(2)
        expect(response.status).toBe(200)
        expect((await response.json()).status).toBe("completed")
        expect(calls[0].body).toBe(body)
        expect(calls[1].url).toBe(url)
        expect(calls[1].signal).toBe(controller.signal)
        expect(new Headers(calls[1].headers).get("authorization")).toBe("Bearer test-key")
        expect(new Headers(calls[1].headers).has("content-length")).toBe(false)
        expect(original).toEqual(history())
      })
    }
  }
}

test("successful reasoning output streams unchanged even when a later event reports a resource error", async () => {
  const text = event("response.created", { response: { output: [] } })
    + event("response.output_item.added", { item: { type: "reasoning", id: "rs_new" } })
    + event("response.failed", { response: { error: { message: masked } } })
  let calls = 0
  const fetch = createRecoveryFetch(async () => { calls++; return stream(text, 1) })
  const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(history()) })
  expect(await response.text()).toBe(text)
  expect(calls).toBe(1)
})

test("authentication failures and successful answers quoting the error do not replay", async () => {
  for (const upstream of [() => rejected(masked, 401),
    () => Response.json({ status: "completed", output: [{ type: "message", content: masked }] })]) {
    let calls = 0
    const fetch = createRecoveryFetch(async () => { calls++; return upstream() })
    const response = await fetch(endpoint, { method: "POST", body: JSON.stringify(history()) })
    await response.text()
    expect(calls).toBe(1)
  }
})

test("protected compaction history stops with its checkpoint intact", async () => {
  const original = history()
  original.input.unshift({ type: "compaction", id: "cmp_old", encrypted_content: "only-record-of-earlier-work" })
  const body = JSON.stringify(original)
  const calls = []
  const fetch = createRecoveryFetch(async (_url, init) => { calls.push(init.body); return rejected(masked) })
  const response = await fetch(endpoint, { method: "POST", body })
  expect((await response.json()).error.code).toBe("azure_gpt_history_unavailable")
  expect(calls).toEqual([body])
  expect(original.input[0].encrypted_content).toBe("only-record-of-earlier-work")
})

test("a second history rejection ends recovery and the next invocation starts from original history", async () => {
  const original = JSON.stringify(history())
  const calls = []
  const fetch = createRecoveryFetch(async (_url, init) => { calls.push(init.body); return rejected(masked) })
  for (let i = 0; i < 2; i++) {
    const response = await fetch(endpoint, { method: "POST", body: original })
    expect((await response.json()).error.code).toBe("azure_gpt_recovery_failed")
  }
  expect(calls).toHaveLength(4)
  expect(calls[0]).toBe(original)
  expect(calls[2]).toBe(original)
})
