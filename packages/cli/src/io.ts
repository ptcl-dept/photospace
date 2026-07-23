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

/** 既存出力のmeta.json。旧versionの可能性があるため、スキップ判定に使う項目だけの型で返す */
export async function readExistingMeta(outDir: string): Promise<{ version?: number; sourceHash?: string } | null> {
  try {
    const text = await readFile(path.join(outDir, "meta.json"), "utf-8");
    return JSON.parse(text) as { version?: number; sourceHash?: string };
  } catch {
    return null;
  }
}

export interface EncodedMaps {
  depth: Uint8Array;
  mask?: Uint8Array;
  normal?: Uint8Array;
  totalBytes: number;
}

/**
 * パック済みRGBAラスタをRGB(3ch)PNGとして書き出す。Aは全マップで定数255のため落とす。
 * ブラウザ側のデコードはgetImageData/texImage2Dが常にRGBAへ展開するので互換が保たれる。
 *
 * palette:falseは必須。sharpはeffort等のパレット系オプションを渡すと暗黙にpalette:trueへ
 * 切り替わり、256色への非可逆量子化でRG16深度が壊れる(かつては effort:10 がこれを踏んでいた)。
 * 非パレットPNGにeffortは効かないため、圧縮の調整はcompressionLevelのみで行う。
 */
async function encodeMapPng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  compressionLevel: number,
): Promise<Uint8Array> {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .removeAlpha()
    .png({ compressionLevel, palette: false })
    .toBuffer();
}

/** 渡されたマップだけPNGエンコードする。totalBytesは同梱マップの合計。 */
export async function encodeMaps(input: {
  depthRgba: Uint8ClampedArray;
  maskRgba?: Uint8ClampedArray;
  normalRgba?: Uint8ClampedArray;
  width: number;
  height: number;
  compressionLevel: number;
}): Promise<EncodedMaps> {
  const { width, height, compressionLevel } = input;
  const [depth, mask, normal] = await Promise.all([
    encodeMapPng(input.depthRgba, width, height, compressionLevel),
    input.maskRgba ? encodeMapPng(input.maskRgba, width, height, compressionLevel) : undefined,
    input.normalRgba ? encodeMapPng(input.normalRgba, width, height, compressionLevel) : undefined,
  ]);
  const totalBytes = depth.byteLength + (mask?.byteLength ?? 0) + (normal?.byteLength ?? 0);
  return { depth, mask, normal, totalBytes };
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

/** エンコード済みの写真候補とdepth(+同梱マップ)/meta.jsonを書き出す。 */
export async function writePackage(input: WritePackageInput): Promise<void> {
  await mkdir(input.outDir, { recursive: true });
  const writes = [
    ...input.photoSources.map((source) => writeFile(path.join(input.outDir, source.file), source.bytes)),
    writeFile(path.join(input.outDir, "depth.png"), input.maps.depth),
  ];
  if (input.maps.mask) writes.push(writeFile(path.join(input.outDir, "mask.png"), input.maps.mask));
  if (input.maps.normal) writes.push(writeFile(path.join(input.outDir, "normal.png"), input.maps.normal));
  await Promise.all(writes);
  await writeFile(path.join(input.outDir, "meta.json"), JSON.stringify(input.meta, null, 2));
}
