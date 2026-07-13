#!/usr/bin/env node
import { Command } from "commander";
import { runBake } from "./bake.ts";

const program = new Command();
program.name("photospace").description("Photospace CLI — 深度推定パッケージの一括ベイク");

program
  .command("bake")
  .description("写真候補とdepth/mask/normalを含むパッケージを一括生成する")
  .argument("<patterns...>", "入力画像のパス・globパターン・ディレクトリ")
  .option("--config <path>", "photospace.config.json のパス")
  .option("--out <dir>", "出力先ディレクトリ", "out")
  .action(async (patterns: string[], options: { config?: string; out: string }) => {
    const { failed } = await runBake(patterns, options);
    if (failed > 0) process.exitCode = 1;
  });

program.parseAsync(process.argv);
