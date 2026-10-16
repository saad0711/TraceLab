/** Deterministic discrete-event simulation. No browser or wall-clock dependencies. */
export type ServiceId = 'gateway' | 'catalog' | 'checkout' | 'cache' | 'database';
export type CircuitState = 'closed' | 'open' | 'half-open';
export interface ServiceConfig {
  id: ServiceId;
  name: string;
  latency: number;
  concurrency: number;
  failureRate: number;
}
export interface Config {
  seed: number;
  rate: number;
  retries: number;
  circuitBreaker: boolean;
  timeout: number;
  queueLimit: number;
  services: ServiceConfig[];
}
export interface Fault {
  service: ServiceId;
  kind: 'latency' | 'outage' | 'errors';
  duration: number;
}
export interface Trace {
  id: number;
  started: number;
  ended: number;
  ok: boolean;
  reason: string;
  route: ServiceId[];
  attempts: number;
  duration: number;
}
export interface LogEntry {
  time: number;
  kind: 'info' | 'warning' | 'error' | 'success';
  text: string;
}
export interface Sample {
  time: number;
  throughput: number;
  errorRate: number;
  latency: number;
  queue: number;
}
export interface ServiceView {
  id: ServiceId;
  name: string;
  active: number;
  queue: number;
  circuit: CircuitState;
  fault: string | null;
  attempts: number;
  failures: number;
  latency: number;
  concurrency: number;
}
export interface Snapshot {
  time: number;
  started: number;
  succeeded: number;
  failed: number;
  inflight: number;
  attempts: number;
  retries: number;
  rejected: number;
  successRate: number;
  p95: number;
  throughput: number;
  services: ServiceView[];
  samples: Sample[];
  traces: Trace[];
  logs: LogEntry[];
}

export const DEFAULT_CONFIG: Config = {
  seed: 42,
  rate: 36,
  retries: 1,
  circuitBreaker: true,
  timeout: 1600,
  queueLimit: 40,
  services: [
    { id: 'gateway', name: 'API Gateway', latency: 8, concurrency: 12, failureRate: 0.001 },
    { id: 'catalog', name: 'Catalog API', latency: 28, concurrency: 8, failureRate: 0.008 },
    { id: 'checkout', name: 'Checkout API', latency: 48, concurrency: 8, failureRate: 0.008 },
    { id: 'cache', name: 'Redis Cache', latency: 6, concurrency: 10, failureRate: 0.002 },
    { id: 'database', name: 'PostgreSQL', latency: 65, concurrency: 6, failureRate: 0.012 },
  ],
};
export const cloneConfig = (config: Config): Config => structuredClone(config);
const IDS: ServiceId[] = ['gateway', 'catalog', 'checkout', 'cache', 'database'];

export function validateConfig(input: unknown): Config {
  if (!input || typeof input !== 'object') throw new Error('A configuration object is required.');
  const c = input as Config;
  const bounded = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (!bounded(c.rate, 1, 180) || !bounded(c.seed, 1, 2147483647) || !Number.isInteger(c.seed))
    throw new Error('Traffic must be 1–180 req/s and seed must be a positive 32-bit integer.');
  if (
    !bounded(c.retries, 0, 3) ||
    !Number.isInteger(c.retries) ||
    typeof c.circuitBreaker !== 'boolean'
  )
    throw new Error('Retries must be 0–3 and circuitBreaker must be a boolean.');
  if (
    !bounded(c.timeout, 200, 10000) ||
    !bounded(c.queueLimit, 0, 200) ||
    !Number.isInteger(c.queueLimit)
  )
    throw new Error('Timeout or queue limit is outside the supported range.');
  if (!Array.isArray(c.services) || c.services.length !== IDS.length)
    throw new Error('Exactly five service configurations are required.');
  for (const id of IDS) {
    const services = c.services.filter((s) => s?.id === id);
    const s = services[0];
    if (
      services.length !== 1 ||
      !s ||
      !bounded(s.latency, 1, 1000) ||
      !bounded(s.concurrency, 1, 32) ||
      !Number.isInteger(s.concurrency) ||
      !bounded(s.failureRate, 0, 1)
    )
      throw new Error(`Invalid settings for ${id}.`);
  }
  return {
    seed: c.seed,
    rate: c.rate,
    retries: c.retries,
    circuitBreaker: c.circuitBreaker,
    timeout: c.timeout,
    queueLimit: c.queueLimit,
    services: IDS.map((id) => {
      const s = c.services.find((s) => s.id === id)!;
      return { ...s, name: DEFAULT_CONFIG.services.find((d) => d.id === id)!.name };
    }),
  };
}

