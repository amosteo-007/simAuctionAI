import { TournamentStore } from '../src/core/store/tournamentStore';
import { createTestTournamentConfig } from '../src/core/configs';
import { PendingRescind, TokenHolding } from '../src/models/types';

describe('TournamentStore', () => {
  let store: TournamentStore;

  beforeEach(() => {
    const config = createTestTournamentConfig();
    store = new TournamentStore(config, ['bot_A', 'bot_B', 'bot_C']);
  });

  test('initializes bots with correct budget', () => {
    const bot = store.getBot('bot_A')!;
    expect(bot.remaining_budget).toBe(5000);
    expect(bot.weighted_points).toBe(0);
    expect(bot.sp).toBe(0);
    expect(bot.tokens_per_stage).toEqual([0, 0, 0]);
  });

  test('getBot returns undefined for unknown bot', () => {
    expect(store.getBot('nonexistent')).toBeUndefined();
  });

  test('deductBudget reduces budget', () => {
    store.deductBudget('bot_A', 1000);
    expect(store.getBot('bot_A')!.remaining_budget).toBe(4000);
  });

  test('deductBudget throws if insufficient', () => {
    expect(() => store.deductBudget('bot_A', 99999)).toThrow('cannot afford');
  });

  test('refundBudget increases budget', () => {
    store.deductBudget('bot_A', 1000);
    store.refundBudget('bot_A', 500);
    expect(store.getBot('bot_A')!.remaining_budget).toBe(4500);
  });

  test('addHolding updates tokens_per_stage and weighted_points', () => {
    const holding: TokenHolding = {
      stage: 0,
      period: 0,
      quantity: 50,
      price_paid_per_token: 10,
      points_per_token: 1.0,
    };
    store.addHolding('bot_A', holding);

    const bot = store.getBot('bot_A')!;
    expect(bot.tokens_per_stage[0]).toBe(50);
    expect(bot.weighted_points).toBe(50); // 50 × 1.0
  });

  test('addHolding with multiplier updates weighted_points correctly', () => {
    const holding: TokenHolding = {
      stage: 1,
      period: 0,
      quantity: 40,
      price_paid_per_token: 10.5,
      points_per_token: 1.5,
    };
    store.addHolding('bot_A', holding);

    const bot = store.getBot('bot_A')!;
    expect(bot.tokens_per_stage[1]).toBe(40);
    expect(bot.weighted_points).toBeCloseTo(60, 4); // 40 × 1.5
  });

  test('removeHolding reverses addHolding', () => {
    const holding: TokenHolding = {
      stage: 0,
      period: 2,
      quantity: 30,
      price_paid_per_token: 11,
      points_per_token: 1.0,
    };
    store.addHolding('bot_B', holding);
    expect(store.getBot('bot_B')!.weighted_points).toBe(30);

    const removed = store.removeHolding('bot_B', 0, 2);
    expect(removed).toBeDefined();
    expect(removed!.quantity).toBe(30);
    expect(store.getBot('bot_B')!.weighted_points).toBe(0);
    expect(store.getBot('bot_B')!.tokens_per_stage[0]).toBe(0);
  });

  test('removeHolding returns undefined if not found', () => {
    expect(store.removeHolding('bot_A', 0, 99)).toBeUndefined();
  });

  test('revealRescinds returns and removes matching entries', () => {
    const rescind: PendingRescind = {
      bot_id: 'bot_A',
      source_stage: 0,
      source_period: 0,
      tokens: 30,
      price_refunded_per_token: 10,
      total_refunded: 300,
      rescinded_at_absolute: 0,
      reveal_at_absolute: 2,
    };
    store.addPendingRescind(rescind);

    // Not yet time
    expect(store.revealRescinds(1)).toHaveLength(0);
    expect(store.getPendingRescinds()).toHaveLength(1);

    // Now reveal
    const revealed = store.revealRescinds(2);
    expect(revealed).toHaveLength(1);
    expect(revealed[0].bot_id).toBe('bot_A');
    expect(store.getPendingRescinds()).toHaveLength(0);
  });

  test('getStageRanking sorts by tokens descending', () => {
    store.addHolding('bot_A', {
      stage: 0, period: 0, quantity: 100,
      price_paid_per_token: 10, points_per_token: 1,
    });
    store.addHolding('bot_B', {
      stage: 0, period: 1, quantity: 150,
      price_paid_per_token: 10, points_per_token: 1,
    });
    // bot_C has no tokens in stage 0

    const ranking = store.getStageRanking(0);
    expect(ranking).toHaveLength(2);
    expect(ranking[0].bot_id).toBe('bot_B');
    expect(ranking[0].tokens).toBe(150);
    expect(ranking[1].bot_id).toBe('bot_A');
    expect(ranking[1].tokens).toBe(100);
  });

  test('awardSP accumulates', () => {
    store.awardSP('bot_A', 3);
    store.awardSP('bot_A', 2);
    expect(store.getBot('bot_A')!.sp).toBe(5);
  });

  test('getRescindSupplyForPeriod sums correctly', () => {
    store.addRescindSupply({
      target_absolute_period: 5,
      tokens: 30,
      source_description: 'test1',
    });
    store.addRescindSupply({
      target_absolute_period: 5,
      tokens: 20,
      source_description: 'test2',
    });
    store.addRescindSupply({
      target_absolute_period: 6,
      tokens: 50,
      source_description: 'test3',
    });

    expect(store.getRescindSupplyForPeriod(5)).toBe(50);
    expect(store.getRescindSupplyForPeriod(6)).toBe(50);
    expect(store.getRescindSupplyForPeriod(7)).toBe(0);
  });
});
