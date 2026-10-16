import { DEFAULT_CONFIG, cloneConfig, type Config, type Fault } from './engine.js';
export interface Preset {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  color: string;
  config: Config;
  fault?: Fault;
  lesson: string;
}
const config = (changes: Partial<Config> = {}): Config => ({
  ...cloneConfig(DEFAULT_CONFIG),
  ...changes,
});
export const PRESETS: Preset[] = [
  {
    id: 'steady',
    title: 'A quiet day in production',
    eyebrow: '01 / BASELINE',
    description: 'Follow a request through a healthy commerce stack. Get to know the happy path.',
    color: 'green',
    config: config(),
    lesson:
      'Start the simulation, then click a service to inspect its worker pool and request queue.',
  },
  {
    id: 'slow',
    title: 'The slow dependency',
    eyebrow: '02 / LATENCY',
    description: 'One slow database. A growing queue. See how a small delay spreads upstream.',
    color: 'amber',
    config: config({ rate: 90, retries: 1 }),
    fault: { service: 'database', kind: 'latency', duration: 16000 },
    lesson:
      'Database requests take an extra 600 ms. Watch worker saturation, queues, and end-to-end deadlines.',
  },
  {
    id: 'storm',
    title: 'When retries make it worse',
    eyebrow: '03 / RETRY STORM',
    description:
      'Take the database offline and watch retries amplify the work of a failing service.',
    color: 'pink',
    config: config({ rate: 65, retries: 3, circuitBreaker: false }),
    fault: { service: 'database', kind: 'outage', duration: 12000 },
    lesson:
      'Every failed attempt may be retried up to three times. Compare the dependency attempts with a circuit breaker enabled.',
  },
  {
    id: 'breaker',
    title: 'Give your system a breather',
    eyebrow: '04 / CIRCUIT BREAKER',
    description:
      'Fail fast, wait, and probe for recovery. Explore the three circuit-breaker states.',
    color: 'purple',
    config: config({ rate: 65, retries: 2, circuitBreaker: true }),
    fault: { service: 'database', kind: 'outage', duration: 12000 },
    lesson:
      'After five consecutive failures, the circuit opens for three seconds. One half-open probe decides whether traffic resumes.',
  },
];
