import { createClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildCaptionPrompt, buildFallbackCaptions, captionGoalSchema, captionOutputSchema, containsProhibitedTerm, contentFormatSchema, type CaptionContext } from "@/lib/ai/captions";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const requestLog = new Map<string, number[]>();

const requestSchema = z.object({
  brandId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  brief: z.string().trim().max(1800).nullable().optional(),
  goal: captionGoalSchema,
  format: contentFormatSchema,
  channels: z.array(z.enum(["ig_feed", "ig_story", "ig_reel", "fb_feed", "fb_story", "fb_reel"])).min(1).max(2),
});

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

function exceedsRateLimit(userId: string) {
  const now = Date.now();
  const recent = (requestLog.get(userId) || []).filter(time => now - time < 60_000);
  requestLog.set(userId, [...recent, now]);
  return recent.length >= 10;
}

export async function POST(request: NextRequest) {
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") !== requestOrigin) return response({ error: "Permintaan harus dibuat dari MediaGrow Content Hub." }, 403);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return response({ error: "Sesi berakhir. Masuk kembali lalu coba lagi." }, 401);

  try {
    const input = requestSchema.parse(await request.json());
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ntdqqzqgkylxixivkmrp.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_QeWv7cMl3JCrHWBN0m5cQA_IN0Tbk_w",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return response({ error: "Sesi berakhir. Masuk kembali lalu coba lagi." }, 401);
    if (exceedsRateLimit(auth.user.id)) return response({ error: "Terlalu banyak permintaan caption. Tunggu satu menit lalu coba lagi." }, 429);

    const [{ data: brand, error: brandError }, { data: rule, error: ruleError }] = await Promise.all([
      db.from("brands").select("id,name,niche").eq("id", input.brandId).single(),
      db.from("brand_rules").select("tone,default_cta,target_audience,hashtag_guidance,prohibited_terms,content_pillars").eq("brand_id", input.brandId).single(),
    ]);
    if (brandError || !brand) return response({ error: "Brand tidak ditemukan atau tidak dapat kamu akses." }, 403);
    if (ruleError || !rule) return response({ error: "Brand Kit belum tersedia untuk brand ini." }, 422);

    const context: CaptionContext = {
      brandName: brand.name,
      niche: brand.niche,
      title: input.title,
      brief: input.brief || null,
      goal: input.goal,
      format: input.format,
      channels: input.channels,
      tone: rule.tone,
      defaultCta: rule.default_cta,
      targetAudience: rule.target_audience,
      hashtagGuidance: rule.hashtag_guidance,
      prohibitedTerms: rule.prohibited_terms,
      contentPillars: Array.isArray(rule.content_pillars) ? rule.content_pillars : [],
    };

    try {
      const result = await generateText({
        model: process.env.AI_CAPTION_MODEL || "google/gemini-3.6-flash",
        instructions: "Kamu adalah copywriter media sosial berbahasa Indonesia untuk brand lokal. Tulis natural, spesifik, tidak mengarang fakta, dan patuhi seluruh batasan Brand Kit.",
        prompt: buildCaptionPrompt(context),
        output: Output.object({ schema: captionOutputSchema }),
        temperature: 0.8,
        maxOutputTokens: 1600,
        abortSignal: AbortSignal.timeout(30_000),
        providerOptions: { gateway: { disallowPromptTraining: true, user: auth.user.id, tags: ["mediagrow", "auto-caption"] } },
      });
      const variants = result.output.variants.filter(item => !containsProhibitedTerm(item.caption, context.prohibitedTerms));
      if (variants.length !== 3) throw new Error("Generated caption contains prohibited terms");
      return response({ variants, source: "ai" });
    } catch (generationError) {
      console.error("AI caption generation failed", generationError instanceof Error ? generationError.message : "unknown error");
      return response({ variants: buildFallbackCaptions(context), source: "template", notice: "AI sedang tidak tersedia. MediaGrow membuat alternatif aman dari Brand Kit agar pekerjaan tetap bisa dilanjutkan." });
    }
  } catch (error) {
    if (error instanceof z.ZodError) return response({ error: "Lengkapi brand, judul, tujuan, dan channel sebelum membuat caption." }, 400);
    return response({ error: "Caption belum dapat dibuat. Coba lagi sebentar." }, 500);
  }
}
