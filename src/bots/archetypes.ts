import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
} from '../models/types';
import { SeededRandom } from '../utils/random';

// ─── Base Class ─────────────────────────────────────────────────────────────────

/**
 * Base for all stochastic bots. Provides seeded randomness and common helpers.
 */
abstract class StochasticBot implements BotAgent {
  readonly bot_id: string;
  protected rng: SeededRandom;

  constructor(bot_id: string, seed: number) {
    this.bot_id = bot_id;
    this.rng = new SeededRandom(seed);
  }

  abstract decideBids(obs: BotObservation): BotBidDecision;
  abstract decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision;

  /** Clamp a bid price to be at least floor and affordable. */
  protected clampBid(price: number, obs: BotObservation): number | null {
    if (price < obs.floor_price) return null;
    const maxAffordable = obs.remaining_budget / obs.tokens_available;
    if (maxAffordable < obs.floor_price) return null;
    return Math.min(price, maxAffordable);
  }

  /** Average clearing price from history for a given stage. */
  protected avgStagePrice(obs: BotObservation, stage?: number): number {
    const targetStage = stage ?? obs.stage;
    const filled = obs.history.filter(
      (h) => h.stage === targetStage && h.allocations.length > 0,
    );
    if (filled.length === 0) return obs.floor_price;
    return filled.reduce((s, h) => s + h.clearing_price, 0) / filled.length;
  }

  /** How many tokens does a bot have in a stage from the leaderboard. */
  protected getLeaderTokens(obs: BotObservation, botId: string, stage: number): number {
    const entry = obs.leaderboard.find((e) => e.bot_id === botId);
    return entry?.tokens_per_stage[stage] ?? 0;
  }

  /** My rank in the current stage (0-indexed). */
  protected myStageRank(obs: BotObservation): number {
    const myTokens = obs.tokens_per_stage[obs.stage];
    const sorted = obs.leaderboard
      .map((e) => e.tokens_per_stage[obs.stage])
      .sort((a, b) => b - a);
    const rank = sorted.findIndex((t) => t <= myTokens);
    return rank >= 0 ? rank : sorted.length;
  }
}

// ─── Archetype 1: Aggressive Early Bird ─────────────────────────────────────────

/**
 * Spends heavily in stages 1 and 2, lighter in stage 3.
 * Bids with a noisy markup above floor. Occasionally rescinds if overpaid.
 *
 * Parameters (randomized per instance):
 * - baseMarkup: 1.5 to 4.0 (how much above floor)
 * - noiseStddev: 0.3 to 1.0 (bid jitter)
 * - stage1Weight: 0.4 to 0.6 (budget fraction for stage 1)
 * - rescindThreshold: 1.15 to 1.35 (rescind if paid > threshold × floor)
 */
export class AggressiveEarlyBird extends StochasticBot {
  private baseMarkup: number;
  private noiseStddev: number;
  private stageBudgets: number[];
  private rescindThreshold: number;

  constructor(id: string, seed: number, totalBudget: number) {
    super(id, seed);
    this.baseMarkup = this.rng.range(1.5, 4.0);
    this.noiseStddev = this.rng.range(0.3, 1.0);
    this.rescindThreshold = this.rng.range(1.15, 1.35);

    const s1w = this.rng.range(0.4, 0.6);
    const s2w = this.rng.range(0.2, 0.35);
    const s3w = 1 - s1w - s2w;
    this.stageBudgets = [s1w * totalBudget, s2w * totalBudget, s3w * totalBudget];
  }

  decideBids(obs: BotObservation): BotBidDecision {
    // Check soft budget for this stage
    const spent = obs.holdings
      .filter((h) => h.stage === obs.stage)
      .reduce((s, h) => s + h.quantity * h.price_paid_per_token, 0);
    const stageBudgetLeft = this.stageBudgets[obs.stage] - spent;
    if (stageBudgetLeft < obs.floor_price * obs.tokens_available * 0.5) {
      // Running low on stage budget — skip or bid conservatively
      if (this.rng.chance(0.6)) return { bids: [] };
    }

    const noise = this.rng.gaussian(0, this.noiseStddev);
    const price = obs.floor_price + this.baseMarkup + noise;
    const clamped = this.clampBid(price, obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
    const overpay = winResult.clearing_price / obs.floor_price;
    if (overpay > this.rescindThreshold && this.rng.chance(0.7)) {
      return { rescind: true };
    }
    return { rescind: false };
  }
}

// ─── Archetype 2: Patient Sniper ────────────────────────────────────────────────

/**
 * Skips or bids minimally in early stages, concentrates budget in stage 3.
 * In the target stage, bids aggressively with noise.
 *
 * Parameters:
 * - targetStage: 1 or 2 (0-indexed), weighted toward 2
 * - earlyBidProb: 0.05 to 0.2 (small chance of bidding early)
 * - aggressiveness: 2.0 to 6.0 (markup in target stage)
 */
export class PatientSniper extends StochasticBot {
  private targetStage: number;
  private earlyBidProb: number;
  private aggressiveness: number;

