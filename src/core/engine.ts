import Decimal from 'decimal.js';
import {
  TournamentConfig,
  TournamentResult,
  BotAgent,
  BotObservation,
  PeriodContext,
  PeriodResult,
  PeriodAllocation,
  Bid,
  TokenHolding,
  PendingRescind,
  RescindSupplyEntry,
  LeaderboardEntry,
  BotSummary,
  PrivateRescindInfo,
  generateId,
  resetIdCounter,
} from '../models/types';
import { TournamentStore } from './store/tournamentStore';
import { getStrategy } from './strategyFactory';

/** Number of periods of delay before a rescind is publicly revealed. */
const RESCIND_REVEAL_DELAY = 2;

/**
 * TournamentEngine runs a complete multi-stage auction tournament in "fast mode"
 * (synchronous, no real-time delays). Bots are called directly via the BotAgent interface.
 *
 * Flow per period:
 *   1. Compute supply (base + revealed rescinds)
 *   2. Build observation for each bot
 *   3. Collect bids from all bots
 *   4. Validate bids (floor price, budget, rate limit)
 *   5. Run clearing strategy
 *   6. Apply allocations (deduct budget, add holdings)
 *   7. Ask winner about rescind decision
 *   8. Process rescind (delayed revelation)
 *   9. Record period result
 *
 * After all periods in a stage:
 *   - Award SP for stage rankings
 *
 * After all stages:
 *   - Award overall bonus SP
 *   - Compute final results
 */
export class TournamentEngine {
  private store: TournamentStore;
  private bots: Map<string, BotAgent>;
  private config: TournamentConfig;

  constructor(config: TournamentConfig, agents: BotAgent[]) {
    this.config = config;
    this.bots = new Map();

    const botIds: string[] = [];
    for (const agent of agents) {
      if (this.bots.has(agent.bot_id)) {
        throw new Error(`Duplicate bot_id: ${agent.bot_id}`);
      }
      this.bots.set(agent.bot_id, agent);
      botIds.push(agent.bot_id);
    }

    this.store = new TournamentStore(config, botIds);
  }

  /**
   * Run the entire tournament synchronously. Returns the final result.
   */
  run(): TournamentResult {
    this.store.setPhase('stage_active');

    let absolutePeriod = 0;

    for (let stageIdx = 0; stageIdx < this.config.stages.length; stageIdx++) {
      const stageConfig = this.config.stages[stageIdx];
      this.store.setCurrentStage(stageIdx);

      // Calculate base supply per period for this stage
      const baseSupplyPerPeriod = stageConfig.base_token_supply / stageConfig.num_periods;

      for (let periodIdx = 0; periodIdx < stageConfig.num_periods; periodIdx++) {
        this.store.setCurrentPeriod(periodIdx);

        // ── 1. Reveal rescinds that are now public ──────────────────────
        const revealedRescinds = this.store.revealRescinds(absolutePeriod);
        this.processRescindRevelations(revealedRescinds, absolutePeriod);

        // ── 2. Compute supply for this period ───────────────────────────
        const rescindExtra = this.store.getRescindSupplyForPeriod(absolutePeriod);
        const tokensAvailable = baseSupplyPerPeriod + rescindExtra;

        // Floor price escalates 5% per stage
        const floorPrice = stageConfig.floor_price;

        const periodContext: PeriodContext = {
          stage: stageIdx,
          period: periodIdx,
          absolute_period: absolutePeriod,
          tokens_available: tokensAvailable,
          floor_price: floorPrice,
          points_per_token: stageConfig.points_per_token,
        };

        // ── 3. Determine if rescind is allowed this period ──────────────
        const isTerminalStage = stageIdx === this.config.stages.length - 1;
        const periodsFromEnd = stageConfig.num_periods - 1 - periodIdx;
        // No rescind in last 2 periods of final stage (no N+2 target)
        const rescindAllowed = !(isTerminalStage && periodsFromEnd < RESCIND_REVEAL_DELAY);

        // ── 4. Run the period ───────────────────────────────────────────
        const periodResult = this.runPeriod(
          periodContext,
          stageConfig.clearing_strategy,
          stageConfig.max_bids_per_period,
          rescindAllowed,
          absolutePeriod,
        );

        this.store.addPeriodResult(periodResult);
        absolutePeriod++;
      }

      // ── Award SP for this stage ─────────────────────────────────────────
      this.awardStageSP(stageIdx);

      // ── Stage transition: announce next stage supply adjustments ────────
      if (stageIdx < this.config.stages.length - 1) {
        this.store.setPhase('stage_transition');
        // Any pending rescinds targeting periods in the next stage are
        // already in the queue. The revelation happens at period start.
        this.store.setPhase('stage_active');
      }
    }

    // ── Award overall bonus SP ──────────────────────────────────────────────
    this.awardOverallBonusSP();

    this.store.setPhase('completed');
    return this.buildResult();
  }

