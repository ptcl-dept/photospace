# Package format (version 1)

The `bake` command of [`photospace-cli`](../packages/cli) writes one or more photo variants and four required package files into one directory per photo. The "Package (.zip)" button in the browser demo generates the same format directly with `photospace-core` and bundles it into a zip.

```
out/<name>/
├── photo.avif    # First photo candidate by default
├── photo.webp    # Optional fallback candidate
├── photo.jpg     # Optional fallback candidate
├── depth.png     # Disparity (RG16 packed)
├── mask.png      # Sky mask (R) + edge mask (G)
├── normal.png    # World-space normals (RGB)
└── meta.json     # Camera & normalization parameters
```

If a required map file is missing, no photo candidate can be decoded, or `meta.json.version` is unsupported, `loadPackage()` fails.

`meta.photo.sources` lists photo candidates in preference order. The runtime fetches and decodes each candidate until one succeeds. `photo.file` duplicates the first candidate for older runtimes; packages without either field still default to `photo.avif`. The CLI can emit every configured format. Browser export includes the requested formats its canvas encoder supports and uses JPEG as the final mandatory fallback if none can be encoded.

Depth, mask and normal always share one resolution. `maps.maxBytes` is an encoding-time constraint, not metadata: when their combined PNG size exceeds it, all three are rebaked at a smaller common resolution and the actual dimensions are recorded in `depth.width` / `depth.height`.

## meta.json

```ts
interface PhotoSpaceMeta {
  version: 1;
  source: { file: string; width: number; height: number };
  photo?: {
    file: string; // First candidate; defaults to photo.avif when photo is omitted
    width?: number;
    height?: number;
    sources?: Array<{
      file: string;
      type: "image/avif" | "image/webp" | "image/jpeg";
    }>;
  };
  depth: {
    width: number;
    height: number;
    space: "disparity";
    orientation: "near=1";
    normalization: { min: number; max: number };
  };
  camera: { fovDeg: number; farRange: number };
  sky: { threshold: number };
  model: { name: string; revision: string };
  bakedAt: string; // ISO8601
  sourceHash: string; // sha256(photoBytes + configJson), used by the CLI to skip re-baking
}
```

- `depth.space: "disparity"` / `orientation: "near=1"`: stores disparity (larger value = nearer), not depth. `depth.normalization` records the raw disparity range the model output (post-inference, pre-normalization); `depth.png` itself holds normalized (0..1) values.
- `camera.fovDeg` / `camera.farRange`: the only parameters needed for the disparity → world-space conversion. `z` is derived with the formula below (`toZ`).

  ```
  disp = mix(1/farRange, 1, d)   // d: normalized disparity in 0..1
  z    = 1 / disp
  x    = (u*2-1) * aspect * tan(fovDeg/2) * z
  y    = (v*2-1) *          tan(fovDeg/2) * z
  ```

- `sky.threshold`: records, as-is, the threshold below which disparity was treated as sky (used to generate the R channel of `mask.png`).

## depth.png — RG16 packing of disparity

An 8-bit PNG can only represent 256 levels, producing banding artifacts in depth, so a 16-bit value is split across two channels.

```
R = (d16 >> 8) & 0xff   // high 8 bits
G =  d16       & 0xff   // low 8 bits
B = 0, A = 255
d16 = round(clamp01(d) * 65535)
```

Recovered with `d = (R*256 + G) / 65535`. The GPU's bilinear interpolation cannot be used on this packing (interpolation across R/G breaks), so sampling in a shader requires NEAREST + manual bilinear (see `photospace-runtime`'s `GLSL_SNIPPETS.unpackAndSampleDepth`).

## mask.png

```
R = round(clamp01(skyMask)  * 255)  // 1 = sky
G = round(clamp01(edgeMask) * 255)  // 1 = non-edge (approaches 0 near silhouettes)
B = 0, A = 255
```

## normal.png

World-space normals (-1..1) are mapped to 0..1 with `n*0.5+0.5` and stored in RGB (A=255).

## Compatibility policy

`meta.json.version` is bumped only when the format changes in a backward-incompatible way. `photospace-runtime` currently supports `version: 1` only. If a future `version: 2` is added, `loadPackage()` must branch on `meta.version` or explicitly throw on unsupported versions.
