# パッケージフォーマット (version 1)

[`photospace-cli`](../packages/cli) の `bake` コマンドは、1枚の写真ごとに以下5ファイルを1ディレクトリへ書き出す。[`photospace-runtime`](../packages/runtime) はこの5点セットだけを前提に読み込む。ブラウザデモ([`src/main.ts`](../src/main.ts))の「Package (.zip)」ボタンも同じ `photospace-core` のロジックでこの5点セットを直接生成し、1つの zip にまとめてダウンロードする(CLIなしで1枚だけ試したい場合用)。

```
out/<name>/
├── photo.avif    # 元写真(AVIF再エンコード。meta.photo.file 指定時は photo.webp / photo.png のことがある)
├── depth.png     # 視差(RG16パック)
├── mask.png      # 空マスク(R) + エッジマスク(G)
├── normal.png    # ワールド法線(RGB)
└── meta.json     # カメラ・正規化パラメータ
```

いずれかのファイルが欠けている、または `meta.json.version` が非対応の場合、`loadPackage()` は失敗する。

写真のファイル名は既定で `photo.avif`。`canvas.toBlob()` の AVIF エンコードは Chrome/Edge を含む多くのブラウザで未対応のため、ブラウザ export は AVIF → WebP → PNG の順にフォールバックし、実際のファイル名を `meta.json` の `photo.file` に記録する。`photospace-runtime` の `loadPackage()` は `meta.photo?.file ?? "photo.avif"` を読む。CLI(sharp)は常に AVIF で書き出すので `photo` フィールドを省略する。

## meta.json

```ts
interface PhotoSpaceMeta {
  version: 1;
  source: { file: string; width: number; height: number };
  photo?: { file: string }; // パッケージ内の写真ファイル名。省略時は "photo.avif"
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
  bakedAt: string; // ISO8601
  sourceHash: string; // sha256(photoBytes + configJson)、CLIの再ベイクスキップ判定に使用
}
```

- `depth.space: "disparity"` / `orientation: "near=1"`: 深度ではなく視差(近いほど値が大きい)を保持する。`depth.normalization` はモデルが出力した生の視差レンジ(推論後・正規化前)を記録しており、`depth.png` 自体には正規化済み(0..1)の値が入る。
- `camera.fovDeg` / `camera.farRange`: 視差 → ワールド座標変換に必要な唯一のパラメータ。以下の式で z を求める(`toZ`)。

  ```
  disp = mix(1/farRange, 1, d)   // d: 0..1 の正規化視差
  z    = 1 / disp
  x    = (u*2-1) * aspect * tan(fovDeg/2) * z
  y    = (v*2-1) *          tan(fovDeg/2) * z
  ```

- `sky.threshold`: この閾値未満の視差を空とみなした(`mask.png` の R チャンネル生成に使用)値をそのまま記録している。

## depth.png — 視差の RG16 パック

8bit PNG では 256 段階しか表現できず深度の帯状アーティファクトが出るため、16bit 値を2チャンネルに分けて格納する。

```
R = (d16 >> 8) & 0xff   // 上位8bit
G =  d16       & 0xff   // 下位8bit
B = 0, A = 255
d16 = round(clamp01(d) * 65535)
```

復元は `d = (R*256 + G) / 65535`。GPU のバイリニア補間はこのパッキングに対して使えない(R/Gをまたぐ補間が壊れる)ため、シェーダーでサンプリングする場合は NEAREST + 手動バイリニアが必要(`photospace-runtime` の `GLSL_SNIPPETS.unpackAndSampleDepth` を参照)。

## mask.png

```
R = round(clamp01(skyMask)  * 255)  // 1=空
G = round(clamp01(edgeMask) * 255)  // 1=非エッジ(シルエットに近いほど0に近づく)
B = 0, A = 255
```

## normal.png

ワールド法線(-1..1)を `n*0.5+0.5` で 0..1 にマップして RGB へ格納する(A=255)。

## 互換性ポリシー

`meta.json.version` はフォーマットが後方互換性を壊す形で変わった場合にのみ上げる。`photospace-runtime` は現時点で `version: 1` のみをサポートする。将来 `version: 2` を追加する場合、`loadPackage()` は `meta.version` を見て分岐するか、非対応バージョンで明示的にエラーを投げること。
