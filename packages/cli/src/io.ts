import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  SourcePhoto,
  PhotoSpaceConfig,
  PhotoSpaceMeta,
  PhotoFormat,
  PhotoMimeType,
} from "photospace-core";

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

export interface EncodedMaps {
  depth: Uint8Array;
  mask: Uint8Array;
  normal: Uint8Array;
  totalBytes: number;
}

async function encodeRgbaPng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  compressionLevel: number,
): Promise<Uint8Array> {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel, effort: 10 })
    .toBuffer();
}

export async function encodeMaps(input: {
  depthRgba: Uint8ClampedArray;
  maskRgba: Uint8ClampedArray;
  normalRgba: Uint8ClampedArray;
  width: number;
  height: number;
  compressionLevel: number;
}): Promise<EncodedMaps> {
  const [depth, mask, normal] = await Promise.all([
    encodeRgbaPng(input.depthRgba, input.width, input.height, input.compressionLevel),
    encodeRgbaPng(input.maskRgba, input.width, input.height, input.compressionLevel),
    encodeRgbaPng(input.normalRgba, input.width, input.height, input.compressionLevel),
  ]);
  return { depth, mask, normal, totalBytes: depth.byteLength + mask.byteLength + normal.byteLength };
}

export interface EncodedPhotoSource {
  file: string;
  type: PhotoMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
}

const PHOTO_OUTPUTS: Record<PhotoFormat, { file: string; type: PhotoMimeType }> = {
  avif: { file: "photo.avif", type: "image/avif" },
  webp: { file: "photo.webp", type: "image/webp" },
  jpeg: { file: "photo.jpg", type: "image/jpeg" },
};

export async function encodePhotoSources(
  photoBytes: Uint8Array,
  config: PhotoSpaceConfig["photo"],
): Promise<EncodedPhotoSource[]> {
  const formats = [...new Set(config.formats)];
  if (formats.length === 0) throw new Error("photo.formatsには1形式以上を指定してください。");

  return Promise.all(
    formats.map(async (format) => {
      let pipeline = sharp(Buffer.from(photoBytes)).rotate().resize({
        width: config.maxSize,
        height: config.maxSize,
        fit: "inside",
        withoutEnlargement: true,
      });
      if (format === "avif") pipeline = pipeline.avif({ quality: config.avifQuality });
      else if (format === "webp") pipeline = pipeline.webp({ quality: config.webpQuality });
      else pipeline = pipeline.jpeg({ quality: config.jpegQuality, mozjpeg: true });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      return { ...PHOTO_OUTPUTS[format], bytes: data, width: info.width, height: info.height };
    }),
  );
}

export interface WritePackageInput {
  outDir: string;
  photoSources: EncodedPhotoSource[];
  maps: EncodedMaps;
  meta: PhotoSpaceMeta;
}

/** エンコード済みの写真候補とdepth/mask/normal/meta.jsonを書き出す。 */
export async function writePackage(input: WritePackageInput): Promise<void> {
  await mkdir(input.outDir, { recursive: true });
  await Promise.all([
    ...input.photoSources.map((source) => writeFile(path.join(input.outDir, source.file), source.bytes)),
    writeFile(path.join(input.outDir, "depth.png"), input.maps.depth),
    writeFile(path.join(input.outDir, "mask.png"), input.maps.mask),
    writeFile(path.join(input.outDir, "normal.png"), input.maps.normal),
  ]);
  await writeFile(path.join(input.outDir, "meta.json"), JSON.stringify(input.meta, null, 2));
}
