# Windows bridge desktop pilot

Hebrew RTL Electron shell for the separately owned portable bridge daemon. It has no bridge-runtime imports: every status, queue, library, lifecycle and diagnostics action goes through the fixed loopback management API on `127.0.0.1:43127`.

## Security boundary

The renderer has no Node access and receives only the narrow preload API. Electron main generates a new bearer capability for each daemon launch and sends it over the child stdin payload, never a command line, URL, log, diagnostic output, or renderer value. Stored launch settings are encrypted with `safeStorage` (Windows DPAPI); setup is blocked when unavailable. The selected daemon executable must implement this restricted stdin startup handshake.

The setup screen submits the user-entered site secret once to Electron main; it is never returned to the renderer, and is stored encrypted before the daemon receives it through stdin. A later printer-specific configuration flow must keep the same Electron-main-only secure file/pipe handoff; this application does not add an unauthenticated daemon configuration endpoint.

## Windows pilot

Install per user through the generated NSIS package: no elevation, no system service. The installer intentionally preserves Electron user data and the separately configured print library on upgrade/uninstall. Verify the packaged installer SHA-256 from the release manifest, then test installation, login launch, tray persistence, 100–200% scaling, Hebrew keyboard flow, and uninstall preservation on Windows 11 x64.

### Current installer limitation

`dist:win` packages the Electron controller only. It does **not** bundle, install,
or provision the bridge daemon executable. The user must select a separately
supplied daemon executable during setup. Therefore this pilot must not be called
installer-complete, or offered as a Windows runtime installer, until a reviewed
daemon artifact and an explicit provisioning step exist.

### Frozen local import contract

The controller streams the selected file directly to `POST
http://127.0.0.1:43127/v1/library/import`. It sends an authenticated Bearer
capability, `Content-Type: application/octet-stream`, an exact byte
`Content-Length`, and `X-File-Name`. `X-File-Name` is the UTF-8 basename only,
encoded with RFC 4648 base64url without padding (`Buffer.from(basename,
'utf8').toString('base64url')`). The daemon must reject missing, malformed, or
path-bearing values; it must never treat this header as a filesystem path.
