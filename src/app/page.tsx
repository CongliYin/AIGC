"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type MediaKind = "image" | "video";
type VideoInputMode = "text" | "firstFrame" | "firstLastFrame" | "reference";
type ModelOption = {
  id: string;
  label: string;
  sizeOptions?: string[];
  qualityOptions?: ImageQuality[];
  outputFormatOptions?: ImageOutputFormat[];
  inputModes?: VideoInputMode[];
  durationOptions?: number[];
  aspectRatios?: string[];
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
};
type ModelLists = { image: ModelOption[]; video: ModelOption[] };
type StatusTone = "idle" | "working" | "success" | "error";
type ImageQuality = "low" | "medium" | "high";
type ImageOutputFormat = "jpeg" | "png" | "webp";
type ReferenceUrlType = "image" | "video" | "audio";

type ImageResult = {
  url?: string;
  base64?: string;
  mimeType?: string;
  error?: string;
};

type VideoStatus = {
  status?: "pending" | "running" | "succeeded" | "failed";
  videoUrl?: string;
  error?: string;
};

type UploadResult = {
  url: string;
  pathname?: string;
  mediaType?: "image" | "video" | "audio" | "file";
};

const EMPTY_MODELS: ModelLists = { image: [], video: [] };
const DEFAULT_IMAGE_SIZE_OPTIONS = ["2048x2048", "2560x1440", "1440x2560"];
const EMPTY_IMAGE_QUALITY_OPTIONS: ImageQuality[] = [];
const EMPTY_IMAGE_OUTPUT_FORMAT_OPTIONS: ImageOutputFormat[] = [];
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const QUALITY_LABELS: Record<ImageQuality, string> = {
  low: "低",
  medium: "中",
  high: "高",
};
const FORMAT_LABELS: Record<ImageOutputFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
};
const REFERENCE_TYPE_LABELS: Record<ReferenceUrlType, string> = {
  image: "图像",
  video: "视频",
  audio: "音频",
};
const INPUT_MODE_LABELS: Record<VideoInputMode, string> = {
  text: "文生视频",
  firstFrame: "首帧图生视频",
  firstLastFrame: "首帧 + 尾帧",
  reference: "参考素材",
};

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    debugPaths?: string[];
  };
  if (!response.ok || data.error) {
    const debug = data.debugPaths?.length
      ? `\n响应字段：\n${data.debugPaths.slice(0, 18).join("\n")}`
      : "";
    throw new Error(`${data.error || `请求失败 (${response.status})`}${debug}`);
  }
  return data;
}

function statusLabel(status?: VideoStatus["status"]) {
  if (status === "pending") return "排队中";
  if (status === "running") return "生成中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "生成失败";
  return "等待中";
}

