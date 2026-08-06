# Raspberry Pi Zero 2 W runtime

Use Raspberry Pi OS Lite 64-bit, Node.js 22, and a dedicated `jmpbridge` user.
Install the bridge under `/opt/justify-my-printer/bridge`; keep configuration in
`/etc/justify-my-printer/bridge.env` (0640, root:jmpbridge) and data in
`/var/lib/justify-my-printer/bridge` (0750, jmpbridge:jmpbridge). The service
binds management HTTP to `127.0.0.1:43127`; USB Gadget networking is future-only
and must use the same API on an explicitly configured interface with a bearer
token. Never bind `0.0.0.0`.

Create directories, copy `.env.example`, set `BRIDGE_ID=home-bridge`, and verify
`node --version` is 22.x before installing `jmp-print-bridge.service` into
`/etc/systemd/system/`. Run `systemd-analyze verify`, then `systemctl daemon-reload`
and `systemctl enable --now jmp-print-bridge`. Check `journalctl -u
jmp-print-bridge` and `/v1/status` locally. Configure a DHCP reservation for the
Pi and disable Wi-Fi powersave; avoid AP/client isolation so the Pi can reach the
printer. Migration requires stopping the Windows bridge first and reconciling
checksums before enabling the Pi; never run both with the same bridge identity.
