import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { glob } from "glob";
import {
  bakeFromDisparity,
  loadDepthModel,
  estimateDepth,
  normalizeDisparity,
  DEFAULT_CONFIG,
  MODEL_DTYPES,
  computeSourceHash,
  nextMapMaxSize,
  type PhotoSpaceConfig,
  type PhotoFormat,
  type ModelDtype,
  type DepthModel,
  type BakedPackage,
  type SourcePhoto,
} from "photospace-core";
import {
  encodeMaps,
  encodePhotoSources,
  loadSourcePhoto,
  readExistingMeta,
  writePackage,
  type EncodedMaps,
} from "./io.ts";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "tiff"];

export interface BakeCommandOptions {
  config?: string;
  out: string;
  /** config値に対する上書き有効化(--mask / --normal フラグ) */
  mask?: boolean;
  normal?: boolean;
}

export interface ConfigOverrides {
  mask?: boolean;
  normal?: boolean;
}

export async function loadConfig(configPath?: string, overrides: ConfigOverrides = {}): Promise<PhotoSpaceConfig> {
  const raw = configPath ? (JSON.parse(await readFile(configPath, "utf-8")) as Partial<PhotoSpaceConfig>) : {};
  const formats = raw.photo?.formats ?? DEFAULT_CONFIG.photo.formats;
  const supported = new Set<PhotoFormat>(["avif", "webp", "jpeg"]);
  if (!Array.isArray(formats) || formats.some((format) => !supported.has(format))) {
    throw new Error("photo.formatsには avif/webp/jpeg のみ指定できます。");
  }
  if (!formats.includes("jpeg")) {
    throw new Error("photo.formatsにはjpegを含めてください(パッケージはphoto.jpgを必須の最終フォールバックとします)。");
  }
  for (const key of ["mask", "normal"] as const) {
    const value = raw.maps?.[key];
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`maps.${key}はtrue/falseで指定してください。`);
    }
  }
  const dtype = raw.model?.dtype;
  if (dtype !== undefined && !MODEL_DTYPES.includes(dtype as ModelDtype)) {
    throw new Error(`model.dtypeは ${MODEL_DTYPES.join("/")} のいずれかで指定してください。`);
  }
  const config: PhotoSpaceConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    camera: { ...DEFAULT_CONFIG.camera, ...raw.camera },
    sky: { ...DEFAULT_CONFIG.sky, ...raw.sky },
    depth: { ...DEFAULT_CONFIG.depth, ...raw.depth },
    model: { ...DEFAULT_CONFIG.model, ...raw.model },
    maps: {
      ...DEFAULT_CONFIG.maps,
      ...raw.maps,
      ...(overrides.mask !== undefined ? { mask: overrides.mask } : {}),
      ...(overrides.normal !== undefined ? { normal: overrides.normal } : {}),
    },
    photo: { ...DEFAULT_CONFIG.photo, ...raw.photo, formats },
  };
  const checks: Array<[string, number, number, number]> = [
    ["depth.maxSize", config.depth.maxSize, 64, 8192],
    ["maps.maxBytes", config.maps.maxBytes, 0, Number.MAX_SAFE_INTEGER],
    ["maps.pngCompressionLevel", config.maps.pngCompressionLevel, 0, 9],
    ["photo.maxSize", config.photo.maxSize, 64, 16384],
    ["photo.avifQuality", config.photo.avifQuality, 0, 100],
    ["photo.webpQuality", config.photo.webpQuality, 0, 100],
    ["photo.jpegQuality", config.photo.jpegQuality, 0, 100],
  ];
  for (const [name, value, min, max] of checks) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name}は${min}〜${max}で指定してください。`);
    }
  }
  if (!Number.isInteger(config.depth.maxSize) || !Number.isInteger(config.photo.maxSize) ||
      !Number.isInteger(config.maps.maxBytes) || !Number.isInteger(config.maps.pngCompressionLevel)) {
    throw new Error("maxSize、maxBytes、pngCompressionLevelは整数で指定してください。");
  }
  return config;
}

async function resolveInputFiles(patterns: string[]): Promise<string[]> {
  const results = new Set<string>();
  for (const pattern of patterns) {
    let isDir = false;
    try {
      isDir = (await stat(pattern)).isDirectory();
    } catch {
      // not an existing path; treat as glob pattern
    }
    const matches = isDir
      ? await glob(`${pattern.replace(/\/$/, "")}/*.{${IMAGE_EXTENSIONS.join(",")}}`, { nocase: true })
      : await glob(pattern, { nocase: true });
    for (const m of matches) results.add(path.resolve(m));
  }
  return [...results].sort();
}

type PreparedInput =
  | { kind: "skip"; baseName: string }
  | { kind: "error"; baseName: string; error: Error }
  | { kind: "photo"; baseName: string; outDir: string; photo: SourcePhoto; sourceHash: string };

/** 入力1枚の読み込み・スキップ判定・デコード。前の写真の推論と重ねて先読みできるよう独立させている */
async function prepareInput(file: string, outRoot: string, config: PhotoSpaceConfig): Promise<PreparedInput> {
  const baseName = path.basename(file).replace(/\.[^.]+$/, "");
  const outDir = path.join(outRoot, baseName);
  try {
    const photoBytes = await readFile(file);
    const sourceHash = await computeSourceHash(photoBytes, config);
    const existing = await readExistingMeta(outDir);
    // configはハッシュに含まれるため通常は自動でリベイクされるが、旧version出力の温存を明示的に防ぐ
    if (existing?.sourceHash === sourceHash && existing.version === 2) {
      return { kind: "skip", baseName };
    }
    const photo = await loadSourcePhoto(file);
    return { kind: "photo", baseName, outDir, photo, sourceHash };
  } catch (e) {
    return { kind: "error", baseName, error: e as Error };
  }
}

