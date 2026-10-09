// 单容器部署用的 TLS 终端：对外用证书提供 HTTPS，再转给同一个容器里的 Next 服务。
// Next 自己不做 HTTPS，所以这一层必须和它一起跑；放在同一个进程组里是为了让容器退出时一起收掉。
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";

const cert = process.env.TLS_CERT || "/app/certs/shuijing.site.pem";
const key = process.env.TLS_KEY || "/app/certs/shuijing.site.key";
const port = Number(process.env.TLS_PORT || 8443);
const appPort = Number(process.env.APP_PORT || 3000);

const server = createServer(
  { cert: readFileSync(cert), key: readFileSync(key), minVersion: "TLSv1.2" },
  (req, res) => {
    const headers = { ...req.headers };
    // 这些是逐跳首部，不能往上游转发
    for (const name of [
      "connection",
      "keep-alive",
      "proxy-connection",
      "upgrade",
      "transfer-encoding",
    ])
      delete headers[name];
    // 保留原始 Host（含端口），应用的同源校验要拿它比对 Origin
    headers["x-forwarded-proto"] = "https";
    const client = req.socket.remoteAddress;
    if (client) {
      headers["x-forwarded-for"] = [headers["x-forwarded-for"], client]
        .filter(Boolean)
        .join(", ");
      headers["x-real-ip"] = client;
    }

    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: appPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (reply) => {
        const outgoing = { ...reply.headers };
        for (const name of ["connection", "keep-alive", "transfer-encoding"])
          delete outgoing[name];
        res.writeHead(reply.statusCode || 502, outgoing);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("应用还没起来，稍后刷新即可。");
    });
    req.pipe(upstream);
  },
);

server.listen(port, "0.0.0.0", () => {
  console.log(`[tls] https://0.0.0.0:${port} -> http://127.0.0.1:${appPort}`);
});
