import { randomBytes } from "node:crypto";
import {
  compactAnnotation,
  sessionSummary,
  type AnnoteAnnotationDTO,
  type AnnoteAnnotationStatus,
  type AnnoteBridgeEventDTO,
  type AnnoteCompactAnnotationDTO,
  type AnnoteSessionDTO,
  type AnnoteSessionSummaryDTO,
} from "../../protocol/src/index.js";
import type { EventBus } from "./event-bus.js";
import type { BridgeEventInput } from "./event-bus.js";

export type SessionRecord = {
  session: AnnoteSessionDTO;
  token: string;
  origin: string;
  closed: boolean;
  claimedBy: Map<string, string>;
};

export type ClaimResult = {
  claimed: boolean;
  sessionId: string;
  page: AnnoteSessionDTO["page"];
  annotation?: AnnoteAnnotationDTO;
  status?: AnnoteAnnotationStatus;
  claimedBy?: string;
};

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  constructor(private bus: EventBus) {}

  create(session: AnnoteSessionDTO, origin: string): { sessionId: string; sessionToken: string } {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(session.sessionId, { session, token, origin, closed: false, claimedBy: new Map() });
    this.bus.notifySessionChanged(session);
    return { sessionId: session.sessionId, sessionToken: token };
  }

  update(sessionId: string, token: string, session: AnnoteSessionDTO): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.closed || record.token !== token) return false;
    record.session = session;
    for (const annotation of session.annotations) {
      if (annotation.status !== "acknowledged") record.claimedBy.delete(annotation.id);
    }
    this.bus.notifySessionChanged(session);
    return true;
  }

  close(sessionId: string, token: string): boolean {
    const record = this.sessions.get(sessionId);
    if (!record || record.token !== token) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  validateToken(sessionId: string, token: string | null | undefined): SessionRecord | null {
    const record = this.sessions.get(sessionId);
    if (!record || record.closed || !token || record.token !== token) return null;
    return record;
  }

  listSessions(): AnnoteSessionSummaryDTO[] {
    return Array.from(this.sessions.values()).map((record) => sessionSummary(record.session));
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  listAnnotations(sessionId?: string): AnnoteCompactAnnotationDTO[] {
    return this.targetSessions(sessionId).flatMap((session) =>
      session.annotations.map((annotation) => compactAnnotation(session, annotation)),
    );
  }

  getAnnotation(id: string, sessionId?: string): { session: AnnoteSessionDTO; annotation: AnnoteAnnotationDTO } | { ambiguous: true } | null {
    const matches = this.targetSessions(sessionId)
      .map((session) => ({ session, annotation: session.annotations.find((annotation) => annotation.id === id) }))
      .filter((match): match is { session: AnnoteSessionDTO; annotation: AnnoteAnnotationDTO } => !!match.annotation);
    if (matches.length > 1 && !sessionId) return { ambiguous: true };
    return matches[0] || null;
  }

  pending(sessionId?: string): AnnoteCompactAnnotationDTO[] {
    return this.targetSessions(sessionId).flatMap((session) =>
      session.annotations
        .filter((annotation) => annotation.status === "pending")
        .map((annotation) => compactAnnotation(session, annotation)),
    );
  }

  claim(id: string, claimant: string, sessionId?: string): ClaimResult {
    const found = this.getAnnotation(id, sessionId);
    if (!found) return { claimed: false, sessionId: sessionId || "", page: { url: "", origin: "" } };
    if ("ambiguous" in found) return { claimed: false, sessionId: "", page: { url: "", origin: "" } };
    const { session, annotation } = found;
    if (annotation.status !== "pending") {
      return {
        claimed: false,
        sessionId: session.sessionId,
        page: session.page,
        annotation,
        status: annotation.status,
        claimedBy: this.sessions.get(session.sessionId)?.claimedBy.get(annotation.id),
      };
    }
    annotation.status = "acknowledged";
    annotation.updatedAt = new Date().toISOString();
    const record = this.sessions.get(session.sessionId);
    record?.claimedBy.set(annotation.id, claimant);
    this.emit(session.sessionId, { type: "annotation.acknowledge", annotationId: id, claimedBy: claimant });
    this.bus.notifySessionChanged(session);
    return { claimed: true, sessionId: session.sessionId, page: session.page, annotation, status: annotation.status, claimedBy: claimant };
  }

  reply(id: string, message: string, sessionId?: string): ClaimResult {
    const found = this.getAnnotation(id, sessionId);
    if (!found || "ambiguous" in found) return { claimed: false, sessionId: sessionId || "", page: { url: "", origin: "" } };
    this.emit(found.session.sessionId, { type: "annotation.reply", annotationId: id, message });
    return { claimed: false, sessionId: found.session.sessionId, page: found.session.page, annotation: found.annotation, status: found.annotation.status };
  }

  resolve(id: string, message?: string, sessionId?: string): ClaimResult {
    if (message) this.reply(id, message, sessionId);
    const found = this.getAnnotation(id, sessionId);
    if (!found || "ambiguous" in found) return { claimed: false, sessionId: sessionId || "", page: { url: "", origin: "" } };
    found.annotation.status = "resolved";
    found.annotation.updatedAt = new Date().toISOString();
    this.emit(found.session.sessionId, { type: "annotation.resolve", annotationId: id });
    this.bus.notifySessionChanged(found.session);
    return { claimed: false, sessionId: found.session.sessionId, page: found.session.page, annotation: found.annotation, status: "resolved" };
  }

  dismiss(id: string, reason?: string, sessionId?: string): ClaimResult {
    if (reason) this.reply(id, reason, sessionId);
    const found = this.getAnnotation(id, sessionId);
    if (!found || "ambiguous" in found) return { claimed: false, sessionId: sessionId || "", page: { url: "", origin: "" } };
    found.annotation.status = "dismissed";
    found.annotation.updatedAt = new Date().toISOString();
    this.emit(found.session.sessionId, { type: "annotation.dismiss", annotationId: id, reason });
    this.bus.notifySessionChanged(found.session);
    return { claimed: false, sessionId: found.session.sessionId, page: found.session.page, annotation: found.annotation, status: "dismissed" };
  }

  async watch(options: { sessionId?: string; timeoutMs: number; batchWindowMs: number; claim: boolean; claimant: string }): Promise<AnnoteCompactAnnotationDTO[]> {
    const existing = this.pending(options.sessionId);
    const firstBatch = existing.length
      ? existing
      : await this.bus.waitForSessionChange(
          (session) => (!options.sessionId || session.sessionId === options.sessionId) && session.annotations.some((annotation) => annotation.status === "pending"),
          options.timeoutMs,
        ).then(() => this.pending(options.sessionId));
    if (!firstBatch.length) return [];
    await new Promise((resolve) => setTimeout(resolve, options.batchWindowMs));
    const batch = this.pending(options.sessionId);
    if (!options.claim) return batch;
    return batch
      .map((annotation) => this.claim(annotation.id, options.claimant, annotation.sessionId))
      .filter((result) => result.claimed && result.annotation)
      .map((result) => compactAnnotation(this.sessions.get(result.sessionId)!.session, result.annotation!));
  }

  private targetSessions(sessionId?: string): AnnoteSessionDTO[] {
    const record = sessionId ? this.sessions.get(sessionId) : null;
    return record ? [record.session] : sessionId ? [] : Array.from(this.sessions.values()).map((item) => item.session);
  }

  private emit(sessionId: string, event: BridgeEventInput): void {
    this.bus.emit(sessionId, this.bus.event(event));
  }
}
