import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { glob } from "glob";
import {
  bakeFromDisparity,
  loadDepthModel,
  estimateDepth,
  normalizeDisparity,
  DEFAULT_CONFIG,
  computeSourceHash,
  nextMapMaxSize,
  type PhotoSpaceConfig,
  type PhotoFormat,
} from "photospace-core";
import { encodeMaps, encodePhotoSources, loadSourcePhoto, readExistingMeta, writePackage } from "./io.ts";

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
  const config: PhotoSpaceConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    camera: { ...DEFAULT_CONFIG.camera, ...raw.camera },
    sky: { ...DEFAULT_CONFIG.sky, ...raw.sky },
    depth: { ...DEFAULT_CONFIG.depth, ...raw.depth },
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

/** `photospace bake` の本体。1枚ずつ処理し、失敗しても他ファイルの処理は継続する */
export async function runBake(patterns: string[], opts: BakeCommandOptions): Promise<{ failed: number }> {
  const config = await loadConfig(opts.config, { mask: opts.mask, normal: opts.normal });
  const files = await resolveInputFiles(patterns);

  if (files.length === 0) {
    console.error("入力ファイルが見つかりませんでした:", patterns.join(", "));
    return { failed: 0 };
  }

  console.log(`${files.length}枚を処理します(config: ${opts.config ?? "既定値"})`);
  const model = await loadDepthModel();

  let failed = 0;
  let skipped = 0;
  for (const file of files) {
    const baseName = path.basename(file).replace(/\.[^.]+$/, "");
    const outDir = path.join(opts.out, baseName);
    try {
      const photoBytes = await readFile(file);
      const sourceHash = await computeSourceHash(photoBytes, config);
      const existing = await readExistingMeta(outDir);
      // configはハッシュに含まれるため通常は自動でリベイクされるが、旧version出力の温存を明示的に防ぐ
      if (existing?.sourceHash === sourceHash && existing.version === 2) {
        console.log(`skip  ${baseName} (変更なし)`);
        skipped++;
        continue;
      }

      const photo = await loadSourcePhoto(file);
      const result = await estimateDepth(model, photo.input);
      const normalized = normalizeDisparity(result.raw);
      const lowRes = { width: result.width, height: result.height, data: normalized.data };

      let mapMaxSize = config.depth.maxSize;
      let baked;
      let maps;
      while (true) {
        const effectiveConfig: PhotoSpaceConfig = {
          ...config,
          depth: { ...config.depth, maxSize: mapMaxSize },
        };
        baked = await bakeFromDisparity(photo, lowRes, { min: normalized.min, max: normalized.max }, {
          config: effectiveConfig,
        });
        maps = await encodeMaps({
          depthRgba: baked.depthRgba,
          maskRgba: baked.maskRgba,
          normalRgba: baked.normalRgba,
          width: baked.depthWidth,
          height: baked.depthHeight,
          compressionLevel: config.maps.pngCompressionLevel,
        });
        if (config.maps.maxBytes <= 0 || maps.totalBytes <= config.maps.maxBytes) break;
        const actualMaxSize = Math.max(baked.depthWidth, baked.depthHeight);
        if (actualMaxSize <= 64) {
          throw new Error(`maps.maxBytes=${config.maps.maxBytes}を最小解像度でも満たせませんでした。`);
        }
        mapMaxSize = nextMapMaxSize(actualMaxSize, maps.totalBytes, config.maps.maxBytes);
      }

      const photoSources = await encodePhotoSources(photo.bytes, config.photo);
      const firstPhoto = photoSources[0];
      baked.meta.sourceHash = sourceHash;
      baked.meta.photo = {
        file: firstPhoto.file,
        width: firstPhoto.width,
        height: firstPhoto.height,
        sources: photoSources.map(({ file, type }) => ({ file, type })),
      };
      await writePackage({
        outDir,
        photoSources,
        maps,
        meta: baked.meta,
      });
      console.log(`bake  ${baseName} -> ${outDir}`);
    } catch (e) {
      failed++;
      console.error(`FAIL  ${baseName}:`, (e as Error).message);
    }
  }

  console.log(`完了: ${files.length - skipped - failed}件ベイク / ${skipped}件スキップ / ${failed}件失敗`);
  return { failed };
}
