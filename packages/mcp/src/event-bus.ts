import { randomUUID } from "node:crypto";
import type { AnnoteBridgeEventDTO, AnnoteSessionDTO } from "../../protocol/src/index.js";

export type BridgeEvent = AnnoteBridgeEventDTO;
export type BridgeEventInput = AnnoteBridgeEventDTO extends infer T
  ? T extends { eventId: string; timestamp: string }
    ? Omit<T, "eventId" | "timestamp">
    : never
  : never;
export type EventListener = (event: BridgeEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>();
  private globalListeners = new Set<EventListener>();
  private waiters = new Set<(session: AnnoteSessionDTO) => void>();

  event(event: BridgeEventInput): BridgeEvent {
    return { ...event, eventId: randomUUID(), timestamp: new Date().toISOString() } as BridgeEvent;
  }

  emit(sessionId: string, event: BridgeEvent): void {
    this.listeners.get(sessionId)?.forEach((listener) => listener(event));
    this.globalListeners.forEach((listener) => listener(event));
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(sessionId) || new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(sessionId);
    };
  }

  subscribeGlobal(listener: EventListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  notifySessionChanged(session: AnnoteSessionDTO): void {
    this.waiters.forEach((waiter) => waiter(session));
  }

  waitForSessionChange(predicate: (session: AnnoteSessionDTO) => boolean, timeoutMs: number): Promise<AnnoteSessionDTO | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (session: AnnoteSessionDTO | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(waiter);
        resolve(session);
      };
      const waiter = (session: AnnoteSessionDTO): void => {
        if (predicate(session)) finish(session);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.waiters.add(waiter);
    });
  }
}
