import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_CONFIG, type PhotoSpaceMeta } from "photospace-core";
import { encodeMaps, encodePhotoSources, writePackage } from "../src/io.ts";

test("encodeMaps reports the exact combined PNG size", async () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(127);
  const maps = await encodeMaps({
    depthRgba: rgba,
    maskRgba: rgba,
    normalRgba: rgba,
    width: 4,
    height: 4,
    compressionLevel: 9,
  });
  assert.equal(maps.totalBytes, maps.depth.byteLength + maps.mask!.byteLength + maps.normal!.byteLength);
  assert.ok(maps.totalBytes > 0);
});

test("encodeMaps encodes only the provided maps", async () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(127);
  const maps = await encodeMaps({ depthRgba: rgba, width: 4, height: 4, compressionLevel: 9 });
  assert.equal(maps.mask, undefined);
  assert.equal(maps.normal, undefined);
  assert.equal(maps.totalBytes, maps.depth.byteLength);
});

test("writePackage omits mask/normal files when not bundled", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "photospace-io-"));
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(127);
  const maps = await encodeMaps({ depthRgba: rgba, width: 4, height: 4, compressionLevel: 9 });
  const meta: PhotoSpaceMeta = {
    version: 2,
    source: { file: "source.jpg", width: 4, height: 4 },
    depth: { width: 4, height: 4, space: "disparity", orientation: "near=1", normalization: { min: 0, max: 1 } },
    camera: { fovDeg: 55, farRange: 12 },
    sky: { threshold: 0.03 },
    model: { name: "test", revision: "test" },
    bakedAt: "2026-01-01T00:00:00.000Z",
    sourceHash: "hash",
  };
  await writePackage({
    outDir,
    photoSources: [{ file: "photo.jpg", type: "image/jpeg", bytes: new Uint8Array([1]), width: 4, height: 4 }],
    maps,
    meta,
  });
  assert.deepEqual((await readdir(outDir)).sort(), ["depth.png", "meta.json", "photo.jpg"]);
});

test("encodePhotoSources emits configured formats at one bounded resolution", async () => {
  const input = await sharp({
    create: { width: 8, height: 4, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).png().toBuffer();
  const sources = await encodePhotoSources(input, {
    ...DEFAULT_CONFIG.photo,
    maxSize: 4,
    formats: ["avif", "webp", "jpeg"],
  });

  assert.deepEqual(sources.map(({ file }) => file), ["photo.avif", "photo.webp", "photo.jpg"]);
  for (const source of sources) {
    assert.equal(source.width, 4);
    assert.equal(source.height, 2);
    assert.ok(source.bytes.byteLength > 0);
  }
});
