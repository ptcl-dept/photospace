import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  // photospace-core は private ワークスペースパッケージなので npm には公開しない。
  // 外部 import のまま publish すると install 時に依存解決が失敗するため、CLI にバンドルする。
  noExternal: ["photospace-core"],
  // @huggingface/transformers はネイティブ/WASM を含む大型依存。バンドルせず external に残し、
  // CLI の dependencies として install させる(core 経由で transitive に必要)。
  external: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
});
