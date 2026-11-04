# Shared Portrait Library

`portraits/catalog.json` describes the bundled library. Images are shared by
all host characters. Users choose Fixed, Random or Off under Settings.

```json
{
  "version": 1,
  "items": [
    {
      "id": "unique-stable-id",
      "name": "Display name",
      "collection": "Collection name",
      "file": "unique-stable-id/display.webp",
      "thumbnail": "unique-stable-id/thumb.webp"
    }
  ]
}
```

Paths are relative to `portraits/` and must remain inside it. IDs use ASCII
letters, digits, `_` and `-`, start with a letter or digit, and are at most
80 characters. Do not change an existing ID when renaming its display label.
The catalog supports up to 2,000 entries and 512 KiB of JSON.

Display images are limited to 1 MiB and thumbnails to 64 KiB. The preparation
tool generates transparent WebP display images up to 960 x 1440 pixels and
thumbnails up to 200 x 280 pixels, without enlarging the source. PNG, JPEG and
GIF are also accepted by the runtime. Only the current image and visible
thumbnail page are loaded; image caches have size limits.

Preferences are saved in the SDK-assigned data directory as `portraits.json`,
separately from relationship data. `pool_ids: null` means all current and
future images; an empty list means no random candidates.

The current test collection contains 18 images prepared from the user-supplied
`千恋万花_立绘` folder, including its costume subdirectory. The optional
`source_file` field records the original relative filename. Original PNGs
remain outside this plugin. This provenance does not assign a license to the
artwork; the plugin's source-code license does not cover these images.

## Placement

The panel shows character artwork at the upper-right side of each page,
starting beside the page title. Desktop layouts reserve a portrait column
up to 220px wide and 360px tall; the image is aligned toward the upper-right
so the page content remains the visual focus.
Images keep their original proportions and never overlap the page controls.
Small windows show a compact portrait beside the title, with forms and charts
using the full width below. Without an image, no portrait space is reserved.

## Legacy Stage Images

The legacy mode remains available when old images exist, or when the catalog
is absent and no explicit display mode has been saved.

Default image: `decoration.webp`.

Stage overrides:

- `stage_stranger.webp`
- `stage_familiar.webp`
- `stage_fond.webp`
- `stage_ambiguous.webp`
- `stage_lover.webp`

PNG, JPG, JPEG and GIF are also supported. Each image must be at most 1 MiB.
A portrait with a transparent background works best. Stage overrides fall
back to the default image when unavailable.

Stage images do not override fixed or random library choices.
