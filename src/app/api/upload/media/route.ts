import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

function mediaKind(type: string) {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
}

function extensionFor(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  if (type === "audio/wav" || type === "audio/x-wav") return "wav";
  if (type === "audio/webm") return "webm";
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/mpeg") return "mp3";
  return "mp4";
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "缺少环境变量 BLOB_READ_WRITE_TOKEN" }, { status: 500 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "请使用 multipart/form-data 上传素材" }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少素材文件" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "仅支持图片、MP4/WebM/MOV 视频、MP3/WAV/M4A/WebM 音频" }, { status: 400 });
    }

    const maxBytes = file.type.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `素材不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` }, { status: 400 });
    }

    const kind = mediaKind(file.type);
    const safeName = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const pathname = `media/${kind}/${Date.now()}-${crypto.randomUUID()}-${safeName || kind}.${extensionFor(file.type)}`;
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
      size: file.size,
      contentType: file.type,
      mediaType: kind,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "素材上传失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
