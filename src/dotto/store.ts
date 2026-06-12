import type { Receipt } from "../core/types.js";

/** Append-only in-memory audit log. Satisfies PRD §3.4 "receipt store" for MVP. */
class ReceiptStore {
  private readonly log: Receipt[] = [];

  add(receipt: Receipt): void {
    this.log.push(receipt);
  }

  getAll(): readonly Receipt[] {
    return this.log;
  }
}

export const receiptStore = new ReceiptStore();
