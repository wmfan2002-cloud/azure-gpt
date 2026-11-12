import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// Magpie seeds its bundled models.dev catalog here on a fresh install and
// replaces it on sync. The plugin SDK does not expose that catalog directly.
// Read metadata only; no provider settings or credentials are needed.
export function createModelCatalog(directory, { env = process.env, home = homedir() } = {}) {
  const cache = path.isAbsolute(env.XDG_CACHE_HOME || "") ? env.XDG_CACHE_HOME : path.join(home, ".cache")
  const files = [...new Set([
    ...(directory ? [path.join(directory, "cache", "models.json")] : []), // portable Magpie
    path.join(cache, "magpie", "models.json"),
    path.join(home, ".cache", "opencode", "models.json"), // Magpie's fallback
  ])]
  const saved = new Map()
  return async () => {
    for (const file of files) {
      try {
        const info = await stat(file), stamp = `${info.mtimeMs}:${info.size}`
        const previous = saved.get(file)
        if (previous?.stamp === stamp) return previous.lookup
        try {
          const data = JSON.parse(await readFile(file, "utf8"))
          if (!data || typeof data !== "object" || Array.isArray(data) || !Object.values(data).some((p) => p?.models)) continue
          const lookup = indexCatalog(data)
          saved.set(file, { stamp, lookup })
          return lookup
        } catch {
          // Keep the last complete catalog if a sync is caught mid-write.
          if (previous) return previous.lookup
        }
      } catch {} // Missing cache: discovery still works with upstream metadata.
    }
    return () => ({})
  }
}

const bare = (id) => id.slice(id.lastIndexOf("/") + 1).toLowerCase()
const spelling = (id) => bare(id).replace(/[._ ]/g, "-")

function indexCatalog(data) {
  const exact = new Map(), normal = new Map()
  // Match the maker's GPT specifications before reseller catalog entries,
  // as Magpie does when borrowing reasoning levels for a custom provider.
  const preferred = ["openai", "azure", "azure-cognitive-services"]
  for (const pid of [...preferred, ...Object.keys(data).filter((id) => !preferred.includes(id)).sort()]) {
    for (const [key, row] of Object.entries(data[pid]?.models ?? {})) {
      if (!row || typeof row !== "object") continue
      for (const id of [row.id ?? key, row.canonical_model_id].filter((id) => typeof id === "string")) {
        if (!exact.has(bare(id))) exact.set(bare(id), row)
        if (!normal.has(spelling(id))) normal.set(spelling(id), row)
      }
    }
  }
  return (id) => {
    const match = (id) => exact.get(bare(id)) ?? normal.get(spelling(id))
    // Prefer an explicitly listed snapshot; otherwise inherit its base model.
    const row = match(id) ?? match(id.replace(/-\d{4}-\d{2}-\d{2}$/, ""))
    if (!row) return {}
    const modalities = (list) => Object.fromEntries(["text", "image", "audio", "video", "pdf"].map((kind) => [kind, list.includes(kind)]))
    return {
      ...(row.name ? { name: row.name } : {}),
      ...(row.family ? { family: row.family } : {}),
      ...(row.release_date ? { release_date: row.release_date } : {}),
      ...(typeof row.temperature === "boolean" ? { temperature: row.temperature } : {}),
      limit: { ...row.limit },
      capabilities: {
        ...(typeof row.reasoning === "boolean" ? { reasoning: row.reasoning } : {}),
        ...(typeof row.tool_call === "boolean" ? { toolcall: row.tool_call } : {}),
        ...(typeof row.attachment === "boolean" ? { attachment: row.attachment } : {}),
        ...(Array.isArray(row.modalities?.input) ? { input: modalities(row.modalities.input) } : {}),
        ...(Array.isArray(row.modalities?.output) ? { output: modalities(row.modalities.output) } : {}),
      },
      // Leave variants to Magpie: it resolves current maker/family levels,
      // aliases and Codex Ultra from this same catalog, without a fixed list.
    }
  }
}
