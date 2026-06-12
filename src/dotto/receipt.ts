import { createHmac, timingSafeEqual } from "node:crypto";
import type { Receipt } from "../core/types.js";

/**
 * Canonical JSON with recursively sorted keys, so a receipt's signature does
 * not depend on object key order — only on its values.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

const secret = (): string => process.env.SYNOD_SIGNING_SECRET ?? "dev-only-not-secret";

function sign(payload: Omit<Receipt, "signature">): string {
  return createHmac("sha256", secret()).update(stableStringify(payload)).digest("hex");
}

/** Produce an immutable, signed record of a decision (PRD §3.4). */
export function signReceipt(payload: Omit<Receipt, "signature">): Receipt {
  return { ...payload, signature: sign(payload) };
}

/** Recompute the signature and constant-time compare — proves the record is untampered. */
export function verifyReceipt(receipt: Receipt): boolean {
  const { signature, ...payload } = receipt;
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
