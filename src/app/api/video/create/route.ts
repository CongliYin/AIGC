import { NextRequest, NextResponse } from "next/server";
import { createVideoTask, encodeRef } from "@/lib/zzz";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const {
      modelId,
      prompt,
      inputMode,
      aspectRatio,
      durationSeconds,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      negativePrompt,
    } = await req.json();

    if (!modelId || !prompt) {
      return NextResponse.json({ error: "缺少 modelId 或 prompt" }, { status: 400 });
    }

    const ref = await createVideoTask(modelId, {
      prompt,
      inputMode,
      aspectRatio,
      durationSeconds,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      referenceVideoUrls,
      referenceAudioUrls,
      negativePrompt,
    });

    if (!ref.id) {
      return NextResponse.json({ error: "厂商未返回任务 id" }, { status: 502 });
    }

    return NextResponse.json({ token: encodeRef(ref) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "提交失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
