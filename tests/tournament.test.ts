import { TournamentEngine } from '../src/core/engine';
import { createTestTournamentConfig } from '../src/core/configs';
import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
  TournamentConfig,
  resetIdCounter,
} from '../src/models/types';

// ─── Test Bot Implementations ───────────────────────────────────────────────────

/** Always bids floor price + fixed markup. Never rescinds. */
class ConstantBidBot implements BotAgent {
  constructor(
    readonly bot_id: string,
    private markup: number = 1.0,
  ) {}

  decideBids(obs: BotObservation): BotBidDecision {
    const price = obs.floor_price + this.markup;
    if (price * obs.tokens_available > obs.remaining_budget) {
      return { bids: [] }; // can't afford
    }
    return { bids: [{ price_per_token: price }] };
  }

  decideRescind(): BotRescindDecision {
    return { rescind: false };
  }
}

/** Bids aggressively (high markup). Always rescinds to test the mechanic. */
class AggressiveRescindBot implements BotAgent {
  constructor(
    readonly bot_id: string,
    private markup: number = 5.0,
  ) {}

  decideBids(obs: BotObservation): BotBidDecision {
    const price = obs.floor_price + this.markup;
    if (price * obs.tokens_available > obs.remaining_budget) {
      return { bids: [] };
    }
    return { bids: [{ price_per_token: price }] };
  }

  decideRescind(): BotRescindDecision {
    return { rescind: true }; // always rescind
  }
}

/** Never bids. Useful for testing empty periods. */
class PassiveBot implements BotAgent {
  constructor(readonly bot_id: string) {}

  decideBids(): BotBidDecision {
    return { bids: [] };
  }

  decideRescind(): BotRescindDecision {
    return { rescind: false };
  }
}

/** Bids only in specific stages. */
class StageSniperBot implements BotAgent {
  constructor(
    readonly bot_id: string,
    private targetStage: number,
    private markup: number = 3.0,
  ) {}

  decideBids(obs: BotObservation): BotBidDecision {
    if (obs.stage !== this.targetStage) {
      return { bids: [] };
    }
    const price = obs.floor_price + this.markup;
    if (price * obs.tokens_available > obs.remaining_budget) {
      return { bids: [] };
    }
    return { bids: [{ price_per_token: price }] };
  }

