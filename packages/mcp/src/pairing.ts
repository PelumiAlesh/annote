import { randomBytes } from "node:crypto";
import { approveOrigin } from "./permissions.js";

export type PairRequest = {
  requestId: string;
  origin: string;
  expiresAt: number;
  used: boolean;
};

export class PairingStore {
  private requests = new Map<string, PairRequest>();
  private recentByOrigin = new Map<string, number[]>();

  constructor(private ttlMs = 3 * 60 * 1000) {}

  create(origin: string): PairRequest {
    this.gc();
    const now = Date.now();
    const recent = (this.recentByOrigin.get(origin) || []).filter((time) => now - time < 60_000);
    if (recent.length >= 12) throw new Error("Too many pairing requests. Try again in a minute.");
    recent.push(now);
    this.recentByOrigin.set(origin, recent);
    const request = {
      requestId: randomBytes(24).toString("base64url"),
      origin,
      expiresAt: now + this.ttlMs,
      used: false,
    };
    this.requests.set(request.requestId, request);
    return request;
  }

  get(requestId: string): PairRequest | null {
    this.gc();
    return this.requests.get(requestId) || null;
  }

  async approve(requestId: string): Promise<string | null> {
    const request = this.get(requestId);
    if (!request || request.used || request.expiresAt <= Date.now()) return null;
    request.used = true;
    this.requests.delete(requestId);
    return approveOrigin(request.origin);
  }

  cancel(requestId: string): void {
    this.requests.delete(requestId);
  }

  private gc(): void {
    const now = Date.now();
    for (const [id, request] of this.requests) {
      if (request.used || request.expiresAt <= now) this.requests.delete(id);
    }
  }
}
