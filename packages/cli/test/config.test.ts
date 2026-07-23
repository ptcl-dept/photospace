import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/bake.ts";

async function writeConfig(json: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "photospace-config-"));
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify(json));
  return file;
}

test("loadConfig defaults include jpeg and disable extra maps", async () => {
  const config = await loadConfig();
  assert.ok(config.photo.formats.includes("jpeg"));
  assert.equal(config.maps.mask, false);
  assert.equal(config.maps.normal, false);
});

test("loadConfig rejects photo.formats without jpeg", async () => {
  const file = await writeConfig({ photo: { formats: ["avif"] } });
  await assert.rejects(loadConfig(file), /jpeg/);
});

test("loadConfig rejects non-boolean maps.mask", async () => {
  const file = await writeConfig({ maps: { mask: "yes" } });
  await assert.rejects(loadConfig(file), /maps\.mask/);
});

test("loadConfig defaults model.dtype to fp32 and accepts q8", async () => {
  assert.equal((await loadConfig()).model.dtype, "fp32");
  const file = await writeConfig({ model: { dtype: "q8" } });
  assert.equal((await loadConfig(file)).model.dtype, "q8");
});

test("loadConfig rejects unknown model.dtype", async () => {
  const file = await writeConfig({ model: { dtype: "fp64" } });
  await assert.rejects(loadConfig(file), /model\.dtype/);
});

test("loadConfig applies flag overrides on top of config values", async () => {
  const file = await writeConfig({ maps: { mask: false, normal: true } });
  const config = await loadConfig(file, { mask: true });
  assert.equal(config.maps.mask, true);
  assert.equal(config.maps.normal, true);
});
