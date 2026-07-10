import { loadDepthModel, estimateDepth, type DepthModel, MODEL_NAME, MODEL_REVISION } from "./depth.ts";
import { normalizeDisparity } from "./normalize.ts";
import { guidedUpsampleDepth, type RasterF32 } from "./upsample.ts";
import { computeSkyMask, computeEdgeMask } from "./masks.ts";
import { computeNormals } from "./normals.ts";
import { packDepthRG16, packMask, packNormal, computeSourceHash, type PhotoSpaceConfig, type PhotoSpaceMeta } from "./pack.ts";

export interface SourcePhoto {
  /** パッケージ名やmeta.jsonのsource.fileに使うファイル名 */
  fileName: string;
  /** 元画像のバイト列(ハッシュ計算とphoto.avif生成に使用) */
  bytes: Uint8Array;
  /** モデル推論への入力(ブラウザ: data URL、Node: ファイルパス) */
  input: string;
  width: number;
  height: number;
  /** 元解像度のRGBAピクセル(ガイド画像に使用) */
  rgba: Uint8ClampedArray | Uint8Array;
}

export interface BakedPackage {
  meta: PhotoSpaceMeta;
  /** RG16パック済み深度 (RGBA raster, depth.width x depth.height) */
  depthRgba: Uint8ClampedArray;
  /** R=空マスク, G=エッジマスク (RGBA raster, depth解像度) */
  maskRgba: Uint8ClampedArray;
  /** 法線 (RGBA raster, depth解像度) */
  normalRgba: Uint8ClampedArray;
  depthWidth: number;
  depthHeight: number;
}

export interface BakeOptions {
  model: DepthModel;
  config: PhotoSpaceConfig;
  guidedFilter?: { radius?: number; eps?: number };
}

/** 長辺がmaxSizeになるようリサイズ後の(width,height)を計算する */
function fitLongEdge(width: number, height: number, maxSize: number): [number, number] {
  const scale = maxSize / Math.max(width, height);
  if (scale >= 1) return [width, height];
  return [Math.round(width * scale), Math.round(height * scale)];
}

/**
 * 推論→正規化→エッジ整合アップサンプリング→マスク→法線 の一連の処理を行い、
 * パッケージ5点セットのうち photo.avif を除く4点分のラスタデータと meta.json を返す。
 * photo.avif のエンコードは環境依存(sharp/canvas)のためこの関数の外で行う。
 */
export async function bakePhoto(photo: SourcePhoto, opts: BakeOptions): Promise<BakedPackage> {
  const { config } = opts;

  const { width: rawW, height: rawH, raw } = await estimateDepth(opts.model, photo.input);
  const { data: normalized, min, max } = normalizeDisparity(raw);
  const lowRes: RasterF32 = { width: rawW, height: rawH, data: normalized };

  const [depthW, depthH] = fitLongEdge(photo.width, photo.height, config.depth.maxSize);
  const upsampled = guidedUpsampleDepth(
    lowRes,
    photo.rgba,
    photo.width,
    photo.height,
    depthW,
    depthH,
    opts.guidedFilter,
  );

  const sky = computeSkyMask(upsampled, config.sky.threshold);
  const edge = computeEdgeMask(upsampled);
  const normals = computeNormals(upsampled, config.camera.fovDeg, config.camera.farRange);

  const sourceHash = await computeSourceHash(photo.bytes, config);

  const meta: PhotoSpaceMeta = {
    version: 1,
    source: { file: photo.fileName, width: photo.width, height: photo.height },
    depth: {
      width: depthW,
      height: depthH,
      space: "disparity",
      orientation: "near=1",
      normalization: { min, max },
    },
    camera: { fovDeg: config.camera.fovDeg, farRange: config.camera.farRange },
    sky: { threshold: config.sky.threshold },
    model: { name: MODEL_NAME, revision: MODEL_REVISION },
    bakedAt: new Date().toISOString(),
    sourceHash,
  };

  return {
    meta,
    depthRgba: packDepthRG16(upsampled.data),
    maskRgba: packMask(sky, edge),
    normalRgba: packNormal(normals.nx, normals.ny, normals.nz),
    depthWidth: depthW,
    depthHeight: depthH,
  };
}

export { loadDepthModel };
