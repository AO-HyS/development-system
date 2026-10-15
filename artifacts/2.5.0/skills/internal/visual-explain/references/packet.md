# Renderer packet

`node scripts/render.mjs --input packet.json --output visual.html` writes one
portable HTML document and returns its path and SHA-256. Paths are explicit;
the renderer does not install, serve, submit or publish anything.

The JSON object has:

- `mode`: `plan` or `delivery`; chooses Includes/Leaves out or Verified/Not
  verified headings. `language` is `es` (default) or `en`.
- `title`, `intro`, `closing`: plain text. The title identifies the real work;
  the closing contains the next action and material boundary.
- `steps`: 2–8 objects with unique `id`, short `label`, `state` (`done`, `active`,
  `pending` or `blocked`), `include` and `exclude` plain text. For delivery,
  those last two fields hold verified facts and limitations respectively.
- `selected`: an existing step id. This is reading focus, not workflow status
  or approval. At most one stage has state `active`.
- `gates`: optional objects `{before: "step-id", label: "real boundary"}`.
  They sit between stages; the first stage cannot have a gate. Only include
  genuine authorization boundaries. A gate never acts as an approval control.

Unknown fields, markup, arbitrary scripts and remote assets are not interpreted.
Strings are rendered as text. The packet has bounded text lengths; shorten
excess copy instead of shrinking type. Keep detailed evidence and its durable
links in the normal completion report. The examples are explicitly illustrative
and make no claim about a real project's progress.
