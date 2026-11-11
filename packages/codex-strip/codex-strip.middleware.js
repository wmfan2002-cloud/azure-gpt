// @magpie-community/middleware-codex-strip
//
// Azure OpenAI's Responses API keeps an answer's state on the resource that
// made it. An input item's `id` (`msg_…`, `rs_…`, `fc_…`) names an item on
// that resource, and the `encrypted_content` a reasoning item carries was
// sealed by it. A relay that spreads one conversation's turns over several
// Azure resources (one-api and its kin, no session affinity) has every
// later turn refused by whichever resource didn't make what it holds:
//
//   The requested item was created under a different Azure OpenAI resource.
//   Use the same resource that created the item to access it.
//   The encrypted content for item rs_… could not be verified.
//
// This middleware removes replayed reasoning and portable item ids on the
// selected providers. Readable reasoning becomes an ordinary history note;
// messages, tools, call_id pairs, headers and response streams are preserved.
// Native compaction is kept intact: its ciphertext may be the only copy of
// earlier context. Only its original resource can read that checkpoint.
//
// Only the providers named in its options are changed. `onProvider` runs
// once for each provider a request is tried on, and every try starts from
// the body the agent sent, so a provider not named here — a group's other
// member, a fallback, OpenAI's own API — gets the request as it came,
// whichever of them answered first.
//
//   {"providers": ["azure-relay"], "aliases": {}}
//
// `providers` are provider ids (as magpie's `provider/<id>` and a provider
// row show them, not the display name): the id a direct request names, or
// the id of a member a group or fallback is tried on. A request through a
// group is changed on the tries of the members named here, and on no other
// member's. Without them the plugin changes nothing.
//
// Options, all but `providers` optional:
//
//   ids              true     each input item's `id` goes, on the kinds that
//                             carry their own contents; `"all"` includes
//                             unknown kinds, `false` keeps ids. Compaction
//                             checkpoints are always preserved
//   keepIds          []       ids retained on these surviving item types
//   encrypted        true     remove reasoning, keeping readable text as
//                             notes; strip other encrypted fields/parts.
//                             Compaction checkpoints are always preserved
//   itemReferences   "drop"   an `item_reference` holds nothing but an id
//                             on the resource, so it goes ("keep" sends it)
//   store            "off"    sends `store: false`, so neither the relay nor
//                             magpie holds an answer to hand a later turn
//                             only the new input under its id ("keep" leaves
//                             the field as the agent sent it)
//   previousResponse false    a top-level `previous_response_id` stays
//                             ("drop" removes it, sending only the new
//                             turn: see below before turning it on)
//   historySearch    "note"   past web_search_call records become text when
//                             encrypted reasoning is removed; "keep" opts
//                             out. With encrypted:false, defaults to "keep"
//   aliases          {}       a provider renamed: {"old-id": "new-id"}
//
// `store` is off by default because it is what makes the rest hold. A
// provider magpie takes for Azure or OpenAI keeps responses itself
// (prevKeeps), and magpie then sends its later turns as the new input alone
// under the id it keeps them by (prevDelta) — the state this plugin exists
// to leave out, added after this hook runs. `store: false` stops that, and
// a relay has nothing to keep either way. Codex sends `store: false` on
// every turn already, so for Codex the field changes nothing.
//
// `previousResponse` is false by default on purpose. magpie deletes the field
// itself once it holds the response and hands the conversation over whole
// (internal/gateway/prev_response.go), so one still there here is a
// response magpie does not hold: a client that sent only its new turn would
// lose everything before it, and a provider that keeps responses would be
// asked to continue from an id it never made. `"drop"` sends such a client's
// new turn alone; for Codex there is nothing there to remove, since it
// replays the whole conversation every turn over HTTP and names none.
//
// Magpie expands its own text compaction before onProvider. An opaque
// compaction still present here must stay whole, even with ids:"all".
// A warning explains how to recover; onProvider cannot reject a request.
//
// The plugin runs in magpie's gateway on moejs, so it is one file and
// imports nothing. A hook that throws or runs past its 250 ms leaves the
// request as it came.
//
// Ported from codex-strip-proxy (AnnaofArendelle), which does the same in
// front of a relay by rewriting base_url.

const compactions = new Set(["compaction", "compaction_summary"])

// portable are the input items whose id may go: the ones that carry their
// own contents, so the id beside them is only a name on the resource.
// Reasoning is handled separately when encrypted state is removed;
// compaction checkpoints are always preserved. Other kinds may need an id
// (another resource's tool item, a search call), so its id stays unless
// the options ask for `ids: "all"`. The content-bearing list is
// codex-history's (packages/codex-history), which took it from Codex
// Filter Manager: a type wrongly taken out of it would send an item
// nobody can find, and one left in costs only an id.
const portable = new Set(["message", "agent_message", "function_call", "function_call_output",
  "custom_tool_call", "custom_tool_call_output", "tool_search_call", "tool_search_output",
  "additional_tools", "reasoning"])

