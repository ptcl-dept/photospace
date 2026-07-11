import { bakeFromDisparity, type SourcePhoto, type PhotoSpaceConfig, type RasterF32 } from "photospace-core";
import { createZip } from "./zip.ts";

export function rasterizeToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodePng(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvasToBlob(canvas, "image/png");
  if (!blob) throw new Error("depth/mask/normal PNG のエンコードに失敗しました。");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 写真の再エンコード候補。canvas.toBlob() は Chrome/Edge を含む多くのブラウザで AVIF エンコード未対応
 * (非対応の場合は黙ってPNG型のBlobを返す)なので、AVIF → WebP → PNG の順に試し、
 * 実際に使ったファイル名を meta.json の photo.file に記録する。
 */
const PHOTO_ENCODE_CANDIDATES = [
  { name: "photo.avif", type: "image/avif" },
  { name: "photo.webp", type: "image/webp" },
  { name: "photo.png", type: "image/png" },
] as const;

async function encodePhoto(
  canvas: HTMLCanvasElement,
  quality01: number,
): Promise<{ name: string; bytes: Uint8Array }> {
  for (const candidate of PHOTO_ENCODE_CANDIDATES) {
    const blob = await canvasToBlob(canvas, candidate.type, quality01);
    if (blob && blob.type === candidate.type) {
      return { name: candidate.name, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
  }
  throw new Error("写真のエンコード(AVIF/WebP/PNG)にすべて失敗しました。");
}

export interface ExportPackageInput {
  /** meta.jsonのsource情報・ハッシュ計算・ガイド画像に使うフル解像度の写真情報 */
  photo: SourcePhoto;
  /** 写真の再エンコードに使う描画ソース(読み込み済みのHTMLImageElement等) */
  photoSource: CanvasImageSource;
  /** モデル推論直後の正規化済み(0..1)disparity。推論を再実行せず既存の結果を再利用する */
  lowResDisparity: RasterF32;
  normalization: { min: number; max: number };
  config: PhotoSpaceConfig;
}

/**
 * docs/package-format.md 記載の5点セット(photo.avif/depth.png/mask.png/normal.png/meta.json)を
 * ブラウザだけで組み立て、1つの .zip としてダウンロードする。CLIの `photospace bake` が
 * Node上(sharp)で行うのと同じ photospace-core のロジックをそのまま使う。
 * AVIFエンコード非対応ブラウザでは写真を WebP/PNG で書き出し、meta.json の photo.file に記録する。
 */
export async function downloadPackage(input: ExportPackageInput): Promise<void> {
  const baked = await bakeFromDisparity(input.photo, input.lowResDisparity, input.normalization, {
    config: input.config,
  });

  const photoCanvas = rasterizeToCanvas(input.photoSource, input.photo.width, input.photo.height);
  const [photo, depthBytes, maskBytes, normalBytes] = await Promise.all([
    encodePhoto(photoCanvas, input.config.photo.avifQuality / 100),
    encodePng(baked.depthRgba, baked.depthWidth, baked.depthHeight),
    encodePng(baked.maskRgba, baked.depthWidth, baked.depthHeight),
    encodePng(baked.normalRgba, baked.depthWidth, baked.depthHeight),
  ]);

  const meta = { ...baked.meta, photo: { file: photo.name } };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta, null, 2));

  const zip = createZip([
    { name: photo.name, data: photo.bytes },
    { name: "depth.png", data: depthBytes },
    { name: "mask.png", data: maskBytes },
    { name: "normal.png", data: normalBytes },
    { name: "meta.json", data: metaBytes },
  ]);

  const baseName = input.photo.fileName.replace(/\.[^.]+$/, "") || "photospace";
  const a = document.createElement("a");
  a.download = `${baseName}.photospace.zip`;
  a.href = URL.createObjectURL(zip);
  a.click();
  URL.revokeObjectURL(a.href);
}