  constructor(id: string, seed: number) {
    super(id, seed);
    this.targetStage = this.rng.chance(0.7) ? 2 : 1;
    this.earlyBidProb = this.rng.range(0.05, 0.2);
    this.aggressiveness = this.rng.range(2.0, 6.0);
  }

  decideBids(obs: BotObservation): BotBidDecision {
    if (obs.stage < this.targetStage) {
      // Occasionally bid early to throw off competitors
      if (!this.rng.chance(this.earlyBidProb)) return { bids: [] };
      const lowBid = obs.floor_price + this.rng.range(0.1, 0.5);
      const clamped = this.clampBid(lowBid, obs);
      if (!clamped) return { bids: [] };
      return { bids: [{ price_per_token: clamped }] };
    }

    // Target stage: go aggressive
    const noise = this.rng.gaussian(0, 1.0);
    const price = obs.floor_price + this.aggressiveness + noise;
    const clamped = this.clampBid(price, obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(): BotRescindDecision {
    // Snipers keep what they win
    return { rescind: false };
  }
}

// ─── Archetype 3: Adaptive Tracker ──────────────────────────────────────────────

/**
 * Tracks clearing price trends and bids slightly above the moving average.
 * Adjusts aggressiveness based on stage competition and budget remaining.
 *
 * Parameters:
 * - trackingMultiplier: 1.01 to 1.10 (how far above avg to bid)
 * - coldStartMarkup: 0.5 to 2.0 (first-period bid when no history)
 * - rescindOverpayThreshold: 1.10 to 1.30
 * - budgetConservatism: 0.2 to 0.5 (reserve this fraction for later stages)
 */
export class AdaptiveTracker extends StochasticBot {
  private trackingMultiplier: number;
  private coldStartMarkup: number;
  private rescindThreshold: number;
  private budgetConservatism: number;

  constructor(id: string, seed: number) {
    super(id, seed);
    this.trackingMultiplier = this.rng.range(1.01, 1.10);
    this.coldStartMarkup = this.rng.range(0.5, 2.0);
    this.rescindThreshold = this.rng.range(1.10, 1.30);
    this.budgetConservatism = this.rng.range(0.2, 0.5);
  }

  decideBids(obs: BotObservation): BotBidDecision {
    // Reserve budget for future stages
    const stagesLeft = obs.stages_remaining + 1;
    const reservePerStage = (obs.remaining_budget * this.budgetConservatism) / stagesLeft;
    const availableNow = obs.remaining_budget - reservePerStage * obs.stages_remaining;
    const maxAffordable = availableNow / obs.tokens_available;

    if (maxAffordable < obs.floor_price) return { bids: [] };

    let price: number;
    const avgPrice = this.avgStagePrice(obs);

    if (obs.period === 0 && obs.history.filter((h) => h.stage === obs.stage).length === 0) {
      // Cold start
      price = obs.floor_price + this.coldStartMarkup + this.rng.gaussian(0, 0.3);
    } else {
      // Track average with noise
      price = avgPrice * this.trackingMultiplier + this.rng.gaussian(0, 0.5);
    }

    const clamped = this.clampBid(Math.min(price, maxAffordable), obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
    const overpay = winResult.clearing_price / obs.floor_price;
    if (overpay > this.rescindThreshold) {
      return { rescind: this.rng.chance(0.6) };
    }
    return { rescind: false };
  }
}

// ─── Archetype 4: Balanced Spreader ─────────────────────────────────────────────

/**
 * Attempts to win roughly equal SP across all stages.
 * Monitors its rank and adjusts bidding intensity accordingly.
 *
 * Parameters:
 * - baseMarkup: 1.0 to 3.0
 * - urgencyMultiplier: 1.5 to 3.0 (how much extra when behind)
 * - passChanceWhenLeading: 0.3 to 0.6 (save budget when already ahead)
 */
export class BalancedSpreader extends StochasticBot {
  private baseMarkup: number;
  private urgencyMultiplier: number;
  private passWhenLeading: number;

  constructor(id: string, seed: number) {
    super(id, seed);
    this.baseMarkup = this.rng.range(1.0, 3.0);
    this.urgencyMultiplier = this.rng.range(1.5, 3.0);
    this.passWhenLeading = this.rng.range(0.3, 0.6);
  }

  decideBids(obs: BotObservation): BotBidDecision {
    const rank = this.myStageRank(obs);

    // If leading the stage, sometimes pass to save budget
    if (rank === 0 && this.rng.chance(this.passWhenLeading)) {
      return { bids: [] };
    }

    // If behind, bid more aggressively
    let markup = this.baseMarkup;
    if (rank > 0) {
      markup *= this.urgencyMultiplier;
    }

    const noise = this.rng.gaussian(0, 0.5);
    const price = obs.floor_price + markup + noise;
    const clamped = this.clampBid(price, obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(): BotRescindDecision {
    // Spreaders keep tokens to maintain rank
    return { rescind: false };
  }
}

// ─── Archetype 5: Information Exploiter ─────────────────────────────────────────

/**
 * Designed to exploit the rescind mechanic. Wins periods cheaply, rescinds
 * frequently, then uses the private information window to bid strategically.
 *
 * Parameters:
 * - rescindProbability: 0.4 to 0.8 (how often to rescind wins)
 * - discountWhenKnowingSupply: 0.7 to 0.9 (bid less when expecting supply glut)
 * - baseMarkup: 2.0 to 4.0
 */
export class InformationExploiter extends StochasticBot {
  private rescindProb: number;
  private discountFactor: number;
  private baseMarkup: number;

  constructor(id: string, seed: number) {
    super(id, seed);
    this.rescindProb = this.rng.range(0.4, 0.8);
    this.discountFactor = this.rng.range(0.7, 0.9);
    this.baseMarkup = this.rng.range(2.0, 4.0);
  }

  decideBids(obs: BotObservation): BotBidDecision {
    let markup = this.baseMarkup;

    // If we have private info about future supply increase, bid less aggressively
    // (we know supply is coming, so we can afford to wait or underbid)
    if (obs.private_rescind_info.length > 0) {
      markup *= this.discountFactor;
    }

    const noise = this.rng.gaussian(0, 0.8);
    const price = obs.floor_price + markup + noise;
    const clamped = this.clampBid(price, obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
    // Don't rescind in the last few periods of a stage (want to keep tokens for ranking)
    if (obs.periods_remaining_in_stage <= 2) {
      return { rescind: false };
    }

    // Don't rescind if we're neck and neck for the stage lead
    if (this.myStageRank(obs) <= 1 && obs.periods_remaining_in_stage <= 4) {
      return { rescind: false };
    }

    return { rescind: this.rng.chance(this.rescindProb) };
  }
}

// ─── Archetype 6: Chaos Agent ───────────────────────────────────────────────────

/**
 * Highly unpredictable. Randomly switches between aggressive and passive.
 * Injects noise into the tournament and tests robustness of other strategies.
 *
 * Parameters:
 * - bidProbability: 0.3 to 0.8 (chance of bidding in any period)
 * - priceRange: [floor, floor + 8.0] (uniform random bid in range)
 * - rescindProbability: 0.2 to 0.5
 */
export class ChaosAgent extends StochasticBot {
  private bidProb: number;
  private maxMarkup: number;
  private rescindProb: number;

  constructor(id: string, seed: number) {
    super(id, seed);
    this.bidProb = this.rng.range(0.3, 0.8);
    this.maxMarkup = this.rng.range(3.0, 8.0);
    this.rescindProb = this.rng.range(0.2, 0.5);
  }

  decideBids(obs: BotObservation): BotBidDecision {
    if (!this.rng.chance(this.bidProb)) return { bids: [] };

    const price = obs.floor_price + this.rng.range(0.1, this.maxMarkup);
    const clamped = this.clampBid(price, obs);
    if (!clamped) return { bids: [] };
    return { bids: [{ price_per_token: clamped }] };
  }

  decideRescind(): BotRescindDecision {
    return { rescind: this.rng.chance(this.rescindProb) };
  }
}

// ─── Bot Factory ────────────────────────────────────────────────────────────────

export type BotArchetype =
  | 'aggressive_early'
  | 'patient_sniper'
  | 'adaptive_tracker'
  | 'balanced_spreader'
  | 'info_exploiter'
  | 'chaos_agent';

export const ALL_ARCHETYPES: BotArchetype[] = [
  'aggressive_early',
  'patient_sniper',
  'adaptive_tracker',
  'balanced_spreader',
  'info_exploiter',
  'chaos_agent',
];

/**
 * Create a bot instance of the given archetype with a unique seed.
 */
export function createBot(
  archetype: BotArchetype,
  id: string,
  seed: number,
  budget: number = 10_000,
): BotAgent {
  switch (archetype) {
    case 'aggressive_early':
      return new AggressiveEarlyBird(id, seed, budget);
    case 'patient_sniper':
      return new PatientSniper(id, seed);
    case 'adaptive_tracker':
      return new AdaptiveTracker(id, seed);
    case 'balanced_spreader':
      return new BalancedSpreader(id, seed);
    case 'info_exploiter':
      return new InformationExploiter(id, seed);
    case 'chaos_agent':
      return new ChaosAgent(id, seed);
  }
}
