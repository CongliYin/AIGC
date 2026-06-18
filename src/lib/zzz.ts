/**
 * 智增增（zhizengzeng）聚合网关统一接入层
 * ------------------------------------------------------------------
 * 该网关把各家官方端点重映射到 https://api.zhizengzeng.com/{vendor}/...
 * 并且用同一个 key 调所有厂商，所以全局只需要一个环境变量 ZZZ_API_KEY。
 *
 * 鉴权两种约定：
 *   - bytedance / alibaba / xai 通道：HTTP 头  Authorization: Bearer <KEY>
 *   - google 通道（Veo/Gemini）：URL 查询参数  ?key=<KEY>
 *
 * ⚠️ 各家「请求体字段」按官方格式编写（火山方舟 / DashScope / x.ai / Gemini）。
 *    model 模型 ID 和个别参数请对照官方文档再核实，它们会变。
 */

// ============================ 配置 ============================

const BASE_URL = normalizeBaseUrl(process.env.ZZZ_BASE_URL ?? "https://api.zhizengzeng.com");
const OPENAI_COMPAT_BASE_URL = openaiCompatBaseUrl(BASE_URL);

function apiKey(): string {
  const key = process.env.ZZZ_API_KEY;
  if (!key) throw new Error("缺少环境变量 ZZZ_API_KEY");
  return key;
}

// Bearer 鉴权通道的通用请求封装
async function bearerFetch(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const { res, text, json } = await bearerFetchRaw(path, init);
  if (!res.ok) {
    throw new Error(`网关返回 ${res.status}: ${text.slice(0, 500)}`);
  }
  throwIfApiError(json);
  return json;
}

async function bearerFetchRaw(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? safeJson(text) : {};
  return { res, text, json };
}

