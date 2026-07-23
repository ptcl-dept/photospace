/**
 * photospace CLI が書き出す meta.json の型。version 1(旧形式)と2の両方を読む。
 * v2の書き込み側の型は packages/core/src/pack.ts の PhotoSpaceMeta と同じ形。
 * runtime はビルド後に単体で配布されるため、コア側の型をimportせずここに複製している。
 */
interface PhotoSpaceMetaShared {
  source: { file: string; width: number; height: number };
  /** fileは旧runtime向け第一候補。新runtimeはsourcesを記載順にデコードする。 */
  photo?: {
    file: string;
    width?: number;
    height?: number;
    sources?: Array<{ file: string; type: string }>;
  };
  depth: {
    width: number;
    height: number;
    space: "disparity";
    orientation: "near=1";
    normalization: { min: number; max: number };
  };
  camera: { fovDeg: number; farRange: number };
  sky: { threshold: number };
  model: { name: string; revision: string };
  bakedAt: string;
  sourceHash: string;
}

/** v1: mask.png/normal.pngが常に同梱され、metaに宣言フィールドを持たない */
export interface PhotoSpaceMetaV1 extends PhotoSpaceMetaShared {
  version: 1;
}

/** v2: photo.jpgが必須の最終フォールバック。mask/normalはフィールドが存在する場合のみ同梱 */
export interface PhotoSpaceMetaV2 extends PhotoSpaceMetaShared {
  version: 2;
  mask?: { file: string };
  normal?: { file: string };
}

export type PhotoSpaceMeta = PhotoSpaceMetaV1 | PhotoSpaceMetaV2;

/** depth.png(R=上位8bit, G=下位8bit)を復元する。d = (R*256 + G) / 65535 */
function unpackDepthRG16(rgba: Uint8Array | Uint8ClampedArray): Float32Array {
  const count = rgba.length / 4;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = rgba[i * 4] * 256 + rgba[i * 4 + 1];
    out[i] = v / 65535;
  }
  return out;
}

function toZ(d: number, far: number): number {
  const disp = (1 - d) / far + d; // mix(1/far, 1, d)
  return 1 / disp;
}

/** uv(0..1)と視差dから、現行ビューワのwpos()と同じ式でワールド座標を求める */
function worldPosition(
  u: number,
  v: number,
  d: number,
  aspect: number,
  tanHalfFov: number,
  farRange: number,
): [number, number, number] {
  const z = toZ(d, farRange);
  const sx = (u * 2 - 1) * aspect * tanHalfFov;
  const sy = (v * 2 - 1) * tanHalfFov;
  return [sx * z, sy * z, -z];
}

export interface PhotoSpacePackage {
  meta: PhotoSpaceMeta;
  /** meta.photo.sourcesのうち最初にデコードできた写真(テクスチャソースとしてそのまま使える) */
  photo: ImageBitmap;
  /** 復元済みの視差値(0..1)。 depthWidth x depthHeight */
  depth: Float32Array;
  depthWidth: number;
  depthHeight: number;
  /** 0..1 (1=空)。mask.png同梱時のみ(v1パッケージは常に同梱) */
  skyMask?: Float32Array;
  /** 0..1 (1=非エッジ、現行ビューワのedge変数と同じ極性)。mask.png同梱時のみ */
  edgeMask?: Float32Array;
  /** normal.png同梱時のみ(v1パッケージは常に同梱) */
  normal?: { nx: Float32Array; ny: Float32Array; nz: Float32Array };
}

async function fetchImageRaster(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`画像を取得できませんでした: ${url} (${response.status})`);
  const blob = await response.blob();
  // depth/mask/normalは色ではなくデータなので、ブラウザの色管理によるピクセル値変換を無効化する
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const im = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: im.data, width: bitmap.width, height: bitmap.height };
}

/** metaから取得すべきマップファイル名を決める。v1は全マップ必須、v2は宣言されたものだけ */
export function packageMapFiles(meta: PhotoSpaceMeta): { mask?: string; normal?: string } {
  if (meta.version === 1) return { mask: "mask.png", normal: "normal.png" };
  if (meta.version === 2) return { mask: meta.mask?.file, normal: meta.normal?.file };
  throw new Error(`未対応のパッケージversionです: ${(meta as { version: number }).version}`);
}

export function photoFileCandidates(meta: PhotoSpaceMeta): string[] {
  const files = meta.photo?.sources?.map((source) => source.file) ?? [];
  if (meta.photo) files.push(meta.photo.file);
  // v2はphoto.jpgが必須なので常に最終候補へ。v1は従来どおりphoto.avifを既定にする。
  files.push(meta.version === 2 ? "photo.jpg" : (meta.photo?.file ?? "photo.avif"));
  return [...new Set(files)];
}