type Event = {
  at: number;
  seq: number;
  kind: 'arrival' | 'done' | 'retry' | 'timeout';
  request?: number;
  service?: ServiceId;
  failed?: boolean;
  probe?: boolean;
  generation?: number;
};
class EventHeap {
  private items: Event[] = [];
  private less(a: Event, b: Event): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
  peek(): Event | undefined {
    return this.items[0];
  }
  push(event: Event): void {
    this.items.push(event);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.items[i]!, this.items[p]!)) break;
      [this.items[i], this.items[p]] = [this.items[p]!, this.items[i]!];
      i = p;
    }
  }
  pop(): Event | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        let m = i;
        const l = 2 * i + 1,
          r = l + 1;
        if (l < this.items.length && this.less(this.items[l]!, this.items[m]!)) m = l;
        if (r < this.items.length && this.less(this.items[r]!, this.items[m]!)) m = r;
        if (m === i) break;
        [this.items[i], this.items[m]] = [this.items[m]!, this.items[i]!];
        i = m;
      }
    }
    return first;
  }
}
interface Request {
  id: number;
  started: number;
  route: ServiceId[];
  stage: number;
  retry: number;
  attempts: number;
}
interface Runtime {
  config: ServiceConfig;
  active: number;
  queue: number[];
  attempts: number;
  failures: number;
  consecutive: number;
  circuit: CircuitState;
  openUntil: number;
  probeBusy: boolean;
  generation: number;
  fault: (Fault & { until: number }) | null;
}

export class Simulator {
  readonly config: Config;
  private clock = 0;
  private sequence = 0;
  private heap = new EventHeap();
  private requests = new Map<number, Request>();
  private runtime = new Map<ServiceId, Runtime>();
  private nextSample = 1000;
  private samples: Sample[] = [];
  private traces: Trace[] = [];
  private logs: LogEntry[] = [];
  private latencies: number[] = [];
  private started = 0;
  private succeeded = 0;
  private failed = 0;
  private totalAttempts = 0;
  private totalRetries = 0;
  private rejected = 0;
  private lastSucceeded = 0;
  private lastFailed = 0;
  private trafficEnabled = true;

