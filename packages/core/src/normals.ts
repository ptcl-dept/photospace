import type { RasterF32 } from "./upsample.ts";

export interface NormalRaster {
  width: number;
  height: number;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
}

function toZ(d: number, far: number): number {
  const disp = (1 - d) / far + d; // mix(1/far, 1, d)
  return 1 / disp;
}

/** uv(0..1)と視差dから、現行ビューワのwpos()と同じ式でワールド座標を求める */
export function worldPosition(
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

/**
 * アップサンプリング後の深度 + カメラFOVから、被写体表面のワールド法線を計算する。
 * 現行ビューワのFSで行っているcross(dFdx(pos),dFdy(pos))と同じ考え方をCPUの中心差分で再現。
 */
export function computeNormals(depth: RasterF32, fovDeg: number, farRange: number): NormalRaster {
  const { width: w, height: h, data } = depth;
  const aspect = w / h;
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);

  const nx = new Float32Array(w * h);
  const ny = new Float32Array(w * h);
  const nz = new Float32Array(w * h);

  const pos = (x: number, y: number): [number, number, number] => {
    const xi = Math.min(Math.max(x, 0), w - 1);
    const yi = Math.min(Math.max(y, 0), h - 1);
    const u = (xi + 0.5) / w;
    const v = (yi + 0.5) / h;
    return worldPosition(u, v, data[yi * w + xi], aspect, tanHalfFov, farRange);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = pos(x, y);
      const pxr = pos(x + 1, y);
      const pxl = pos(x - 1, y);
      const pyd = pos(x, y + 1);
      const pyu = pos(x, y - 1);
      const dPosX: [number, number, number] = [
        (pxr[0] - pxl[0]) * 0.5,
        (pxr[1] - pxl[1]) * 0.5,
        (pxr[2] - pxl[2]) * 0.5,
      ];
      const dPosY: [number, number, number] = [
        (pyd[0] - pyu[0]) * 0.5,
        (pyd[1] - pyu[1]) * 0.5,
        (pyd[2] - pyu[2]) * 0.5,
      ];
      let n = cross(dPosX, dPosY);
      n = normalize(n);
      if (dot(n, [-p[0], -p[1], -p[2]]) < 0) {
        n = [-n[0], -n[1], -n[2]];
      }
      const i = y * w + x;
      nx[i] = n[0];
      ny[i] = n[1];
      nz[i] = n[2];
    }
  }

  return { width: w, height: h, nx, ny, nz };
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(dot(v, v)) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
