# Optional local typography

> **Making or quoting a video? Take inventory first.** Run `hackathon-kit/bin/kit-video --tools`
> and `hackathon-kit/bin/kit-scene --list` before choosing a method or giving a time: tools land
> often and this page may not list them. Then pick the route in
> [VIDEO-ROUTES.md](../VIDEO-ROUTES.md) and estimate from its measured step costs. Ready-made scenes
> render in seconds and only new code takes long, so never offer a frame-by-frame render
> (1–4 h) unless no existing scene fits.

A written `brand.md` helps the agent choose a look. `brand.json` supplies font assets
the tools actually load. It is optional and independent of video format.

1. Record the product's real type choices and licensed local assets.
2. Adapt `brand.example.json`, keeping paths relative to the JSON file.
3. Run `bin/kit-setup-fonts` once if local font inspection/conversion is unavailable.
   It installs a small isolated fonttools/brotli environment under `KIT_HOME`; no API key
   or model service is involved, and a build never downloads fonts automatically.
4. In `hackathon.yaml`, set `video.brand_file: demo/brand.json`. Or use `kit-edit`'s
   `brand` path, or `kit-caption --brand demo/brand.json`.

The body/display/caption roles name declared families. Each face has a family alias,
local `file`, `weight`, optional `style` and optional `license` file. Browser aliases
can differ from internal font names; the helper inspects the actual font and selects
its INTERNAL family for libass captions. A typo or missing asset fails instead of
quietly exporting with a substitute. `highlight` supplies a readable accent for the
currently spoken word. Colour and type choices in the example are placeholders.

TTF, OTF, WOFF and WOFF2 static faces are supported. WOFF/WOFF2 convert to TTF for all
renderers. Converted filenames are content-addressed; licences are copied separately
from the font scan. Font provenance records the source hash and roles. Collections must
be extracted to individual faces. For variable fonts, first export static instances at
the weights used by the product, for example:

```sh
<KIT_HOME>/font-tools/bin/fonttools varLib.instancer Variable.ttf wght=400 --static -o Regular.ttf
```

The kit does not infer a website's type system, font rights or a sensible weight from a
screenshot. Keep the supplied licence/source details and verify the treatment visually.

## Where typography is applied

- Designed cards load body/display faces and await font/image readiness before capture.
- HyperFrames default and named styles receive local `@font-face` rules and role overrides;
  captured UI and intentional monospace code/URL treatments remain part of their source.
- Remotion registers the bundled font faces and waits for them before rendering frames;
  title/result and captions use their respective roles.
- FFmpeg cards use the selected local display face. Branded captions use ASS with the
  correct internal family and bundled font directory, with or without word highlighting.
- Standalone `kit-caption` and `kit-edit` use the same preparation/alignment helpers.

This controls typography, not an automatic redesign of every preset. Layout, framing,
colours beyond the existing project accent, motion and how much app to show still follow
the brief. Local brand assets never become permission to reproduce unrelated footage or
publish the result. A font-loading pass is a technical check, not an aesthetic score.

Named HyperFrames presets currently use a fixed 1920×1080 canvas and reject other sizes explicitly. The default compositor and standalone editor accept other even dimensions. Typography support does not make fixed-layout presets responsive.
