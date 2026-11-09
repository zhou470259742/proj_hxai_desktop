import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { CONFIG } from "./config.mjs";

const SCRYPT_N = 16384;
const KEYLEN = 64;

/** 口令散列：scrypt$N$salt$hash（不引入任何第三方库，避免原生编译） */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N }).toString("hex");
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, n, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const candidate = scryptSync(String(password), salt, KEYLEN, { N: Number(n) });
    const expected = Buffer.from(hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (str) => Buffer.from(str, "base64url");

function sign(data) {
  return createHmac("sha256", CONFIG.secret).update(data).digest("base64url");
}

export function issueToken(payload) {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const sig = sign(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

export function decodeToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64u(body).toString("utf8"));
    if (payload.exp && Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export const randomToken = (size = 24) => randomBytes(size).toString("base64url");
