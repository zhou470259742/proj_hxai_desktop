/**
 * 本地 mock 模型服务
 *
 * 目的：在没有真实内网模型网关的环境里，验证「ZCode → 控制面网关 → 上游模型」
 * 这条链路真的能跑通。它只实现最小可用的 OpenAI Chat Completions 响应。
 *
 * 用法：
 *   node scripts/mock-upstream.mjs            # 默认 9911 端口
 *   PORT=9911 node scripts/mock-upstream.mjs
 *
 * 然后把后台的 llm_providers.base_url 指到 http://127.0.0.1:9911/v1
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 9911);
const HOST = process.env.HOST || "127.0.0.1";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
  }

  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      // 忽略
    }
    const lastUser = Array.isArray(body.messages)
      ? [...body.messages].reverse().find((m) => m?.role === "user")
      : undefined;
    const text =
      typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
    const reply = `MOCK_OK model=${body.model} echo=${text.slice(0, 60)}`;
    console.log(
      `[mock] ${body.stream ? "stream" : "json"} model=${body.model} msgs=${body.messages?.length ?? 0}`
    );

    // ZCode 默认走流式（stream: true）。上游只回一个非流式 JSON 时客户端会认为
    // 「没有文本、没有工具调用、也没有 usage」，所以这里两种都要支持。
    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const chunk = {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "mock-model",
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      };
      const final = {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "mock-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify(final)}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      })
    );
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found", path: url.pathname }));
});

server.listen(PORT, HOST, () => {
  console.log(`mock 上游模型服务已启动: http://${HOST}:${PORT}/v1`);
  console.log(`  把后台 llm_providers.base_url 改成 http://${HOST}:${PORT}/v1 即可`);
});
