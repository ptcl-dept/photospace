#!/usr/bin/env node
import { Command } from "commander";
import { runBake } from "./bake.ts";

const program = new Command();
program.name("photospace").description("Photospace CLI — 深度推定パッケージの一括ベイク");

program
  .command("bake")
  .description("写真候補とdepth.png/meta.json(+オプションのmask/normal)を含むパッケージを一括生成する")
  .argument("<patterns...>", "入力画像のパス・globパターン・ディレクトリ")
  .option("--config <path>", "photospace.config.json のパス")
  .option("--out <dir>", "出力先ディレクトリ", "out")
  .option("--mask", "mask.png(空マスク+エッジマスク)を同梱する")
  .option("--normal", "normal.png(ワールド法線)を同梱する")
  .action(async (patterns: string[], options: { config?: string; out: string; mask?: boolean; normal?: boolean }) => {
    const { failed } = await runBake(patterns, options);
    if (failed > 0) process.exitCode = 1;
  });

program.parseAsync(process.argv);
