import crypto from "crypto";

const TOKEN_ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getTokenKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptToken(value: string): string {
  const key = getTokenKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(TOKEN_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((buf) => buf.toString("base64url")).join(".");
}

export function decryptToken(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const [ivRaw, tagRaw, encryptedRaw] = parts.map((part) => Buffer.from(part, "base64url"));
    const key = getTokenKey();
    const decipher = crypto.createDecipheriv(TOKEN_ALGO, key, ivRaw);
    decipher.setAuthTag(tagRaw);
    const decrypted = Buffer.concat([decipher.update(encryptedRaw), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