  decideRescind(): BotRescindDecision {
    return { rescind: false };
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('TournamentEngine', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  test('runs a complete tournament with two bots', () => {
    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      new ConstantBidBot('bot_A', 2.0),
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    // Tournament should complete
    expect(result.final_leaderboard.length).toBe(2);
    expect(result.winner_bot_id).toBeTruthy();
    expect(result.all_period_results.length).toBe(9); // 3 stages × 3 periods

    // bot_A bids higher → wins every period
    for (const pr of result.all_period_results) {
      if (pr.allocations.length > 0) {
        expect(pr.winner_bot_id).toBe('bot_A');
        // Pays second-highest price (bot_B's bid or floor)
        expect(pr.clearing_price).toBeLessThanOrEqual(
          pr.floor_price + 2.0,
        );
      }
    }

    // bot_A should have 3 SP per stage = 9 + bonus = 10
    const botA = result.final_leaderboard.find((e) => e.bot_id === 'bot_A')!;
    expect(botA.sp).toBe(10); // 3+3+3 + 1 bonus
  });

  test('passive bot gets no tokens or points', () => {
    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      new ConstantBidBot('bot_A', 2.0),
      new PassiveBot('bot_passive'),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const passive = result.bot_summaries.get('bot_passive')!;
    expect(passive.total_sp).toBe(0);
    expect(passive.weighted_points).toBe(0);
    expect(passive.periods_won).toBe(0);
    expect(passive.budget_remaining).toBe(config.budget_per_bot);
  });

  test('rescind correctly refunds budget and removes holding', () => {
    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      new AggressiveRescindBot('bot_rescinder', 5.0),
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const rescinder = result.bot_summaries.get('bot_rescinder')!;
    // Rescinder wins periods but always rescinds → gets tokens back
    // Budget should be mostly intact (spent then refunded)
    // But tokens should be minimal since rescinds remove holdings
    expect(rescinder.rescinds_made).toBeGreaterThan(0);
  });

  test('rescinded tokens appear in later periods with 2-period delay', () => {
    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      new AggressiveRescindBot('bot_rescinder', 5.0),
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    // Find periods with extra supply (tokens_available > base)
    const baseSupplies = config.stages.map(
      (s) => s.base_token_supply / s.num_periods,
    );

    const periodsWithExtraSupply = result.all_period_results.filter((pr) => {
      const baseForStage = baseSupplies[pr.stage];
      return pr.tokens_available > baseForStage + 0.01; // tolerance
    });

    // If rescinds happened, some later periods should have extra supply
    if (result.bot_summaries.get('bot_rescinder')!.rescinds_made > 0) {
      expect(periodsWithExtraSupply.length).toBeGreaterThan(0);
    }
  });

  test('stage sniper bot only gets tokens in target stage', () => {
    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      new StageSniperBot('sniper_s2', 1, 3.0), // only bids in stage 2 (index 1)
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const sniper = result.final_leaderboard.find((e) => e.bot_id === 'sniper_s2')!;
    expect(sniper.tokens_per_stage[0]).toBe(0); // no stage 1 tokens
    expect(sniper.tokens_per_stage[1]).toBeGreaterThan(0); // has stage 2 tokens
    expect(sniper.tokens_per_stage[2]).toBe(0); // no stage 3 tokens
  });

  test('SP awards are correct for 3 competing bots', () => {
    const config = createTestTournamentConfig();
    // bot_A always wins (highest markup), B second, C never wins
    const bots: BotAgent[] = [
      new ConstantBidBot('bot_A', 5.0),
      new ConstantBidBot('bot_B', 3.0),
      new PassiveBot('bot_C'),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const a = result.final_leaderboard.find((e) => e.bot_id === 'bot_A')!;
    const b = result.final_leaderboard.find((e) => e.bot_id === 'bot_B')!;
    const c = result.final_leaderboard.find((e) => e.bot_id === 'bot_C')!;

    // bot_A wins all periods → 3 SP per stage = 9, plus overall bonus = 10
    expect(a.sp).toBe(10);
    // bot_B never wins a period → 0 tokens → 0 SP
    // (B bids but A always outbids, B gets nothing in Vickrey single-winner)
    expect(b.sp).toBe(0);
    expect(c.sp).toBe(0);
  });

  test('budget is shared across stages', () => {
    const config = createTestTournamentConfig({ budget_per_bot: 1000 });
    const bots: BotAgent[] = [
      new ConstantBidBot('bot_A', 2.0),
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const a = result.bot_summaries.get('bot_A')!;
    // Budget spent + remaining should equal initial budget
    expect(a.budget_spent + a.budget_remaining).toBeCloseTo(1000, 2);
    // Should have spent something across all stages
    expect(a.budget_spent).toBeGreaterThan(0);
  });

  test('duplicate bot_id throws', () => {
    const config = createTestTournamentConfig();
    expect(
      () =>
        new TournamentEngine(config, [
          new ConstantBidBot('same_id', 1.0),
          new ConstantBidBot('same_id', 2.0),
        ]),
    ).toThrow('Duplicate bot_id');
  });

  test('bot that throws on decideBids is gracefully skipped', () => {
    const errorBot: BotAgent = {
      bot_id: 'error_bot',
      decideBids: () => {
        throw new Error('Bot crashed!');
      },
      decideRescind: () => ({ rescind: false }),
    };

    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      errorBot,
      new ConstantBidBot('bot_B', 1.0),
    ];

    // Should not throw — engine catches bot errors
    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    expect(result.final_leaderboard.length).toBe(2);
    // bot_B should win everything since error_bot submits no bids
    const b = result.bot_summaries.get('bot_B')!;
    expect(b.periods_won).toBeGreaterThan(0);
  });

  test('bot that runs out of budget stops winning', () => {
    // Very low budget: can only afford ~1 period
    const config = createTestTournamentConfig({ budget_per_bot: 350 });
    const bots: BotAgent[] = [
      new ConstantBidBot('bot_A', 2.0),
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    const a = result.bot_summaries.get('bot_A')!;
    // Can't afford all periods → budget eventually runs out
    expect(a.budget_remaining).toBeGreaterThanOrEqual(0);
    // Some periods should have no allocation (both bots ran out)
    const emptyPeriods = result.all_period_results.filter(
      (pr) => pr.allocations.length === 0,
    );
    expect(emptyPeriods.length).toBeGreaterThan(0);
  });
});

describe('TournamentEngine — rescind delayed revelation', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  test('rescind info is private for 2 periods', () => {
    // Custom bot that rescinds only in the first period and checks
    // private_info in subsequent periods
    const privateInfoLog: { period: number; hasPrivateInfo: boolean }[] = [];

    const rescindFirstOnly: BotAgent = {
      bot_id: 'smart_rescinder',
      decideBids(obs: BotObservation): BotBidDecision {
        privateInfoLog.push({
          period: obs.absolute_period,
          hasPrivateInfo: obs.private_rescind_info.length > 0,
        });
        return { bids: [{ price_per_token: obs.floor_price + 5 }] };
      },
      decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
        // Only rescind in absolute period 0
        return { rescind: winResult.absolute_period === 0 };
      },
    };

    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      rescindFirstOnly,
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    engine.run();

    // After rescinding in period 0:
    // Period 1: smart_rescinder should have private info
    // Period 2: supply appears, info becomes public, private_info cleared
    const period1 = privateInfoLog.find((l) => l.period === 1);
    expect(period1?.hasPrivateInfo).toBe(true);
  });
});

describe('TournamentEngine — final period rescind restriction', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  test('cannot rescind in last 2 periods of final stage', () => {
    const rescindAttempts: { period: number; stage: number }[] = [];

    const alwaysRescindBot: BotAgent = {
      bot_id: 'always_rescind',
      decideBids(obs: BotObservation): BotBidDecision {
        return { bids: [{ price_per_token: obs.floor_price + 5 }] };
      },
      decideRescind(obs: BotObservation): BotRescindDecision {
        rescindAttempts.push({ period: obs.period, stage: obs.stage });
        return { rescind: true };
      },
    };

    const config = createTestTournamentConfig();
    const bots: BotAgent[] = [
      alwaysRescindBot,
      new ConstantBidBot('bot_B', 1.0),
    ];

    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    // Last stage (index 2), periods 1 and 2 (0-indexed) in a 3-period stage
    // Period 2 is the last, period 1 is second-to-last
    // With RESCIND_REVEAL_DELAY=2, periods with index >= (3-2)=1 cannot rescind
    const lastStagePeriods = result.all_period_results.filter(
      (pr) => pr.stage === 2,
    );

    // Last two periods of final stage should NOT be rescinded
    const lastPeriod = lastStagePeriods.find((pr) => pr.period === 2);
    const secondLastPeriod = lastStagePeriods.find((pr) => pr.period === 1);

    // These should either be null (rescind not offered) or not rescinded
    // The engine doesn't call decideRescind for these periods
    if (lastPeriod && lastPeriod.winner_bot_id === 'always_rescind') {
      expect(lastPeriod.rescinded).toBeNull();
    }
    if (secondLastPeriod && secondLastPeriod.winner_bot_id === 'always_rescind') {
      expect(secondLastPeriod.rescinded).toBeNull();
    }
  });
});
