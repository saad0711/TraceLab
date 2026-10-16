import {
  Simulator,
  DEFAULT_CONFIG,
  cloneConfig,
  compareStrategies,
  type ServiceId,
  type Snapshot,
  type Fault,
  type ExperimentResult,
} from './engine.js';
import { PRESETS } from './presets.js';
import { replaySession, type Session, type Intervention } from './session.js';

const icons: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  flask:
    '<path d="M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1.2 2h13.6a1.3 1.3 0 0 0 1.2-2L14 9V3M7 15h10"/>',
  traces: '<path d="M4 6h16M4 12h11M4 18h16"/><circle cx="19" cy="12" r="1"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  step: '<path d="m5 5 10 7-10 7ZM19 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9M7.5 5.5l9 5"/>',
  cart: '<path d="M3 3h2l3 12h11l2-9H6M9 20h.01M18 20h.01"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
  activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  code: '<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};
const icon = (name: string, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.grid}</svg>`;
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const time = (ms: number) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
type Page = 'playground' | 'experiments' | 'traces' | 'saved';
interface Saved {
  id: string;
  savedAt: string;
  session: Session;
}
let page: Page = 'playground',
  presetId = 'steady',
  selected: ServiceId = 'database',
  running = false,
  speed = 1,
  traceFilter = 'all',
  search = '';
let initialConfig = cloneConfig(DEFAULT_CONFIG),
  engine = new Simulator(initialConfig),
  events: Intervention[] = [],
  title = PRESETS[0]!.title;
let results: ExperimentResult[] | null = null;
let saved: Saved[] = [];
try {
  const value = JSON.parse(localStorage.getItem('tracelab-sessions-v1') ?? '[]');
  if (Array.isArray(value))
    saved = value
      .filter(
        (s) =>
          s &&
          typeof s.id === 'string' &&
          typeof s.savedAt === 'string' &&
          s.session?.schemaVersion === 1,
      )
      .slice(0, 12);
} catch {
  /* Browser storage is optional. */
}
engine.advance(12000);

const nav = (id: Page, label: string, i: string) =>
  `<button class="nav-item ${page === id ? 'active' : ''}" data-page="${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(i)}<span>${label}</span>${id === 'saved' ? `<span class="nav-count">${saved.length}</span>` : ''}</button>`;
