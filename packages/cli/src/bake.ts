import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { glob } from "glob";
import { bakePhoto, loadDepthModel, DEFAULT_CONFIG, computeSourceHash, type PhotoSpaceConfig } from "photospace-core";
import { loadSourcePhoto, readExistingMeta, writePackage } from "./io.ts";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "tiff"];

export interface BakeCommandOptions {
  config?: string;
  out: string;
}

async function loadConfig(configPath?: string): Promise<PhotoSpaceConfig> {
  if (!configPath) return DEFAULT_CONFIG;
  const text = await readFile(configPath, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(text) } as PhotoSpaceConfig;
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
  const config = await loadConfig(opts.config);
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
      if (existing?.sourceHash === sourceHash) {
        console.log(`skip  ${baseName} (変更なし)`);
        skipped++;
        continue;
      }

      const photo = await loadSourcePhoto(file);
      const baked = await bakePhoto(photo, { model, config });
      await writePackage({
        outDir,
        photoBytes: photo.bytes,
        photoWidth: photo.width,
        photoHeight: photo.height,
        avifQuality: config.photo.avifQuality,
        depthRgba: baked.depthRgba,
        maskRgba: baked.maskRgba,
        normalRgba: baked.normalRgba,
        depthWidth: baked.depthWidth,
        depthHeight: baked.depthHeight,
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