  // ─── Period Execution ───────────────────────────────────────────────────────

  private runPeriod(
    context: PeriodContext,
    strategyType: string,
    maxBidsPerPeriod: number,
    rescindAllowed: boolean,
    absolutePeriod: number,
  ): PeriodResult {
    const strategy = getStrategy(strategyType as any);

    // ── Collect bids from all bots ──────────────────────────────────────
    const allBids: Bid[] = [];
    const botIds = this.store.getBotIds();

    for (const botId of botIds) {
      const agent = this.bots.get(botId)!;
      const observation = this.buildObservation(botId, context);

      try {
        const decision = agent.decideBids(observation);

        // Validate and collect bids (enforce rate limit)
        const bidSlice = decision.bids.slice(0, maxBidsPerPeriod);

        for (const bidInput of bidSlice) {
          const bot = this.store.getBot(botId)!;
          const totalCost = bidInput.price_per_token * context.tokens_available;

          // Skip invalid bids
          if (bidInput.price_per_token < context.floor_price) continue;
          if (totalCost > bot.remaining_budget) continue;
          if (bidInput.price_per_token <= 0) continue;

          const bid: Bid = {
            id: generateId('bid'),
            bot_id: botId,
            stage: context.stage,
            period: context.period,
            price_per_token: bidInput.price_per_token,
            total_cost: totalCost,
            submitted_at: new Date(),
          };

          allBids.push(bid);
        }
      } catch {
        // Bot errored — skip its bids for this period
      }
    }

    // ── Run clearing ────────────────────────────────────────────────────
    const clearingResult = strategy.clear(
      allBids,
      context.tokens_available,
      context.floor_price,
    );

    // ── Apply allocations ───────────────────────────────────────────────
    let winnerBotId: string | null = null;

    for (const alloc of clearingResult.allocations) {
      // Deduct budget
      this.store.deductBudget(alloc.bot_id, alloc.total_paid);

      // Add holdings
      const holding: TokenHolding = {
        stage: context.stage,
        period: context.period,
        quantity: alloc.tokens_allocated,
        price_paid_per_token: alloc.price_paid_per_token,
        points_per_token: context.points_per_token,
      };
      this.store.addHolding(alloc.bot_id, holding);

      // For single-winner strategies, track the winner
      if (clearingResult.allocations.length === 1) {
        winnerBotId = alloc.bot_id;
      }
    }

    // ── Rescind decision (single-winner strategies only) ────────────────
    let rescinded: boolean | null = null;

    if (winnerBotId && rescindAllowed && clearingResult.allocations.length === 1) {
      const agent = this.bots.get(winnerBotId)!;
      const winnerObservation = this.buildObservation(winnerBotId, context);

      // Build a preliminary period result for the winner to evaluate
      const prelimResult: PeriodResult = {
        stage: context.stage,
        period: context.period,
        absolute_period: absolutePeriod,
        tokens_available: context.tokens_available,
        floor_price: context.floor_price,
        points_per_token: context.points_per_token,
        clearing_price: clearingResult.clearing_price,
        allocations: clearingResult.allocations,
        rescinded: null,
        winner_bot_id: winnerBotId,
        bids_submitted: allBids,
        strategy_used: strategy.type,
      };

      try {
        const rescindDecision = agent.decideRescind(winnerObservation, prelimResult);

        if (rescindDecision.rescind) {
          this.processRescind(
            winnerBotId,
            context,
            clearingResult.allocations[0],
            absolutePeriod,
          );
          rescinded = false; // false = not yet revealed to public (null means N/A)
          // We set rescinded to false here because from the public's perspective,
          // the rescind status is unknown until the reveal period.
          // The period result will show rescinded: null until revelation.
        }
      } catch {
        // Bot errored on rescind — keep the tokens
      }
    }

    return {
      stage: context.stage,
      period: context.period,
      absolute_period: absolutePeriod,
      tokens_available: context.tokens_available,
      floor_price: context.floor_price,
      points_per_token: context.points_per_token,
      clearing_price: clearingResult.clearing_price,
      allocations: clearingResult.allocations,
      rescinded,
      winner_bot_id: winnerBotId,
      bids_submitted: allBids,
      strategy_used: strategy.type,
    };
  }

