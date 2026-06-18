import { NextRequest, NextResponse } from "next/server";
import { decodeRef, getVideoTask } from "@/lib/zzz";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "缺少 token" }, { status: 400 });
    }

    const ref = decodeRef(token);
    const result = await getVideoTask(ref);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "查询任务失败";
    return NextResponse.json({ error: message, status: "failed" }, { status: 500 });
  }
}
