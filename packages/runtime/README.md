# photospace-runtime

A lightweight loader that reads the five-file package set (`photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json`) baked by [`photospace-cli`](https://github.com/ptcl-dept/photo-space/tree/main/packages/cli) in the browser, and returns decoded rasters plus helpers for recovering world-space positions. It is renderer-agnostic, so it works with three.js, raw WebGL, or Canvas2D.

## Install

```bash
npm install photospace-runtime
```

## Usage

```ts
import { loadPackage, worldPositionFromMeta } from "photospace-runtime";

const pkg = await loadPackage("/sample/source/");
// pkg.photo:   ImageBitmap
// pkg.depth:   Float32Array (0..1, depthWidth x depthHeight)
// pkg.skyMask / pkg.edgeMask: Float32Array (0..1)
// pkg.normal:  { nx, ny, nz: Float32Array } (-1..1)

const [x, y, z] = worldPositionFromMeta(pkg.meta, u, v, disparity);
```

`loadPackage(baseUrl)` fetches the five files under `baseUrl` in parallel and decodes the 16-bit packed `depth.png` (R = high 8 bits / G = low 8 bits) back into a `Float32Array`. World-space positions can be computed from just `camera.fovDeg` / `camera.farRange` in `meta.json`, so the shader side needs no extra parameters.

To wire it directly into your own shader, use `GLSL_SNIPPETS.unpackAndSampleDepth` / `GLSL_SNIPPETS.worldPosition`. Because the RG16 packing cannot use the GPU's bilinear interpolation, `unpackAndSampleDepth` reads with NEAREST sampling plus manual bilinear filtering.

See [`examples/three-scene`](https://github.com/ptcl-dept/photo-space/tree/main/examples/three-scene) for a three.js implementation.

## Package format

[`docs/package-format.md`](https://github.com/ptcl-dept/photo-space/blob/main/docs/package-format.md) documents the fields in detail along with the compatibility policy. The `version` field in `meta.json` guards against future format changes.

## Building from source

```bash
pnpm install
pnpm --filter photospace-runtime build
```

This builds `loader.ts` into `dist/loader.js` (ESM) + `dist/loader.d.ts`.

## License

MIT
