# 0.3.0 recovery transport

The root package uses Magpie's existing provider-plugin API:
`auth.loader → {baseURL, apiKey, headers, fetch}`. Models declare
`@ai-sdk/openai`, which Magpie sends over native Responses. No application
patch is loaded or applied.

## Normal calls keep their request and output

The first fetch receives the original URL, method, headers, body and signal.
Recovery is considered only for POST `/responses` and `/responses/compact`.
Other endpoints pass straight through. The plugin neither lowers reasoning
effort nor modifies tools, token limits, model, `include` or storage settings
on normal requests.

For streaming success, only pre-output lifecycle events are held. Once an
output item, reasoning, tool activity, an unknown event, or the 64 KiB prefix
limit is reached, all original bytes are released in order and subsequent
chunks stream normally. Canceling the returned stream cancels its upstream
reader. There is no retry after output starts, including buffered output.

## Error recognition

HTTP error bodies and structured pre-output SSE errors are matched against
specific Azure resource and decryption failures. A successful answer that
quotes those words is not an error. Authentication, quota, timeout, generic
server and safety failures do not trigger history repair.

Resource errors are also recognized when a relay masks Azure as `***`, as
in `created under a different *** OpenAI resource`. AgentRouter requires
`originator: codex_cli_rs`; the provider supplies it for that host on both
model discovery and transport, with configured headers taking precedence.

The plugin handles HTTP 200 containing `response.failed` as well as ordinary
HTTP validation errors. Error inspection is bounded to 32 KiB. Oversized or
unrecognized replies pass through rather than being guessed at.

## Repair is local to one fetch invocation

The original request is parsed only after a recognized rejection. Repair
reuses the existing history rules:

- A named rejected reasoning item is removed; its readable summary/content
  becomes an assistant history note. Other reasoning items remain.
- A named foreign portable message/call loses only its resource-scoped ID.
- Without an item identity, the retry clears replayed reasoning and portable
  IDs, keeping text, tool arguments/results and `call_id` pairs in order.
- Native search records become text when their required reasoning is removed.
- Opaque compaction, unresolved `previous_response_id`, `item_reference`, and
  encrypted-only messages stop repair instead of discarding history.

The repaired fetch uses the same URL, account, model and request settings,
with a recalculated body length. The failed response is closed before retry.
The caller's cancellation signal remains in force. There is no second repair
inside that invocation and no history/failure cache affecting later calls.

Magpie and the client own their outer retries, route changes and compaction
attempts. Those may call the transport again; the old host patch's shared
gateway/compaction retry counter is not part of this provider API. The plugin
records its recovery attempts explicitly and never claims a per-conversation
or gateway-wide retry limit.

## Stop without activating Magpie's broader cleanup

Official Magpie has its own decryption fallback, which can remember rejected
seals and remove a compaction checkpoint on a later attempt. When this plugin
cannot safely repair history, or its repair receives another recognized
history rejection, it returns an explicit JSON error:

- `azure_gpt_history_unavailable`: history/reference cannot be safely rebuilt.
- `azure_gpt_recovery_failed`: the single repaired attempt was rejected again.

These responses preserve an HTTP error status (or use 400 for an SSE failure)
and record the actual upstream status in `error.upstream_status`. Their clear
recovery message replaces the raw decryption wording, so the host does not
interpret the plugin's terminal decision as a request for broader cleanup.
Unrelated upstream failures retain their original responses.

Logs contain the error category and repair counts, never API keys, headers,
request bodies or model-generated reasoning. The original local conversation
is not edited. A repaired attempt cannot retain the unreadable encrypted
state it removes; upstream resource affinity is what preserves that state.

## Historical entry points

`packages/codex-strip` retains the 0.2.0 middleware and its explicit
`mode: "always"` compatibility path. The new root entry point imports its
repair function but does not register its cleanup hooks. Old installations
should disable that middleware before selecting the new provider.
