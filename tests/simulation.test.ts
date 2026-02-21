import { TournamentEngine } from '../src/core/engine';
import { createTestTournamentConfig, createDefaultTournamentConfig } from '../src/core/configs';
import { createBot, ALL_ARCHETYPES, BotArchetype } from '../src/bots/archetypes';
import { SimulationEngine, SimulationConfig } from '../src/simulation/harness';
import { SeededRandom } from '../src/utils/random';
import { BotAgent, resetIdCounter } from '../src/models/types';

describe('SeededRandom', () => {
  test('same seed produces same sequence', () => {
    const r1 = new SeededRandom(42);
    const r2 = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(r1.next()).toBe(r2.next());
    }
  });

  test('different seeds produce different sequences', () => {
    const r1 = new SeededRandom(42);
    const r2 = new SeededRandom(43);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (r1.next() === r2.next()) same++;
    }
    expect(same).toBeLessThan(5); // extremely unlikely to match often
  });

  test('range produces values within bounds', () => {
    const r = new SeededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  test('gaussian produces reasonable distribution', () => {
    const r = new SeededRandom(77);
    const samples = Array.from({ length: 5000 }, () => r.gaussian(10, 2));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const std = Math.sqrt(
      samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length,
    );
    expect(mean).toBeGreaterThan(9);
    expect(mean).toBeLessThan(11);
    expect(std).toBeGreaterThan(1.5);
    expect(std).toBeLessThan(2.5);
  });
});

