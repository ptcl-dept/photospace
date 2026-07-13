import test from "node:test";
import assert from "node:assert/strict";
import { photoFileCandidates, type PhotoSpaceMeta } from "../loader.ts";

function meta(photo?: PhotoSpaceMeta["photo"]): PhotoSpaceMeta {
  return {
    version: 1,
    source: { file: "source.jpg", width: 1, height: 1 },
    photo,
    depth: {
      width: 1,
      height: 1,
      space: "disparity",
      orientation: "near=1",
      normalization: { min: 0, max: 1 },
    },
    camera: { fovDeg: 55, farRange: 12 },
    sky: { threshold: 0.03 },
    model: { name: "test", revision: "test" },
    bakedAt: "2026-01-01T00:00:00.000Z",
    sourceHash: "hash",
  };
}

test("photoFileCandidates keeps legacy AVIF default", () => {
  assert.deepEqual(photoFileCandidates(meta()), ["photo.avif"]);
});

test("photoFileCandidates uses sources in order and removes duplicate legacy file", () => {
  assert.deepEqual(
    photoFileCandidates(meta({
      file: "photo.avif",
      sources: [
        { file: "photo.avif", type: "image/avif" },
        { file: "photo.webp", type: "image/webp" },
      ],
    })),
    ["photo.avif", "photo.webp"],
  );
});
