# Local 3MF print files

This directory is the local source for sliced `.3mf` files. The files and the
real `manifest.json` are ignored by Git and are never uploaded to the server.
Only extracted print time, material amounts, and the resulting calculated price
are sent.

1. Export each plate from Bambu Studio as a sliced `*.gcode.3mf` file and put it here.
2. For terminal use, set `JMP_ADMIN_USERNAME` and `JMP_ADMIN_PASSWORD` in `.env.local`.
3. Run `npm run sync:prints` while the target server is running. A local `manifest.json` is created automatically and is never committed.

The same sync can be started from the management panel with **סנכרון קבצי הדפסה** during local development; it uses your active admin session and does not need credentials in `.env.local`. It is intentionally disabled in production.

Before configuring the manifest or server login, verify that the local files
contain sliced output with `npm run sync:prints -- --inspect`. In Bambu Studio,
use **Export plate sliced file**; saving the project after pressing Slice still
creates a project-only 3MF without total time or material weight.

Each imported product is a draft. Choose the filament in the management panel
before publishing; the server then calculates and stores the price.
