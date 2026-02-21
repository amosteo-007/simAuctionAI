import { createDefaultTournamentConfig } from './core/configs';
import { SimulationEngine, printSimulationReport, SimulationConfig } from './simulation/harness';

// ─── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const numRuns = parseInt(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? '100', 10);
const seed = parseInt(args.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? String(Date.now()), 10);
const mode = (args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'fixed') as SimulationConfig['population_mode'];
const poolSize = parseInt(args.find((a) => a.startsWith('--pool='))?.split('=')[1] ?? '6', 10);

// ─── Run ────────────────────────────────────────────────────────────────────────

console.log(`\nCCA Auction Simulation`);
console.log(`  Runs: ${numRuns}  Seed: ${seed}  Mode: ${mode}  Pool: ${poolSize}`);
console.log(`  Running...`);

const startTime = Date.now();

const simConfig: SimulationConfig = {
  num_runs: numRuns,
  tournament_config: createDefaultTournamentConfig(),
  master_seed: seed,
  population_mode: mode,
  pool_size: poolSize,
};

const sim = new SimulationEngine(simConfig);

const result = sim.run((run, total) => {
  if (run % 10 === 0 || run === total) {
    process.stdout.write(`\r  Progress: ${run}/${total}`);
  }
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\r  Completed ${numRuns} tournaments in ${elapsed}s`);

// ─── Report ─────────────────────────────────────────────────────────────────────

console.log(printSimulationReport(result));

// ─── Optional: dump per-run data to JSON ────────────────────────────────────────

if (args.includes('--json')) {
  const jsonOut = {
    config: {
      num_runs: result.num_runs,
      master_seed: seed,
      mode,
    },
    archetype_wins: Object.fromEntries(result.archetype_wins),
    archetype_averages: Object.fromEntries(
      [...result.archetype_averages.entries()].map(([k, v]) => [k, v]),
    ),
    price_stats: result.price_stats,
    runs: result.run_results,
  };
  const filename = `sim_results_${seed}.json`;
  require('fs').writeFileSync(filename, JSON.stringify(jsonOut, null, 2));
  console.log(`  Results saved to ${filename}`);
}