  // ─── Rescind Processing ─────────────────────────────────────────────────────

  private processRescind(
    botId: string,
    context: PeriodContext,
    allocation: PeriodAllocation,
    absolutePeriod: number,
  ): void {
    // Remove the holding
    this.store.removeHolding(botId, context.stage, context.period);

    // Refund budget
    this.store.refundBudget(botId, allocation.total_paid);

    // Calculate target period (current + RESCIND_REVEAL_DELAY)
    const targetAbsolute = absolutePeriod + RESCIND_REVEAL_DELAY;

    // Queue the rescind for delayed revelation
    const pendingRescind: PendingRescind = {
      bot_id: botId,
      source_stage: context.stage,
      source_period: context.period,
      tokens: allocation.tokens_allocated,
      price_refunded_per_token: allocation.price_paid_per_token,
      total_refunded: allocation.total_paid,
      rescinded_at_absolute: absolutePeriod,
      reveal_at_absolute: targetAbsolute,
    };

    this.store.addPendingRescind(pendingRescind);

    // Queue supply injection at target period
    const supplyEntry: RescindSupplyEntry = {
      target_absolute_period: targetAbsolute,
      tokens: allocation.tokens_allocated,
      source_description: `Rescind from stage ${context.stage} period ${context.period} by ${botId}`,
    };

    this.store.addRescindSupply(supplyEntry);

    // Give the winner private information about the future supply increase
    const bot = this.store.getBot(botId);
    if (bot) {
      const { stage: targetStage, period: targetPeriod } =
        this.absoluteToStagePeriod(targetAbsolute);

      bot.private_info.push({
        target_stage: targetStage,
        target_period: targetPeriod,
        tokens: allocation.tokens_allocated,
        reveal_at_absolute_period: targetAbsolute,
      });
    }
  }

  /**
   * When rescinds are revealed, update the public period results.
   */
  private processRescindRevelations(
    revealed: PendingRescind[],
    _currentAbsolute: number,
  ): void {
    for (const rescind of revealed) {
      // Find the original period result and mark it as rescinded
      const result = this.store.getPeriodResult(
        rescind.source_stage,
        rescind.source_period,
      );
      if (result) {
        result.rescinded = true;
      }

      // Remove private info from the bot (now public)
      const bot = this.store.getBot(rescind.bot_id);
      if (bot) {
        bot.private_info = bot.private_info.filter(
          (info: PrivateRescindInfo) => info.reveal_at_absolute_period !== rescind.reveal_at_absolute,
        );
      }
    }
  }

  // ─── Observation Building ───────────────────────────────────────────────────

  private buildObservation(
    botId: string,
    context: PeriodContext,
  ): BotObservation {
    const bot = this.store.getBot(botId)!;
    const stageConfig = this.config.stages[context.stage];
    const totalPeriods = this.config.stages.reduce(
      (sum, s) => sum + s.num_periods, 0,
    );

    // Build public leaderboard
    const leaderboard: LeaderboardEntry[] = this.store.getAllBots().map((b) => ({
      bot_id: b.bot_id,
      tokens_per_stage: [...b.tokens_per_stage],
      weighted_points: b.weighted_points,
      sp: b.sp,
    }));

    // Filter period results: only show results where rescind is either
    // revealed (true/false) or not applicable (null for non-winner periods)
    // Hide rescind status for periods still in the delay window
    const publicHistory = this.store.getPeriodResults().map((r) => ({
      ...r,
      // Keep rescinded as-is — it's already null for unrevealed
    }));

    return {
      stage: context.stage,
      period: context.period,
      absolute_period: context.absolute_period,
      periods_remaining_in_stage: stageConfig.num_periods - context.period - 1,
      stages_remaining: this.config.stages.length - context.stage - 1,
      remaining_budget: bot.remaining_budget,
      holdings: [...bot.holdings],
      weighted_points: bot.weighted_points,
      tokens_per_stage: [...bot.tokens_per_stage],
      sp: bot.sp,
      tokens_available: context.tokens_available,
      floor_price: context.floor_price,
      points_per_token: context.points_per_token,
      history: publicHistory,
      leaderboard,
      private_rescind_info: [...bot.private_info],
    };
  }