function sizeLabel(size: string) {
  const [width, height] = size.split("x").map(Number);
  if (!width || !height) return size;
  if (width === height) return `1:1 · ${size}`;
  if (width > height) return `16:9 · ${size}`;
  return `9:16 · ${size}`;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function Home() {
  const [models, setModels] = useState<ModelLists>(EMPTY_MODELS);
  const [kind, setKind] = useState<MediaKind>("image");
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [imageSize, setImageSize] = useState("2048x2048");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("low");
  const [imageOutputFormat, setImageOutputFormat] = useState<ImageOutputFormat>("jpeg");
  const [inputMode, setInputMode] = useState<VideoInputMode>("text");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [imageUrl, setImageUrl] = useState("");
  const [firstFrameUrl, setFirstFrameUrl] = useState("");
  const [lastFrameUrl, setLastFrameUrl] = useState("");
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [referenceVideoUrls, setReferenceVideoUrls] = useState<string[]>([]);
  const [referenceAudioUrls, setReferenceAudioUrls] = useState<string[]>([]);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceUrlType, setReferenceUrlType] = useState<ReferenceUrlType>("image");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusTone, setStatusTone] = useState<StatusTone>("idle");
  const [status, setStatus] = useState("就绪");
  const [resultUrl, setResultUrl] = useState("");
  const [resultKind, setResultKind] = useState<MediaKind>("image");
  const [lastModelLabel, setLastModelLabel] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [taskToken, setTaskToken] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const model = kind === "image" ? imageModel : videoModel;
  const currentModels = models[kind];
  const canSubmit = Boolean(model && prompt.trim() && !busy && !uploading);

  const selectedModelLabel = useMemo(() => {
    return currentModels.find((item) => item.id === model)?.label ?? "";
  }, [currentModels, model]);
  const selectedImageModel = useMemo(() => {
    return models.image.find((item) => item.id === imageModel);
  }, [models.image, imageModel]);
  const selectedVideoModel = useMemo(() => {
    return models.video.find((item) => item.id === videoModel);
  }, [models.video, videoModel]);
  const imageSizeOptions = selectedImageModel?.sizeOptions?.length
    ? selectedImageModel.sizeOptions
    : DEFAULT_IMAGE_SIZE_OPTIONS;
  const imageQualityOptions = selectedImageModel?.qualityOptions ?? EMPTY_IMAGE_QUALITY_OPTIONS;
  const imageOutputFormatOptions = selectedImageModel?.outputFormatOptions ?? EMPTY_IMAGE_OUTPUT_FORMAT_OPTIONS;
  const inputModes: VideoInputMode[] = selectedVideoModel?.inputModes?.length ? selectedVideoModel.inputModes : ["text"];
  const durationOptions = selectedVideoModel?.durationOptions?.length
    ? selectedVideoModel.durationOptions
    : [3, 5, 8, 10];
  const aspectRatioOptions = selectedVideoModel?.aspectRatios?.length ? selectedVideoModel.aspectRatios : ["16:9", "9:16"];
  const supportsFirstFrame = inputModes.includes("firstFrame") || inputModes.includes("firstLastFrame");
  const supportsReferences = inputModes.includes("reference");

  useEffect(() => {
    let live = true;

    fetch("/api/models")
      .then((response) => readJson<ModelLists>(response))
      .then((data) => {
        if (!live) return;
        setModels(data);
        setImageModel(data.image[0]?.id ?? "");
        setVideoModel(data.video[0]?.id ?? "");
      })
      .catch((error: Error) => {
        if (!live) return;
        setStatusTone("error");
        setStatus(error.message);
      });

    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!imageSizeOptions.includes(imageSize)) {
      setImageSize(imageSizeOptions[0] ?? "1024x1024");
    }
    if (imageQualityOptions.length && !imageQualityOptions.includes(imageQuality)) {
      setImageQuality(imageQualityOptions[0] ?? "low");
    }
    if (imageOutputFormatOptions.length && !imageOutputFormatOptions.includes(imageOutputFormat)) {
      setImageOutputFormat(imageOutputFormatOptions[0] ?? "jpeg");
    }
  }, [imageOutputFormat, imageOutputFormatOptions, imageQuality, imageQualityOptions, imageSize, imageSizeOptions]);

  useEffect(() => {
    if (!inputModes.includes(inputMode)) {
      setInputMode(inputModes[0] ?? "text");
    }
    if (!durationOptions.includes(durationSeconds)) {
      setDurationSeconds(durationOptions[0] ?? 5);
    }
    if (!aspectRatioOptions.includes(aspectRatio)) {
      setAspectRatio(aspectRatioOptions[0] ?? "16:9");
    }
  }, [aspectRatio, aspectRatioOptions, durationOptions, durationSeconds, inputMode, inputModes]);

  function cancelActiveJob(nextStatus = "已取消") {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStatusTone("idle");
    setStatus(nextStatus);
  }

  function switchKind(nextKind: MediaKind) {
    if (nextKind === kind) return;
    cancelActiveJob("就绪");
    setKind(nextKind);
  }

  async function pollVideo(token: string, signal: AbortSignal) {
    const startedAt = Date.now();
    let delay = 5000;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const response = await fetch(`/api/video/status?token=${encodeURIComponent(token)}`, {
        signal,
      });
      const data = await readJson<VideoStatus>(response);
      setStatus(`${statusLabel(data.status)} · 下次查询 ${Math.round(delay / 1000)}s`);

      if (data.status === "succeeded" && data.videoUrl) return data.videoUrl;
      if (data.status === "failed") throw new Error(data.error || "视频生成失败");

      await wait(delay, signal);
      delay = Math.min(Math.round(delay * 1.35), 15000);
    }

    throw new Error(`任务仍在进行，可稍后用 token 查询：${token}`);
  }

  async function uploadMedia(file: File) {
    setUploading(true);
    setStatusTone("working");
    setStatus("上传素材");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/media", {
        method: "POST",
        body: formData,
      });
      const data = await readJson<UploadResult>(response);
      setStatusTone("success");
      setStatus("素材已上传");
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "素材上传失败";
      setStatusTone("error");
      setStatus(message);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function uploadFirstFrame(file: File) {
    if (!supportsFirstFrame && inputMode !== "firstFrame" && inputMode !== "firstLastFrame") {
      setStatusTone("error");
      setStatus("当前视频模型不支持首帧图输入");
      return "";
    }

    const data = await uploadMedia(file);
    if (!data?.url) return "";
    if (data.mediaType !== "image") {
      setStatusTone("error");
      setStatus("首帧必须上传图片素材");
      return "";
    }
    setFirstFrameUrl(data.url);
    setImageUrl(data.url);
    setKind("video");
    if (inputMode === "text") setInputMode("firstFrame");
    setStatusTone("success");
    setStatus("首帧图已上传");
    return data.url;
  }

  async function handleFirstFrameFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await uploadFirstFrame(file);
  }

  async function useCurrentImageAsFirstFrame() {
    if (!resultUrl || resultKind !== "image") return;
    if (!supportsFirstFrame) {
      setKind("video");
      setStatusTone("error");
      setStatus("当前视频模型不支持首帧图输入，请先切换到支持首帧的模型");
      return;
    }

    try {
      setUploading(true);
      setStatusTone("working");
      setStatus("准备上传当前图像");
      const response = await fetch(resultUrl);
      if (!response.ok) throw new Error("无法读取当前图像");
      const blob = await response.blob();
      const file = new File([blob], `generated-${Date.now()}.${blob.type.split("/")[1] || "png"}`, {
        type: blob.type || "image/png",
      });
      setUploading(false);
      await uploadFirstFrame(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "当前图像上传失败";
      setUploading(false);
      setStatusTone("error");
      setStatus(message);
    }
  }

  async function handleFrameFile(event: ChangeEvent<HTMLInputElement>, target: "first" | "last") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const data = await uploadMedia(file);
    if (!data?.url) return;
    if (data.mediaType !== "image") {
      setStatusTone("error");
      setStatus("首帧/尾帧必须上传图片素材");
      return;
    }
    if (target === "first") {
      setFirstFrameUrl(data.url);
      setImageUrl(data.url);
    } else {
      setLastFrameUrl(data.url);
    }
  }

  async function handleReferenceFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    let imageCount = referenceImageUrls.length;
    let videoCount = referenceVideoUrls.length;
    let audioCount = referenceAudioUrls.length;
    for (const file of files) {
      const data = await uploadMedia(file);
      if (!data?.url) continue;
      if (data.mediaType === "image") {
        if (imageCount >= (selectedVideoModel?.maxReferenceImages ?? 0)) {
          setStatusTone("error");
          setStatus("参考图数量已达当前模型上限");
          return;
        }
        imageCount += 1;
        setReferenceImageUrls((items) => [...items, data.url]);
      } else if (data.mediaType === "video") {
        if (videoCount >= (selectedVideoModel?.maxReferenceVideos ?? 0)) {
          setStatusTone("error");
          setStatus("参考视频数量已达当前模型上限");
          return;
        }
        videoCount += 1;
        setReferenceVideoUrls((items) => [...items, data.url]);
      } else if (data.mediaType === "audio") {
        if (audioCount >= (selectedVideoModel?.maxReferenceAudios ?? 0)) {
          setStatusTone("error");
          setStatus("参考音频数量已达当前模型上限");
          return;
        }
        audioCount += 1;
        setReferenceAudioUrls((items) => [...items, data.url]);
      }
    }
  }

  function removeReference(kind: "image" | "video" | "audio", index: number) {
    if (kind === "image") setReferenceImageUrls((items) => items.filter((_, i) => i !== index));
    if (kind === "video") setReferenceVideoUrls((items) => items.filter((_, i) => i !== index));
    if (kind === "audio") setReferenceAudioUrls((items) => items.filter((_, i) => i !== index));
  }

  function addReferenceUrl() {
    const url = referenceUrl.trim();
    if (!url) return;
    if (!isHttpUrl(url)) {
      setStatusTone("error");
      setStatus("参考素材 URL 必须以 http:// 或 https:// 开头");
      return;
    }

    if (referenceUrlType === "image") {
      if (referenceImageUrls.length >= (selectedVideoModel?.maxReferenceImages ?? 0)) {
        setStatusTone("error");
        setStatus("参考图数量已达当前模型上限");
        return;
      }
      setReferenceImageUrls((items) => [...items, url]);
    } else if (referenceUrlType === "video") {
      if (referenceVideoUrls.length >= (selectedVideoModel?.maxReferenceVideos ?? 0)) {
        setStatusTone("error");
        setStatus("参考视频数量已达当前模型上限");
        return;
      }
      setReferenceVideoUrls((items) => [...items, url]);
    } else {
      if (referenceAudioUrls.length >= (selectedVideoModel?.maxReferenceAudios ?? 0)) {
        setStatusTone("error");
        setStatus("参考音频数量已达当前模型上限");
        return;
      }
      setReferenceAudioUrls((items) => [...items, url]);
    }

    setReferenceUrl("");
    setStatusTone("success");
    setStatus("参考素材 URL 已添加");
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setStatusTone("working");
    setStatus(kind === "image" ? "提交图像请求" : "提交视频任务");
    setResultUrl("");
    setTaskToken("");

    try {
      if (kind === "image") {
        const response = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: model,
            prompt: prompt.trim(),
            size: imageSize,
            quality: imageQualityOptions.length ? imageQuality : undefined,
            outputFormat: imageOutputFormatOptions.length ? imageOutputFormat : undefined,
          }),
          signal: controller.signal,
        });
        const data = await readJson<ImageResult>(response);
        const nextUrl = data.url || (data.base64 ? `data:${data.mimeType ?? "image/png"};base64,${data.base64}` : "");
        if (!nextUrl) throw new Error("模型未返回图片");
        setResultUrl(nextUrl);
        setResultKind("image");
        setStatusTone("success");
        setStatus("图像已生成");
      } else {
        const response = await fetch("/api/video/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: model,
            prompt: prompt.trim(),
            inputMode,
            aspectRatio,
            durationSeconds,
            imageUrl: inputMode === "firstFrame" || inputMode === "firstLastFrame" ? firstFrameUrl.trim() || imageUrl.trim() || undefined : undefined,
            firstFrameUrl: inputMode === "firstFrame" || inputMode === "firstLastFrame" ? firstFrameUrl.trim() || imageUrl.trim() || undefined : undefined,
            lastFrameUrl: inputMode === "firstLastFrame" ? lastFrameUrl.trim() || undefined : undefined,
            referenceImageUrls: inputMode === "reference" ? referenceImageUrls : [],
            referenceVideoUrls: inputMode === "reference" ? referenceVideoUrls : [],
            referenceAudioUrls: inputMode === "reference" ? referenceAudioUrls : [],
            negativePrompt: negativePrompt.trim() || undefined,
          }),
          signal: controller.signal,
        });
        const data = await readJson<{ token: string }>(response);
        setTaskToken(data.token);
        setStatus("任务已提交 · 开始轮询");
        const videoUrl = await pollVideo(data.token, controller.signal);
        setResultUrl(videoUrl);
        setResultKind("video");
        setStatusTone("success");
        setStatus("视频已生成");
      }

      setLastModelLabel(selectedModelLabel);
      setLastPrompt(prompt.trim());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "生成失败";
      setStatusTone("error");
      setStatus(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI MEDIA STUDIO</p>
          <h1>生成图像与视频</h1>
          <p className="subtitle">选择模型，填写提示词，生成结果会在右侧预览。</p>
        </div>
        <div className={`status status-${statusTone}`} role="status" aria-live="polite">
          <span />
          <strong>{status}</strong>
          {statusTone === "working" ? (
            <em aria-hidden="true">
              <i />
              <i />
              <i />
            </em>
          ) : null}
        </div>
      </header>

      <div className="mode-switch" aria-label="生成类型">
        <button
          type="button"
          className={kind === "image" ? "active" : ""}
          onClick={() => switchKind("image")}
        >
          生成图像
        </button>
        <button
          type="button"
          className={kind === "video" ? "active" : ""}
          onClick={() => switchKind("video")}
        >
          生成视频
        </button>
      </div>

      <section className="workspace">
        <form className="control-panel" onSubmit={run}>
          <div className="panel-heading">
            <p>参数</p>
            <strong>{kind === "image" ? "图像生成" : "视频生成"}</strong>
          </div>
          <label className="field">
            <span>模型</span>
            <select
              value={model}
              onChange={(event) =>
                kind === "image" ? setImageModel(event.target.value) : setVideoModel(event.target.value)
              }
            >
              <option value="">选择模型</option>
              {currentModels.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field prompt-field">
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A cinematic product shot of a translucent glass robot arm assembling a tiny moon base"
              rows={8}
            />
          </label>

          {kind === "image" ? (
            <div className="video-grid">
              <label className="field">
                <span>画幅</span>
                <select value={imageSize} onChange={(event) => setImageSize(event.target.value)}>
                  {imageSizeOptions.map((size) => (
                    <option value={size} key={size}>
                      {sizeLabel(size)}
                    </option>
                  ))}
                </select>
              </label>
              {imageQualityOptions.length ? (
                <label className="field">
                  <span>质量</span>
                  <select
                    value={imageQuality}
                    onChange={(event) => setImageQuality(event.target.value as ImageQuality)}
                  >
                    {imageQualityOptions.map((quality) => (
                      <option value={quality} key={quality}>
                        {QUALITY_LABELS[quality]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {imageOutputFormatOptions.length ? (
                <label className="field">
                  <span>格式</span>
                  <select
                    value={imageOutputFormat}
                    onChange={(event) => setImageOutputFormat(event.target.value as ImageOutputFormat)}
                  >
                    {imageOutputFormatOptions.map((format) => (
                      <option value={format} key={format}>
                        {FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="video-grid">
              <label className="field video-wide">
                <span>输入模式</span>
                <select value={inputMode} onChange={(event) => setInputMode(event.target.value as VideoInputMode)}>
                  {inputModes.map((mode) => (
                    <option value={mode} key={mode}>
                      {INPUT_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>宽高比</span>
                <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                  {aspectRatioOptions.map((ratio) => (
                    <option value={ratio} key={ratio}>
                      {ratio}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>时长</span>
                <select
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(Number(event.target.value))}
                >
                  {durationOptions.map((seconds) => (
                    <option value={seconds} key={seconds}>
                      {seconds} 秒
                    </option>
                  ))}
                </select>
              </label>
              {(inputMode === "firstFrame" || inputMode === "firstLastFrame") ? (
                <>
                  <label className="field video-wide">
                    <span>首帧图 URL</span>
                    <input
                      value={firstFrameUrl}
                      onChange={(event) => {
                        setFirstFrameUrl(event.target.value);
                        setImageUrl(event.target.value);
                      }}
                      placeholder="https://..."
                    />
                  </label>
                  <label className="field video-wide">
                    <span>上传首帧图</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => handleFrameFile(event, "first")}
                      disabled={busy || uploading}
                    />
                  </label>
                </>
              ) : null}
              {inputMode === "firstLastFrame" ? (
                <>
                  <label className="field video-wide">
                    <span>尾帧图 URL</span>
                    <input
                      value={lastFrameUrl}
                      onChange={(event) => setLastFrameUrl(event.target.value)}
                      placeholder="https://..."
                    />
                  </label>
                  <label className="field video-wide">
                    <span>上传尾帧图</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => handleFrameFile(event, "last")}
                      disabled={busy || uploading}
                    />
                  </label>
                </>
              ) : null}
              {inputMode === "reference" ? (
                <div className="field video-wide">
                  <span>参考素材</span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm"
                    onChange={handleReferenceFile}
                    disabled={busy || uploading || !supportsReferences}
                  />
                  <p className="field-note">
                    当前上限：图 {selectedVideoModel?.maxReferenceImages ?? 0}，视频 {selectedVideoModel?.maxReferenceVideos ?? 0}，音频 {selectedVideoModel?.maxReferenceAudios ?? 0}
                  </p>
                  <div className="reference-url-row">
                    <select
                      value={referenceUrlType}
                      onChange={(event) => setReferenceUrlType(event.target.value as ReferenceUrlType)}
                      disabled={busy || uploading || !supportsReferences}
                      aria-label="参考素材 URL 类型"
                    >
                      {(["image", "video", "audio"] as ReferenceUrlType[]).map((type) => (
                        <option value={type} key={type}>
                          {REFERENCE_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={referenceUrl}
                      onChange={(event) => setReferenceUrl(event.target.value)}
                      placeholder="粘贴参考素材 URL"
                      disabled={busy || uploading || !supportsReferences}
                    />
                    <button
                      className="secondary"
                      type="button"
                      onClick={addReferenceUrl}
                      disabled={busy || uploading || !supportsReferences || !referenceUrl.trim()}
                    >
                      添加
                    </button>
                  </div>
                  <div className="material-list">
                    {referenceImageUrls.map((url, index) => (
                      <button type="button" key={url} onClick={() => removeReference("image", index)}>
                        图 {index + 1}
                      </button>
                    ))}
                    {referenceVideoUrls.map((url, index) => (
                      <button type="button" key={url} onClick={() => removeReference("video", index)}>
                        视频 {index + 1}
                      </button>
                    ))}
                    {referenceAudioUrls.map((url, index) => (
                      <button type="button" key={url} onClick={() => removeReference("audio", index)}>
                        音频 {index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="field video-wide">
                <span>Negative Prompt</span>
                <input
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  placeholder="low quality, distorted motion"
                />
              </label>
            </div>
          )}

          <div className="actions">
            <button className="primary" type="submit" disabled={!canSubmit}>
              {busy ? "处理中" : kind === "image" ? "生成图像" : "生成视频"}
            </button>
            {busy ? (
              <button className="secondary" type="button" onClick={() => cancelActiveJob()}>
                取消
              </button>
            ) : null}
          </div>
        </form>

        <section className="result-panel" aria-label="生成结果">
          <div className="panel-heading">
            <p>预览</p>
            <strong>{resultUrl ? "生成结果" : "等待生成"}</strong>
          </div>
          <div className="result-frame">
            {resultUrl && resultKind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resultUrl} alt="生成图像结果" />
            ) : null}
            {resultUrl && resultKind === "video" ? (
              <video src={resultUrl} controls playsInline />
            ) : null}
            {!resultUrl ? (
              <div className="empty-state">
                <span>{kind === "image" ? "图像预览" : "视频预览"}</span>
              </div>
            ) : null}
          </div>

          <div className="result-meta">
            <div>
              <span>模型</span>
              <strong>{lastModelLabel || selectedModelLabel || "未选择"}</strong>
            </div>
            <div>
              <span>Prompt</span>
              <strong>{lastPrompt || prompt || "空"}</strong>
            </div>
            {taskToken ? (
              <div>
                <span>Token</span>
                <code>{taskToken}</code>
              </div>
            ) : null}
          </div>

          {resultUrl ? (
            <div className="result-actions">
              <a className="download" href={resultUrl} download target="_blank" rel="noreferrer">
                下载结果
              </a>
              {resultKind === "image" ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={useCurrentImageAsFirstFrame}
                  disabled={busy || uploading || !supportsFirstFrame}
                >
                  {uploading ? "上传中" : "作为视频首帧"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
