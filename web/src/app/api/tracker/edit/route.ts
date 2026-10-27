import { runCoreCli } from "@/lib/core-cli";
import { readJsonObject } from "@/lib/json-body";
import { parseCliJson } from "@/lib/status-cli.mjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown>>(req);
  if (!body || (typeof body.n !== "string" && typeof body.n !== "number") || !/^[1-9]\d*$/.test(String(body.n ?? "")) ||
      ["company", "role", "expectedCompany", "expectedRole"].some((key) =>
        typeof body[key] !== "string" || !(body[key] as string).trim() ||
        (body[key] as string).length > 500 || /[|\x00-\x1f\x7f]/.test(body[key] as string))) {
    return Response.json({ error: "Provide a company and role without pipes or control characters (maximum 500 characters)." }, { status: 400 });
  }
  const result = await runCoreCli("tracker", ["edit", "--num", String(body.n),
    "--company", (body.company as string).trim(), "--role", (body.role as string).trim(),
    "--expect-company", body.expectedCompany as string, "--expect-role", body.expectedRole as string]);
  const parsed = parseCliJson(result.stdout);
  if (result.code !== 0 || parsed?.ok !== true) {
    const code = parsed?.code;
    const status = code === "conflict" ? 409 : code === "not-found" ? 404 : code === "invalid-input" || code === "malformed-row" ? 400 : code === "lock-timeout" ? 503 : 500;
    const clientError = ["conflict", "not-found", "invalid-input", "malformed-row"].includes(String(code));
    const message = clientError && typeof parsed?.error === "string" ? parsed.error
      : code === "lock-timeout" ? "The tracker is busy. Please try again shortly."
      : "Could not save changes. Please try again.";
    return Response.json({ error: message }, { status });
  }
  return Response.json({ ok: true });
}