/**
 * 推論からマップPNGエンコードまで。maps.maxBytes超過時は解像度を下げて再試行する。
 * sourceHashは計算済みの値を渡し、再試行時に写真バイト列のSHA-256を再計算しない。
 */
async function bakeWithSizeLimit(
  model: DepthModel,
  photo: SourcePhoto,
  config: PhotoSpaceConfig,
  sourceHash: string,
): Promise<{ baked: BakedPackage; maps: EncodedMaps }> {
  const result = await estimateDepth(model, photo.input);
  const normalized = normalizeDisparity(result.raw);
  const lowRes = { width: result.width, height: result.height, data: normalized.data };

  let mapMaxSize = config.depth.maxSize;
  while (true) {
    const effectiveConfig: PhotoSpaceConfig = {
      ...config,
      depth: { ...config.depth, maxSize: mapMaxSize },
    };
    const baked = await bakeFromDisparity(photo, lowRes, { min: normalized.min, max: normalized.max }, {
      config: effectiveConfig,
      sourceHash,
    });
    const maps = await encodeMaps({
      depthRgba: baked.depthRgba,
      maskRgba: baked.maskRgba,
      normalRgba: baked.normalRgba,
      width: baked.depthWidth,
      height: baked.depthHeight,
      compressionLevel: config.maps.pngCompressionLevel,
    });
    if (config.maps.maxBytes <= 0 || maps.totalBytes <= config.maps.maxBytes) return { baked, maps };
    const actualMaxSize = Math.max(baked.depthWidth, baked.depthHeight);
    if (actualMaxSize <= 64) {
      throw new Error(`maps.maxBytes=${config.maps.maxBytes}を最小解像度でも満たせませんでした。`);
    }
    mapMaxSize = nextMapMaxSize(actualMaxSize, maps.totalBytes, config.maps.maxBytes);
  }
}

/** 写真の各フォーマットへのエンコードとパッケージ書き出し。次の写真の推論と重ねて実行される */
async function finalizePackage(
  prepared: { photo: SourcePhoto; outDir: string },
  baked: BakedPackage,
  maps: EncodedMaps,
  config: PhotoSpaceConfig,
): Promise<void> {
  const photoSources = await encodePhotoSources(prepared.photo.bytes, config.photo);
  const firstPhoto = photoSources[0];
  // meta.sourceHashはbakeFromDisparityへ渡した計算済みハッシュが既に入っている
  baked.meta.photo = {
    file: firstPhoto.file,
    width: firstPhoto.width,
    height: firstPhoto.height,
    sources: photoSources.map(({ file, type }) => ({ file, type })),
  };
  await writePackage({
    outDir: prepared.outDir,
    photoSources,
    maps,
    meta: baked.meta,
  });
}

/**
 * `photospace bake` の本体。推論は1枚ずつ直列だが、次の写真の読み込み・デコード(先読み1枚)と
 * 前の写真のエンコード・書き出し(後段1枚)を推論とオーバーラップさせる小さなパイプラインで回す。
 * 1枚失敗しても他ファイルの処理は継続する。
 */
export async function runBake(patterns: string[], opts: BakeCommandOptions): Promise<{ failed: number }> {
  const config = await loadConfig(opts.config, { mask: opts.mask, normal: opts.normal });
  const files = await resolveInputFiles(patterns);

  if (files.length === 0) {
    console.error("入力ファイルが見つかりませんでした:", patterns.join(", "));
    return { failed: 0 };
  }

  console.log(`${files.length}枚を処理します(config: ${opts.config ?? "既定値"})`);
  const model = await loadDepthModel({ dtype: config.model.dtype });

  let failed = 0;
  let skipped = 0;
  let pendingFinalize: Promise<void> | null = null;
  let nextPrepared = prepareInput(files[0], opts.out, config);
  for (let i = 0; i < files.length; i++) {
    const prepared = await nextPrepared;
    // 先読み: 現在の写真の推論中に次の写真の読み込み・デコードを進める
    if (i + 1 < files.length) nextPrepared = prepareInput(files[i + 1], opts.out, config);

    if (prepared.kind === "skip") {
      console.log(`skip  ${prepared.baseName} (変更なし)`);
      skipped++;
      continue;
    }
    if (prepared.kind === "error") {
      failed++;
      console.error(`FAIL  ${prepared.baseName}:`, prepared.error.message);
      continue;
    }

    let result;
    try {
      result = await bakeWithSizeLimit(model, prepared.photo, config, prepared.sourceHash);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${prepared.baseName}:`, (e as Error).message);
      continue;
    }

    // 後段は1枚分だけ先行を許す(並列度は固定)。前の書き出し完了を待ってから次を投入する
    if (pendingFinalize) await pendingFinalize;
    pendingFinalize = finalizePackage(prepared, result.baked, result.maps, config).then(
      () => console.log(`bake  ${prepared.baseName} -> ${prepared.outDir}`),
      (e: Error) => {
        failed++;
        console.error(`FAIL  ${prepared.baseName}:`, e.message);
      },
    );
  }
  if (pendingFinalize) await pendingFinalize;

  console.log(`完了: ${files.length - skipped - failed}件ベイク / ${skipped}件スキップ / ${failed}件失敗`);
  return { failed };
}
