import { NextRequest, NextResponse } from "next/server";
import { veo } from "@/lib/zzz";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const fileId = req.nextUrl.searchParams.get("fileId");
    if (!fileId) {
      return NextResponse.json({ error: "缺少 fileId" }, { status: 400 });
    }

    const upstream = await veo.downloadFile(fileId);
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `视频下载失败: ${text.slice(0, 500)}` },
        { status: upstream.status || 502 }
      );
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "video/mp4",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "视频下载失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
