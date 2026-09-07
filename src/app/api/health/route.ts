export async function GET() {
  return Response.json({ ok: true, service: "content-hub", time: new Date().toISOString() });
}
