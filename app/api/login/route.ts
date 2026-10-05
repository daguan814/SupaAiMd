import { NextRequest, NextResponse } from "next/server";
import { token, sameOrigin } from "@/lib/auth";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const { password } = await request.json();
  if (password !== process.env.APP_PASSWORD)
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("notes-session", token(), {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 86400 * 7,
  });
  return response;
}
