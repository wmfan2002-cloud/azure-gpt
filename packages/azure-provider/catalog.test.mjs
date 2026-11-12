import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createModelCatalog } from "./catalog.js"

test("metadata follows Magpie's catalog, portable paths, sync and fallback without guessing deployments", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "azure-catalog-"))
  const directory = path.join(temp, "portable"), cache = path.join(temp, "xdg")
  const portableFile = path.join(directory, "cache/models.json"), installedFile = path.join(cache, "magpie/models.json")
  const catalog = createModelCatalog(directory, { home: temp, env: { XDG_CACHE_HOME: cache } })
  try {
    expect((await catalog())("gpt-6.1-sol")).toEqual({})
    await mkdir(path.dirname(installedFile), { recursive: true })
    await writeFile(installedFile, JSON.stringify({ openai: { models: { "gpt-6.1-sol": {
      id: "gpt-6.1-sol", name: "GPT-6.1 Sol", reasoning: true, temperature: false, tool_call: true,
      modalities: { input: ["text", "image", "pdf"], output: ["text"] }, limit: { context: 100000, input: 90000, output: 10000 },
    }, "gpt-4o": { id: "gpt-4o", reasoning: false } } },
      azure: { models: { "gpt-6.1-sol": { id: "gpt-6.1-sol", reasoning: false, limit: { context: 50000 } } } } }))
    let find = await catalog()
    for (const id of ["gpt-6.1-sol", "openai/GPT-6.1-Sol", "GPT-6-1-Sol", "gpt-6.1-sol-2026-09-29"]) {
      expect(find(id).capabilities.reasoning).toBe(true)
      expect(find(id).limit.input).toBe(90000)
      expect(find(id).temperature).toBe(false)
      expect(find(id).capabilities.input.pdf).toBe(true)
      expect(find(id).variants).toBeUndefined() // Magpie resolves the levels.
    }
    expect(find("gpt-4o").capabilities.reasoning).toBe(false)
    expect(find("my-azure-deployment")).toEqual({})
    expect(await catalog()).toBe(find)
    await writeFile(installedFile, '{"unfinished":')
    expect(await catalog()).toBe(find)
    await writeFile(installedFile, JSON.stringify({ openai: { models: { "gpt-6.1-sol": { reasoning: true, limit: { context: 200000 } } } } }))
    expect((await catalog())("gpt-6.1-sol").limit.context).toBe(200000)
    await mkdir(path.dirname(portableFile), { recursive: true })
    await writeFile(portableFile, JSON.stringify({ openai: { models: { "gpt-6.1-sol": { reasoning: true, limit: { context: 300000 } } } } }))
    expect((await catalog())("gpt-6.1-sol").limit.context).toBe(300000)
    await rm(portableFile)
    expect((await catalog())("gpt-6.1-sol").limit.context).toBe(200000)
    const fallback = path.join(temp, ".cache/opencode/models.json")
    await mkdir(path.dirname(fallback), { recursive: true })
    await writeFile(fallback, JSON.stringify({ openai: { models: { "gpt-6.1-sol": { reasoning: true, limit: { context: 400000 } } } } }))
    await rm(installedFile)
    expect((await catalog())("gpt-6.1-sol").limit.context).toBe(400000)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
