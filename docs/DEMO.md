# A portfolio demo that shows the engineering

## A 90-second walkthrough

**0:00 — The problem**

“It is difficult to see how one unhealthy dependency changes the rest of a distributed system. I built a simulator that makes those trade-offs observable and reproducible.”

**0:15 — Healthy baseline**

Open Steady state and start playback. Explain that all numbers are computed from individual simulated requests. Point out the independent worker pools and bounded queues.

**0:30 — Break a dependency**

Select PostgreSQL, inject a latency spike, and raise traffic. Show queue growth, throughput changes, and failed traces. Explain that an end-to-end deadline terminates waiting requests.

**0:50 — Compare policies**

Open Experiments and run the benchmark. Compare database attempts across policies. Explain why a circuit breaker can reduce downstream work without maximizing success rate.

**1:10 — Demonstrate reproducibility**

Export a session, import it, and show that elapsed time and metrics return to the same state. Explain seed-based event generation and ordered interventions.

**1:25 — Show the code**

Open the engine, architecture document, and tests. Discuss the heap, lifecycle invariants, and circuit generation numbers.

## Interview questions worth preparing for

- Why a discrete-event simulation instead of simulating every millisecond?
- How do you prevent retry policies from changing the random workload used in a comparison?
- What happens when a deadline fires before an in-flight service call completes?
- Why must an old successful response not close a newer open circuit?
- Why are successful-request P95 and overall success rate both needed?
- Which parts of the model would need to change before using it for capacity planning?
- At what scale would the simulation need a Web Worker or streaming percentile estimator?

## Make it your own before pinning it

Read and understand the engine. Choose one extension, implement it, and add a test that demonstrates its behavior. Good options include a retry budget, timeout-driven breakers, alternate traffic distributions, or per-request span timing.

Record a short screen capture after checking desktop and mobile layouts. Add it below the README introduction, add your demo URL to the repository's About section, and pin the repository. Describe your own contributions accurately when presenting the project.
