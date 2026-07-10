import { packDepthRG16, type PhotoSpaceConfig } from "../core/pack.ts";

export function downloadDepthPng(depth01: Float32Array, width: number, height: number, fileName = "depth_rg16.png"): void {
  const packed = packDepthRG16(depth01);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  const im = ctx.createImageData(width, height);
  im.data.set(packed);
  ctx.putImageData(im, 0, 0);
  const a = document.createElement("a");
  a.download = fileName;
  a.href = c.toDataURL("image/png");
  a.click();
}

export function downloadConfig(config: PhotoSpaceConfig, fileName = "photospace.config.json"): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.download = fileName;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}
