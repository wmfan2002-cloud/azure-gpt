# Build and deployment — 2026-11-12

## 0.3.2 AgentRouter connection and recovery fix

The Linux installation runs official Magpie 0.1.3882 with plugin 0.3.1.
Its saved Azure GPT key matches the working `agent` channel's key. An
authenticated GET to `https://agentrouter.org/v1/models` returned HTTP 401
with `unauthorized_client_error`; the same request with the working channel's
`originator: codex_cli_rs` returned HTTP 200. Version 0.3.2 supplies that
header for AgentRouter discovery and transport, with explicit headers winning.

The three reported sessions used `agent/gpt-6.1-sol`. Their Magpie usage
records contain six cross-resource HTTP 400 failures each, including the
relay wording `created under a different *** OpenAI resource`. The transport
now recognizes that masked wording. These sessions contain encrypted
reasoning and no native compaction checkpoints.

The inspected upstream model list contains IDs only. `configs/agentrouter.json`
retains the working channel's two models, 512000 context, 128000 output,
reasoning levels, image input, priority tier and pricing. Without explicit
metadata the plugin host listed these sparse models with `reasoning: false`
and no limits or variants.

Verification on Linux:

- Before the code fix, the new provider/transport suite reported 6 passing
  and 6 failing tests, including the missing discovery header and masked
  HTTP/SSE recovery. After the fix, `bun test packages` passes all 43 tests,
  including the 30 legacy cases and the manual model metadata check.
- JavaScript parser checks and Git whitespace checks pass.
- An isolated official Magpie plugin host loaded the modified provider and
  successfully discovered the three upstream model IDs using the real account.
- An isolated official Magpie gateway using the manual configuration listed
  both models with the expected limits, reasoning levels and priority tier.
  Two real SSE turns on `azure-gpt/gpt-6.1-sol`, effort `low`, completed with
  `OK`. The second replayed the first response's encrypted reasoning; both
  outputs retained encrypted reasoning and both usage records reported 200.
  The two turns used 120 tokens total. No resource rejection occurred in
  those two live turns; recovery is covered by the literal-error fixtures.
- Temporary gateway processes and configuration directories were removed
  after the checks.

The source fix is prepared locally as 0.3.2. The running installation remains
0.3.1. The README gives the local installation steps, including disabling the
GitHub copy before loading the local path and applying the model configuration.

## 0.3.1 fresh-server sign-in fix

The user's server installation exposed a path the local preconfigured
installation did not exercise. Magpie's `keyAsked` recognizes any API method
with nonempty `prompts` and an `authorize` function as asking for its own key.
The 0.3.0 method asked only for the URL, so Magpie skipped its key field and
`apiKey` rejected the result as containing no key. The 0.3.1 method omits
`authorize` and uses the existing standard branch, which stores the key and
keeps the URL answers in account metadata.

The change was checked against the host's method classification, API-key
storage and GUI transition code. The provider JavaScript parser check passed.
No sign-in was automated, no model request or test suite was run. The fix is
prepared locally for the user to push and update on the server; the server's
successful login remains to be confirmed.

## 0.3.0 pure provider plugin

- The root package now registers the `azure-gpt` provider, using official
  Magpie's `auth.loader.fetch` and native Responses support. It does not load
  the 0.2.0 recovery middleware or apply a source patch.
- JavaScript parser checks passed for the provider and streaming transport.
- The original, unmodified Magpie 0.1.3721 executable from the pre-change
  backup loaded the new plugin successfully and listed both configured
  models: GPT-6 Astra and GPT-6.1 Sol, with the original 512000 context,
  128000 output limit, image input, low/medium/high/xhigh/max/ultra efforts,
  priority tier and pricing.
- The local snapshot is installed at
  `C:/Users/lenovo/.config/magpie/plugins/local/azure-gpt-0.3.0`.
  Its non-secret endpoint/model configuration is saved in
  `C:/Users/lenovo/.codex/tmp/azure-gpt-provider-20261111/provider-options.json`.
- The provider is awaiting its own API-key sign-in. A desktop launcher
  `C:/Users/lenovo/Desktop/连接 Azure 纯插件.cmd` opens Magpie's normal hidden-key
  prompt. No old channel's credential was extracted or copied through a shell.
- The running 0.2.0 setup is retained until the new provider is signed in and
  selected. Restoring the official executable then requires one restart;
  ordinary 0.3.0 plugin updates do not require a patched Magpie build.

No test suite, mock transport scenario or synthetic model request was run,
as requested. The evidence above establishes syntax, official-host loading
and model metadata, not runtime recovery of the new transport. The user's
previously failing conversations are the pending real-use check.

## Historical 0.2.0 delivery

## Completed checks

- JavaScript parser check (`node --check`) for the middleware.
- JSON parsing for both manifests, provenance and existing fixtures.
- Go 1.27.4 Windows/amd64 compilation of the changed Magpie packages:
  `go build -tags nogui ./internal/gwmw ./internal/middleware ./internal/gateway`.
- Go formatting and Git whitespace inspection. One `gofmt -w` write to
  `internal/gateway/codex_backend.go` was denied by the local file ACL;
  its remaining difference is a single-line `if` that compiles successfully.
  Run `gofmt` when applying the patch in a writable checkout.
- Exported recovery patch checked against the exact candidate source.

The source baseline is Magpie `5c02be05b87719baaa84d569cbc2930fa5943fdd`.
The isolated candidate and build logs are under
`C:/Users/lenovo/.codex/tmp/azure-gpt-recovery-20261111/` on the author's machine.

## Deployment status

The complete Windows/amd64 desktop executable also compiled successfully with
`production,comlauncher,packedassets`, including UI assets, Windows resources
and the console launcher. Its version is `0.1.3721-azure-recovery.1` and its
path is `magpie-build/dist/magpie.exe` under the build root above.

The patched host is now serving from the user's existing Magpie installation.
On 2026-11-11 at 18:09 Asia/Singapore, the live gateway reported
`0.1.3721-azure-recovery.1` (PID 50092). Plugin 0.2.0 is registered with
`providers: ["agent"]` and `mode: "on-error"`. The installed CLI successfully
loaded both `onProvider` and `onProviderError` without a loading error.
The live gateway reads plugin-registration changes on subsequent requests.

The prepared local 0.2.0 plugin, original executable backup, installation script,
idle-restart helper and rollback script are recorded in
`C:/Users/lenovo/.codex/tmp/azure-gpt-deploy-20261111-1725/RECOVERY.md`.
The user ran the installation script and manually restarted Magpie. The
host replacement, initially refused by Codex's execution policy, was performed
by that user-run script. The helper's plugin-registration step failed under
Windows PowerShell 5.1 because `File.Replace` received an empty backup path
when `$null` was bound. Supplying an actual backup path fixed it; executing the
repaired registration script succeeded without another Magpie restart.
`status.json` now records `active`. The automatic host-failure rollback path
was not exercised.

The original installer used UTF-8 without BOM. Windows PowerShell 5.1 parsed
its Chinese messages using the legacy encoding and reported syntax errors
before execution. The installer now uses UTF-8 BOM, and a desktop launcher
selects Windows PowerShell explicitly and leaves the result/error visible.

No test suite or synthetic model request was run. Installation, host health
and CLI hook loading are established; error-triggered recovery in the user's
previously failing conversations remains for the user's trial.
