import { NextRequest, NextResponse } from "next/server";
import * as store from "@/lib/storage";
import { authorized, sameOrigin } from "@/lib/auth";
import * as ai from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function error(e: unknown) {
  if (e instanceof store.UserError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  const code = (e as NodeJS.ErrnoException).code;
  return NextResponse.json(
    {
      error:
        code === "EEXIST"
          ? "该名称已经存在"
          : code === "ENOENT"
            ? "文件或目录不存在"
            : "操作失败，请检查服务器存储权限",
    },
    { status: 400 },
  );
}
export async function GET(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "请登录" }, { status: 401 });
  try {
    await store.init();
    const relative = request.nextUrl.searchParams.get("path");
    if (relative) return NextResponse.json(await store.read(relative));
    if (request.nextUrl.searchParams.get("trash"))
      return NextResponse.json({ trash: await store.trashList() });
    return NextResponse.json({
      tree: await store.tree(),
      aiConfigured: !!process.env.DEEPSEEK_API_KEY,
      trash: await store.trashList(),
    });
  } catch (e) {
    return error(e);
  }
}
export async function POST(request: NextRequest) {
  if (!authorized(request))
    return NextResponse.json({ error: "请登录" }, { status: 401 });
  if (!sameOrigin(request))
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  try {
    const b = await request.json();
    if (typeof b.action !== "string" || typeof b.path !== "string")
      throw new store.UserError("请求无效");
    if (b.action === "assist" || b.action === "clearChat") {
      const note = await store.read(b.path);
      if (note.hash !== b.hash)
        throw new store.UserError("正文已更新，请稍后重新发送", 409);
      if (b.action === "clearChat")
        return NextResponse.json(
          await store.exclusive(() => store.clearChat(b.path, b.hash)),
        );
      if (
        typeof b.message !== "string" ||
        !b.message.trim() ||
        b.message.length > 2000
      )
        throw new store.UserError("请先写下要对 AI 说的话（最多 2000 字）");
      const message = b.message.trim();
      const reply = await ai.assist(note.content, note.chat, message);
      const history = [
        ...note.chat.map(({ role, content }) => ({ role, content })),
        { role: "user" as const, content: message },
        { role: "assistant" as const, content: reply },
      ];
      return NextResponse.json(
        await store.exclusive(() => store.putChat(b.path, history, b.hash)),
      );
    }
    if (["graph", "revise"].includes(b.action)) {
      const note = await store.read(b.path);
      if (note.hash !== b.hash)
        throw new store.UserError("正文已更新，请先保存", 409);
      if (
        b.action === "revise" &&
        (!note.graph ||
          typeof b.instruction !== "string" ||
          !b.instruction.trim() ||
          b.instruction.length > 3000)
      )
        throw new store.UserError("请填写图的修改意见（最多 3000 字）");
      const graphHash = store.hash(JSON.stringify(note.graph));
      const output = await ai.complete(note.content, b.action, {
        graph: note.graph,
        instruction: b.instruction,
      });
      let parsed;
      try {
        parsed = JSON.parse(output);
      } catch {
        throw new store.UserError("AI 返回格式无效，请重试", 502);
      }
      const graph = {
        ...ai.validateGraph(parsed, note.content),
        sourceHash: note.hash,
      };
      return NextResponse.json(
        await store.exclusive(() =>
          store.putGraph(
            b.path,
            graph,
            b.hash,
            graphHash,
            b.action === "revise" ? b.instruction.trim() : undefined,
          ),
        ),
      );
    }
    return await store.exclusive(async () => {
      switch (b.action) {
        case "annotate":
          return NextResponse.json(
            await store.putAnnotation(
              b.path,
              { id: b.id, quote: b.quote, label: b.label },
              b.hash,
              b.annotationsHash,
            ),
          );
        case "unannotate":
          return NextResponse.json(
            await store.removeAnnotation(
              b.path,
              b.id,
              b.hash,
              b.annotationsHash,
            ),
          );
        case "reorder":
          return NextResponse.json({
            tree: await store.reorder(b.path, b.order),
          });
        case "undoGraph":
          return NextResponse.json(
            await store.undoGraph(b.path, b.hash, b.graphHash),
          );
        case "save":
          if (typeof b.content !== "string" || typeof b.hash !== "string")
            throw new store.UserError("请求无效");
          return NextResponse.json(await store.save(b.path, b.content, b.hash));
        case "undo":
          return NextResponse.json(await store.undo(b.path, b.hash));
        case "create":
          if (b.type !== "file" && b.type !== "folder")
            throw new store.UserError("类型无效");
          return NextResponse.json({
            tree: await store.create(b.path, b.type),
          });
        case "move":
          if (typeof b.to !== "string") throw new store.UserError("请求无效");
          return NextResponse.json({ tree: await store.move(b.path, b.to) });
        case "trash":
          return NextResponse.json({
            tree: await store.trash(b.path),
            trash: await store.trashList(),
          });
        case "restore":
          return NextResponse.json({
            tree: await store.restore(b.path),
            trash: await store.trashList(),
          });
        case "purge":
          return NextResponse.json({
            tree: await store.purge(b.path),
            trash: await store.trashList(),
          });
        case "emptyTrash":
          return NextResponse.json({
            tree: await store.emptyTrash(),
            trash: await store.trashList(),
          });
        default:
          throw new store.UserError("未知操作");
      }
    });
  } catch (e) {
    return error(e);
  }
}
