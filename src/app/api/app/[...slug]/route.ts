import { handle } from "@/server/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function entry(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await ctx.params;
  return handle(req, slug);
}

export const GET = entry;
export const POST = entry;
export const PATCH = entry;
export const DELETE = entry;
