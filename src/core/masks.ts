import type { RasterF32 } from "./upsample.ts";

/**
 * エッジマスクの感度。深度勾配のどこからエッジとみなすかの閾値で、
 * meta.json化されるsky.thresholdと違いv1では調整UIを持たず固定値とする
 * (現index.htmlプロトタイプの既定値 uEdge=0.05 を踏襲)。
 */
const EDGE_THRESHOLD = 0.05;

/** depth < threshold の画素を空とみなす (1=空, 0=非空) */
export function computeSkyMask(depth: RasterF32, threshold: number): Float32Array {
  const out = new Float32Array(depth.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = depth.data[i] < threshold ? 1 : 0;
  }
  return out;
}

/**
 * 深度の勾配(不連続度)からエッジマスクを算出する。値が大きいほどシルエット(輪郭)。
 * 現プロトタイプのシェーダー内 rel/edge 計算をCPU向けに移植したもの。
 */
export function computeEdgeMask(depth: RasterF32, threshold = EDGE_THRESHOLD): Float32Array {
  const { width: w, height: h, data } = depth;
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = Math.max(data[i], 1e-4);
      const xr = Math.min(x + 1, w - 1);
      const xl = Math.max(x - 1, 0);
      const yd = Math.min(y + 1, h - 1);
      const yu = Math.max(y - 1, 0);
      const dx = (data[y * w + xr] - data[y * w + xl]) * 0.5;
      const dy = (data[yd * w + x] - data[yu * w + x]) * 0.5;
      const rel = Math.sqrt(dx * dx + dy * dy) / d;
      // smoothstep(threshold, threshold*3, rel) の 1-x 版
      const t = clamp01((rel - threshold) / (threshold * 2));
      const smooth = t * t * (3 - 2 * t);
      out[i] = 1 - smooth;
    }
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
