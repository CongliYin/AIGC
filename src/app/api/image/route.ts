import { NextRequest, NextResponse } from "next/server";
import { generateImage } from "@/lib/zzz";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { modelId, prompt, size, quality, outputFormat, imageBase64 } = await req.json();

    if (!modelId || !prompt) {
      return NextResponse.json({ error: "缺少 modelId 或 prompt" }, { status: 400 });
    }

    const result = await generateImage(modelId, { prompt, size, quality, outputFormat, imageBase64 });
    if (!result.url && !result.base64) {
      return NextResponse.json(
        {
          error: "模型未返回图片地址或 base64 内容",
          debugPaths: result.debugPaths,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: result.url, base64: result.base64, mimeType: result.mimeType });
  } catch (e) {
    const message = e instanceof Error ? e.message : "图片生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
