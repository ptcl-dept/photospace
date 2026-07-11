# photospace-cli

写真から `photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json` のパッケージ5点セットを一括生成する CLI。単眼深度推定([Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small))を Node 上(CPU)で実行し、[`photospace-runtime`](../runtime) で読み込める形式に書き出す。

## インストール

```bash
npm install -g photospace-cli
```

または `npx photospace-cli` でインストールせずに実行できる。

Node 20 以上が必要。`sharp` と `onnxruntime-node` のネイティブバイナリを含むため、対応プラットフォーム(macOS/Linux/Windows の x64・arm64)でのみ動作する。

## 使い方

```bash
photospace bake ./photos --out ./out
```

- `<patterns...>`: 画像ファイルパス・globパターン・ディレクトリを複数指定できる(ディレクトリを渡すと直下の `jpg/jpeg/png/webp/avif/tiff` を対象にする)
- `--out <dir>`: 出力先ディレクトリ(既定 `out`)。ファイルごとに `out/<ファイル名>/` へ5点セットを書き出す
- `--config <path>`: `photospace.config.json` のパス(省略時は既定値)

写真バイト列 + config の SHA-256 ハッシュを `meta.json` の `sourceHash` に記録しており、同一入力で再実行した場合はベイクをスキップする。

## config.json

```json
{
  "version": 1,
  "camera": { "fovDeg": 55, "farRange": 12 },
  "sky": { "threshold": 0.03 },
  "depth": { "maxSize": 1024 },
  "photo": { "avifQuality": 50 }
}
```

| フィールド | 説明 |
| --- | --- |
| `camera.fovDeg` | ビューワが使う仮想カメラの垂直FOV(度) |
| `camera.farRange` | 視差 → 深度変換の奥行きレンジ |
| `sky.threshold` | この値未満の視差を空とみなし `mask.png` の R チャンネルに焼き込む |
| `depth.maxSize` | 出力する depth/mask/normal の長辺ピクセル数(ガイデッドフィルタで元写真解像度にスナップさせる) |
| `photo.avifQuality` | `photo.avif` のエンコード品質(0–100) |

ブラウザデモ側の「config.json」エクスポートボタンで、UI 上のスライダー値からこのファイルを生成できる。

## 出力フォーマット

書き出されるパッケージの詳細は [`docs/package-format.md`](../../docs/package-format.md) を参照。

## ソースからビルド

```bash
pnpm install
pnpm --filter photospace-cli build
node packages/cli/dist/index.js bake ./photos
```
