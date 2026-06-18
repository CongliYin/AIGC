import { NextResponse } from "next/server";
import { MODELS } from "@/lib/zzz";

export const dynamic = "force-dynamic";

export async function GET() {
  const visible = MODELS.reduce(
    (acc, model) => {
      acc[model.kind].push({
        id: model.id,
        label: model.label,
        sizeOptions: model.sizeOptions ?? [],
        qualityOptions: model.qualityOptions ?? [],
        outputFormatOptions: model.outputFormatOptions ?? [],
        inputModes: model.inputModes ?? [],
        durationOptions: model.durationOptions ?? [],
        aspectRatios: model.aspectRatios ?? [],
        maxReferenceImages: model.maxReferenceImages ?? 0,
        maxReferenceVideos: model.maxReferenceVideos ?? 0,
        maxReferenceAudios: model.maxReferenceAudios ?? 0,
      });
      return acc;
    },
    {
      image: [] as Array<{
        id: string;
        label: string;
        sizeOptions: string[];
        qualityOptions: string[];
        outputFormatOptions: string[];
      }>,
      video: [] as Array<{
        id: string;
        label: string;
        inputModes: string[];
        durationOptions: number[];
        aspectRatios: string[];
        maxReferenceImages: number;
        maxReferenceVideos: number;
        maxReferenceAudios: number;
      }>,
    }
  );

  return NextResponse.json(visible);
}
