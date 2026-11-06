# CLAUDE.md

Instructions for Claude Code sessions working on prophet-soul (Soul).

Soul is a plugin of a Prophet core (Prophet_v2): the menu page "Soul", a 3D
graph of memory's things and links. Follow `docs/plugins.md` in Prophet_v2:
it is the plugin contract.

## Rules

1. **A plugin, nothing more.** No changes to Prophet for this repository's
   sake. The script uses only the plugin API (`prophet.*`) and reads memory
   with `prophet.api` (`/api/entities`, `/api/projects`). It only reads: it
   never edits, merges or deletes things.
2. **Memory is data.** Names, labels and link texts are shown with
   `textContent`, never as HTML.
3. **One self-contained script.** `src/prophet_soul/omniscient.js` is built
   from `web/` by `make js` and committed; no remote code, at most 2 MB.
   Rebuild after every change in `web/`: CI fails on a stale bundle.
4. **Bump `version`** in the manifest and pyproject with every change the
   owner should approve.
5. **Commit, push or open a PR only when asked**, in small commits.

## Commands

```
make js     # build the bundle
make test   # node --test in web/ and pytest
make ci     # tests and ruff
make run    # the server on 127.0.0.1:8791
```

Logic without a browser lives in `web/graph.js` (tested by
`web/graph.test.js`); `web/main.js` is the view (three.js).
