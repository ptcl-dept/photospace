# photospace-runtime

A lightweight loader that reads a Photospace package (ordered AVIF/WebP/JPEG photo candidates plus `depth.png` / `meta.json`, and optional `mask.png` / `normal.png`) baked by [`photospace-cli`](https://github.com/ptcl-dept/photospace/tree/main/packages/cli), and returns decoded rasters plus helpers for recovering world-space positions. It is renderer-agnostic, so it works with three.js, raw WebGL, or Canvas2D.

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
// pkg.skyMask / pkg.edgeMask: Float32Array (0..1) | undefined — only when mask.png is bundled
// pkg.normal:  { nx, ny, nz: Float32Array } (-1..1) | undefined — only when normal.png is bundled

if (pkg.skyMask) {
  // mask-dependent path; sky can also be derived from disparity + pkg.meta.sky.threshold
}

const [x, y, z] = worldPositionFromMeta(pkg.meta, u, v, disparity);
```

`loadPackage(baseUrl)` tries the photo candidates in `meta.photo.sources` in order (a version 2 package always ends with the mandatory `photo.jpg`), while fetching the map files declared by `meta.json` in parallel. It decodes the 16-bit packed `depth.png` (R = high 8 bits / G = low 8 bits) back into a `Float32Array`. Version 1 packages are still supported: all maps are fetched unconditionally and packages without `photo.sources` default to `photo.avif`.

To wire it directly into your own shader, use `GLSL_SNIPPETS.unpackAndSampleDepth` / `GLSL_SNIPPETS.worldPosition`. Because the RG16 packing cannot use the GPU's bilinear interpolation, `unpackAndSampleDepth` reads with NEAREST sampling plus manual bilinear filtering.

See [`examples/three-scene`](https://github.com/ptcl-dept/photospace/tree/main/examples/three-scene) for a three.js implementation.

> **Browser-only.** The loader relies on `fetch`, `createImageBitmap`, and `OffscreenCanvas`, so it runs in the browser (or a Worker), not in Node. To bake packages from Node, use [`photospace-cli`](https://github.com/ptcl-dept/photospace/tree/main/packages/cli).

## API

Full type definitions ship in `dist/loader.d.ts`; this is a summary of the public surface.

### `loadPackage(baseUrl: string | URL): Promise<PhotoSpacePackage>`

Fetches and decodes the package under `baseUrl`. A trailing `/` is added to `baseUrl` if missing, and it is resolved against `location.href`, so both relative (`"/sample/source/"`) and absolute URLs work.

```ts
interface PhotoSpacePackage {
  meta: PhotoSpaceMeta;              // parsed meta.json (version 1 or 2)
  photo: ImageBitmap;                // decoded photo, ready as a texture source
  depth: Float32Array;               // disparity 0..1 (1 = near), depthWidth * depthHeight
  depthWidth: number;
  depthHeight: number;
  skyMask?: Float32Array;            // 0..1 (1 = sky); only when mask.png is bundled
  edgeMask?: Float32Array;           // 0..1 (1 = non-edge); only when mask.png is bundled
  normal?: { nx: Float32Array; ny: Float32Array; nz: Float32Array }; // each -1..1; only when normal.png is bundled
}
```

`depth` is recovered from the RG16-packed `depth.png` as `(R * 256 + G) / 65535`. All arrays are row-major and share the same `depthWidth * depthHeight` length.

### `worldPositionFromMeta(meta, u, v, disparity): [x, y, z]`

Reconstructs a world-space position from a UV coordinate (`0..1`) and a disparity value, using only `camera.fovDeg` / `camera.farRange` from `meta`. The result is in a right-handed, camera-space frame looking down **−Z** (matching the viewer and the `GLSL_SNIPPETS.worldPosition` output).

### `GLSL_SNIPPETS`

Two GLSL (ES 3.0 / WebGL2) source strings you can concatenate into your own shader:

- `unpackAndSampleDepth` — defines `float dsp(sampler2D uDep, vec2 uDRes, vec2 uv)`. Because the RG16 packing cannot use the GPU's bilinear interpolation, it samples with `texelFetch` (NEAREST) and does the bilinear blend manually. Requires the depth texture (`uDep`) and its resolution in texels (`uDRes`).
- `worldPosition` — defines `float toZ(float d, float uFar)` and `vec3 wpos(vec2 uv, float d, float aspect, float uTanF, float uFar)`, the shader-side equivalent of `worldPositionFromMeta` (`uTanF = tan(fovDeg * π / 360)`).

```glsl
// vertex/fragment shader
${GLSL_SNIPPETS.unpackAndSampleDepth}
${GLSL_SNIPPETS.worldPosition}
// ... later:
float d = dsp(uDep, uDRes, uv);
vec3 p = wpos(uv, d, aspect, uTanF, uFar);
```

### Types

`PhotoSpaceMeta` and `PhotoSpacePackage` are exported for TypeScript consumers. `PhotoSpaceMeta` mirrors `meta.json` — see [`docs/package-format.md`](https://github.com/ptcl-dept/photospace/blob/main/docs/package-format.md) for the field-by-field spec.

## Package format

[`docs/package-format.md`](https://github.com/ptcl-dept/photospace/blob/main/docs/package-format.md) documents the fields in detail along with the compatibility policy. The `version` field in `meta.json` guards against future format changes; this loader reads versions 1 and 2 and throws on anything else.

> **Breaking change in 0.2.0:** `skyMask`, `edgeMask`, and `normal` are now optional — version 2 packages bundle `mask.png` / `normal.png` only when baked with them enabled. Runtimes ≤0.1.x cannot read v2 packages baked without both maps.

## Building from source

```bash
pnpm install
pnpm --filter photospace-runtime build
```

This builds `loader.ts` into `dist/loader.js` (ESM) + `dist/loader.d.ts`.

## License

MIT
