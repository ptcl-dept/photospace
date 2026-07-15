# photospace-cli

A CLI that generates AVIF/WebP/JPEG photo variants plus `depth.png` / `meta.json` (and optional `mask.png` / `normal.png`) from photos. It runs monocular depth estimation ([Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small)) on Node (CPU) and writes output in a format readable by [`photospace-runtime`](https://github.com/ptcl-dept/photospace/tree/main/packages/runtime).

## Install

```bash
npm install -g photospace-cli
```

Or run it without installing via `npx photospace-cli`.

Requires Node 20+. Because it includes the native binaries of `sharp` and `onnxruntime-node`, it runs only on supported platforms (macOS/Linux/Windows, x64 and arm64).

## Usage

```bash
photospace bake ./photos --out ./out
```

- `<patterns...>`: one or more image file paths, glob patterns, or directories (passing a directory targets the `jpg/jpeg/png/webp/avif/tiff` files directly inside it)
- `--out <dir>`: output directory (default `out`). One package directory is written to `out/<name>/` per file
- `--config <path>`: path to `photospace.config.json` (defaults are used when omitted)
- `--mask`: bundle `mask.png` (sky + edge masks); overrides `maps.mask` in the config
- `--normal`: bundle `normal.png` (world-space normals); overrides `maps.normal` in the config

The SHA-256 hash of the photo bytes + config is recorded in `meta.json` as `sourceHash`, so re-running on identical input skips the bake.

## config.json

```json
{
  "version": 1,
  "camera": { "fovDeg": 55, "farRange": 12 },
  "sky": { "threshold": 0.03 },
  "depth": { "maxSize": 1024 },
  "maps": { "maxBytes": 1500000, "pngCompressionLevel": 9, "mask": false, "normal": false },
  "photo": {
    "maxSize": 2048,
    "formats": ["avif", "webp", "jpeg"],
    "avifQuality": 50,
    "webpQuality": 75,
    "jpegQuality": 82
  }
}
```

| Field | Description |
| --- | --- |
| `camera.fovDeg` | Vertical FOV (degrees) of the virtual camera used by the viewer |
| `camera.farRange` | Depth range for the disparity → depth conversion |
| `sky.threshold` | Disparity below this value is treated as sky; recorded in `meta.json` and baked into the R channel of `mask.png` when bundled |
| `depth.maxSize` | Long-edge pixel size of the output maps (snapped to the source photo resolution with a guided filter) |
| `maps.maxBytes` | Maximum combined bytes for the bundled maps; `0` disables the limit. All bundled maps are rebaked at a smaller shared resolution when exceeded |
| `maps.pngCompressionLevel` | PNG compression level for the map PNGs (0–9) |
| `maps.mask` / `maps.normal` | Bundle `mask.png` / `normal.png` (default `false`); their presence is declared in `meta.json` |
| `photo.maxSize` | Long-edge pixel size of each encoded photo variant |
| `photo.formats` | Ordered photo variants to emit: `avif`, `webp`, `jpeg`. Must include `jpeg` — `photo.jpg` is the package's mandatory final fallback |
| `photo.*Quality` | Per-format encoding quality (0–100) |

Fields may be omitted; defaults are merged per section.

## Output format

See [`docs/package-format.md`](https://github.com/ptcl-dept/photospace/blob/main/docs/package-format.md) for the full spec of the package written by the CLI.

## Building from source

```bash
pnpm install
pnpm --filter photospace-cli build
node packages/cli/dist/index.js bake ./photos
```

## License

MIT
