import type { Logger } from 'pino';

export const ANALYTICS_EVENTS = [
  'GAME_STARTED',
  'MATCH_STARTED',
  'MATCH_ENDED',
  'PLAYER_DIED',
  'PLAYER_EXTRACTED',
  'ITEM_FOUND',
  'ITEM_SOLD',
  'ITEM_BOUGHT',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  timestamp: string;
  props: AnalyticsProps;
}

/** A destination for analytics events (log, memory, later an external provider). */
export interface AnalyticsSink {
  handle(event: AnalyticsEvent): void | Promise<void>;
}

type Listener = (event: AnalyticsEvent) => void;

/**
 * In-process analytics event bus. Game code calls `track`; sinks forward the
 * events. Sink failures never propagate into game logic.
 */
export class AnalyticsBus {
  private readonly sinks: AnalyticsSink[] = [];
  private readonly listeners = new Map<AnalyticsEventName, Set<Listener>>();

  constructor(private readonly onError: (err: unknown) => void = () => {}) {}

  addSink(sink: AnalyticsSink): this {
    this.sinks.push(sink);
    return this;
  }

  on(name: AnalyticsEventName, fn: Listener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  track(name: AnalyticsEventName, props: AnalyticsProps = {}): void {
    const event: AnalyticsEvent = { name, timestamp: new Date().toISOString(), props };
    for (const sink of this.sinks) {
      try {
        const r = sink.handle(event);
        if (r instanceof Promise) r.catch(this.onError);
      } catch (err) {
        this.onError(err);
      }
    }
    const set = this.listeners.get(name);
    if (set) for (const fn of set) fn(event);
  }
}

export class LogAnalyticsSink implements AnalyticsSink {
  constructor(private readonly logger: Logger) {}

  handle(event: AnalyticsEvent): void {
    this.logger.debug({ analytics: event.name, ...event.props }, `analytics:${event.name}`);
  }
}

/** Keeps the last N events in memory, useful for tests and the metrics endpoint. */
export class MemoryAnalyticsSink implements AnalyticsSink {
  readonly events: AnalyticsEvent[] = [];
  readonly counts: Partial<Record<AnalyticsEventName, number>> = {};

  constructor(private readonly capacity = 500) {}

  handle(event: AnalyticsEvent): void {
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    this.counts[event.name] = (this.counts[event.name] ?? 0) + 1;
  }
}
