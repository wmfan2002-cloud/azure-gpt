# Include agent-requested compaction in Magpie middleware

Use `magpie-compaction-middleware.patch` when building a Magpie version whose
`codexCompact` calls `s.serve` directly. That path handles a Codex
`compaction_trigger` when Magpie, rather than the native provider, makes the
summary. Without the patch, a plugin's `onProvider` never sees that request.

Base: [Magpie `60f0433d1b1d500a9939eced3dfe6c54232051af`](https://github.com/yetone/magpie/tree/60f0433d1b1d500a9939eced3dfe6c54232051af).
The local installed-version marker during review was `0.1.3493`; the patch
is tied to the source revision, not to an assumption about installed binaries.

## Apply in a writable Magpie source checkout

From the Magpie checkout, using the path to this repository:

```sh
git apply --check ../azure-gpt/patches/magpie-compaction-middleware.patch
git apply ../azure-gpt/patches/magpie-compaction-middleware.patch
```

Build Magpie using that checkout's normal build process. Apply it to an
isolated candidate before replacing an installation that serves active
conversations. Installing or updating `codex-strip` does not patch a running
Magpie binary.

## What changes

The patch extracts the existing JS middleware section into
`serveAgentMiddleware`. Normal agent turns use that same section unchanged;
`codexCompact` uses it for each summary attempt too. This gives compaction
the existing `onRequest`, provider-attempt, response and event hooks, along
with their current lifetime and error handling.

Provider selection remains in `onProvider`, so a route group's unnamed
members keep their original requests. A fresh middleware run is created for
each compaction attempt. No-plugin requests still call `s.serve` directly.

Summary requests do not reenter conversation recording, tool-loop guards,
previous-response expansion or asynchronous gateway hooks. Titles, routing
classifiers, search and vision helper requests keep their existing paths.

## Native checkpoints still need their original state

This patch connects Magpie's text-compaction requests. It does not change
the standalone native `/responses/compact` endpoint or decrypt Azure's
native checkpoints. If a checkpoint belongs to another resource, preserve
it and resume on its writer, or restore the original history and create a
text summary. The JS plugin logs this condition instead of dropping it.
