# JustifyMyPrinter local print bridge

This bridge runs on a computer on the same home network as the Bambu Lab P2S.
It does not open an inbound port. Instead, it polls the JustifyMyPrinter server
for an owner-approved job, sends the sliced file to the printer over the LAN,
and reports each lifecycle event back to the site.

The approval gate is enforced by the server: a new job remains
`awaiting_approval` until the admin clicks **אשר ושלח למדפסת**. After a job ends,
the site deliberately leaves the printer marked busy until the owner clears the
bed and clicks **סמן מדפסת כפנויה**.

## Requirements

- Node.js 20 or newer on a laptop, mini-PC, or Raspberry Pi that stays on the
  same LAN as the printer.
- A sliced `.gcode.3mf` file exported from Bambu Studio. The bridge owns its
  bytes locally; the website receives only a checksum and derived estimates.
- The same strong `BRIDGE_SECRET` configured in both the bridge environment and
  the server environment. For production, add it to the Render service's
  environment variables and redeploy/restart the service.

## Printer settings

On the P2S screen, open **Settings → LAN Only** (the exact Network/LAN wording
may vary by firmware) and enable LAN-only/developer access. Record:

- the printer's LAN IP address for `PRINTER_IP`;
- the access code/PIN shown in the LAN-only screen for
  `PRINTER_ACCESS_CODE`;
- the device serial number from **Settings → Device/About** for
  `PRINTER_SERIAL`.

Keep the access code private. If the printer regenerates it, update the bridge
configuration before restarting the bridge. Bambu Lab documents LAN-only mode
as local client-to-printer communication authenticated with the code displayed
on the printer; the bridge must remain on a network that can reach the P2S.

## Install and configure

```bash
cd bridge
npm install
cp .env.example .env
```

Edit `bridge/.env`:

```dotenv
SITE_URL=https://your-app.onrender.com
BRIDGE_SECRET=use-the-same-long-random-value-as-render
BRIDGE_ID=home-p2s-bridge
STORAGE_DIR=/Users/you/JustifyMyPrinter-print-library
SIMULATE=false
PRINTER_IP=192.168.1.50
PRINTER_SERIAL=your-printer-serial
PRINTER_ACCESS_CODE=your-printer-access-code
```

Then run:

```bash
node --env-file=.env index.js
```

Leave the process running while jobs should be available. `BRIDGE_ID` and
`POLL_INTERVAL_MS` are optional. `PRINTER_PLATE_GCODE` defaults to
`Metadata/plate_1.gcode`, and `PRINTER_USE_AMS` defaults to `true`.

## Local file library

The process creates three directories under `STORAGE_DIR`: `incoming/`,
`library/`, and `quarantine/`. Drop only sliced Bambu `.gcode.3mf` files into
`incoming/`. The bridge waits for a stable file, enforces a 100MiB default
limit (override with `MAX_FILE_BYTES`), verifies sliced metadata including
`Metadata/plate_1.gcode`, extracts estimates, hashes it with SHA-256, and
atomically moves it to `library/<checksum>.gcode.3mf`. Duplicate and invalid
files move to `quarantine/` with a nearby explanation, so the bridge does not
delete print inputs automatically. Nothing is deleted automatically from
`library/`.

The bridge scans and syncs its complete inventory before it claims a plate, and
periodically afterward. If you remove a library file manually, the following
sync marks it unavailable and the server will not assign a checksum-based job
to this bridge. Legacy jobs that have only an old Cloudinary URL still download
directly to the bridge as a compatibility fallback.

## Service installation

For a Mac pilot, copy `com.justifymyprinter.bridge.plist` to
`~/Library/LaunchAgents/`, replace every absolute-path placeholder and the
Node path (`command -v node`), then run `launchctl bootstrap gui/$(id -u)
~/Library/LaunchAgents/com.justifymyprinter.bridge.plist`. Use `launchctl
bootout` to stop it. For a Pi/Mini-PC, copy `jmp-print-bridge.service` to
`/etc/systemd/system/`, replace its placeholders, then run `sudo systemctl
daemon-reload`, `sudo systemctl enable --now jmp-print-bridge`, and inspect it
with `journalctl -u jmp-print-bridge -f`.

Both templates start only this outbound polling process. They do not expose a
network listener or a route from Render into the home LAN. Stop it gracefully
with SIGTERM/SIGINT; it completes only the current API request and does not
delete print files.

## Safe simulation first

Simulation requires no printer and no installed bridge dependencies. Point it
at a development server that has the same secret and run:

```bash
SIMULATE=true node --env-file=.env index.js
```

Create and approve one test job in the admin dashboard. The timeline should
advance through claimed, uploading, printing, and done. The printer remains
busy afterward by design; clear it manually in the dashboard.

## Current hardware status and troubleshooting

The simulation path is verified, but the real P2S FTPS/MQTT path has not yet
been tested against the owner's physical printer. It currently uploads over
implicit FTPS on port 990 and starts/monitors the project over MQTT TLS on port
8883. Printer firmware or the selected plate/AMS mapping may require adjustment.

When an upload, MQTT connection, or printer command fails, the bridge reports
the job as `failed`. The error and the events remain visible in the site's job
timeline so the owner can diagnose the exact stage. Check that:

- the bridge computer and printer can reach each other on the LAN;
- the IP, serial, and access code are current;
- the uploaded file is a sliced `.gcode.3mf` compatible with the P2S;
- local firewall or network isolation is not blocking ports 990 and 8883.
