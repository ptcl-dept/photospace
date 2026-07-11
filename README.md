# Photo Space

1枚の写真から単眼深度推定でパララックス表現用のアセット一式(`photo.avif` / `depth.png` / `mask.png` / `normal.png` / `meta.json`)を作る。ブラウザだけで完結するデモビューワと、複数枚を一括処理する CLI の両方を持つ。

- **ブラウザデモ**(このリポジトリのルートアプリ): 写真をドロップすると、ブラウザ内(WebGPU/WASM)で深度推定 → カーソル追従の視差エフェクトをその場でプレビューできる。すべてローカルで完結し、サーバーには何も送信しない。「Package (.zip)」ボタンで CLI と同じ5点セット(`photo.avif`/`depth.png`/`mask.png`/`normal.png`/`meta.json`)をブラウザだけで焼いて zip ダウンロードでき、1枚だけなら CLI なしで完結する(AVIF エンコード非対応ブラウザでは写真を WebP/PNG で書き出し、`meta.json` に記録する)。
- **[`photospace-cli`](packages/cli)**: 同じ推論・パッキングロジックを Node で動かし、フォルダ内の画像をまとめてベイクする CLI(npm 公開予定)。
- **[`photospace-runtime`](packages/runtime)**: CLI が書き出したパッケージ5点セットをブラウザで読み込み、ワールド座標を復元する軽量ローダー(npm 公開予定)。three.js 等、任意のレンダラーから使える。

## リポジトリ構成

```
.
├── src/                 # ブラウザデモアプリ(Vite, private)
├── examples/three-scene # three.js からパッケージを読み込む受け入れ検証シーン
├── public/sample/source # サンプルのベイク済みパッケージ
└── packages/
    ├── core/            # 推論・正規化・アップサンプリング・パッキングの共有ロジック(非公開、viewer/CLI 双方が依存)
    ├── cli/              → photospace-cli としてnpm公開
    └── runtime/           → photospace-runtime としてnpm公開
```

`packages/core` は viewer アプリと CLI から共有される内部パッケージで、npm には公開しない(`private: true`)。

## セットアップ

```bash
pnpm install
```

Node 20 以上が必要(CLI は `sharp` / `onnxruntime-node` のネイティブバイナリに依存)。

## ブラウザデモを動かす

```bash
pnpm dev
```

初回はブラウザ内で深度推定モデル(~25–50MB, [`onnx-community/depth-anything-v2-small`](https://huggingface.co/onnx-community/depth-anything-v2-small))をダウンロードする。WebGPU 対応ブラウザでは WebGPU、非対応環境では WASM にフォールバックする。

## CLI を使う

```bash
pnpm --filter photospace-cli build
node packages/cli/dist/index.js bake ./photos --out ./out
```

詳細は [`packages/cli/README.md`](packages/cli/README.md) を参照。npm 公開後は `npx photospace-cli bake ...` で直接使える。

## パッケージフォーマット

CLI が書き出し、runtime が読み込む5点セットの仕様は [`docs/package-format.md`](docs/package-format.md) にまとめている。

## モデルのライセンスについて

既定モデル `onnx-community/depth-anything-v2-small` は Apache-2.0 で商用利用可。Depth Anything V2 の Base/Large バリアントに切り替える場合は CC-BY-NC-4.0(非商用限定)なので、モデルを変更する際は必ず各モデルカードのライセンスを確認すること。

## テスト・型チェック

```bash
pnpm test        # packages/*/test, src/*/*.test.ts のユニットテスト
pnpm typecheck   # 全ワークスペース(ルートapp含む)の型チェック
```
