/**
 * Zeabur 转发服务（万能通道 · Node 版）
 *
 * 【零依赖】只用 Node 内置模块（http / https / url）
 *
 * 【用法】
 *   https://<你的域名>/?target=<URL编码>&<其余参数>
 *   例：/?target=https%3A%2F%2Ffapi.binance.com%2Ffapi%2Fv1%2Fklines&symbol=ETHUSDT&interval=1m&limit=10
 *   无参数访问 → 返回自检信息（含能否到币安）
 *
 * 【Zeabur 部署要点】
 *   · 区域选【香港 hkg / 新加坡 sin / 东京 tyo】← 关键！避开美国
 *   · 端口用 process.env.PORT（Zeabur 自动注入）
 */

const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const PORT = process.env.PORT || 8080;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 只放行公开行情域名
const ALLOW = [
  "binance.com", "binance.vision", "binancefuture.com",
  "okx.com", "bybit.com", "mexc.com", "gateio.ws",
  "coinbase.com", "kraken.com", "htx.com", "kucoin.com",
  "coingecko.com", "cryptocompare.com",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Cache-Control": "no-store",
};

function allowed(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return ALLOW.some((a) => h === a || h.endsWith("." + a));
  } catch (e) {
    return false;
  }
}

function fetchUrl(full, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let req;
    try {
      req = https.get(full, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      }, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => resolve({
          ok: true, status: r.statusCode,
          ctype: r.headers["content-type"] || "application/json",
          body: Buffer.concat(chunks), ms: Date.now() - t0,
        }));
      });
    } catch (e) {
      return resolve({ ok: false, error: e.name + ": " + e.message,
                       ms: Date.now() - t0 });
    }
    req.on("timeout", () => { req.destroy(); });
    req.on("error", (e) => resolve({ ok: false, error: e.name + ": " +
                                     e.message, ms: Date.now() - t0 }));
  });
}

function sendJson(res, obj, status) {
  const b = Buffer.from(JSON.stringify(obj, null, 2), "utf8");
  res.writeHead(status || 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": b.length,
    ...CORS,
  });
  res.end(b);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const target = u.searchParams.get("target") || "";
  const path = u.searchParams.get("path") || "";

  // 无参数 → 自检
  if (!target && !path) {
    const probe = await fetchUrl("https://fapi.binance.com/fapi/v1/time",
                                 10000);
    return sendJson(res, {
      ok: true,
      relay: "zeabur-node",
      region_hint: process.env.ZEABUR_REGION ||
                   process.env.VERCEL_REGION || null,
      usage: "/?target=<urlencoded-url>&<params>",
      binance_shortcut: "/?path=/fapi/v1/klines&symbol=ETHUSDT&interval=1m&limit=10",
      upstream_probe: probe.ok
        ? { status: probe.status, ms: probe.ms,
            body: probe.body.toString("utf8").slice(0, 200) }
        : { error: probe.error, ms: probe.ms },
    });
  }

  // 组装目标 URL
  const extra = new URLSearchParams();
  for (const [k, v] of u.searchParams.entries()) {
    if (k === "target" || k === "path") continue;
    extra.append(k, v);
  }
  const qs = extra.toString();

  let full;
  if (target) {
    full = target + (qs ? (target.includes("?") ? "&" : "?") + qs : "");
  } else {
    full = "https://fapi.binance.com" + path + (qs ? "?" + qs : "");
  }

  if (!allowed(full)) return sendJson(res, { error: "host not allowed",
                                             target: full }, 403);

  const r = await fetchUrl(full, 25000);
  if (!r.ok) return sendJson(res, { error: r.error, target: full,
                                    ms: r.ms }, 502);

  res.writeHead(r.status, {
    "Content-Type": r.ctype,
    "X-Relay": "zeabur-node",
    "X-Upstream-Ms": String(r.ms),
    "Content-Length": r.body.length,
    ...CORS,
  });
  res.end(r.body);
});

server.listen(PORT, () => {
  console.log("zeabur-relay listening on port " + PORT);
});
