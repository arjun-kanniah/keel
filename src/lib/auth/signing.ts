import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

// Small HMAC-signed tokens: base64url(json).signature. Used for the session cookie and for the
// short-lived scoped tokens the assistant calls tools with. Each use has its own purpose string,
// so a token minted for one can't be replayed as the other.

function sig(purpose: string, body: string): string {
  return createHmac("sha256", config.sessionSecret).update(`${purpose}.${body}`).digest("base64url");
}

export function sign(purpose: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sig(purpose, body)}`;
}

export function verify<T>(purpose: string, token: string | undefined | null): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sig(purpose, body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
