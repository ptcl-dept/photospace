import "./style.css";
import { Viewer } from "./viewer/gl.ts";
import { bindDropzone } from "./ui/dropzone.ts";
import { bindButtonGroup, bindSlider } from "./ui/controls.ts";
import { downloadDepthPng, downloadConfig } from "./ui/exports.ts";
import { loadDepthModel, estimateDepth, type DepthModel } from "./core/depth.ts";
import { normalizeDisparity } from "./core/normalize.ts";
import { DEFAULT_CONFIG, type PhotoSpaceConfig } from "./core/pack.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>("cv");
const drop = $<HTMLElement>("drop");
const fileInput = $<HTMLInputElement>("file");
const statusEl = $<HTMLElement>("status");
const bar = $<HTMLElement>("bar");
const barIn = bar.firstElementChild as HTMLElement;
const errBox = $<HTMLElement>("err");
const stage = $<HTMLElement>("stage");

let viewer: Viewer | null = null;
let depther: DepthModel | null = null;
let ready = false;
let currentDepth01: Float32Array | null = null;

function fail(msg: string): void {
  errBox.style.display = "block";
  errBox.textContent = msg;
  statusEl.textContent = "Error";
}

bindButtonGroup(["m0", "m1", "m2"], (i) => viewer && (viewer.state.mode = i as 0 | 1 | 2));
bindButtonGroup(["s0", "s1"], (i) => viewer && (viewer.state.space = i as 0 | 1));
bindButtonGroup(["v0", "v1", "v2"], (i) => viewer && (viewer.state.view = i as 0 | 1 | 2));
bindSlider("fov", "fovV", (v) => viewer && (viewer.state.fov = v), (v) => v + "°");
bindSlider("far", "farV", (v) => viewer && (viewer.state.far = v), (v) => v.toFixed(1).replace(/\.0$/, ""));
bindSlider("sky", "skyV", (v) => viewer && (viewer.state.sky = v), (v) => v.toFixed(3).replace(/^0/, ""));
bindSlider("rad", "radV", (v) => viewer && (viewer.state.rad = v), (v) => v.toFixed(2).replace(/0$/, ""));
bindSlider("edg", "edgV", (v) => viewer && (viewer.state.edg = v), (v) => v.toFixed(3).replace(/^0/, ""));

bindDropzone(drop, fileInput, loadImage);

$<HTMLButtonElement>("rst").onclick = () => {
  ready = false;
  viewer?.stop();
  cv.style.display = "none";
  drop.style.display = "block";
  statusEl.textContent = "Idle";
};

async function getModel(): Promise<DepthModel> {
  if (depther) return depther;
  statusEl.textContent = "Loading model…";
  bar.style.display = "block";
  depther = await loadDepthModel({
    onProgress: (p) => {
      if (p.status === "progress" && p.total) {
        barIn.style.width = Math.round(p.progress ?? 0) + "%";
      }
    },
  });
  statusEl.textContent = "Model ready";
  bar.style.display = "none";
  return depther;
}

async function loadImage(file: File): Promise<void> {
  errBox.style.display = "none";
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Failed to read the file"));
    r.readAsDataURL(file);
  });
  const img = new Image();
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Failed to decode the image"));
      img.src = url;
    });
  } catch (e) {
    fail((e as Error).message + " — try a WebGPU/WASM-capable browser (latest Chrome/Edge recommended).");
    return;
  }

  let model: DepthModel;
  try {
    model = await getModel();
  } catch (e) {
    fail("Failed to load the model. Check your network connection and use a WebGPU/WASM-capable browser. " + (e as Error).message);
    return;
  }

  statusEl.textContent = "Estimating depth…";
  await new Promise((r) => setTimeout(r, 30));
  let result;
  try {
    result = await estimateDepth(model, url);
  } catch (e) {
    fail("Depth estimation failed: " + (e as Error).message);
    return;
  }
  const { data } = normalizeDisparity(result.raw);
  currentDepth01 = data;

  if (!viewer) viewer = new Viewer(cv);
  viewer.loadImageAndDepth(img, img.naturalWidth, img.naturalHeight, data, result.width, result.height);

  drop.style.display = "none";
  cv.style.display = "block";
  viewer.fitCanvas(stage);
  ready = true;
  statusEl.textContent = "Running — move cursor over the photo";
  viewer.start();
}

addEventListener("resize", () => {
  if (ready) viewer?.fitCanvas(stage);
});

function setPointerFromEvent(e: PointerEvent): void {
  if (!viewer) return;
  const r = cv.getBoundingClientRect();
  const u = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  const v = Math.min(Math.max(1 - (e.clientY - r.top) / r.height, 0), 1);
  viewer.setPointerTarget(u, v);
}
cv.addEventListener("pointermove", setPointerFromEvent);
cv.addEventListener("pointerdown", setPointerFromEvent);

$<HTMLButtonElement>("exd").onclick = () => {
  if (!currentDepth01 || !viewer) {
    fail("Load an image first.");
    return;
  }
  downloadDepthPng(currentDepth01, viewer.depthWidth, viewer.depthHeight);
};

$<HTMLButtonElement>("expCfg").onclick = () => {
  if (!viewer) {
    fail("Load an image first.");
    return;
  }
  const config: PhotoSpaceConfig = {
    ...DEFAULT_CONFIG,
    camera: { fovDeg: viewer.state.fov, farRange: viewer.state.far },
    sky: { threshold: viewer.state.sky },
  };
  downloadConfig(config);
};
