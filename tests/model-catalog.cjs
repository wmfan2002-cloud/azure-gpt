// Synthetic Magpie catalog: deliberately different levels and limits from
// the live catalog, proving the plugin borrows data rather than fixed values.
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const sparseIDs = ["gpt-5.6-sol", "gpt-6-astra", "gpt-6.1-sol", "gpt-4o", "unknown-deployment"]
const levels = { "gpt-5.6-sol": ["low", "high"], "gpt-6-astra": ["medium", "max"], "gpt-6.1-sol": ["low", "high", "max"] }

async function seedCatalog(temp) {
  const file = path.join(temp, "cache/magpie/models.json")
  const model = (id, name, efforts) => ({ id, name, family: "gpt-sol", reasoning: true, temperature: false, tool_call: true,
    release_date: "2026-09-01", limit: { context: 100000, input: 90000, output: 10000 },
    modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    ...(efforts ? { reasoning_options: [{ type: "effort", values: efforts }] } : {}) })
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ openai: { id: "openai", models: {
    "gpt-5.6-sol": model("gpt-5.6-sol", "GPT-5.6 Sol", levels["gpt-5.6-sol"]),
    "gpt-6-astra": { ...model("gpt-6-astra", "GPT-6 Astra", levels["gpt-6-astra"]), family: "gpt-astra" },
    "gpt-6.1-sol": { ...model("gpt-6.1-sol", "GPT-6.1 Sol"), release_date: "2026-09-29" },
    "gpt-6-sol": { ...model("gpt-6-sol", "GPT-6 Sol", levels["gpt-6.1-sol"]), release_date: "2026-09-22" },
    "gpt-4o": { id: "gpt-4o", name: "GPT-4o", reasoning: false },
  } } }))
  // Keep Magpie's startup seed/sync from replacing the synthetic fixture.
  await fs.utimes(file, new Date("2100-01-01"), new Date("2100-01-01"))
  await fs.writeFile(path.join(path.dirname(file), "labs.json"), "{}")
}

function assertMetadata(rows) {
  for (const [id, expected] of Object.entries(levels)) {
    const row = rows.find((row) => row.id === `azure-gpt/${id}`)
    assert(row, `ID-only discovery offers ${id}`)
    assert.equal(row.reasoning, true)
    assert.deepEqual(row.reasoning_levels.filter((level) => level !== "ultra"), expected, `${id} follows Magpie's maker/family reasoning levels`)
    assert.equal(row.context_window, 90000)
    assert.equal(row.max_output_tokens, 10000)
    assert.deepEqual(row.modalities.input, ["text", "image", "pdf"])
    assert(row.display_name.startsWith("GPT-"))
  }
  for (const id of ["gpt-4o", "unknown-deployment"]) {
    const row = rows.find((row) => row.id === `azure-gpt/${id}`)
    assert.equal(row.reasoning, false)
    assert.deepEqual(row.reasoning_levels, [])
  }
}

module.exports = { sparseIDs, levels, seedCatalog, assertMetadata }
