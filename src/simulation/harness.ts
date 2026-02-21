import {
  TournamentConfig,
  TournamentResult,
  BotAgent,
  BotSummary,
  resetIdCounter,
} from '../models/types';
import { TournamentEngine } from '../core/engine';
import { SeededRandom } from '../utils/random';
import {
  BotArchetype,
  ALL_ARCHETYPES,
  createBot,
} from '../bots/archetypes';

// ─── Simulation Configuration ───────────────────────────────────────────────────

export interface SimulationConfig {
  /** Number of tournament runs. */
  num_runs: number;

  /** Tournament config to use for each run. */
  tournament_config: TournamentConfig;

  /** Master seed for reproducible randomization across runs. */
  master_seed: number;

  /**
   * Bot population strategy:
   * - 'fixed': same archetypes every run, different seeds
   * - 'random_pool': randomly sample from archetype pool each run
   * - 'custom': use the provided bot_specs
   */
  population_mode: 'fixed' | 'random_pool' | 'custom';

  /** For 'fixed' mode: which archetypes to include (one instance each). */
  fixed_archetypes?: BotArchetype[];

  /** For 'random_pool' mode: how many bots per tournament. */
  pool_size?: number;

  /** For 'random_pool' mode: which archetypes to draw from. */
  pool_archetypes?: BotArchetype[];

  /** For 'custom' mode: explicit bot specifications. */
  custom_bots?: { archetype: BotArchetype; id_prefix: string }[];
}

// ─── Simulation Results ─────────────────────────────────────────────────────────

export interface SimulationResult {
  config: SimulationConfig;
  num_runs: number;

  /** Win count per archetype. */
  archetype_wins: Map<string, number>;

  /** SP distribution per archetype: archetype → array of SP totals. */
  archetype_sp_distribution: Map<string, number[]>;

  /** Average metrics per archetype. */
  archetype_averages: Map<string, ArchetypeAverage>;

  /** Per-run results (for detailed analysis). */
  run_results: RunSummary[];

  /** Price statistics across all runs. */
  price_stats: PriceStats;
}

export interface ArchetypeAverage {
  archetype: string;
  avg_sp: number;
  avg_weighted_points: number;
  avg_budget_spent: number;
  avg_periods_won: number;
  avg_rescinds: number;
  avg_capital_efficiency: number;
  win_rate: number;
  top3_rate: number; // how often in top 3
  median_sp: number;
}

export interface RunSummary {
  run_index: number;
  winner_id: string;
  winner_archetype: string;
  leaderboard: { bot_id: string; archetype: string; sp: number; weighted_points: number }[];
  total_rescinds: number;
  avg_clearing_price: number;
}

export interface PriceStats {
  avg_price_stage_1: number;
  avg_price_stage_2: number;
  avg_price_stage_3: number;
  price_variance_stage_1: number;
  price_variance_stage_2: number;
  price_variance_stage_3: number;
  avg_rescind_rate: number;
}

// ─── Simulation Engine ──────────────────────────────────────────────────────────

export class SimulationEngine {
  private config: SimulationConfig;
  private masterRng: SeededRandom;

  constructor(config: SimulationConfig) {
    this.config = config;
    this.masterRng = new SeededRandom(config.master_seed);
  }

  /**
   * Run the full simulation. Returns aggregate results.
   */
  run(progressCallback?: (run: number, total: number) => void): SimulationResult {
    const archetypeWins = new Map<string, number>();
    const archetypeSPs = new Map<string, number[]>();
    const archetypeSummaries = new Map<string, BotSummary[]>();
    const runResults: RunSummary[] = [];

    // Price accumulators
    const stagePrices: number[][] = [[], [], []];
    let totalRescinds = 0;
    let totalPeriods = 0;

    for (let run = 0; run < this.config.num_runs; run++) {
      if (progressCallback) progressCallback(run + 1, this.config.num_runs);
      resetIdCounter();

      // Create bots for this run
      const { bots, archetypeMap } = this.createBotsForRun(run);

      // Run tournament
      const engine = new TournamentEngine(this.config.tournament_config, bots);
      const result = engine.run();

      // Extract archetype for winner
      const winnerArchetype = archetypeMap.get(result.winner_bot_id) ?? 'unknown';
      archetypeWins.set(winnerArchetype, (archetypeWins.get(winnerArchetype) ?? 0) + 1);

      // Collect per-archetype SP and summaries
      for (const entry of result.final_leaderboard) {
        const arch = archetypeMap.get(entry.bot_id) ?? 'unknown';

        if (!archetypeSPs.has(arch)) archetypeSPs.set(arch, []);
        archetypeSPs.get(arch)!.push(entry.sp);

        const summary = result.bot_summaries.get(entry.bot_id);
        if (summary) {
          if (!archetypeSummaries.has(arch)) archetypeSummaries.set(arch, []);
          archetypeSummaries.get(arch)!.push(summary);
        }
      }

      // Price data
      const rescindsThisRun = result.all_period_results.filter(
        (pr) => pr.rescinded === true,
      ).length;
      totalRescinds += rescindsThisRun;
      totalPeriods += result.all_period_results.length;

      for (const pr of result.all_period_results) {
        if (pr.allocations.length > 0) {
          stagePrices[pr.stage].push(pr.clearing_price);
        }
      }

      // Run summary
      const allPrices = result.all_period_results
        .filter((pr) => pr.allocations.length > 0)
        .map((pr) => pr.clearing_price);
      const avgPrice = allPrices.length > 0
        ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length
        : 0;

      runResults.push({
        run_index: run,
        winner_id: result.winner_bot_id,
        winner_archetype: winnerArchetype,
        leaderboard: result.final_leaderboard.map((e) => ({
          bot_id: e.bot_id,
          archetype: archetypeMap.get(e.bot_id) ?? 'unknown',
          sp: e.sp,
          weighted_points: e.weighted_points,
        })),
        total_rescinds: rescindsThisRun,
        avg_clearing_price: avgPrice,
      });
    }

    // Compute averages
    const archetypeAverages = this.computeAverages(
      archetypeSummaries,
      archetypeWins,
      this.config.num_runs,
    );

    // Price stats
    const priceStats = this.computePriceStats(stagePrices, totalRescinds, totalPeriods);

    return {
      config: this.config,
      num_runs: this.config.num_runs,
      archetype_wins: archetypeWins,
      archetype_sp_distribution: archetypeSPs,
      archetype_averages: archetypeAverages,
      run_results: runResults,
      price_stats: priceStats,
    };
  }