  constructor(config: Config = DEFAULT_CONFIG) {
    this.config = validateConfig(config);
    for (const s of this.config.services)
      this.runtime.set(s.id, {
        config: s,
        active: 0,
        queue: [],
        attempts: 0,
        failures: 0,
        consecutive: 0,
        circuit: 'closed',
        openUntil: 0,
        probeBusy: false,
        generation: 0,
        fault: null,
      });
    this.schedule({ at: 0, kind: 'arrival' });
    this.log('info', `Simulation initialized · seed ${this.config.seed}`);
  }
  get time(): number {
    return this.clock;
  }
  private schedule(e: Omit<Event, 'seq'>): void {
    this.heap.push({ ...e, seq: this.sequence++ });
  }
  private random(key: number): number {
    let x = (key ^ this.config.seed) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    x = (x ^ (x >>> 16)) >>> 0;
    return x / 4294967296;
  }
  private draw(r: Request, channel: number): number {
    return this.random(Math.imul(r.id, 100003) + r.stage * 1009 + r.retry * 101 + channel * 17);
  }
  private log(kind: LogEntry['kind'], text: string): void {
    this.logs.unshift({ time: this.clock, kind, text });
    this.logs.length = Math.min(this.logs.length, 60);
  }
  private fault(s: Runtime): Runtime['fault'] {
    return s.fault && this.clock < s.fault.until ? s.fault : null;
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 1 || rate > 180)
      throw new Error('Traffic must be 1–180 req/s.');
    this.config.rate = rate;
    this.log('info', `Traffic set to ${rate} req/s`);
  }
  stopTraffic(): void {
    this.trafficEnabled = false;
  }
  inject(fault: Fault): void {
    if (
      !IDS.includes(fault.service) ||
      !['latency', 'outage', 'errors'].includes(fault.kind) ||
      !Number.isFinite(fault.duration) ||
      fault.duration < 1000 ||
      fault.duration > 60000
    )
      throw new Error('Invalid fault definition.');
    const s = this.runtime.get(fault.service)!;
    s.fault = { ...fault, until: this.clock + fault.duration };
    this.log(
      'warning',
      `${s.config.name}: ${fault.kind === 'latency' ? '+600 ms latency' : fault.kind === 'outage' ? 'service outage' : '65% errors'} for ${fault.duration / 1000}s`,
    );
  }
  recoverAll(): void {
    for (const s of this.runtime.values()) s.fault = null;
    this.log('success', 'All injected faults removed. Open circuits recover after their cooldown.');
  }
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 60000)
      throw new Error('Advance must be between 0 and 60000 ms.');
    const end = this.clock + milliseconds;
    while (true) {
      const event = this.heap.peek();
      if (this.nextSample <= end && (!event || this.nextSample <= event.at)) {
        this.clock = this.nextSample;
        this.sample();
        this.nextSample += 1000;
        continue;
      }
      if (!event || event.at > end) break;
      this.heap.pop();
      this.clock = event.at;
      this.process(event);
    }
    this.clock = end;
  }
  private process(e: Event): void {
    if (e.kind === 'arrival') {
      if (this.trafficEnabled) this.arrive();
      return;
    }
    if (e.kind === 'done') {
      this.complete(e);
      return;
    }
    const r = this.requests.get(e.request!);
    if (!r) return;
    if (e.kind === 'timeout') this.finish(r, false, 'Request deadline exceeded');
    else this.dispatch(r);
  }
  private arrive(): void {
    const id = ++this.started;
    const isRead = this.random(id * 1009) < 0.7;
    const hit = this.random(id * 1009 + 1) < 0.72;
    const route: ServiceId[] = isRead
      ? ['gateway', 'catalog', 'cache', ...(!hit ? ['database' as const] : [])]
      : ['gateway', 'checkout', 'database'];
    const r: Request = { id, started: this.clock, route, stage: 0, retry: 0, attempts: 0 };
    this.requests.set(id, r);
    this.schedule({ at: this.clock + this.config.timeout, kind: 'timeout', request: id });
    this.dispatch(r);
    const interval = (1000 / this.config.rate) * (0.75 + 0.5 * this.random(id * 7919));
    this.schedule({ at: this.clock + interval, kind: 'arrival' });
  }
  private dispatch(r: Request): void {
    const id = r.route[r.stage];
    if (!id) {
      this.finish(r, true, 'OK');
      return;
    }
    const s = this.runtime.get(id)!;
    if (this.config.circuitBreaker && s.circuit === 'open' && this.clock < s.openUntil) {
      this.rejected++;
      this.finish(r, false, `${s.config.name}: circuit open`);
      return;
    }
    // Admission is bounded; no unbounded backlog when a dependency slows down.
    if (s.active >= s.config.concurrency) {
      s.queue = s.queue.filter((id) => this.requests.has(id));
      if (s.queue.length >= this.config.queueLimit) {
        this.rejected++;
        this.finish(r, false, `${s.config.name}: queue full`);
      } else s.queue.push(r.id);
      return;
    }
    this.startWork(r, s);
  }
  private startWork(r: Request, s: Runtime): void {
    let probe = false;
    if (this.config.circuitBreaker) {
      if (s.circuit === 'open' && this.clock >= s.openUntil) {
        s.circuit = 'half-open';
        s.probeBusy = false;
        this.log('info', `${s.config.name}: circuit half-open · testing recovery`);
      }
      if (s.circuit === 'open' || (s.circuit === 'half-open' && s.probeBusy)) {
        this.rejected++;
        this.finish(r, false, `${s.config.name}: circuit ${s.circuit}`);
        return;
      }
      if (s.circuit === 'half-open') {
        s.probeBusy = true;
        probe = true;
      }
    }
    const fault = this.fault(s);
    const duration =
      s.config.latency * (0.65 + this.draw(r, 1) * 0.7) + (fault?.kind === 'latency' ? 600 : 0);
    const failureRate =
      fault?.kind === 'outage' ? 1 : fault?.kind === 'errors' ? 0.65 : s.config.failureRate;
    s.active++;
    s.attempts++;
    r.attempts++;
    this.totalAttempts++;
    this.schedule({
      at: this.clock + duration,
      kind: 'done',
      request: r.id,
      service: s.config.id,
      failed: this.draw(r, 2) < failureRate,
      probe,
      generation: s.generation,
    });
  }
  private complete(e: Event): void {
    const s = this.runtime.get(e.service!)!;
    s.active--;
    if (e.failed) s.failures++;
    if (this.config.circuitBreaker && e.generation === s.generation) {
      if (e.probe) {
        s.probeBusy = false;
        if (e.failed) this.openCircuit(s);
        else {
          s.circuit = 'closed';
          s.consecutive = 0;
          this.log('success', `${s.config.name}: circuit closed · service recovered`);
        }
      } else if (s.circuit === 'closed') {
        s.consecutive = e.failed ? s.consecutive + 1 : 0;
        if (s.consecutive >= 5) this.openCircuit(s);
      }
    }
    const r = this.requests.get(e.request!);
    if (r) {
      if (e.failed) {
        if (r.retry < this.config.retries && s.circuit !== 'open') {
          r.retry++;
          this.totalRetries++;
          const backoff = 120 * 2 ** (r.retry - 1) * (0.75 + this.draw(r, 3) * 0.5);
          this.schedule({ at: this.clock + backoff, kind: 'retry', request: r.id });
        } else this.finish(r, false, `${s.config.name}: dependency failed`);
      } else {
        r.stage++;
        r.retry = 0;
        this.dispatch(r);
      }
    }
    this.drain(s);
  }
  private openCircuit(s: Runtime): void {
    s.circuit = 'open';
    s.openUntil = this.clock + 3000;
    s.generation++;
    s.probeBusy = false;
    this.log('error', `${s.config.name}: circuit opened · 3s cooldown`);
  }
  private drain(s: Runtime): void {
    while (s.active < s.config.concurrency && s.queue.length) {
      const id = s.queue.shift()!;
      const r = this.requests.get(id);
      if (r) this.startWork(r, s);
    }
  }
  private finish(r: Request, ok: boolean, reason: string): void {
    if (!this.requests.delete(r.id)) return;
    if (ok) {
      this.succeeded++;
      this.latencies.push(this.clock - r.started);
      if (this.latencies.length > 2000) this.latencies.shift();
    } else this.failed++;
    this.traces.unshift({
      id: r.id,
      started: r.started,
      ended: this.clock,
      ok,
      reason,
      route: r.route.slice(0, Math.min(r.stage + 1, r.route.length)),
      attempts: r.attempts,
      duration: this.clock - r.started,
    });
    if (this.traces.length > 120) this.traces.pop();
  }
  private p95(): number {
    if (!this.latencies.length) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  }
  private sample(): void {
    for (const s of this.runtime.values())
      if (s.fault && this.clock >= s.fault.until) {
        s.fault = null;
        this.log('success', `${s.config.name}: injected fault ended`);
      }
    const ok = this.succeeded - this.lastSucceeded,
      bad = this.failed - this.lastFailed;
    const queue = [...this.runtime.values()].reduce(
      (n, s) => n + s.queue.filter((id) => this.requests.has(id)).length,
      0,
    );
    this.samples.push({
      time: this.clock,
      throughput: ok,
      errorRate: ok + bad ? (100 * bad) / (ok + bad) : 0,
      latency: this.p95(),
      queue,
    });
    if (this.samples.length > 180) this.samples.shift();
    this.lastSucceeded = this.succeeded;
    this.lastFailed = this.failed;
  }
  snapshot(): Snapshot {
    const resolved = this.succeeded + this.failed;
    return {
      time: this.clock,
      started: this.started,
      succeeded: this.succeeded,
      failed: this.failed,
      inflight: this.requests.size,
      attempts: this.totalAttempts,
      retries: this.totalRetries,
      rejected: this.rejected,
      successRate: resolved ? (this.succeeded / resolved) * 100 : 100,
      p95: this.p95(),
      throughput: this.samples.at(-1)?.throughput ?? 0,
      services: [...this.runtime.values()].map((s) => ({
        id: s.config.id,
        name: s.config.name,
        active: s.active,
        queue: s.queue.filter((id) => this.requests.has(id)).length,
        circuit: s.circuit,
        fault: this.fault(s)?.kind ?? null,
        attempts: s.attempts,
        failures: s.failures,
        latency: s.config.latency,
        concurrency: s.config.concurrency,
      })),
      samples: this.samples.map((s) => ({ ...s })),
      traces: this.traces.map((t) => ({ ...t, route: [...t.route] })),
      logs: this.logs.map((l) => ({ ...l })),
    };
  }
}

export interface ExperimentResult {
  label: string;
  config: Config;
  snapshot: Snapshot;
}
export function compareStrategies(config: Config): ExperimentResult[] {
  return [
    { label: 'No protection', retries: 0, circuitBreaker: false },
    { label: 'Retries only', retries: 2, circuitBreaker: false },
    { label: 'Retries + breaker', retries: 2, circuitBreaker: true },
  ].map((policy) => {
    const c = {
      ...cloneConfig(config),
      retries: policy.retries,
      circuitBreaker: policy.circuitBreaker,
    };
    const sim = new Simulator(c);
    sim.advance(8000);
    sim.inject({ service: 'database', kind: 'outage', duration: 10000 });
    sim.advance(22000);
    sim.stopTraffic();
    sim.advance(c.timeout + 2000);
    return { label: policy.label, config: c, snapshot: sim.snapshot() };
  });
}
