import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz";

/** Short random ids with a readable prefix, e.g. cs_4k2m9x7q. */
export function newId(prefix: string, len = 10): string {
  const bytes = randomBytes(len);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}
