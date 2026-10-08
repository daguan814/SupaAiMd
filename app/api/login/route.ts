import { NextRequest, NextResponse } from "next/server";
import { token, sameOrigin } from "@/lib/auth";
import {
  clientKey,
  lockedMessage,
  registerFailure,
  registerSuccess,
} from "@/lib/login-guard";
export async function POST(request: NextRequest) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const key = clientKey(request);
  const locked = await lockedMessage(key);
  if (locked)
    return NextResponse.json(
      { error: `密码错误次数过多，登录已锁定，请 ${locked}后再试` },
      { status: 429 },
    );
  const { password } = await request.json();
  if (password !== process.env.APP_PASSWORD) {
    const { locked: nowLocked, remaining } = await registerFailure(key);
    return NextResponse.json(
      {
        error: nowLocked
          ? "密码错误次数过多，已锁定 5 小时"
          : `密码不正确，还可以尝试 ${remaining} 次`,
      },
      { status: nowLocked ? 429 : 401 },
    );
  }
  await registerSuccess(key);
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