describe('Stochastic Bots', () => {
  test('all archetypes can be created', () => {
    for (const arch of ALL_ARCHETYPES) {
      const bot = createBot(arch, `test_${arch}`, 42);
      expect(bot.bot_id).toBe(`test_${arch}`);
    }
  });

  test('same archetype with different seeds produces different bids', () => {
    resetIdCounter();
    const config = createTestTournamentConfig();

    // Run with seed 1
    const bots1: BotAgent[] = ALL_ARCHETYPES.map((a, i) =>
      createBot(a, `${a}_s1`, 100 + i),
    );
    const engine1 = new TournamentEngine(config, bots1);
    const result1 = engine1.run();

    resetIdCounter();

    // Run with seed 2
    const bots2: BotAgent[] = ALL_ARCHETYPES.map((a, i) =>
      createBot(a, `${a}_s2`, 200 + i),
    );
    const engine2 = new TournamentEngine(config, bots2);
    const result2 = engine2.run();

    // Results should differ (different seeds → different parameters → different bids)
    const prices1 = result1.all_period_results
      .filter((p) => p.allocations.length > 0)
      .map((p) => p.clearing_price);
    const prices2 = result2.all_period_results
      .filter((p) => p.allocations.length > 0)
      .map((p) => p.clearing_price);

    // Not all prices should be identical
    let diffs = 0;
    for (let i = 0; i < Math.min(prices1.length, prices2.length); i++) {
      if (Math.abs(prices1[i] - prices2[i]) > 0.01) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });

  test('same archetype with same seed produces identical results', () => {
    resetIdCounter();
    const config = createTestTournamentConfig();

    const bots1: BotAgent[] = ALL_ARCHETYPES.map((a, i) =>
      createBot(a, `${a}_v1`, 42 + i),
    );
    const engine1 = new TournamentEngine(config, bots1);
    const result1 = engine1.run();

    resetIdCounter();

    const bots2: BotAgent[] = ALL_ARCHETYPES.map((a, i) =>
      createBot(a, `${a}_v2`, 42 + i),
    );
    const engine2 = new TournamentEngine(config, bots2);
    const result2 = engine2.run();

    // Same seeds → same parameters → same results
    const prices1 = result1.all_period_results.map((p) => p.clearing_price);
    const prices2 = result2.all_period_results.map((p) => p.clearing_price);
    expect(prices1).toEqual(prices2);
  });
});

describe('SimulationEngine', () => {
  test('fixed mode runs without errors', () => {
    const simConfig: SimulationConfig = {
      num_runs: 5,
      tournament_config: createTestTournamentConfig(),
      master_seed: 42,
      population_mode: 'fixed',
      fixed_archetypes: ['aggressive_early', 'patient_sniper', 'adaptive_tracker'],
    };

    const sim = new SimulationEngine(simConfig);
    const result = sim.run();

    expect(result.num_runs).toBe(5);
    expect(result.run_results).toHaveLength(5);
    expect(result.archetype_wins.size).toBeGreaterThan(0);
  });

  test('random_pool mode produces population variation', () => {
    const simConfig: SimulationConfig = {
      num_runs: 20,
      tournament_config: createTestTournamentConfig(),
      master_seed: 123,
      population_mode: 'random_pool',
      pool_size: 4,
    };

    const sim = new SimulationEngine(simConfig);
    const result = sim.run();

    expect(result.run_results).toHaveLength(20);
    // Different runs should have different winners (with high probability)
    const uniqueWinners = new Set(result.run_results.map((r) => r.winner_archetype));
    expect(uniqueWinners.size).toBeGreaterThan(1);
  });

  test('custom mode uses specified bots', () => {
    const simConfig: SimulationConfig = {
      num_runs: 3,
      tournament_config: createTestTournamentConfig(),
      master_seed: 99,
      population_mode: 'custom',
      custom_bots: [
        { archetype: 'chaos_agent', id_prefix: 'chaos' },
        { archetype: 'adaptive_tracker', id_prefix: 'tracker' },
      ],
    };

    const sim = new SimulationEngine(simConfig);
    const result = sim.run();

    // Only our two archetypes should appear
    const archetypes = new Set<string>();
    for (const run of result.run_results) {
      for (const entry of run.leaderboard) {
        archetypes.add(entry.archetype);
      }
    }
    expect(archetypes.size).toBe(2);
    expect(archetypes.has('chaos_agent')).toBe(true);
    expect(archetypes.has('adaptive_tracker')).toBe(true);
  });

  test('different master seeds produce different results', () => {
    const base: Omit<SimulationConfig, 'master_seed'> = {
      num_runs: 10,
      tournament_config: createTestTournamentConfig(),
      population_mode: 'fixed',
      fixed_archetypes: ['aggressive_early', 'adaptive_tracker', 'chaos_agent'],
    };

    const sim1 = new SimulationEngine({ ...base, master_seed: 1 });
    const sim2 = new SimulationEngine({ ...base, master_seed: 2 });

    const result1 = sim1.run();
    const result2 = sim2.run();

    // Winner distributions should differ
    const winners1 = result1.run_results.map((r) => r.winner_archetype).join(',');
    const winners2 = result2.run_results.map((r) => r.winner_archetype).join(',');
    expect(winners1).not.toBe(winners2);
  });

  test('archetype averages are computed correctly', () => {
    const simConfig: SimulationConfig = {
      num_runs: 10,
      tournament_config: createTestTournamentConfig(),
      master_seed: 55,
      population_mode: 'fixed',
      fixed_archetypes: ['aggressive_early', 'patient_sniper'],
    };

    const sim = new SimulationEngine(simConfig);
    const result = sim.run();

    for (const [, avg] of result.archetype_averages) {
      expect(avg.avg_sp).toBeGreaterThanOrEqual(0);
      expect(avg.avg_sp).toBeLessThanOrEqual(10);
      expect(avg.win_rate).toBeGreaterThanOrEqual(0);
      expect(avg.win_rate).toBeLessThanOrEqual(1);
      expect(avg.avg_budget_spent).toBeGreaterThanOrEqual(0);
    }
  });

  test('price stats show stage-level variation', () => {
    const simConfig: SimulationConfig = {
      num_runs: 20,
      tournament_config: createDefaultTournamentConfig(),
      master_seed: 42,
      population_mode: 'fixed',
    };

    const sim = new SimulationEngine(simConfig);
    const result = sim.run();

    // Stage prices should increase (floor escalates)
    expect(result.price_stats.avg_price_stage_2).toBeGreaterThanOrEqual(
      result.price_stats.avg_price_stage_1,
    );
    // Price variance should exist (stochastic bots)
    const totalVariance =
      result.price_stats.price_variance_stage_1 +
      result.price_stats.price_variance_stage_2 +
      result.price_stats.price_variance_stage_3;
    expect(totalVariance).toBeGreaterThan(0);
  });

  test('progress callback fires', () => {
    const simConfig: SimulationConfig = {
      num_runs: 5,
      tournament_config: createTestTournamentConfig(),
      master_seed: 1,
      population_mode: 'fixed',
      fixed_archetypes: ['adaptive_tracker', 'chaos_agent'],
    };

    const calls: number[] = [];
    const sim = new SimulationEngine(simConfig);
    sim.run((run) => calls.push(run));

    expect(calls).toEqual([1, 2, 3, 4, 5]);
  });
});
