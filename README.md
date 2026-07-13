# Photo Space

Turn a single photo into a set of assets for parallax rendering using monocular depth estimation (`photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json`). The project ships both a browser demo viewer that runs entirely in the browser and a CLI for batch-processing many photos.

**Live demo: [photospace-app.vercel.app](https://photospace-app.vercel.app)**

- **Browser demo** (the root app in this repo): drop in a photo and it estimates depth in-browser (WebGPU/WASM), then previews a cursor-following parallax effect on the spot. Everything runs locally — nothing is uploaded to a server. The **Package (.zip)** button bakes the same five-file set as the CLI (`photo.avif`/`depth.png`/`mask.png`/`normal.png`/`meta.json`) entirely in the browser and downloads it as a zip, so a single photo can be processed without the CLI (on browsers without AVIF encoding support, the photo is written as WebP/PNG and recorded in `meta.json`).
- **[`photospace-cli`](packages/cli)**: runs the same inference and packing logic in Node to bake a whole folder of images at once. Distributed on npm as `photospace-cli`.
- **[`photospace-runtime`](packages/runtime)**: a lightweight loader that reads the five-file package baked by the CLI in the browser and recovers world-space positions. Renderer-agnostic — usable from three.js or any other renderer. Distributed on npm as `photospace-runtime`.

## Repository layout

```
.
├── src/                 # Browser demo app (Vite, private)
├── examples/three-scene # Acceptance-test scene that loads a package from three.js
├── public/sample/source # A sample pre-baked package
└── packages/
    ├── core/            # Shared inference / normalization / upsampling / packing logic (private, used by both the viewer and the CLI)
    ├── cli/              → published as photospace-cli
    └── runtime/          → published as photospace-runtime
```

`packages/core` is an internal package shared by the viewer app and the CLI; it is not published to npm (`private: true`). The CLI bundles it at build time.

## Setup

```bash
pnpm install
```

Requires Node 20+ (the CLI depends on the native binaries of `sharp` and `onnxruntime-node`).

## Running the browser demo

```bash
pnpm dev
```

On first run the depth estimation model (~25–50MB, [`onnx-community/depth-anything-v2-small`](https://huggingface.co/onnx-community/depth-anything-v2-small)) is downloaded in the browser. It uses WebGPU where available and falls back to WASM otherwise.

## Using the CLI

```bash
npx photospace-cli bake ./photos --out ./out
```

Or install it globally with `npm install -g photospace-cli`. See [`packages/cli/README.md`](packages/cli/README.md) for details.

## Package format

The five-file set the CLI writes and the runtime reads is specified in [`docs/package-format.md`](docs/package-format.md).

## Model license

The default model `onnx-community/depth-anything-v2-small` is Apache-2.0 and permitted for commercial use. The Base/Large variants of Depth Anything V2 are CC-BY-NC-4.0 (non-commercial only), so always check each model card's license before switching models.

## Tests & type-checking

```bash
pnpm test        # Unit tests in packages/*/test and src/*/*.test.ts
pnpm typecheck   # Type-check every workspace, including the root app
```

## License

MIT