export function onProvider(body, ctx) {
  if (!isObject(body)) return
  // Responses only: an Azure resource scopes nothing in a Chat or Messages
  // request, and magpie translates those itself
  if (ctx.protocol !== "responses") return
  const provider = ctx.provider
  if (!provider || typeof provider.id !== "string" || provider.id === "") return
  const options = isObject(ctx.options) ? ctx.options : {}
  if (!actsOn(provider.id, options)) return
  const counts = strip(body, options)
  if (counts.compactions) {
    console.warn("codex-strip: " + provider.id + " preserved " + counts.compactions
      + " native compaction checkpoint(s). Resume on the Azure resource that created them,"
      + " or restore the original history and make a text summary; deleting them loses context.")
  }
  if (!counts.changed) return
  // magpie's log, at most 60 lines a minute per middleware
  console.log("codex-strip: " + provider.id + " (" + (provider.model || "?") + ") " + said(counts))
  return body
}

// portableID says whether an id on an item of this type may go: the kinds
// in portable, and a message written without a type, which is a role and
// its content. `ids: "all"` takes every kind's, `ids: false` none.
//
// An item's `include` is never touched: it asks for reasoning in the
// REPLY, not for the history's ciphertext, and some upstreams turn a Codex
// request away over a changed include (codex-history's note, kept here).
function portableID(type, role, content, options) {
  if (options.ids === false) return false
  if (options.ids === "all") return true
  if (typeof type === "string" && type !== "") return portable.has(type)
  return typeof role === "string" && role !== "" && content !== undefined
}

// actsOn says whether provider id is one the options name, through as many
// renames as `aliases` records.
function actsOn(id, options) {
  const names = named(options)
  if (!names.length) return false
  const aliases = isObject(options.aliases) ? options.aliases : {}
  const seen = new Set([id])
  let at = id
  for (let i = 0; i < 16; i++) {
    const next = aliases[at]
    if (typeof next !== "string" || next === "" || seen.has(next)) break
    seen.add(next)
    at = next
  }
  for (const name of names) if (seen.has(name)) return true
  return false
}

// named is the providers the options name: a list, one string, or an
// object of {"<id>": true}.
function named(options) {
  const p = options.providers
  if (typeof p === "string") return p.trim() ? [p.trim()] : []
  if (Array.isArray(p)) return p.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
  if (isObject(p)) return Object.keys(p).filter((k) => p[k])
  return []
}

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function has(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k)
}

// keepId says whether an item of this type keeps its id, by the types the
// options name.
function keepId(type, options) {
  const keep = options.keepIds
  if (typeof type !== "string" || type === "") return false
  if (typeof keep === "string") return keep === type
  if (Array.isArray(keep)) return keep.indexOf(type) >= 0
  if (isObject(keep)) return keep[type] === true
  return false
}

// strip leaves out of body what the resource that made it would have to
// read back, and says how much of each.
function strip(body, options) {
  const n = { ids: 0, encrypted: 0, parts: 0, refs: 0, sealed: 0, reasoning: 0,
    notes: 0, compactions: 0, search: 0, previous: 0, store: 0, changed: false }
  if (options.previousResponse === "drop" && has(body, "previous_response_id")) {
    delete body.previous_response_id
    n.previous = 1
  }
  if (options.store !== "keep" && body.store !== false) {
    body.store = false
    n.store = 1
  }
  if (Array.isArray(body.input)) {
    const kept = []
    for (const item of body.input) {
      if (!isObject(item)) {
        kept.push(item)
        continue
      }
      // A checkpoint is not disposable reasoning. Preserve the entire item,
      // including its id, even if it also has a readable field: that field
      // does not establish that the encrypted history can be reconstructed.
      if (compactions.has(item.type)) {
        if (options.encrypted !== false && Object.keys(item).some((k) =>
          k.toLowerCase().indexOf("encrypted") === 0 && item[k] != null && item[k] !== "")) {
          n.compactions++
        }
        kept.push(item)
        continue
      }
      // an item that is only a pointer to an item on the resource
      if (item.type === "item_reference" && options.itemReferences !== "keep") {
        n.refs++
        continue
      }
      // Removing only id/encrypted_content leaves an invalid or unresolvable
      // reasoning shell on relays Magpie does not recognize as Azure.
      if (item.type === "reasoning" && options.encrypted !== false) {
        const note = reasoningAsNote(item)
        n.reasoning++
        if (note) {
          kept.push(note)
          n.notes++
        }
        continue
      }
      // a seal nothing readable is left beside: the item goes with it
      if (stripItem(item, options, n)) {
        n.sealed++
        continue
      }
      // A native search may require the reasoning item just removed above.
      // Carry its recorded action and sources as text, without a resource id.
      const noteSearch = options.historySearch === "note"
        || (options.historySearch === undefined && options.encrypted !== false)
      if (item.type === "web_search_call" && noteSearch) {
        kept.push(searchAsNote(item, n))
        continue
      }
      kept.push(item)
    }
    if (n.refs + n.sealed + n.reasoning + n.search > 0) body.input = kept
  }
  n.changed = n.ids + n.encrypted + n.parts + n.refs + n.sealed + n.reasoning + n.search + n.previous + n.store > 0
  return n
}

