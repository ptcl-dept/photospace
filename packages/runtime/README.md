# photospace-runtime

[`photospace-cli`](../cli) が焼き出したパッケージ5点セット(`photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json`)をブラウザで読み込み、デコード済みラスタとワールド座標復元用のヘルパーを返す軽量ローダー。特定のレンダラーに依存しないため、three.js・raw WebGL・Canvas2D いずれからも使える。

## インストール

```bash
npm install photospace-runtime
```

## 使い方

```ts
import { loadPackage, worldPositionFromMeta } from "photospace-runtime";

const pkg = await loadPackage("/sample/source/");
// pkg.photo:   ImageBitmap
// pkg.depth:   Float32Array (0..1, depthWidth x depthHeight)
// pkg.skyMask / pkg.edgeMask: Float32Array (0..1)
// pkg.normal:  { nx, ny, nz: Float32Array } (-1..1)

const [x, y, z] = worldPositionFromMeta(pkg.meta, u, v, disparity);
```

`loadPackage(baseUrl)` は `baseUrl` 配下の5ファイルを並列 fetch し、16bit パック済みの `depth.png`(R=上位8bit/G=下位8bit)をデコードして `Float32Array` に復元する。`meta.json` の `camera.fovDeg` / `camera.farRange` だけでワールド座標を計算できるので、シェーダー側は追加のパラメータを持つ必要がない。

自前のシェーダーに直接組み込みたい場合は `GLSL_SNIPPETS.unpackAndSampleDepth` / `GLSL_SNIPPETS.worldPosition` を使う。RG16 パックは GPU のバイリニア補間が使えないため、`unpackAndSampleDepth` は NEAREST サンプリング + 手動バイリニアで読む。

three.js での実装例は [`examples/three-scene`](../../examples/three-scene) を参照。

## パッケージフォーマット

[`docs/package-format.md`](../../docs/package-format.md) にフィールドの詳細と互換性ポリシーをまとめている。`meta.json` の `version` フィールドで将来のフォーマット変更に備える。

## ソースからビルド

```bash
pnpm install
pnpm --filter photospace-runtime build
```

`loader.ts` を `dist/loader.js`(ESM)+ `dist/loader.d.ts` にビルドする。
