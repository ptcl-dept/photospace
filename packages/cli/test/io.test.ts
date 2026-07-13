import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DEFAULT_CONFIG } from "photospace-core";
import { encodeMaps, encodePhotoSources } from "../src/io.ts";

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
  assert.equal(maps.totalBytes, maps.depth.byteLength + maps.mask.byteLength + maps.normal.byteLength);
  assert.ok(maps.totalBytes > 0);
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
