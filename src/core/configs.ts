import { TournamentConfig, StageConfig } from '../models/types';

/**
 * Create the default 3-stage tournament configuration as discussed:
 *
 * Stage 1: 900 tokens, $10 floor, 1.0 pts/token (cheap, high supply)
 * Stage 2: 600 tokens, $10.50 floor, 1.5 pts/token (moderate)
 * Stage 3: 300 tokens, $11.03 floor, 2.5 pts/token (scarce, expensive)
 *
 * All stages use Vickrey (second-price) clearing.
 * 9 periods per stage, 60 seconds each.
 * Budget: $10,000 per bot, shared across all stages.
 * SP: 3/2/1 per stage, +1 for overall weighted points leader.
 */
export function createDefaultTournamentConfig(
  overrides?: Partial<TournamentConfig>,
): TournamentConfig {
  const stages: StageConfig[] = [
    {
      base_token_supply: 900,
      points_per_token: 1.0,
      floor_price: 10.0,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'vickrey',
    },
    {
      base_token_supply: 600,
      points_per_token: 1.5,
      floor_price: 10.5,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'vickrey',
    },
    {
      base_token_supply: 300,
      points_per_token: 2.5,
      floor_price: 11.03,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'vickrey',
    },
  ];

  return {
    name: 'Default CCA Bot Tournament',
    budget_per_bot: 10_000,
    stages,
    sp_awards: [3, 2, 1],
    overall_bonus_sp: 1,
    ...overrides,
  };
}

/**
 * Create a quick tournament config for testing (fewer periods, smaller numbers).
 */
export function createTestTournamentConfig(
  overrides?: Partial<TournamentConfig>,
): TournamentConfig {
  const stages: StageConfig[] = [
    {
      base_token_supply: 90,
      points_per_token: 1.0,
      floor_price: 10.0,
      num_periods: 3,
      period_duration_seconds: 5,
      max_bids_per_period: 5,
      clearing_strategy: 'vickrey',
    },
    {
      base_token_supply: 60,
      points_per_token: 1.5,
      floor_price: 10.5,
      num_periods: 3,
      period_duration_seconds: 5,
      max_bids_per_period: 5,
      clearing_strategy: 'vickrey',
    },
    {
      base_token_supply: 30,
      points_per_token: 2.5,
      floor_price: 11.03,
      num_periods: 3,
      period_duration_seconds: 5,
      max_bids_per_period: 5,
      clearing_strategy: 'vickrey',
    },
  ];

  return {
    name: 'Test Tournament',
    budget_per_bot: 5_000,
    stages,
    sp_awards: [3, 2, 1],
    overall_bonus_sp: 1,
    ...overrides,
  };
}

/**
 * Create a mixed-strategy tournament where each stage uses a different mechanism.
 * Useful for comparing bot behavior across clearing mechanisms.
 */
export function createMixedStrategyTournamentConfig(): TournamentConfig {
  const stages: StageConfig[] = [
    {
      base_token_supply: 900,
      points_per_token: 1.0,
      floor_price: 10.0,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'vickrey',          // Stage 1: second-price
    },
    {
      base_token_supply: 600,
      points_per_token: 1.5,
      floor_price: 10.5,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'uniform_price',    // Stage 2: multi-winner uniform
    },
    {
      base_token_supply: 300,
      points_per_token: 2.5,
      floor_price: 11.03,
      num_periods: 9,
      period_duration_seconds: 60,
      max_bids_per_period: 10,
      clearing_strategy: 'vickrey',          // Stage 3: back to second-price
    },
  ];

  return {
    name: 'Mixed Strategy Tournament',
    budget_per_bot: 10_000,
    stages,
    sp_awards: [3, 2, 1],
    overall_bonus_sp: 1,
  };
}