  // ── Bot Creation ────────────────────────────────────────────────────────

  private createBotsForRun(
    runIndex: number,
  ): { bots: BotAgent[]; archetypeMap: Map<string, string> } {
    const bots: BotAgent[] = [];
    const archetypeMap = new Map<string, string>();
    const budget = this.config.tournament_config.budget_per_bot;

    switch (this.config.population_mode) {
      case 'fixed': {
        const archetypes = this.config.fixed_archetypes ?? ALL_ARCHETYPES;
        for (let i = 0; i < archetypes.length; i++) {
          const arch = archetypes[i];
          const seed = Math.floor(this.masterRng.next() * 2147483647);
          const id = `${arch}_r${runIndex}`;
          const bot = createBot(arch, id, seed, budget);
          bots.push(bot);
          archetypeMap.set(id, arch);
        }
        break;
      }

      case 'random_pool': {
        const poolSize = this.config.pool_size ?? 6;
        const pool = this.config.pool_archetypes ?? ALL_ARCHETYPES;
        for (let i = 0; i < poolSize; i++) {
          const arch = this.masterRng.pick(pool);
          const seed = Math.floor(this.masterRng.next() * 2147483647);
          const id = `${arch}_${i}_r${runIndex}`;
          const bot = createBot(arch, id, seed, budget);
          bots.push(bot);
          archetypeMap.set(id, arch);
        }
        break;
      }

      case 'custom': {
        const specs = this.config.custom_bots ?? [];
        for (let i = 0; i < specs.length; i++) {
          const spec = specs[i];
          const seed = Math.floor(this.masterRng.next() * 2147483647);
          const id = `${spec.id_prefix}_r${runIndex}`;
          const bot = createBot(spec.archetype, id, seed, budget);
          bots.push(bot);
          archetypeMap.set(id, spec.archetype);
        }
        break;
      }
    }

    return { bots, archetypeMap };
  }

  // ── Statistics ──────────────────────────────────────────────────────────

  private computeAverages(
    summaries: Map<string, BotSummary[]>,
    wins: Map<string, number>,
    numRuns: number,
  ): Map<string, ArchetypeAverage> {
    const result = new Map<string, ArchetypeAverage>();

    for (const [arch, allSummaries] of summaries) {
      const n = allSummaries.length;
      if (n === 0) continue;

      const sps = allSummaries.map((s) => s.total_sp);
      sps.sort((a, b) => a - b);

      result.set(arch, {
        archetype: arch,
        avg_sp: sps.reduce((a, b) => a + b, 0) / n,
        avg_weighted_points:
          allSummaries.reduce((s, b) => s + b.weighted_points, 0) / n,
        avg_budget_spent:
          allSummaries.reduce((s, b) => s + b.budget_spent, 0) / n,
        avg_periods_won:
          allSummaries.reduce((s, b) => s + b.periods_won, 0) / n,
        avg_rescinds:
          allSummaries.reduce((s, b) => s + b.rescinds_made, 0) / n,
        avg_capital_efficiency:
          allSummaries.reduce((s, b) => s + b.capital_efficiency, 0) / n,
        win_rate: (wins.get(arch) ?? 0) / numRuns,
        top3_rate: allSummaries.filter((s) => s.total_sp > 0).length / n,
        median_sp: sps[Math.floor(n / 2)],
      });
    }

    return result;
  }

