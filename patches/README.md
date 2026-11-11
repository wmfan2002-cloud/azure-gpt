# Historical Magpie provider-error recovery hook

**Version 0.3.0 uses the official provider-plugin transport and requires none
of these patches.** The following integration notes belong to 0.2.0 and
earlier middleware installations. New installations follow the root README.

## 0.2.0: apply the complete recovery patch

Use `magpie-provider-recovery.patch` against
[Magpie `5c02be05b87719baaa84d569cbc2930fa5943fdd`](https://github.com/yetone/magpie/tree/5c02be05b87719baaa84d569cbc2930fa5943fdd).
It adds `onProviderError` to the existing JS engine and a single pre-output
repair retry. It includes text-compaction integration and supersedes the
older patch below; do not apply both to the same checkout.

```sh
git apply --check ../azure-gpt/patches/magpie-provider-recovery.patch
git apply ../azure-gpt/patches/magpie-provider-recovery.patch
go build -tags nogui ./...
```

The host supplies fixed failure metadata, enforces cancellation and
`errors=pass`, refuses retries after output/reasoning/tool activity, and
limits repair to one attempt on the same provider/account/model. Repaired
history is local to that attempt. The host accepts changes only to input
and storage/reference fields. See [the contract](../ERROR_RECOVERY.md).

The plugin installer does not replace Magpie. Build/check the host separately
before switching a gateway used by active conversations. Exact local build
results are recorded in `BUILD-STATUS.md` alongside this document.

## 0.1.1: historical compaction-only patch

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