async function fetchPhotoBitmap(base: string, meta: PhotoSpaceMeta): Promise<ImageBitmap> {
  const failures: string[] = [];
  for (const file of photoFileCandidates(meta)) {
    try {
      const response = await fetch(new URL(file, base));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await createImageBitmap(await response.blob());
    } catch (error) {
      failures.push(`${file}: ${(error as Error).message}`);
    }
  }
  throw new Error(`写真をデコードできませんでした (${failures.join(", ")})`);
}

/** baseUrl配下の写真/depth.png/meta.json(+metaが宣言するmask/normal)を読み込む */
export async function loadPackage(baseUrl: string | URL): Promise<PhotoSpacePackage> {
  const normalized = typeof baseUrl === "string" && !baseUrl.endsWith("/") ? baseUrl + "/" : baseUrl;
  const base = new URL(normalized, location.href).toString();

  const metaResponse = await fetch(new URL("meta.json", base));
  if (!metaResponse.ok) throw new Error(`meta.jsonを取得できませんでした (${metaResponse.status})`);
  const meta: PhotoSpaceMeta = await metaResponse.json();
  const mapFiles = packageMapFiles(meta); // 未対応versionはここでthrow

  const [depthRaster, maskRaster, normalRaster, photo] = await Promise.all([
    fetchImageRaster(new URL("depth.png", base).toString()),
    mapFiles.mask ? fetchImageRaster(new URL(mapFiles.mask, base).toString()) : undefined,
    mapFiles.normal ? fetchImageRaster(new URL(mapFiles.normal, base).toString()) : undefined,
    fetchPhotoBitmap(base, meta),
  ]);

  const depth = unpackDepthRG16(depthRaster.data);
  const count = depth.length;

  let skyMask: Float32Array | undefined;
  let edgeMask: Float32Array | undefined;
  if (maskRaster) {
    skyMask = new Float32Array(count);
    edgeMask = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      skyMask[i] = maskRaster.data[i * 4] / 255;
      edgeMask[i] = maskRaster.data[i * 4 + 1] / 255;
    }
  }

  let normal: PhotoSpacePackage["normal"];
  if (normalRaster) {
    const nx = new Float32Array(count);
    const ny = new Float32Array(count);
    const nz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      nx[i] = (normalRaster.data[i * 4] / 255) * 2 - 1;
      ny[i] = (normalRaster.data[i * 4 + 1] / 255) * 2 - 1;
      nz[i] = (normalRaster.data[i * 4 + 2] / 255) * 2 - 1;
    }
    normal = { nx, ny, nz };
  }

  return {
    meta,
    photo,
    depth,
    depthWidth: meta.depth.width,
    depthHeight: meta.depth.height,
    skyMask,
    edgeMask,
    normal,
  };
}

/** meta.json の camera 情報を使い、uv+視差からワールド座標を逆算する */
export function worldPositionFromMeta(meta: PhotoSpaceMeta, u: number, v: number, disparity: number): [number, number, number] {
  const aspect = meta.source.width / meta.source.height;
  const tanHalfFov = Math.tan((meta.camera.fovDeg * Math.PI) / 360);
  return worldPosition(u, v, disparity, aspect, tanHalfFov, meta.camera.farRange);
}

/**
 * 自前のシェーダーに埋め込めるGLSLスニペット。RG16パックはGPUのバイリニア補間が使えないため、
 * NEARESTサンプリング + 手動バイリニア(dsp)で読む必要がある(現行ビューワと同じ方式)。
 * 使用側はuDep(sampler2D)とuDRes(vec2)のuniformを用意すること。
 */
export const GLSL_SNIPPETS = {
  unpackAndSampleDepth: `
float dsp(sampler2D uDep, vec2 uDRes, vec2 uv){
  vec2 stx=vec2(uv.x,1.0-uv.y)*uDRes-0.5;
  vec2 f=fract(stx);
  ivec2 i0=ivec2(floor(stx));
  ivec2 mx=ivec2(uDRes)-1;
  float a=texelFetch(uDep,clamp(i0,ivec2(0),mx),0).r;
  float b=texelFetch(uDep,clamp(i0+ivec2(1,0),ivec2(0),mx),0).r;
  float c=texelFetch(uDep,clamp(i0+ivec2(0,1),ivec2(0),mx),0).r;
  float d=texelFetch(uDep,clamp(i0+ivec2(1,1),ivec2(0),mx),0).r;
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}`.trim(),
  worldPosition: `
float toZ(float d, float uFar){return 1.0/mix(1.0/uFar,1.0,d);}
vec3 wpos(vec2 uv, float d, float aspect, float uTanF, float uFar){
  float z=toZ(d,uFar);
  vec2 s=(uv*2.-1.)*vec2(aspect,1.)*uTanF;
  return vec3(s*z,-z);
}`.trim(),
};