// Only recorded text becomes a note. Never stringify a reasoning item: it
// can contain ciphertext or resource identifiers beside its readable text.
function reasoningAsNote(item) {
  const texts = []
  for (const field of [item.summary, item.content]) {
    if (typeof field === "string" && field.trim() !== "") {
      texts.push(field)
    } else if (Array.isArray(field)) {
      for (const part of field) {
        if (isObject(part) && ["summary_text", "reasoning_text", "text", "input_text", "output_text"].indexOf(part.type) >= 0
          && typeof part.text === "string" && part.text.trim() !== "") texts.push(part.text)
      }
    }
  }
  if (!texts.length) return null
  return { type: "message", role: "assistant", content: [{ type: "output_text",
    text: "[Reasoning recorded in an earlier turn]\n" + texts.join("\n\n") }] }
}

// searchAsNote is a historical web_search_call as an assistant message that
// says what it was, the item's own recorded fields kept as text: the query,
// the status and the sources, never a reconstructed result.
function searchAsNote(item, n) {
  n.search++
  const record = {}
  for (const k of Object.keys(item)) {
    if (k === "id" || k === "type" || k.toLowerCase().indexOf("encrypted") === 0) continue
    record[k] = item[k]
  }
  return { type: "message", role: "assistant", content: [{ type: "output_text",
    text: "[A web search run in an earlier turn; recorded data only, not a new tool call. "
      + "Its result is not reconstructed; what it found follows in the conversation.]\n"
      + JSON.stringify(record) }] }
}

// stripItem leaves out of one input item its id and its sealed fields, and
// says whether a message whose only content was sealed is now empty.
// Reasoning and compaction are handled before this function is called.
function stripItem(item, options, n) {
  if (has(item, "id") && portableID(item.type, item.role, item.content, options) && !keepId(item.type, options)) {
    delete item.id
    n.ids++
  }
  if (options.encrypted !== false) {
    for (const k of Object.keys(item)) {
      if (k.toLowerCase().indexOf("encrypted") === 0) {
        delete item[k]
        n.encrypted++
      }
    }
    if (Array.isArray(item.content)) {
      // a message between agents seals its words as a content part of its
      // own, with nothing readable beside it
      const was = item.content.length
      const parts = []
      let gone = 0
      for (const part of item.content) {
        if (!isObject(part)) {
          parts.push(part)
          continue
        }
        if (part.type === "encrypted_content") {
          gone++
          continue
        }
        for (const k of Object.keys(part)) {
          if (k.toLowerCase().indexOf("encrypted") === 0) {
            delete part[k]
            n.encrypted++
          }
        }
        parts.push(part)
      }
      if (gone > 0) n.parts += gone
      item.content = parts
      // no API takes a message that says nothing
      if (was > 0 && parts.length === 0) return true
    }
  }
  return false
}

// said is the counts as one line.
function said(n) {
  const out = []
  const plural = (c, one, many) => c + " " + (c === 1 ? one : many)
  if (n.ids) out.push(plural(n.ids, "id", "ids"))
  if (n.encrypted) out.push(plural(n.encrypted, "encrypted field", "encrypted fields"))
  if (n.parts) out.push(plural(n.parts, "sealed part", "sealed parts"))
  if (n.refs) out.push(plural(n.refs, "item reference", "item references"))
  if (n.sealed) out.push(plural(n.sealed, "sealed item", "sealed items"))
  if (n.reasoning) out.push(plural(n.reasoning, "reasoning item", "reasoning items") + " removed")
  if (n.notes) out.push(plural(n.notes, "reasoning note", "reasoning notes") + " kept")
  if (n.search) out.push(plural(n.search, "past search", "past searches") + " as text")
  if (n.previous) out.push("previous_response_id")
  if (n.store) out.push("store off")
  return out.join(", ")
}
