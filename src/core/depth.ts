import { pipeline, type PretrainedModelOptions, type DepthEstimationPipeline } from "@huggingface/transformers";

export const MODEL_NAME = "onnx-community/depth-anything-v2-small";
export const MODEL_REVISION = "main";

export interface DepthEstimationResult {
  width: number;
  height: number;
  raw: Float32Array;
}

export interface ProgressEvent {
  status: string;
  progress?: number;
  total?: number;
}

export type DepthModel = DepthEstimationPipeline;

/**
 * ブラウザではWebGPU→WASMの順でフォールバック、Node(CLI)ではCPUバックエンドを使う。
 * transformers.jsは環境を自動判別してonnxruntime-web/onnxruntime-nodeを切り替える。
 */
export async function loadDepthModel(opts?: {
  onProgress?: (p: ProgressEvent) => void;
}): Promise<DepthModel> {
  const isBrowser = typeof window !== "undefined";
  const progress_callback = opts?.onProgress
    ? (p: ProgressEvent) => opts.onProgress!(p)
    : undefined;

  const candidates: PretrainedModelOptions[] = isBrowser
    ? [
        { device: "webgpu", dtype: "fp32" },
        { device: "wasm", dtype: "q8" },
      ]
    : [{ device: "cpu", dtype: "fp32" }];

  if (isBrowser && !("gpu" in navigator)) {
    candidates.shift();
  }

  let lastError: unknown;
  for (const opt of candidates) {
    try {
      return await pipeline("depth-estimation", MODEL_NAME, {
        ...opt,
        ...(progress_callback ? { progress_callback } : {}),
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** モデル出力(視差テンソル)をFloat32Arrayへ展開する */
export async function estimateDepth(
  model: DepthModel,
  input: string | URL | Blob,
): Promise<DepthEstimationResult> {
  const out = await model(input);
  const result = Array.isArray(out) ? out[0] : out;
  const dims = result.predicted_depth.dims;
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  const raw = Float32Array.from(result.predicted_depth.data as ArrayLike<number>);
  return { width, height, raw };
}
