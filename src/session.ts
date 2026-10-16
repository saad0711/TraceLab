import { Simulator, validateConfig, cloneConfig, type Config, type Fault } from './engine.js';
export type Intervention =
  | { at: number; type: 'fault'; fault: Fault }
  | { at: number; type: 'rate'; rate: number }
  | { at: number; type: 'recover' };
export interface Session {
  schemaVersion: 1;
  title: string;
  config: Config;
  events: Intervention[];
  elapsedMs: number;
}
export function replaySession(input: unknown): { session: Session; simulator: Simulator } {
  if (!input || typeof input !== 'object') throw new Error('Choose a TraceLab JSON export.');
  const raw = input as Session;
  if (raw.schemaVersion !== 1) throw new Error('This session version is not supported.');
  if (
    typeof raw.title !== 'string' ||
    raw.title.length > 100 ||
    !Number.isFinite(raw.elapsedMs) ||
    raw.elapsedMs < 0 ||
    raw.elapsedMs > 600000 ||
    !Array.isArray(raw.events) ||
    raw.events.length > 500
  )
    throw new Error('Session title, duration, or events are invalid.');
  const config = validateConfig(raw.config),
    simulator = new Simulator(config);
  let previous = 0;
  const advance = (ms: number) => {
    while (ms > 0) {
      const step = Math.min(ms, 60000);
      simulator.advance(step);
      ms -= step;
    }
  };
  const events: Intervention[] = [];
  for (const event of raw.events) {
    if (!event || !Number.isFinite(event.at) || event.at < previous || event.at > raw.elapsedMs)
      throw new Error('Session events must be ordered within its duration.');
    advance(event.at - simulator.time);
    if (event.type === 'rate') {
      simulator.setRate(event.rate);
      events.push({ at: event.at, type: 'rate', rate: event.rate });
    } else if (event.type === 'fault') {
      simulator.inject(event.fault);
      events.push({ at: event.at, type: 'fault', fault: { ...event.fault } });
    } else if (event.type === 'recover') {
      simulator.recoverAll();
      events.push({ at: event.at, type: 'recover' });
    } else throw new Error('Unknown session event.');
    previous = event.at;
  }
  advance(raw.elapsedMs - simulator.time);
  return {
    session: {
      schemaVersion: 1,
      title: raw.title,
      config: cloneConfig(config),
      events,
      elapsedMs: raw.elapsedMs,
    },
    simulator,
  };
}