function shell(): void {
  $('#app').innerHTML =
    `<aside class="sidebar"><a href="#" class="brand" aria-label="TraceLab home"><span class="brand-mark"><i></i><i></i><i></i></span>trace<span>lab</span><sup>β</sup></a><div class="workspace-select"><span class="workspace-avatar">P</span><div>Personal workspace<small>Your systems playground</small></div>${icon('down')}</div><div class="nav-label">WORKSPACE</div><nav aria-label="Main navigation">${nav('playground', 'Playground', 'grid')}${nav('experiments', 'Experiments', 'flask')}${nav('traces', 'Request traces', 'traces')}${nav('saved', 'Saved sessions', 'save')}</nav><div class="nav-label resources-label">RESOURCES</div><button class="nav-item" data-action="help">${icon('book')}<span>How it works</span>${icon('arrow', 'nav-end')}</button><button class="nav-item" data-action="architecture">${icon('code')}<span>Under the hood</span></button><div class="sidebar-bottom"><div class="lab-note">${icon('spark')}<strong>Curiosity, meet chaos.</strong><p>The best way to understand a system? See how it breaks.</p><button data-action="guided">Try a guided experiment ${icon('arrow')}</button></div><div class="local-note"><span class="status-dot"></span>Runs entirely in your browser</div></div></aside><div class="app-body"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>${page === 'playground' ? 'Playground' : page === 'experiments' ? 'Experiments' : page === 'traces' ? 'Request traces' : 'Saved sessions'}</strong></div><div class="topbar-actions"><span class="sandbox-tag">${icon('shield')} Local sandbox</span><button class="icon-button" data-action="help" aria-label="Help and keyboard shortcuts">${icon('help')}</button><button class="button subtle small" data-action="export">${icon('download')} Export session</button></div></header><main id="main">${page === 'playground' ? playground() : page === 'experiments' ? experimentsPage() : page === 'traces' ? tracesPage() : savedPage()}</main><footer class="footer"><span><span class="tiny-mark">⌁</span> Built for the wonderfully curious.</span><span>Deterministic engine <b>·</b> No API keys <b>·</b> Open source</span></footer></div><div id="toast" class="toast" role="status" aria-live="polite"></div><dialog id="dialog"><div id="dialog-content"></div></dialog><input type="file" id="import-file" accept=".json,application/json" hidden />`;
  bind();
  update();
}
function header(eyebrow: string, heading: string, description: string): string {
  return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${heading}</h1><p>${description}</p></div><span class="version-tag"><span class="status-dot"></span> SIMULATOR v1.0</span></section>`;
}
function playground(): string {
  return `${header('DISTRIBUTED SYSTEMS PLAYGROUND', 'Break things. <span>Understand systems.</span>', 'A little chaos. A lot of clarity. Explore what happens when your services meet the unexpected.')}<div class="scenario-label"><span>CHOOSE YOUR STARTING POINT</span><button class="text-button" data-action="guided">Explore scenarios ${icon('arrow')}</button></div><div class="preset-tabs" role="group" aria-label="Simulation scenarios">${PRESETS.map((p, i) => `<button class="preset-tab ${presetId === p.id ? 'selected' : ''}" data-preset="${p.id}"><span class="preset-icon ${p.color}">${icon(['activity', 'clock', 'bolt', 'shield'][i]!)}</span><div><strong>${['Steady state', 'Latency spike', 'Retry storm', 'Circuit breaker'][i]}</strong><span>${['Everything, in balance', 'A dependency slows down', 'Failures multiply', 'Build in resilience'][i]}</span></div>${presetId === p.id ? '<span class="selected-dot"></span>' : ''}</button>`).join('')}</div><div class="experiment-toolbar"><div class="experiment-title">${icon('flask')}<strong>${esc(title)}</strong><span id="run-status" class="state-pill">Paused</span></div><div class="transport"><span id="sim-time" class="mono">00:12</span><select id="speed" aria-label="Playback speed"><option value="1" ${speed === 1 ? 'selected' : ''}>1× speed</option><option value="2" ${speed === 2 ? 'selected' : ''}>2× speed</option><option value="4" ${speed === 4 ? 'selected' : ''}>4× speed</option></select><button class="icon-button" data-action="reset" aria-label="Reset experiment" title="Reset (R)">${icon('reset')}</button><button class="icon-button" data-action="step" aria-label="Advance one simulated second" title="Step one second">${icon('step')}</button><button class="button primary" data-action="run" id="run-button">${icon('play')} Run simulation</button></div></div><section class="metric-grid" aria-label="Simulation metrics">${metric('success', 'Successful requests', 'shield', '%', 'Completion ratio')}${metric('throughput', 'Throughput', 'activity', 'req/s', 'Last simulated second')}${metric('latency', 'P95 latency', 'clock', 'ms', 'Successful requests')}${metric('queue', 'Queued requests', 'traces', '', 'Waiting for a worker')}</section><div class="lab-grid"><section class="panel topology-panel"><div class="panel-heading"><div><h2>Service topology <span class="count-tag">5 services</span></h2><p>Your commerce stack, under the microscope.</p></div><button class="icon-button" data-action="topology-help" aria-label="Explain service topology">${icon('help')}</button></div><div class="topology-scroll"><div class="topology-canvas" id="topology-canvas"><span class="canvas-region">${icon('globe')} COMMERCE / DEMO ENVIRONMENT</span><svg class="edges" viewBox="0 0 900 420" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9aaa9e"/></marker></defs>${edge('M 72 221 H 140')}${edge('M 293 221 H 319 Q 335 221 335 205 V 119 Q 335 105 350 105 H 370')}${edge('M 293 221 H 319 Q 335 221 335 237 V 310 Q 335 325 350 325 H 370')}${edge('M 523 105 H 595')}${edge('M 523 325 H 682')}${edge('M 748 105 H 776 Q 797 105 797 126 V 269')}<text class="edge-label" x="329" y="154">70% reads</text><text class="edge-label" x="330" y="272">30% writes</text><text class="edge-label" x="791" y="197" text-anchor="end">cache miss</text></svg><div class="client-node">${icon('globe')}<span>Traffic</span><small id="client-rate">36 req/s</small></div>${node('gateway', 'API Gateway', 'gateway.internal', 'server', 140, 179)}${node('catalog', 'Catalog API', '/api/products', 'box', 370, 63)}${node('checkout', 'Checkout API', '/api/checkout', 'cart', 370, 283)}${node('cache', 'Redis Cache', 'cache.internal', 'bolt', 595, 63)}${node('database', 'PostgreSQL', 'primary.db', 'database', 682, 283)}<span class="canvas-hint">${icon('search')} Select a service to inspect or inject a fault</span></div></div><div class="topology-legend"><span><i class="legend-dot healthy"></i>Healthy</span><span><i class="legend-dot degraded"></i>Degraded</span><span><i class="legend-dot failed"></i>Fault / open circuit</span><span class="legend-right">Animated flow is illustrative</span></div></section><aside class="panel inspector"><div class="panel-heading"><h2>Control room</h2>${icon('sliders')}</div><div class="control-section"><label class="field-label" for="traffic">Incoming traffic <span><strong id="rate-value">${engine.config.rate}</strong> req/s</span></label><input id="traffic" type="range" min="1" max="180" value="${engine.config.rate}"/><div class="range-labels"><span>1 req/s</span><span>180 req/s</span></div><div class="control-row"><label for="retries">Retries per service</label><select id="retries">${[0, 1, 2, 3].map((n) => `<option ${engine.config.retries === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="control-row"><label for="breaker">Circuit breaker</label><button id="breaker" role="switch" aria-checked="${engine.config.circuitBreaker}" class="switch ${engine.config.circuitBreaker ? 'on' : ''}" aria-label="Circuit breaker"><span></span></button></div><p class="field-hint">Changing protection restarts the experiment.</p></div><div class="control-section service-inspector"><div class="section-overline">SELECTED SERVICE</div><div id="service-info"></div></div><div class="control-section fault-section"><div class="section-overline">INTRODUCE A LITTLE CHAOS</div><label for="fault-kind" class="sr-only">Fault type</label><select id="fault-kind" class="full-select"><option value="latency" selected>${'Latency spike · +600 ms'}</option><option value="outage">Service outage · 100% errors</option><option value="errors">Intermittent errors · 65%</option></select><button class="button fault-button" data-action="inject">${icon('bolt')} Inject fault <span>10s</span></button><button class="text-button recover-button" data-action="recover">${icon('reset')} Clear active faults</button></div></aside></div><div class="bottom-grid"><section class="panel chart-panel"><div class="panel-heading"><div><h2>Throughput over time</h2><p>Successful requests per simulated second</p></div><span class="chart-key"><i></i> Completed</span></div><div id="throughput-chart" class="large-chart"></div><div class="chart-footer"><span>Live simulation · last 60 seconds</span><span id="total-requests"></span></div></section><section class="panel events-panel"><div class="panel-heading"><div><h2>Event stream <span class="live-dot"></span></h2><p>The story your system is telling.</p></div><span class="count-tag" id="event-count">1 event</span></div><div id="event-stream" class="event-stream"></div></section></div><div class="learning-strip">${icon('book')}<p><strong>A small experiment, a useful insight.</strong> ${esc(PRESETS.find((p) => p.id === presetId)?.lesson ?? 'Tune the system, introduce a fault, and observe what changes.')}</p><button class="text-button" data-page="experiments">Compare strategies ${icon('arrow')}</button></div>`;
}
function metric(id: string, label: string, i: string, unit: string, note: string): string {
  return `<article class="metric"><div class="metric-label">${label}${icon(i)}</div><div class="metric-value"><strong id="metric-${id}">—</strong><span>${unit}</span><div id="spark-${id}" class="sparkline"></div></div><div class="metric-note" id="note-${id}">${note}</div></article>`;
}
function edge(path: string): string {
  return `<path class="edge" d="${path}" marker-end="url(#arrowhead)"/><circle class="packet" r="3" fill="#82b854"><animateMotion dur="2.6s" repeatCount="indefinite" path="${path}"/></circle>`;
}
function node(id: ServiceId, name: string, sub: string, i: string, x: number, y: number): string {
  return `<button class="service-node ${selected === id ? 'is-selected' : ''}" data-service="${id}" style="left:${x / 9}%;top:${y / 4.2}%" aria-label="Inspect ${name}" aria-pressed="${selected === id}"><div class="node-top"><span class="node-icon ${id}">${icon(i)}</span><span class="node-dot"></span></div><strong>${name}</strong><span class="node-sub">${sub}</span><div class="node-meta"><span id="node-status-${id}">Healthy</span><span id="node-load-${id}">0/${engine.config.services.find((s) => s.id === id)!.concurrency}</span></div></button>`;
}
function experimentsPage(): string {
  return `${header('EXPERIMENTS', 'Make failure <span>your teacher.</span>', 'Start with a guided scenario, or run the same outage against three protection strategies.')}<div class="scenario-cards">${PRESETS.map((p) => `<button class="scenario-card" data-preset="${p.id}"><span class="section-overline">${p.eyebrow}</span><span class="scenario-art ${p.color}">${icon(p.id === 'steady' ? 'activity' : p.id === 'slow' ? 'clock' : p.id === 'storm' ? 'bolt' : 'shield')}</span><h2>${p.title}</h2><p>${p.description}</p><span class="text-button">Open experiment ${icon('arrow')}</span></button>`).join('')}</div><section class="panel benchmark"><div class="panel-heading"><div><h2>Same outage. Three different strategies.</h2><p>30 seconds of traffic · database down from 8s–18s · seed ${engine.config.seed} · ${engine.config.rate} req/s</p></div><button class="button primary" data-action="benchmark" id="benchmark-button">${icon('play')} Run comparison</button></div><div id="benchmark-results">${results ? renderResults() : `<div class="empty-benchmark">${icon('flask')}<h3>Find out what protection actually changes.</h3><p>A reproducible benchmark runs each strategy against the same traffic and fault schedule. Results include deadline drain time.</p></div>`}</div></section><div class="insight-grid"><article><span class="insight-number">01</span><h3>Retries have a cost.</h3><p>Retrying transient failures can recover requests. During a sustained outage, extra attempts consume capacity without fixing the dependency.</p></article><article><span class="insight-number">02</span><h3>A breaker isn’t a cure.</h3><p>Failing fast protects a dependency from repeated calls. Those requests still fail. Compare service attempts as well as success rate.</p></article><article><span class="insight-number">03</span><h3>Control your variables.</h3><p>Each run shares the seed, routes, load, and outage schedule. Change the baseline settings in the playground to explore a different workload.</p></article></div>`;
}
function renderResults(): string {
  if (!results) return '';
  return `<div class="table-scroll"><table class="comparison-table"><thead><tr><th>Strategy</th><th>Success rate</th><th>P95 success latency</th><th>Database attempts</th><th>Retries</th><th>Rejected early</th></tr></thead><tbody>${results.map((r, i) => `<tr><td><span class="strategy-badge strategy-${i}">${i + 1}</span><strong>${r.label}</strong></td><td>${r.snapshot.successRate.toFixed(1)}%</td><td>${Math.round(r.snapshot.p95)} ms</td><td>${fmt(r.snapshot.services.find((s) => s.id === 'database')!.attempts)}</td><td>${fmt(r.snapshot.retries)}</td><td>${fmt(r.snapshot.rejected)}</td></tr>`).join('')}</tbody></table></div><div class="benchmark-note">${icon('help')} P95 includes successful requests only. Rejected requests include open circuits and full queues; requests that were never completed are not counted as successes. This is an educational model, not a production capacity estimate.</div>`;
}
function tracesPage(): string {
  return `${header('REQUEST TRACES', 'Follow the <span>whole journey.</span>', 'Inspect the latest 120 completed requests. Every row comes from the simulation engine.')}<section class="panel"><div class="panel-heading"><div><h2>Request explorer <span id="trace-count" class="count-tag"></span></h2><p>Select a request to see its route, attempts, and outcome.</p></div><div class="trace-tools"><div class="search-field">${icon('search')}<input id="trace-search" placeholder="Find request ID…" aria-label="Search request ID" value="${esc(search)}"/></div><select id="trace-filter" aria-label="Filter requests"><option value="all" ${traceFilter === 'all' ? 'selected' : ''}>All requests</option><option value="failed" ${traceFilter === 'failed' ? 'selected' : ''}>Failed only</option><option value="success" ${traceFilter === 'success' ? 'selected' : ''}>Successful only</option></select></div></div><div class="table-scroll"><table class="trace-table"><thead><tr><th>Request</th><th>Route taken</th><th>Outcome</th><th>Latency</th><th>Attempts</th><th>Completed at</th></tr></thead><tbody id="trace-rows"></tbody></table></div></section>`;
}
function savedPage(): string {
  return `${header('SAVED SESSIONS', 'Good experiments <span>deserve a replay.</span>', 'Save your configuration, fault schedule, and elapsed time. Open a session to reconstruct it exactly.')}<div class="saved-toolbar"><span>${saved.length} of 12 local slots used</span><div><button class="button subtle" data-action="import">${icon('upload')} Import JSON</button><button class="button primary" data-action="save">${icon('save')} Save current session</button></div></div>${saved.length ? `<div class="saved-grid">${saved.map((s) => `<article class="panel saved-card"><div class="saved-card-top"><span class="saved-icon">${icon('flask')}</span><button class="icon-button" data-delete="${esc(s.id)}" aria-label="Delete ${esc(s.session.title)}">${icon('trash')}</button></div><h2>${esc(s.session.title)}</h2><p>${esc(new Date(s.savedAt).toLocaleString())}</p><div class="saved-meta"><span>${time(s.session.elapsedMs)} elapsed</span><span>${s.session.config.rate} req/s</span><span>Seed ${s.session.config.seed}</span></div><button class="button subtle full-width" data-load="${esc(s.id)}">Open session ${icon('arrow')}</button></article>`).join('')}</div>` : `<section class="panel empty-state">${icon('save')}<h2>Keep your first discovery.</h2><p>Run an experiment, introduce a fault, and save the session here. JSON exports let you share reproducible experiments.</p><button class="button primary" data-action="save">${icon('save')} Save current session</button></section>`}<p class="storage-note">Sessions stay in this browser. Export important experiments before clearing browser data.</p>`;
}

