# 0.2.0 source delivery — 2026-11-11

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

The plugin source is 0.2.0. The installed plugin remains 0.1.1, and the running
Magpie is unchanged. A JS-only update cannot provide the new recovery hook.
The host patch must be integrated into a Magpie build before on-error mode
can automatically retry. Replacing the gateway serving active conversations
requires a separate switch with a recovery route.

Tests and real model requests were not run in this iteration. Compilation
establishes build compatibility of the changed packages; stream/retry behavior
still needs the agreed runtime check before replacing the active gateway.
