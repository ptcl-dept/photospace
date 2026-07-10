import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SourcePhoto } from "../core/bake.ts";
import type { PhotoSpaceMeta } from "../core/pack.ts";

/** 元画像ファイルを読み込み、bakePhoto()へ渡せる形(RGBAピクセル込み)に変換する */
export async function loadSourcePhoto(filePath: string): Promise<SourcePhoto> {
  const bytes = await readFile(filePath);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    fileName: path.basename(filePath),
    bytes,
    input: filePath,
    width: info.width,
    height: info.height,
    rgba: data,
  };
}

export async function readExistingMeta(outDir: string): Promise<PhotoSpaceMeta | null> {
  try {
    const text = await readFile(path.join(outDir, "meta.json"), "utf-8");
    return JSON.parse(text) as PhotoSpaceMeta;
  } catch {
    return null;
  }
}

async function writeRgbaPng(outPath: string, rgba: Uint8ClampedArray, width: number, height: number): Promise<void> {
  await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

export interface WritePackageInput {
  outDir: string;
  photoBytes: Uint8Array;
  photoWidth: number;
  photoHeight: number;
  avifQuality: number;
  depthRgba: Uint8ClampedArray;
  maskRgba: Uint8ClampedArray;
  normalRgba: Uint8ClampedArray;
  depthWidth: number;
  depthHeight: number;
  meta: PhotoSpaceMeta;
}

/** パッケージ5点セット(photo.avif, depth.png, mask.png, normal.png, meta.json)を書き出す */
export async function writePackage(input: WritePackageInput): Promise<void> {
  await mkdir(input.outDir, { recursive: true });

  await sharp(Buffer.from(input.photoBytes))
    .avif({ quality: input.avifQuality })
    .toFile(path.join(input.outDir, "photo.avif"));

  await writeRgbaPng(path.join(input.outDir, "depth.png"), input.depthRgba, input.depthWidth, input.depthHeight);
  await writeRgbaPng(path.join(input.outDir, "mask.png"), input.maskRgba, input.depthWidth, input.depthHeight);
  await writeRgbaPng(path.join(input.outDir, "normal.png"), input.normalRgba, input.depthWidth, input.depthHeight);

  await writeFile(path.join(input.outDir, "meta.json"), JSON.stringify(input.meta, null, 2));
}
