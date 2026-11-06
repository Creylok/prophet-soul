# Soul

A [Prophet](https://github.com/Creylok/Prophet_v2) plugin: the menu page
**Soul**, a memory visualisation. The things confirmed facts are about and the
links between them, as a 3D graph.

- **Sectors.** Things tied more to each other than to the rest form a sector
  with its own place in space. The sector list is on the left; keys 1–9 fly to
  a sector, 0 shows the whole graph.
- **Free flight.** Drag to rotate, right drag or Shift to pan, wheel to zoom.
  WASD or arrows fly, Q/E go down/up (by key position, in any keyboard layout).
- **Search** by name, other names and label (`/` focuses it). Enter flies to
  the first match.
- **Soft highlight.** Hovering a thing gently tints its links, the links of its
  neighbours half as much, the next ones half again, for as many steps as set
  in the settings. It fades in and out; the rest of the graph dims only a
  little.
- **Labels** never overlap each other, lit points or the panels: the selected,
  lit and found things are labelled first, then the nearest and most linked;
  far ones fade. How many labels show is a setting.
- Click a thing to see its label, other names, facts and links on the right.
  Double click or F flies to it; Esc clears.

The plugin reads memory in the owner's Omniscient through `prophet.api`
(`/api/entities`, `/api/projects`), so it has no scopes and no key. Links
appear in memory when they are switched on on the Memory page.

## Running

```
uv run prophet-soul                 # http://127.0.0.1:8791
uv run prophet-soul --omniscient http://127.0.0.1:8770,http://192.168.1.10:8770
```

Then in Omniscient: Settings → Plugins → Add plugin → `http://127.0.0.1:8791`,
check and approve, reload the page.

The server serves only the manifest and the script. `--omniscient` (or
`PROPHET_URL`, which a node sets) lists Omniscient's origins for CORS.

On a node (`~/.config/prophet-node/config.json`):

```json
"plugins": {
  "soul": {"command": "uvx", "args": ["--from", "git+https://github.com/<owner>/prophet-soul@v0.2.0", "prophet-soul"]}
}
```

## Development

The script for Omniscient is one file, `src/prophet_soul/omniscient.js`,
built from `web/` (three.js bundled in, nothing loaded from the network). It is
committed, and CI checks it matches `web/`.

```
make js     # build omniscient.js after changing web/
make test   # node --test (graph, sectors, highlight, labels) and pytest (server, manifest)
make ci     # tests and ruff
```