function lineChart(
  values: number[],
  width = 110,
  height = 38,
  color = '#82aa5b',
  area = false,
): string {
  const max = Math.max(...values, 1) * 1.15,
    min = 0;
  const points = values
    .map(
      (v, i) =>
        `${5 + (i * (width - 10)) / Math.max(values.length - 1, 1)},${height - 5 - ((v - min) / (max - min)) * (height - 10)}`,
    )
    .join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${area && values.length ? `<polygon points="5,${height - 5} ${points} ${width - 5},${height - 5}" fill="${color}" opacity=".10"/>` : ''}<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function update(): void {
  const s = engine.snapshot();
  document.body.dataset.running = String(running);
  if (page === 'playground') {
    $('#sim-time').textContent = time(s.time);
    $('#run-status').textContent = running ? 'Running' : 'Paused';
    $('#run-status').classList.toggle('is-live', running);
    $('#run-button').innerHTML =
      `${icon(running ? 'pause' : 'play')}${running ? 'Pause' : 'Run simulation'}`;
    $('#metric-success').textContent = s.successRate.toFixed(1);
    $('#metric-throughput').textContent = fmt(s.throughput);
    $('#metric-latency').textContent = fmt(s.p95);
    const queued = s.services.reduce((n, x) => n + x.queue, 0);
    $('#metric-queue').textContent = fmt(queued);
    $('#note-success').innerHTML =
      `<span class="${s.successRate > 98 ? 'good-text' : 'warning-text'}">${fmt(s.succeeded)} of ${fmt(s.succeeded + s.failed)}</span> resolved requests`;
    $('#note-queue').textContent = `${s.inflight} requests in flight · ${s.retries} retries`;
    $('#spark-success').innerHTML = lineChart(s.samples.slice(-20).map((p) => 100 - p.errorRate));
    $('#spark-throughput').innerHTML = lineChart(s.samples.slice(-20).map((p) => p.throughput));
    $('#spark-latency').innerHTML = lineChart(
      s.samples.slice(-20).map((p) => p.latency),
      110,
      38,
      '#aea0cc',
    );
    $('#spark-queue').innerHTML = lineChart(
      s.samples.slice(-20).map((p) => p.queue),
      110,
      38,
      '#c7ac68',
    );
    $('#client-rate').textContent = `${engine.config.rate} req/s`;
    $('#rate-value').textContent = String(engine.config.rate);
    for (const service of s.services) {
      const n = $(`[data-service="${service.id}"]`);
      const bad = service.fault === 'outage' || service.circuit === 'open';
      const degraded = !!service.fault || service.queue > 0 || service.circuit === 'half-open';
      n.classList.toggle('is-failed', bad);
      n.classList.toggle('is-degraded', degraded && !bad);
      n.classList.toggle('is-selected', service.id === selected);
      n.setAttribute('aria-pressed', String(service.id === selected));
      $(`#node-status-${service.id}`).textContent =
        service.circuit !== 'closed'
          ? `${service.circuit} circuit`
          : (service.fault ?? (service.queue ? 'Queueing' : 'Healthy'));
      $(`#node-load-${service.id}`).textContent = `${service.active}/${service.concurrency}`;
    }
    const service = s.services.find((x) => x.id === selected)!;
    $('#service-info').innerHTML =
      `<div class="selected-service-name">${icon(selected === 'database' ? 'database' : selected === 'cache' ? 'bolt' : 'server')}<strong>${service.name}</strong><span class="service-state ${service.fault ? 'warning-text' : ''}">${service.fault ?? 'online'}</span></div><div class="service-stats"><div><span>Base latency</span><strong>${service.latency} <small>ms</small></strong></div><div><span>Worker pool</span><strong>${service.active}<small> / ${service.concurrency}</small></strong></div><div><span>Queue</span><strong>${service.queue}</strong></div><div><span>Circuit</span><strong class="circuit-label">${engine.config.circuitBreaker ? service.circuit : 'disabled'}</strong></div></div>`;
    const samples = s.samples.slice(-60),
      ceiling = Math.max(40, ...samples.map((p) => p.throughput)) * 1.15;
    const chartWidth = 640,
      chartHeight = 140;
    const points = samples
      .map(
        (p, i) =>
          `${42 + (i * (chartWidth - 56)) / Math.max(samples.length - 1, 1)},${chartHeight - 16 - (p.throughput / ceiling) * (chartHeight - 35)}`,
      )
      .join(' ');
    $('#throughput-chart').innerHTML =
      `<svg viewBox="0 0 640 157" role="img" aria-label="Successful requests per second, latest ${samples.length} seconds">${[0, 0.5, 1].map((f) => `<line x1="42" x2="630" y1="${124 - f * 105}" y2="${124 - f * 105}" stroke="#eaece6" stroke-dasharray="3 4"/><text x="29" y="${128 - f * 105}" text-anchor="end">${Math.round(f * ceiling)}</text>`).join('')}${samples.length ? `<polygon points="42,124 ${points} ${chartWidth - 14},124" fill="#94b971" opacity=".12"/><polyline points="${points}" fill="none" stroke="#86aa66" stroke-width="2.5" stroke-linejoin="round"/><text x="42" y="150">${time(samples[0]!.time)}</text><text x="628" y="150" text-anchor="end">${time(s.time)}</text>` : ''}</svg>`;
    $('#total-requests').textContent = `${fmt(s.started)} total requests`;
    $('#event-count').textContent = `${s.logs.length} events`;
    $('#event-stream').innerHTML =
      s.logs
        .slice(0, 7)
        .map(
          (l) =>
            `<div class="event"><span class="event-symbol ${l.kind}">${icon(l.kind === 'success' ? 'check' : l.kind === 'error' ? 'bolt' : 'activity')}</span><p>${esc(l.text)}</p><time>${time(l.time)}</time></div>`,
        )
        .join('') +
      (s.logs.length < 2
        ? `<div class="event-prompt"><span>All quiet. For now.</span><p>Inject a fault to see how your system responds.</p></div>`
        : '');
  } else if (page === 'traces') updateTraces(s);
}
function updateTraces(s: Snapshot): void {
  const traces = s.traces.filter(
    (t) =>
      (traceFilter === 'all' || (traceFilter === 'failed' ? !t.ok : t.ok)) &&
      String(t.id).includes(search.replace(/^req-/i, '')),
  );
  $('#trace-count').textContent = `${traces.length} requests`;
  $('#trace-rows').innerHTML = traces.length
    ? traces
        .map(
          (t) =>
            `<tr><td><button class="trace-link" data-trace="${t.id}">req-${String(t.id).padStart(5, '0')} ${icon('arrow')}</button></td><td class="route-cell">${t.route.map((r) => esc(r)).join('<span> → </span>')}</td><td><span class="outcome ${t.ok ? 'ok' : 'bad'}">${t.ok ? 'Success' : 'Failed'}</span></td><td class="mono">${Math.round(t.duration)} ms</td><td>${t.attempts}</td><td class="mono muted">${time(t.ended)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="table-empty">No matching requests. Run the simulation or change the filter.</td></tr>`;
}
function session(): Session {
  return {
    schemaVersion: 1,
    title,
    config: cloneConfig(initialConfig),
    events: structuredClone(events),
    elapsedMs: engine.time,
  };
}
function loadPreset(id: string): void {
  const p = PRESETS.find((p) => p.id === id);
  if (!p) return;
  presetId = id;
  title = p.title;
  initialConfig = cloneConfig(p.config);
  engine = new Simulator(initialConfig);
  events = [];
  engine.advance(12000);
  running = false;
  results = null;
  if (p.fault) {
    engine.inject(p.fault);
    events.push({ at: engine.time, type: 'fault', fault: p.fault });
  }
  selected = 'database';
  page = 'playground';
  shell();
}
function restart(): void {
  engine = new Simulator(initialConfig);
  events = [];
  engine.advance(12000);
  running = false;
  results = null;
  const p = PRESETS.find((p) => p.id === presetId);
  if (p?.fault) {
    engine.inject(p.fault);
    events.push({ at: engine.time, type: 'fault', fault: p.fault });
  }
  shell();
}
let toastTimeout: number | undefined;
function toast(message: string): void {
  const e = $('#toast');
  e.textContent = message;
  e.classList.add('visible');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => e.classList.remove('visible'), 3500);
}
function modal(content: string): void {
  running = false;
  update();
  $('#dialog-content').innerHTML =
    `<button class="icon-button dialog-close" data-action="close" aria-label="Close dialog">${icon('close')}</button>${content}`;
  $<HTMLDialogElement>('#dialog').showModal();
}
function help(architecture = false): void {
  modal(
    architecture
      ? `<div class="modal-eyebrow">UNDER THE HOOD</div><h2>Small engine. Real trade-offs.</h2><p>TraceLab is a TypeScript discrete-event simulator. A stable min-heap schedules arrivals, completions, retries, and deadlines. The UI advances simulated time; it does not fabricate metrics.</p><div class="help-block"><h3>Reproducible by design</h3><p>Randomness is keyed by seed, request, stage, and attempt. Exported sessions preserve the initial configuration and ordered interventions for deterministic replay.</p></div><div class="help-block"><h3>Bounded, observable state</h3><p>Services have finite worker pools and bounded queues. Traces retain 120 completions, charts retain 180 samples, and P95 uses the latest 2,000 successful requests.</p></div><div class="help-block"><h3>What this model leaves out</h3><p>There is no real network, autoscaling, shared CPU, transaction rollback, or response-size model. Requests follow sequential routes. Fault effects are captured when service work starts. Use this to reason about resilience, not to size production infrastructure.</p></div><p class="modal-source">Pattern reference: <a href="https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker" target="_blank" rel="noreferrer">Microsoft Azure Architecture Center ↗</a></p>`
      : `<div class="modal-eyebrow">WELCOME TO TRACELAB</div><h2>Learn by making a little trouble.</h2><p>An interactive sandbox for understanding what happens between a request and a response.</p><ol class="help-steps"><li><span>1</span><div><h3>Start the traffic</h3><p>Run a baseline, adjust incoming requests, or step one second at a time.</p></div></li><li><span>2</span><div><h3>Pick a service. Inject a fault.</h3><p>Click a service in the topology, then try a latency spike, intermittent errors, or an outage.</p></div></li><li><span>3</span><div><h3>Watch the consequences</h3><p>Inspect throughput, deadlines, queues, and request traces. Compare resilience strategies in Experiments.</p></div></li><li><span>4</span><div><h3>Keep it reproducible</h3><p>Save your session locally or export its seed and intervention schedule as JSON.</p></div></li></ol><div class="shortcut-row"><span><kbd>Space</kbd> Run / pause</span><span><kbd>R</kbd> Reset</span><span><kbd>?</kbd> Help</span></div><p class="field-hint">The initial 12 seconds are a deterministic warm-up. All numbers are simulated, and no requests leave your browser.</p>`,
  );
}
function action(name: string): void {
  if (name === 'run') {
    running = !running;
    update();
  }
  if (name === 'step') {
    running = false;
    advance(1000);
    update();
  }
  if (name === 'reset') {
    restart();
    toast('Experiment reset to the same seed.');
  }
  if (name === 'help') help();
  if (name === 'architecture') help(true);
  if (name === 'close') $<HTMLDialogElement>('#dialog').close();
  if (name === 'guided') {
    page = 'experiments';
    shell();
  }
  if (name === 'topology-help')
    modal(
      `<div class="modal-eyebrow">SERVICE TOPOLOGY</div><h2>One request, a few moving parts.</h2><p>70% of incoming requests take the catalog route; 30% take checkout. Catalog reads use Redis with a 72% cache-hit probability; misses go to PostgreSQL. Checkout always visits PostgreSQL.</p><p>Each node shows active workers / total workers. Requests wait in a bounded queue when all workers are busy. Green, amber, and red show health, degradation, and faults or open circuits.</p><p>Packet animations illustrate the direction of flow. Metrics and traces represent actual simulated requests.</p>`,
    );
  if (name === 'inject') {
    if (events.length >= 500) {
      toast('Session event limit reached. Export and reset to continue.');
      return;
    }
    const fault: Fault = {
      service: selected,
      kind: $<HTMLSelectElement>('#fault-kind').value as Fault['kind'],
      duration: 10000,
    };
    engine.inject(fault);
    events.push({ at: engine.time, type: 'fault', fault });
    running = true;
    update();
    toast('Fault injected. Watch the system respond.');
  }
  if (name === 'recover') {
    if (events.length >= 500) {
      toast('Session event limit reached. Reset to continue.');
      return;
    }
    engine.recoverAll();
    events.push({ at: engine.time, type: 'recover' });
    update();
    toast('Injected faults cleared. Circuits retain their cooldown.');
  }
  if (name === 'export') {
    const data = { ...session(), summary: engine.snapshot() };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracelab-session-${Math.floor(engine.time / 1000)}s.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Session exported with reproducible events and metrics.');
  }
  if (name === 'import') $('#import-file').click();
  if (name === 'save')
    modal(
      `<div class="modal-eyebrow">SAVE YOUR DISCOVERY</div><h2>Name this experiment.</h2><p>Your seed, configuration, and interventions are saved together.</p><form id="save-form"><label class="field-label" for="session-name">Session name</label><input id="session-name" class="text-input" maxlength="100" value="${esc(title)}" required/><div class="modal-actions"><button type="button" class="button subtle" data-action="close">Cancel</button><button class="button primary" type="submit">${icon('save')} Save session</button></div></form>`,
    );
  if (name === 'benchmark') {
    running = false;
    const button = $('#benchmark-button') as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Running three experiments…';
    setTimeout(() => {
      try {
        results = compareStrategies(engine.config);
        if (page === 'experiments') shell();
        toast('Comparison complete. Same workload, three strategies.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Comparison failed.');
      } finally {
        button.disabled = false;
      }
    }, 30);
  }
}
function advance(ms: number): void {
  const remaining = 600000 - engine.time;
  if (remaining <= 0) {
    running = false;
    toast('10-minute simulation limit reached. Save or reset the session.');
    return;
  }
  engine.advance(Math.min(ms, remaining));
  if (engine.time >= 600000) running = false;
}

function bind(): void {
  $('#app').onclick = (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>(
      '[data-page],[data-preset],[data-action],[data-service],[data-load],[data-delete],[data-trace]',
    );
    if (target.closest('.brand')) {
      e.preventDefault();
      page = 'playground';
      shell();
      return;
    }
    if (!button) return;
    if (button.dataset.page) {
      page = button.dataset.page as Page;
      shell();
    } else if (button.dataset.preset) loadPreset(button.dataset.preset);
    else if (button.dataset.action) action(button.dataset.action);
    else if (button.dataset.service) {
      selected = button.dataset.service as ServiceId;
      update();
    } else if (button.dataset.load) {
      const item = saved.find((s) => s.id === button.dataset.load);
      if (item)
        try {
          const result = replaySession(item.session);
          engine = result.simulator;
          initialConfig = result.session.config;
          events = result.session.events;
          title = result.session.title;
          presetId = 'custom';
          running = false;
          page = 'playground';
          shell();
          toast('Session replayed from its seed and events.');
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not open session.');
        }
    } else if (button.dataset.delete) {
      const item = saved.find((s) => s.id === button.dataset.delete);
      if (item)
        modal(
          `<div class="modal-eyebrow">REMOVE LOCAL SESSION</div><h2>Delete this saved session?</h2><p>${esc(item.session.title)}</p><div class="modal-actions"><button class="button subtle" data-action="close">Cancel</button><button class="button danger" id="confirm-delete" data-id="${esc(item.id)}">Delete session</button></div>`,
        );
    } else if (button.dataset.trace) {
      const t = engine.snapshot().traces.find((t) => t.id === Number(button.dataset.trace));
      if (t)
        modal(
          `<div class="modal-eyebrow">REQUEST req-${String(t.id).padStart(5, '0')}</div><h2>${t.ok ? 'A successful journey.' : 'A request that didn’t make it.'}</h2><span class="outcome ${t.ok ? 'ok' : 'bad'}">${esc(t.reason)}</span><div class="trace-detail-stats"><div><span>Duration</span><strong>${Math.round(t.duration)} ms</strong></div><div><span>Service attempts</span><strong>${t.attempts}</strong></div><div><span>Completed</span><strong>${time(t.ended)}</strong></div></div><h3>Visited route</h3><div class="trace-route">${t.route.map((r, i) => `<span>${i + 1}<strong>${esc(r)}</strong></span>`).join('')}</div><p class="field-hint">Attempts include retries. Route shows the sequence of dependencies reached, including a service that rejected the request before executing.</p>`,
        );
    }
  };
  $('#app').onsubmit = saveSubmit;
  const traffic = $<HTMLInputElement>('#traffic');
  if (traffic) {
    traffic.oninput = () => {
      $('#rate-value').textContent = traffic.value;
    };
    traffic.onchange = () => {
      if (events.length >= 500) {
        traffic.value = String(engine.config.rate);
        toast('Session event limit reached. Reset to continue.');
        return;
      }
      engine.setRate(Number(traffic.value));
      events.push({ at: engine.time, type: 'rate', rate: Number(traffic.value) });
      update();
    };
  }
  const retries = $<HTMLSelectElement>('#retries');
  if (retries)
    retries.onchange = () => {
      initialConfig = cloneConfig(engine.config);
      initialConfig.retries = Number(retries.value);
      restart();
    };
  const breaker = $('#breaker');
  if (breaker)
    breaker.onclick = () => {
      initialConfig = cloneConfig(engine.config);
      initialConfig.circuitBreaker = !initialConfig.circuitBreaker;
      restart();
    };
  const speedInput = $<HTMLSelectElement>('#speed');
  if (speedInput)
    speedInput.onchange = () => {
      speed = Number(speedInput.value);
    };
  const filter = $<HTMLSelectElement>('#trace-filter');
  if (filter)
    filter.onchange = () => {
      traceFilter = filter.value;
      update();
    };
  const find = $<HTMLInputElement>('#trace-search');
  if (find)
    find.oninput = () => {
      search = find.value;
      update();
    };
  $('#import-file').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      toast('Session files must be smaller than 2 MB.');
      return;
    }
    try {
      const result = replaySession(JSON.parse(await file.text()));
      engine = result.simulator;
      initialConfig = result.session.config;
      events = result.session.events;
      title = result.session.title;
      presetId = 'custom';
      running = false;
      page = 'playground';
      shell();
      toast('Session imported and replayed.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Invalid session file.');
    }
  };
  $('#dialog').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'confirm-delete') {
      const id = (e.target as HTMLElement).dataset.id;
      const next = saved.filter((s) => s.id !== id);
      try {
        localStorage.setItem('tracelab-sessions-v1', JSON.stringify(next));
        saved = next;
        shell();
        toast('Saved session deleted.');
      } catch {
        toast('Browser storage is unavailable.');
      }
    }
  });
}
function saveSubmit(e: Event): void {
  if ((e.target as HTMLFormElement).id !== 'save-form') return;
  e.preventDefault();
  if (saved.length >= 12) {
    toast('All 12 slots are used. Export or remove a session first.');
    return;
  }
  const name = $<HTMLInputElement>('#session-name').value.trim();
  if (!name) return;
  const next = [
    {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      session: { ...session(), title: name },
    },
    ...saved,
  ];
  try {
    localStorage.setItem('tracelab-sessions-v1', JSON.stringify(next));
    saved = next;
    page = 'saved';
    shell();
    toast('Session saved in this browser.');
  } catch {
    toast('Browser storage is unavailable or full. Export JSON to keep this session.');
  }
}
document.addEventListener('keydown', (e) => {
  if (
    $<HTMLDialogElement>('#dialog')?.open ||
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLButtonElement ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    action('run');
  } else if (e.key.toLowerCase() === 'r') action('reset');
  else if (e.key === '?') help();
});
let last = performance.now();
setInterval(() => {
  const now = performance.now(),
    elapsed = Math.min(now - last, 300);
  last = now;
  if (running && !document.hidden) {
    advance(elapsed * speed);
    update();
  }
}, 180);
document.addEventListener('visibilitychange', () => {
  last = performance.now();
});
shell();