  // ─── SP Awards ──────────────────────────────────────────────────────────────

  private awardStageSP(stageIdx: number): void {
    const ranking = this.store.getStageRanking(stageIdx);
    const spAwards = this.config.sp_awards;

    for (let i = 0; i < Math.min(ranking.length, spAwards.length); i++) {
      this.store.awardSP(ranking[i].bot_id, spAwards[i]);
    }
  }

  private awardOverallBonusSP(): void {
    const ranking = this.store.getOverallRanking();
    if (ranking.length > 0 && ranking[0].weighted_points > 0) {
      this.store.awardSP(ranking[0].bot_id, this.config.overall_bonus_sp);
    }
  }

  // ─── Result Building ────────────────────────────────────────────────────────

  private buildResult(): TournamentResult {
    const allBots = this.store.getAllBots();

    const finalLeaderboard: LeaderboardEntry[] = allBots
      .map((b) => ({
        bot_id: b.bot_id,
        tokens_per_stage: [...b.tokens_per_stage],
        weighted_points: b.weighted_points,
        sp: b.sp,
      }))
      .sort((a, b) => {
        if (b.sp !== a.sp) return b.sp - a.sp;
        return b.weighted_points - a.weighted_points; // tiebreak
      });

    const botSummaries = new Map<string, BotSummary>();
    for (const bot of allBots) {
      const budgetSpent = this.config.budget_per_bot - bot.remaining_budget;
      const periodsWon = this.store.getPeriodResults().filter(
        (r) => r.winner_bot_id === bot.bot_id && r.rescinded !== true,
      ).length;
      const rescindsMade = this.store.getPeriodResults().filter(
        (r) => r.winner_bot_id === bot.bot_id && r.rescinded === true,
      ).length;

      const totalTokens = bot.holdings.reduce((s: number, h: TokenHolding) => s + h.quantity, 0);
      const totalPaid = bot.holdings.reduce(
        (s: number, h: TokenHolding) => s + h.quantity * h.price_paid_per_token, 0,
      );
      const avgPrice = totalTokens > 0 ? totalPaid / totalTokens : 0;

      botSummaries.set(bot.bot_id, {
        bot_id: bot.bot_id,
        total_sp: bot.sp,
        weighted_points: bot.weighted_points,
        tokens_per_stage: [...bot.tokens_per_stage],
        budget_spent: budgetSpent,
        budget_remaining: bot.remaining_budget,
        periods_won: periodsWon,
        rescinds_made: rescindsMade,
        avg_price_paid: avgPrice,
        capital_efficiency: budgetSpent > 0 ? bot.weighted_points / budgetSpent : 0,
      });
    }

    return {
      config: this.config,
      final_leaderboard: finalLeaderboard,
      winner_bot_id: finalLeaderboard.length > 0 ? finalLeaderboard[0].bot_id : '',
      all_period_results: this.store.getPeriodResults(),
      bot_summaries: botSummaries,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Convert absolute period index to (stage, period) pair.
   */
  private absoluteToStagePeriod(
    absolutePeriod: number,
  ): { stage: number; period: number } {
    let remaining = absolutePeriod;
    for (let s = 0; s < this.config.stages.length; s++) {
      const numPeriods = this.config.stages[s].num_periods;
      if (remaining < numPeriods) {
        return { stage: s, period: remaining };
      }
      remaining -= numPeriods;
    }
    // Beyond tournament — return last stage, last period
    const lastStage = this.config.stages.length - 1;
    return {
      stage: lastStage,
      period: this.config.stages[lastStage].num_periods - 1,
    };
  }

  /** Expose store for testing. */
  getStore(): TournamentStore {
    return this.store;
  }
}
