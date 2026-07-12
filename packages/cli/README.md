# photospace-cli

A CLI that batch-generates the five-file package set — `photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json` — from photos. It runs monocular depth estimation ([Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small)) on Node (CPU) and writes output in a format readable by [`photospace-runtime`](https://github.com/ptcl-dept/photo-space/tree/main/packages/runtime).

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
- `--out <dir>`: output directory (default `out`). The five-file set is written to `out/<name>/` per file
- `--config <path>`: path to `photospace.config.json` (defaults are used when omitted)

The SHA-256 hash of the photo bytes + config is recorded in `meta.json` as `sourceHash`, so re-running on identical input skips the bake.

## config.json

```json
{
  "version": 1,
  "camera": { "fovDeg": 55, "farRange": 12 },
  "sky": { "threshold": 0.03 },
  "depth": { "maxSize": 1024 },
  "photo": { "avifQuality": 50 }
}
```

| Field | Description |
| --- | --- |
| `camera.fovDeg` | Vertical FOV (degrees) of the virtual camera used by the viewer |
| `camera.farRange` | Depth range for the disparity → depth conversion |
| `sky.threshold` | Disparity below this value is treated as sky and baked into the R channel of `mask.png` |
| `depth.maxSize` | Long-edge pixel size of the output depth/mask/normal (snapped to the source photo resolution with a guided filter) |
| `photo.avifQuality` | Encoding quality of `photo.avif` (0–100) |

The browser demo's "config.json" export button generates this file from the slider values in the UI.

## Output format

See [`docs/package-format.md`](https://github.com/ptcl-dept/photo-space/blob/main/docs/package-format.md) for the full spec of the package written by the CLI.

## Building from source

```bash
pnpm install
pnpm --filter photospace-cli build
node packages/cli/dist/index.js bake ./photos
```

## License

MIT
