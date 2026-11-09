import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..");

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.DATA_DIR || join(ROOT, "data"),
  publicDir: join(ROOT, "public"),
  // 会话令牌签名密钥。生产环境务必通过环境变量固定，否则每次重启会让已签发令牌失效。
  secret: process.env.OWCP_SECRET || "hx-control-plane-dev-secret-change-me",
  tokenTtlSeconds: Number(process.env.OWCP_TOKEN_TTL || 60 * 60 * 12),
  cookieName: "owcp_session",
  // 控制面对外地址，用于生成下发清单里的资源链接
  publicBaseUrl: process.env.OWCP_PUBLIC_BASE_URL || "http://127.0.0.1:8787",
  orgName: process.env.OWCP_ORG_NAME || "和信智慧应急",
  // 控制面自己的版本号，客户端 /v1/app-version 会读它
  version: process.env.OWCP_VERSION || "0.1.0",
  // 桌面端登录回调协议：授权页生成登录码后用它把码直接带回客户端
  desktopDeepLinkScheme: process.env.OWCP_DESKTOP_DEEPLINK_SCHEME || "hxai",
  allowAnonymousManifest: process.env.OWCP_ANON_MANIFEST === "1",
};
