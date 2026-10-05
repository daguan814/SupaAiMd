import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
export const token = () =>
  createHmac("sha256", process.env.APP_PASSWORD || "local")
    .update("supaaimd-session-v1")
    .digest("hex");
export function authorized(request: NextRequest) {
  if (!process.env.APP_PASSWORD) return true;
  const value = request.cookies.get("notes-session")?.value || "";
  const expected = token();
  return (
    value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