async function openaiCompatFetch(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const res = await fetch(`${OPENAI_COMPAT_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new Error(`网关返回 ${res.status}: ${(apiErrorMessage(json) || text).slice(0, 500)}`);
  }
  throwIfApiError(json);
  return json;
}

function openaiCompatBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized === "http://api.zhizengzeng.com") {
    return "https://api.zhizengzeng.com";
  }
  return normalized;
}

// google 通道：key 放在 query 上
async function googleFetch(path: string, init: RequestInit = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE_URL}${path}${sep}key=${encodeURIComponent(apiKey())}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const json = text ? safeJson(text) : {};
  if (!res.ok) throw new Error(`Google 通道返回 ${res.status}: ${text.slice(0, 500)}`);
  throwIfApiError(json);
  return json;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function throwIfApiError(json: any) {
  if (!json?.error) return;
  throw new Error(apiErrorMessage(json) || "上游模型返回错误");
}

function apiErrorMessage(json: any): string {
  const error = json.error;
  return (
    typeof error === "string"
      ? error
      : [error?.message, error?.code, error?.param, error?.type].filter(Boolean).join(" · ")
  );
}

// ============================ 统一类型 ============================

export type Vendor = "veo" | "doubao" | "qwen" | "xai" | "openai";
export type MediaKind = "image" | "video";
export type VideoInputMode = "text" | "firstFrame" | "firstLastFrame" | "reference";

/** 归一化后的任务状态，屏蔽各家差异 */
export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface ImageOptions {
  prompt: string;
  size?: string; // 例如 "1024x1024"
  imageBase64?: string; // 图生图时的参考图（data URL 或纯 base64）
}

export interface ImageResult {
  url?: string; // 直接可访问的图片 URL（豆包/xAI 通常返回）
  base64?: string; // 或 base64
  debugPaths?: string[]; // 解析失败时返回字段路径摘要，避免暴露完整响应
}

export interface VideoOptions {
  prompt: string;
  inputMode?: VideoInputMode;
  aspectRatio?: string; // "16:9" | "9:16"
  durationSeconds?: number;
  imageUrl?: string; // 首帧图（图生视频）
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  negativePrompt?: string;
}

/** 创建视频任务后返回的不透明引用，原样回传给状态查询接口即可 */
export interface VideoTaskRef {
  vendor: Vendor;
  model: string;
  id: string;
}

export interface VideoTaskResult {
  status: TaskStatus;
  /** 完成后可播放/下载的地址。Veo 会是后端代理地址，其余是厂商临时公开 URL */
  videoUrl?: string;
  error?: string;
  raw?: unknown; // 调试用，保留原始响应
}

// 把任务引用编码成一个字符串 token，方便前端在 create/status 间透传
export function encodeRef(ref: VideoTaskRef): string {
  return Buffer.from(JSON.stringify(ref)).toString("base64url");
}
export function decodeRef(token: string): VideoTaskRef {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

// ============================ 1) Veo（Google 通道，异步三步）============================

export const veo = {
  /** 第1步：启动生成 operation，返回 operation id */
  async createVideoTask(model: string, opts: VideoOptions): Promise<VideoTaskRef> {
    const parameters: Record<string, unknown> = {
      aspectRatio: opts.aspectRatio ?? "16:9",
      numberOfVideos: 1,
    };
    if (opts.durationSeconds) parameters.durationSeconds = opts.durationSeconds; // Veo 支持 5-8
    if (opts.negativePrompt) parameters.negativePrompt = opts.negativePrompt;
    parameters.personGeneration = "allow_adult";

    const inputMode = opts.inputMode ?? (opts.imageUrl || opts.firstFrameUrl ? "firstFrame" : "text");
    const firstFrameUrl = opts.firstFrameUrl ?? opts.imageUrl;
    const instance: Record<string, unknown> = { prompt: opts.prompt };

    if (inputMode === "firstFrame" || inputMode === "firstLastFrame") {
      if (!firstFrameUrl) throw new Error("Veo 图生视频缺少首帧图 URL");
      instance.image = { imageUri: firstFrameUrl };
      if (inputMode === "firstLastFrame") {
        if (!opts.lastFrameUrl) throw new Error("Veo 首尾帧模式缺少尾帧图 URL");
        parameters.last_frame = { imageUri: opts.lastFrameUrl };
      }
    }

    if (inputMode === "reference") {
      const urls = opts.referenceImageUrls?.filter(Boolean) ?? [];
      if (urls.length === 0) throw new Error("Veo 参考图模式至少需要 1 张参考图");
      if (urls.length > 3) throw new Error("Veo 参考图最多 3 张");
      instance.referenceImages = urls.map((url) => ({
        referenceType: "asset",
        image: { imageUri: url },
      }));
    }

    const json: any = await googleFetch(
      `/google/v1beta/models/${model}:predictLongRunning`,
      { method: "POST", body: JSON.stringify({ instances: [instance], parameters }) }
    );
    // 返回形如 { "name": "models/veo-2.0-generate-001/operations/<id>" }
    const name: string = json.name ?? "";
    const id = name.split("/operations/")[1] ?? name;
    return { vendor: "veo", model, id };
  },

  /** 第2步：轮询 operation；完成后从响应里取出 fileId，封装成后端代理地址 */
  async getVideoTask(ref: VideoTaskRef): Promise<VideoTaskResult> {
    const json: any = await googleFetch(
      `/google/v1beta/models/${ref.model}/operations/${ref.id}`
    );
    if (json.error) return { status: "failed", error: JSON.stringify(json.error), raw: json };
    if (!json.done) return { status: "running", raw: json };

    // 完成。视频以文件形式存在，需要 fileId 再走第3步下载（必须带 key，故由后端代理）
    const fileId = extractVeoFileId(json);
    if (!fileId) return { status: "failed", error: "未能从响应中解析出视频 fileId", raw: json };
    return { status: "succeeded", videoUrl: `/api/video/file?fileId=${encodeURIComponent(fileId)}`, raw: json };
  },

  /** 第3步：后端代理下载视频字节（注入 key，前端永远看不到 key） */
  async downloadFile(fileId: string): Promise<Response> {
    const url = `${BASE_URL}/google/v1beta/files/${fileId}:download?alt=media&key=${encodeURIComponent(apiKey())}`;
    return fetch(url); // 调用方负责把流转给浏览器
  },
};

function extractVeoFileId(op: any): string | null {
  // 不同 Veo 版本返回结构略有差异，这里做容错解析
  const samples =
    op?.response?.generateVideoResponse?.generatedSamples ??
    op?.response?.generatedSamples ??
    op?.response?.videos ??
    [];
  const uri: string | undefined = samples?.[0]?.video?.uri ?? samples?.[0]?.uri;
  if (!uri) return null;
  const m = uri.match(/files\/([^:/?]+)/);
  return m ? m[1] : null;
}

// ============================ 2) 豆包（bytedance 通道，火山方舟格式）============================

export const doubao = {
  /** 图片：同步返回 */
  async generateImage(model: string, opts: ImageOptions): Promise<ImageResult> {
    const body: Record<string, unknown> = {
      model,
      prompt: opts.prompt,
      size: opts.size ?? "2048x2048",
      response_format: "url",
      watermark: false,
    };
    const json: any = await bearerFetch("/bytedance/api/v3/images/generations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return normalizeImageResult(json);
  },

  /** 视频：创建任务，返回 task id。火山用 content 数组承载文本和首帧图 */
  async createVideoTask(model: string, opts: VideoOptions): Promise<VideoTaskRef> {
    const inputMode = opts.inputMode ?? (opts.imageUrl || opts.firstFrameUrl ? "firstFrame" : "text");
    // 火山把宽高比/时长写进 prompt 末尾的 --ratio / --dur 命令
    const cmd = [
      opts.aspectRatio ? `--ratio ${opts.aspectRatio}` : "",
      opts.durationSeconds ? `--dur ${opts.durationSeconds}` : "",
    ].filter(Boolean).join(" ");
    const materialPrompt = buildSeedanceMaterialPrompt(opts);
    const content: any[] = [{ type: "text", text: `${opts.prompt} ${materialPrompt} ${cmd}`.trim() }];

    if (inputMode === "firstFrame" || inputMode === "firstLastFrame") {
      const firstFrameUrl = opts.firstFrameUrl ?? opts.imageUrl;
      if (!firstFrameUrl) throw new Error("Seedance 图生视频缺少首帧图 URL");
      content.push({ type: "image_url", image_url: { url: firstFrameUrl } });
      if (inputMode === "firstLastFrame") {
        if (!opts.lastFrameUrl) throw new Error("Seedance 首尾帧模式缺少尾帧图 URL");
        content.push({ type: "image_url", image_url: { url: opts.lastFrameUrl } });
      }
    }

    for (const url of opts.referenceImageUrls ?? []) {
      content.push({ type: "image_url", image_url: { url } });
    }
    for (const url of opts.referenceVideoUrls ?? []) {
      content.push({ type: "video_url", video_url: { url } });
    }
    for (const url of opts.referenceAudioUrls ?? []) {
      content.push({ type: "audio_url", audio_url: { url } });
    }

    const json: any = await bearerFetch("/bytedance/api/v3/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({ model, content }),
    });
    return { vendor: "doubao", model, id: json.id };
  },

  async getVideoTask(ref: VideoTaskRef): Promise<VideoTaskResult> {
    const { res, text, json } = await bearerFetchRaw(
      `/bytedance/api/v3/contents/generations/tasks/${ref.id}`,
      { method: "GET" }
    );
    const errorMessage = apiErrorMessage(json);
    if (!res.ok || json?.error) {
      if (errorMessage.toLowerCase().includes("no api_result yet")) {
        return { status: "running", raw: json };
      }
      if (res.ok) {
        return { status: "failed", error: errorMessage || "豆包视频任务失败", raw: json };
      }
      throw new Error(`网关返回 ${res.status}: ${(errorMessage || text).slice(0, 500)}`);
    }
    // 火山状态：queued / running / succeeded / failed / cancelled
    const status = mapStatus(json.status, {
      succeeded: ["succeeded"],
      failed: ["failed", "cancelled"],
      running: ["running"],
      pending: ["queued"],
    });
    return {
      status,
      videoUrl: json?.content?.video_url,
      error: json?.error?.message,
      raw: json,
    };
  },
};

function buildSeedanceMaterialPrompt(opts: VideoOptions): string {
  const imageCount = opts.referenceImageUrls?.filter(Boolean).length ?? 0;
  const videoCount = opts.referenceVideoUrls?.filter(Boolean).length ?? 0;
  const audioCount = opts.referenceAudioUrls?.filter(Boolean).length ?? 0;
  const parts: string[] = [];
  if (imageCount) parts.push(`参考图像: ${Array.from({ length: imageCount }, (_, i) => `@image${i + 1}`).join(", ")}`);
  if (videoCount) parts.push(`参考视频: ${Array.from({ length: videoCount }, (_, i) => `@video${i + 1}`).join(", ")}`);
  if (audioCount) parts.push(`参考音频: ${Array.from({ length: audioCount }, (_, i) => `@audio${i + 1}`).join(", ")}`);
  return parts.length ? `\n${parts.join("；")}。` : "";
}

// ============================ 3) 千问（alibaba 通道，DashScope 格式）============================

export const qwen = {
  /**
   * 视频：DashScope 异步任务。创建时必须带 X-DashScope-Async: enable，
   * 否则会同步等待而超时。返回 output.task_id。
   */
  async createVideoTask(model: string, opts: VideoOptions): Promise<VideoTaskRef> {
    const input: Record<string, unknown> = { prompt: opts.prompt };
    if (opts.imageUrl) input.img_url = opts.imageUrl;

    const parameters: Record<string, unknown> = {};
    if (opts.aspectRatio === "16:9") parameters.size = "1280*720";
    else if (opts.aspectRatio === "9:16") parameters.size = "720*1280";
    if (opts.durationSeconds) parameters.duration = opts.durationSeconds;

    const json: any = await bearerFetch(
      "/alibaba/api/v1/services/aigc/video-generation/video-synthesis",
      {
        method: "POST",
        headers: { "X-DashScope-Async": "enable" },
        body: JSON.stringify({ model, input, parameters }),
      }
    );
    return { vendor: "qwen", model, id: json?.output?.task_id };
  },

  async getVideoTask(ref: VideoTaskRef): Promise<VideoTaskResult> {
    const json: any = await bearerFetch(`/alibaba/api/v1/tasks/${ref.id}`, { method: "GET" });
    // DashScope 状态：PENDING / RUNNING / SUCCEEDED / FAILED / CANCELED
    const status = mapStatus(json?.output?.task_status, {
      succeeded: ["SUCCEEDED"],
      failed: ["FAILED", "CANCELED", "UNKNOWN"],
      running: ["RUNNING"],
      pending: ["PENDING"],
    });
    return {
      status,
      videoUrl: json?.output?.video_url,
      error: json?.output?.message,
      raw: json,
    };
  },
};

// ============================ 4) xAI（xai 通道，OpenAI 兼容）============================

export const xai = {
  /** 图片：同步 */
  async generateImage(model: string, opts: ImageOptions): Promise<ImageResult> {
    const json: any = await bearerFetch("/xai/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({ model, prompt: opts.prompt, n: 1, response_format: "url" }),
    });
    return normalizeImageResult(json);
  },

  /** 视频：创建，返回 request_id */
  async createVideoTask(model: string, opts: VideoOptions): Promise<VideoTaskRef> {
    const json: any = await bearerFetch("/xai/v1/videos/generations", {
      method: "POST",
      body: JSON.stringify({ model, prompt: opts.prompt }),
    });
    return { vendor: "xai", model, id: json.request_id ?? json.id };
  },

  async getVideoTask(ref: VideoTaskRef): Promise<VideoTaskResult> {
    const json: any = await bearerFetch(`/xai/v1/videos/${ref.id}`, { method: "GET" });
    // xAI 状态字段以官方为准，这里做容错映射
    const status = mapStatus(json.status, {
      succeeded: ["completed", "succeeded", "success"],
      failed: ["failed", "error"],
      running: ["processing", "running", "in_progress"],
      pending: ["queued", "pending"],
    });
    return {
      status,
      videoUrl: json.url ?? json.video_url ?? json?.data?.[0]?.url,
      error: json.error,
      raw: json,
    };
  },
};

// ============================ 5) OpenAI 兼容通道（智增增网关）============================

export const openai = {
  async generateImage(model: string, opts: ImageOptions): Promise<ImageResult> {
    const json: any = await openaiCompatFetch("/images/generations", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        size: opts.size ?? "1024x1024",
      }),
    });
    return normalizeImageResult(json);
  },
};

function normalizeImageResult(json: any): ImageResult {
  const candidates = [
    json?.data?.[0],
    json?.output?.images?.[0],
    json?.output?.results?.[0],
    json?.output?.choices?.[0],
    json?.result?.images?.[0],
    json?.result?.[0],
    json?.image,
    json,
  ];

  for (const item of candidates) {
    const url = firstString(
      item?.url,
      item?.image_url?.url,
      item?.image_url,
      item?.imageUrl,
      item?.image?.url,
      item?.image,
      item?.content?.[0]?.image_url?.url,
      item?.content?.[0]?.image_url,
      item?.output?.url,
      item?.output?.image_url?.url,
      item?.output?.image_url
    );
    const base64 = firstString(
      item?.b64_json,
      item?.base64,
      item?.image_base64,
      item?.imageBase64,
      item?.image?.b64_json,
      item?.image?.base64,
      item?.result
    );

    if (url || base64) return { url, base64 };
  }

  const url = findStringByKey(json, ["url", "image_url", "imageUrl", "uri"]);
  const base64 = findStringByKey(json, ["b64_json", "base64", "image_base64", "imageBase64"]);
  if (url || base64) return { url, base64 };

  return { debugPaths: collectJsonPaths(json).slice(0, 80) };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function findStringByKey(value: unknown, keys: string[], seen = new WeakSet<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKey(item, keys, seen);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const current = record[key];
    if (typeof current === "string" && current.length > 0) return current;
  }
  for (const current of Object.values(record)) {
    const found = findStringByKey(current, keys, seen);
    if (found) return found;
  }
  return undefined;
}

function collectJsonPaths(value: unknown, path = "$", depth = 0, out: string[] = []): string[] {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value !== "object") {
    out.push(`${path}: ${typeof value}`);
    return out;
  }

  if (Array.isArray(value)) {
    out.push(`${path}: array(${value.length})`);
    if (value.length > 0) collectJsonPaths(value[0], `${path}[0]`, depth + 1, out);
    return out;
  }

  const record = value as Record<string, unknown>;
  out.push(`${path}: object(${Object.keys(record).join(", ")})`);
  for (const [key, current] of Object.entries(record)) {
    collectJsonPaths(current, `${path}.${key}`, depth + 1, out);
  }
  return out;
}

function mapStatus(raw: string | undefined, m: Record<TaskStatus, string[]>): TaskStatus {
  const v = (raw ?? "").toLowerCase();
  for (const s of ["succeeded", "failed", "running", "pending"] as TaskStatus[]) {
    if (m[s].some((x) => x.toLowerCase() === v)) return s;
  }
  return "running"; // 未知状态当作仍在进行，让前端继续轮询
}

// ============================ 模型注册表 ============================
// 前端只认 id；后端据此找到 vendor / kind / 真实 model 字符串。
// 注意：modelId 字段是“传给厂商 API 的真实模型名”，请按官方控制台再核对。

export interface ModelDef {
  id: string; // 前端使用的标识（可与 modelId 相同）
  label: string; // 下拉框展示名
  vendor: Vendor;
  kind: MediaKind;
  modelId: string; // 传给厂商 API 的真实模型名
  inputModes?: VideoInputMode[];
  durationOptions?: number[];
  aspectRatios?: string[];
  sizeOptions?: string[];
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
}

export const MODELS: ModelDef[] = [
  // —— 图片 ——
  {
    id: "doubao-seedream",
    label: "豆包 Seedream（图）",
    vendor: "doubao",
    kind: "image",
    modelId: "doubao-seedream-5-0-lite-260128",
    sizeOptions: ["2048x2048", "2560x1440", "1440x2560"],
  },
  {
    id: "gpt-image-2",
    label: "GPT Image 2（图）",
    vendor: "openai",
    kind: "image",
    modelId: "gpt-image-2",
    sizeOptions: ["1024x1024", "1536x1024", "1024x1536"],
  },

  // —— 视频 ——
  {
    id: "doubao-seedance",
    label: "豆包 Seedance（视频）",
    vendor: "doubao",
    kind: "video",
    modelId: "doubao-seedance-2-0-260128",
    inputModes: ["text", "firstFrame", "firstLastFrame", "reference"],
    durationOptions: [5, 10],
    aspectRatios: ["16:9", "9:16"],
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
  },
];

export function findModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

// ============================ 统一分发 ============================

const IMAGE_PROVIDERS = { doubao, xai, openai } as const;
const VIDEO_PROVIDERS = { veo, doubao, qwen, xai } as const;

export async function generateImage(modelId: string, opts: ImageOptions): Promise<ImageResult> {
  const def = findModel(modelId);
  if (!def || def.kind !== "image") throw new Error(`未知图片模型: ${modelId}`);
  const provider = (IMAGE_PROVIDERS as any)[def.vendor];
  if (!provider?.generateImage) throw new Error(`厂商 ${def.vendor} 不支持图片生成`);
  return provider.generateImage(def.modelId, opts);
}

export async function createVideoTask(modelId: string, opts: VideoOptions): Promise<VideoTaskRef> {
  const def = findModel(modelId);
  if (!def || def.kind !== "video") throw new Error(`未知视频模型: ${modelId}`);
  validateVideoOptions(def, opts);
  const provider = (VIDEO_PROVIDERS as any)[def.vendor];
  return provider.createVideoTask(def.modelId, opts);
}

function validateVideoOptions(def: ModelDef, opts: VideoOptions) {
  const mode = opts.inputMode ?? "text";
  if (!def.inputModes?.includes(mode)) {
    throw new Error(`${def.label} 不支持当前输入模式`);
  }
  if ((opts.referenceImageUrls?.length ?? 0) > (def.maxReferenceImages ?? 0)) {
    throw new Error(`${def.label} 最多支持 ${def.maxReferenceImages ?? 0} 张参考图`);
  }
  if ((opts.referenceVideoUrls?.length ?? 0) > (def.maxReferenceVideos ?? 0)) {
    throw new Error(`${def.label} 最多支持 ${def.maxReferenceVideos ?? 0} 段参考视频`);
  }
  if ((opts.referenceAudioUrls?.length ?? 0) > (def.maxReferenceAudios ?? 0)) {
    throw new Error(`${def.label} 最多支持 ${def.maxReferenceAudios ?? 0} 段参考音频`);
  }
  if (mode === "reference" && ((opts.firstFrameUrl ?? opts.imageUrl) || opts.lastFrameUrl) && def.vendor === "veo") {
    throw new Error("Veo 参考图模式不能同时使用首帧或尾帧");
  }
}

export async function getVideoTask(ref: VideoTaskRef): Promise<VideoTaskResult> {
  const provider = (VIDEO_PROVIDERS as any)[ref.vendor];
  return provider.getVideoTask(ref);
}
