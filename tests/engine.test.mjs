import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Simulator,
  DEFAULT_CONFIG,
  cloneConfig,
  validateConfig,
  compareStrategies,
} from '../dist/assets/engine.js';
import { replaySession } from '../dist/assets/session.js';

const healthyConfig = () => {
  const c = cloneConfig(DEFAULT_CONFIG);
  for (const s of c.services) s.failureRate = 0;
  return c;
};
const database = (s) => s.services.find((x) => x.id === 'database');
const totalQueue = (s) => s.services.reduce((n, s) => n + s.queue, 0);

test('same seed and actions produce identical state', () => {
  const run = () => {
    const sim = new Simulator();
    sim.advance(8500);
    sim.inject({ service: 'database', kind: 'errors', duration: 6000 });
    sim.advance(11000);
    return sim.snapshot();
  };
  assert.deepEqual(run(), run());
});
test('different seeds change request outcomes', () => {
  const a = new Simulator(),
    b = new Simulator({ ...cloneConfig(DEFAULT_CONFIG), seed: 99 });
  a.advance(12000);
  b.advance(12000);
  assert.notDeepEqual(a.snapshot().traces, b.snapshot().traces);
});
test('time slicing does not change deterministic results', () => {
  const a = new Simulator(),
    b = new Simulator();
  a.advance(12000);
  for (let i = 0; i < 120; i++) b.advance(100);
  assert.deepEqual(a.snapshot(), b.snapshot());
});
test('all requests are either successful, failed, or in flight', () => {
  const sim = new Simulator({ ...cloneConfig(DEFAULT_CONFIG), rate: 180 });
  sim.inject({ service: 'database', kind: 'latency', duration: 18000 });
  for (let i = 0; i < 60; i++) {
    sim.advance(500);
    const s = sim.snapshot();
    assert.equal(s.started, s.succeeded + s.failed + s.inflight);
    for (const n of s.services) {
      assert.ok(n.active >= 0 && n.active <= n.concurrency);
      assert.ok(n.queue >= 0 && n.queue <= sim.config.queueLimit);
    }
  }
});
test('healthy requests succeed and drain before their deadline', () => {
  const c = healthyConfig(),
    sim = new Simulator(c);
  sim.advance(10000);
  sim.stopTraffic();
  sim.advance(c.timeout);
  const s = sim.snapshot();
  assert.equal(s.failed, 0);
  assert.equal(s.inflight, 0);
  assert.equal(s.started, s.succeeded);
  assert.equal(s.successRate, 100);
});
test('queue overflow is bounded and observable', () => {
  const c = healthyConfig();
  c.rate = 180;
  c.queueLimit = 3;
  c.circuitBreaker = false;
  c.services.find((s) => s.id === 'database').concurrency = 1;
  const sim = new Simulator(c);
  sim.inject({ service: 'database', kind: 'latency', duration: 10000 });
  sim.advance(6000);
  const s = sim.snapshot();
  assert.ok(s.rejected > 0);
  assert.ok(database(s).queue <= 3);
  assert.ok(totalQueue(s) >= 0);
});
test('zero-length queues reject work when the worker pool is full', () => {
  const c = healthyConfig();
  c.rate = 180;
  c.queueLimit = 0;
  c.services.find((s) => s.id === 'gateway').concurrency = 1;
  c.services.find((s) => s.id === 'gateway').latency = 100;
  const sim = new Simulator(c);
  sim.advance(3000);
  const s = sim.snapshot();
  assert.ok(s.rejected > 0);
  assert.equal(totalQueue(s), 0);
});
test('request deadlines terminate slow work exactly once', () => {
  const c = healthyConfig();
  c.timeout = 200;
  c.circuitBreaker = false;
  const sim = new Simulator(c);
  sim.inject({ service: 'gateway', kind: 'latency', duration: 5000 });
  sim.advance(3000);
  sim.stopTraffic();
  sim.advance(5000);
  const s = sim.snapshot();
  assert.equal(s.inflight, 0);
  assert.equal(s.started, s.succeeded + s.failed);
  assert.equal(s.failed, s.started);
  assert.ok(s.traces.every((t) => Math.abs(t.duration - 200) < 1e-9));
  assert.ok(s.services.every((s) => s.active === 0 && s.queue === 0));
});
test('retries perform additional service work during a persistent outage', () => {
  const c = healthyConfig();
  c.circuitBreaker = false;
  c.retries = 0;
  const a = new Simulator(c);
  const b = new Simulator({ ...c, retries: 3 });
  for (const sim of [a, b]) {
    sim.inject({ service: 'database', kind: 'outage', duration: 15000 });
    sim.advance(10000);
  }
  assert.ok(database(b.snapshot()).attempts > database(a.snapshot()).attempts);
  assert.ok(b.snapshot().retries > 0);
  assert.equal(a.snapshot().retries, 0);
});
test('circuit breaker opens after persistent dependency failures', () => {
  const sim = new Simulator(healthyConfig());
  sim.inject({ service: 'database', kind: 'outage', duration: 12000 });
  sim.advance(2000);
  assert.equal(database(sim.snapshot()).circuit, 'open');
  assert.ok(sim.snapshot().rejected > 0);
});
test('open circuits reduce dependency attempts during an outage', () => {
  const config = healthyConfig();
  config.retries = 2;
  const protectedSim = new Simulator(config);
  const unprotected = new Simulator({ ...config, circuitBreaker: false });
  for (const sim of [protectedSim, unprotected]) {
    sim.inject({ service: 'database', kind: 'outage', duration: 12000 });
    sim.advance(10000);
  }
  assert.ok(
    database(protectedSim.snapshot()).attempts < database(unprotected.snapshot()).attempts / 2,
  );
});
test('only one probe reaches a still-failing dependency per cooldown', () => {
  const c = healthyConfig();
  c.rate = 90;
  const sim = new Simulator(c);
  sim.inject({ service: 'database', kind: 'outage', duration: 20000 });
  sim.advance(2500);
  const before = database(sim.snapshot()).attempts;
  sim.advance(2900);
  assert.equal(database(sim.snapshot()).attempts - before, 1);
});
test('a successful half-open probe restores a closed circuit', () => {
  const sim = new Simulator(healthyConfig());
  sim.inject({ service: 'database', kind: 'outage', duration: 4000 });
  sim.advance(12000);
  assert.equal(database(sim.snapshot()).circuit, 'closed');
  assert.ok(sim.snapshot().logs.some((l) => l.text.includes('circuit closed')));
});
test('clearing a fault does not bypass circuit cooldown', () => {
  const sim = new Simulator(healthyConfig());
  sim.inject({ service: 'database', kind: 'outage', duration: 10000 });
  sim.advance(1000);
  assert.equal(database(sim.snapshot()).circuit, 'open');
  sim.recoverAll();
  assert.equal(database(sim.snapshot()).fault, null);
  assert.equal(database(sim.snapshot()).circuit, 'open');
});
test('faults naturally expire and emit recovery events', () => {
  const sim = new Simulator();
  sim.inject({ service: 'cache', kind: 'errors', duration: 2000 });
  sim.advance(3000);
  assert.equal(sim.snapshot().services.find((s) => s.id === 'cache').fault, null);
  assert.ok(sim.snapshot().logs.some((l) => l.text.includes('fault ended')));
});
test('request traces describe valid read and checkout routes', () => {
  const sim = new Simulator(healthyConfig());
  sim.advance(10000);
  for (const t of sim.snapshot().traces) {
    assert.equal(t.route[0], 'gateway');
    assert.ok(['catalog', 'checkout'].includes(t.route[1]));
    if (t.route[1] === 'checkout') assert.equal(t.route[2], 'database');
    else assert.equal(t.route[2], 'cache');
    assert.equal(t.attempts, t.route.length);
  }
});
test('snapshots cannot mutate the engine', () => {
  const sim = new Simulator();
  sim.advance(4000);
  const before = sim.snapshot();
  const snapshot = sim.snapshot();
  snapshot.services[0].queue = 999;
  snapshot.traces[0].route.push('database');
  snapshot.samples[0].throughput = 999;
  assert.deepEqual(sim.snapshot(), before);
});
test('trace and sample retention remain bounded during long runs', () => {
  const sim = new Simulator();
  for (let i = 0; i < 4; i++) sim.advance(60000);
  const s = sim.snapshot();
  assert.equal(s.traces.length, 120);
  assert.equal(s.samples.length, 180);
  assert.ok(s.logs.length <= 60);
  assert.equal(new Set(s.traces.map((t) => t.id)).size, 120);
});
test('invalid configuration, rates, faults, and clock inputs fail clearly', () => {
  for (const rate of [0, 181, NaN, Infinity, '36'])
    assert.throws(() => validateConfig({ ...cloneConfig(DEFAULT_CONFIG), rate }));
  const missing = cloneConfig(DEFAULT_CONFIG);
  missing.services.pop();
  assert.throws(() => validateConfig(missing));
  const duplicate = cloneConfig(DEFAULT_CONFIG);
  duplicate.services[0] = duplicate.services[1];
  assert.throws(() => validateConfig(duplicate));
  const sim = new Simulator();
  assert.throws(() => sim.advance(-1));
  assert.throws(() => sim.advance(Infinity));
  assert.throws(() => sim.setRate(200));
  assert.throws(() => sim.inject({ service: 'missing', kind: 'outage', duration: 5000 }));
  assert.throws(() => sim.inject({ service: 'database', kind: 'unknown', duration: 5000 }));
});
test('benchmark strategies receive identical arrival counts and drain completely', () => {
  const results = compareStrategies(DEFAULT_CONFIG);
  assert.equal(results.length, 3);
  assert.equal(new Set(results.map((r) => r.snapshot.started)).size, 1);
  for (const r of results) assert.equal(r.snapshot.inflight, 0);
  assert.ok(database(results[2].snapshot).attempts < database(results[1].snapshot).attempts);
});
test('session export/replay reproduces interventions and final state', () => {
  const config = cloneConfig(DEFAULT_CONFIG),
    sim = new Simulator(config);
  const events = [
    { at: 3500, type: 'fault', fault: { service: 'database', kind: 'latency', duration: 10000 } },
    { at: 6100, type: 'rate', rate: 90 },
    { at: 9800, type: 'recover' },
  ];
  for (const e of events) {
    sim.advance(e.at - sim.time);
    if (e.type === 'fault') sim.inject(e.fault);
    else if (e.type === 'rate') sim.setRate(e.rate);
    else sim.recoverAll();
  }
  sim.advance(6000);
  const session = { schemaVersion: 1, title: 'Replay test', config, events, elapsedMs: sim.time };
  const replay = replaySession(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(replay.simulator.snapshot(), sim.snapshot());
});
test('session imports reject malformed, unordered, oversized, and future events', () => {
  const base = {
    schemaVersion: 1,
    title: 'test',
    config: cloneConfig(DEFAULT_CONFIG),
    events: [],
    elapsedMs: 10000,
  };
  assert.throws(() => replaySession({ ...base, schemaVersion: 2 }));
  assert.throws(() => replaySession({ ...base, elapsedMs: 600001 }));
  assert.throws(() => replaySession({ ...base, events: [{ at: 11000, type: 'recover' }] }));
  assert.throws(() =>
    replaySession({
      ...base,
      events: [
        { at: 3000, type: 'recover' },
        { at: 1000, type: 'recover' },
      ],
    }),
  );
  assert.throws(() => replaySession({ ...base, events: [{ at: 100, type: 'unknown' }] }));
});
