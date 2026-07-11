import { test } from "node:test";
import assert from "node:assert/strict";
import { rgbaToGrayF32, bilinearResizeF32, type RasterF32 } from "../src/upsample.ts";

test("rgbaToGrayF32 applies the luma weights and normalizes to 0..1", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]);
  const gray = rgbaToGrayF32(rgba, 2, 1);
  assert.ok(Math.abs(gray.data[0] - 0.299) < 1e-6);
  assert.equal(gray.data[1], 0);
});

test("bilinearResizeF32 preserves a flat raster's value", () => {
  const src: RasterF32 = { width: 2, height: 2, data: new Float32Array([1, 1, 1, 1]) };
  const resized = bilinearResizeF32(src, 4, 4);
  assert.equal(resized.width, 4);
  assert.equal(resized.height, 4);
  for (const v of resized.data) assert.ok(Math.abs(v - 1) < 1e-6);
});

test("bilinearResizeF32 is a no-op when target size matches source", () => {
  const src: RasterF32 = { width: 2, height: 2, data: new Float32Array([0, 1, 2, 3]) };
  const resized = bilinearResizeF32(src, 2, 2);
  for (let i = 0; i < src.data.length; i++) {
    assert.ok(Math.abs(resized.data[i] - src.data[i]) < 1e-6);
  }
});