  private computePriceStats(
    stagePrices: number[][],
    totalRescinds: number,
    totalPeriods: number,
  ): PriceStats {
    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const variance = (arr: number[]) => {
      if (arr.length < 2) return 0;
      const m = avg(arr);
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    };

    return {
      avg_price_stage_1: avg(stagePrices[0]),
      avg_price_stage_2: avg(stagePrices[1]),
      avg_price_stage_3: avg(stagePrices[2]),
      price_variance_stage_1: variance(stagePrices[0]),
      price_variance_stage_2: variance(stagePrices[1]),
      price_variance_stage_3: variance(stagePrices[2]),
      avg_rescind_rate: totalPeriods > 0 ? totalRescinds / totalPeriods : 0,
    };
  }
}

// ─── Pretty Print ───────────────────────────────────────────────────────────────

export function printSimulationReport(result: SimulationResult): string {
  const lines: string[] = [];
  const hr = '═'.repeat(72);

  lines.push('');
  lines.push(hr);
  lines.push(`  SIMULATION REPORT — ${result.num_runs} tournaments`);
  lines.push(hr);
  lines.push('');

  // Win rates
  lines.push('  ARCHETYPE WIN RATES');
  lines.push('  ' + '─'.repeat(60));

  const sortedArchetypes = [...result.archetype_averages.entries()]
    .sort((a, b) => b[1].win_rate - a[1].win_rate);

  for (const [arch, avg] of sortedArchetypes) {
    const wins = result.archetype_wins.get(arch) ?? 0;
    const bar = '█'.repeat(Math.round(avg.win_rate * 40));
    lines.push(
      `  ${arch.padEnd(22)} ${(avg.win_rate * 100).toFixed(1).padStart(5)}% ` +
      `(${String(wins).padStart(3)}/${result.num_runs})  ${bar}`,
    );
  }

  lines.push('');

  // Average metrics
  lines.push('  ARCHETYPE AVERAGES');
  lines.push('  ' + '─'.repeat(60));
  lines.push(
    '  ' +
    'Archetype'.padEnd(22) +
    'Avg SP'.padStart(8) +
    'Med SP'.padStart(8) +
    'Avg Pts'.padStart(9) +
    'Avg Wins'.padStart(10) +
    'Cap Eff'.padStart(9) +
    'Rescinds'.padStart(10),
  );

  for (const [arch, avg] of sortedArchetypes) {
    lines.push(
      '  ' +
      arch.padEnd(22) +
      avg.avg_sp.toFixed(1).padStart(8) +
      avg.median_sp.toFixed(0).padStart(8) +
      avg.avg_weighted_points.toFixed(0).padStart(9) +
      avg.avg_periods_won.toFixed(1).padStart(10) +
      avg.avg_capital_efficiency.toFixed(4).padStart(9) +
      avg.avg_rescinds.toFixed(1).padStart(10),
    );
  }

  lines.push('');

  // Price stats
  lines.push('  PRICE DYNAMICS');
  lines.push('  ' + '─'.repeat(60));
  const ps = result.price_stats;
  lines.push(`  Stage 1  avg: $${ps.avg_price_stage_1.toFixed(2)}  variance: ${ps.price_variance_stage_1.toFixed(3)}`);
  lines.push(`  Stage 2  avg: $${ps.avg_price_stage_2.toFixed(2)}  variance: ${ps.price_variance_stage_2.toFixed(3)}`);
  lines.push(`  Stage 3  avg: $${ps.avg_price_stage_3.toFixed(2)}  variance: ${ps.price_variance_stage_3.toFixed(3)}`);
  lines.push(`  Rescind rate: ${(ps.avg_rescind_rate * 100).toFixed(1)}% of periods`);

  lines.push('');

  // Strategy insights
  lines.push('  STRATEGY INSIGHTS');
  lines.push('  ' + '─'.repeat(60));

  const bestCapEff = sortedArchetypes.reduce<[string, number]>(
    (best, [, avg]) => (avg.avg_capital_efficiency > best[1] ? [avg.archetype, avg.avg_capital_efficiency] : best),
    ['', 0],
  );
  const mostRescinds = sortedArchetypes.reduce<[string, number]>(
    (best, [, avg]) => (avg.avg_rescinds > best[1] ? [avg.archetype, avg.avg_rescinds] : best),
    ['', 0],
  );

  lines.push(`  Most capital efficient:  ${bestCapEff[0]} (${bestCapEff[1].toFixed(4)} pts/$)`);
  lines.push(`  Most rescinds:           ${mostRescinds[0]} (${mostRescinds[1].toFixed(1)} avg per tournament)`);

  // Dominant strategy check
  const topWinRate = sortedArchetypes[0]?.[1].win_rate ?? 0;
  if (topWinRate > 0.5) {
    lines.push(`  ⚠  Potential dominant strategy: ${sortedArchetypes[0][0]} wins ${(topWinRate * 100).toFixed(0)}% of tournaments`);
  } else {
    lines.push(`  ✓  No dominant strategy detected (max win rate: ${(topWinRate * 100).toFixed(0)}%)`);
  }

  lines.push('');
  lines.push(hr);

  return lines.join('\n');
}
