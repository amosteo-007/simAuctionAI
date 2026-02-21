import Decimal from 'decimal.js';

// Configure Decimal for financial precision
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

// ─── ID Helper ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
export function generateId(prefix = ''): string {
  _idCounter++;
  const ts = Date.now().toString(36);
  const count = _idCounter.toString(36).padStart(4, '0');
  return prefix ? `${prefix}_${ts}${count}` : `${ts}${count}`;
}

/** Reset counter (for deterministic tests). */
export function resetIdCounter(): void {
  _idCounter = 0;
}

// ─── Tournament Configuration ───────────────────────────────────────────────────

/**
 * A Tournament is the top-level container: 3 stages, scored by Stage Points (SP).
 */
export interface TournamentConfig {
  /** Human-readable name for this tournament. */
  name: string;

  /** Starting budget per bot (shared across all stages, does not reset). */
  budget_per_bot: number;

  /** Stage definitions in order. */
  stages: StageConfig[];

  /** SP awarded per stage: index 0 = 1st place, etc. Default: [3, 2, 1]. */
  sp_awards: number[];

  /** Bonus SP for highest cumulative weighted points across all stages. */
  overall_bonus_sp: number;
}

export interface StageConfig {
  /** Total tokens available in this stage (before rescinds from prior stages). */
  base_token_supply: number;

  /** Points per token for this stage. */
  points_per_token: number;

  /** Floor price per token at start of this stage. */
  floor_price: number;

  /** Number of periods in this stage. Default: 9. */
  num_periods: number;

  /** Duration of each bidding period in seconds (real-time mode). */
  period_duration_seconds: number;

  /** Max bids a bot can submit per period. */
  max_bids_per_period: number;

  /**
   * The clearing strategy to use for this stage.
   * Allows different auction mechanisms per stage.
   */
  clearing_strategy: ClearingStrategyType;
}

// ─── Clearing Strategy Types ────────────────────────────────────────────────────

/**
 * Enumeration of supported clearing mechanisms.
 * New mechanisms are added here and implemented via the ClearingStrategy interface.
 */
export type ClearingStrategyType =
  | 'vickrey'           // Single-winner, pays second-highest price
  | 'uniform_price'     // Multi-winner, everyone pays clearing price (original CCA)
  | 'discriminatory'    // Multi-winner, each pays own bid (pay-as-bid)
  | 'dutch'             // Descending price, first to accept wins
  | 'sealed_first'      // Sealed first-price, highest bid wins at own price
  ;

// ─── Tournament State ───────────────────────────────────────────────────────────

export type TournamentPhase =
  | 'not_started'
  | 'stage_active'
  | 'stage_transition'
  | 'completed';

export interface TournamentState {
  config: TournamentConfig;
  phase: TournamentPhase;
  current_stage: number;        // 0-indexed, -1 if not started
  current_period: number;       // 0-indexed within current stage, -1 if between stages

  /** Per-bot state. Keyed by bot_id. */
  bots: Map<string, BotState>;

  /** All period results across all stages. */
  period_results: PeriodResult[];

  /** Pending rescinds not yet revealed (delayed revelation). */
  pending_rescinds: PendingRescind[];

  /** Accumulated rescind tokens to be added to future periods/stages. */
  rescind_supply_queue: RescindSupplyEntry[];
}

// ─── Bot State ──────────────────────────────────────────────────────────────────

export interface BotState {
  bot_id: string;
  remaining_budget: number;

  /** Tokens held, by stage and period. */
  holdings: TokenHolding[];

  /** Weighted points: sum of (tokens × points_per_token) across all stages. */
  weighted_points: number;

  /** Tokens held per stage (for SP ranking). */
  tokens_per_stage: number[];

  /** Stage Points earned. */
  sp: number;

  /** Private information this bot has (from winning + rescinding). */
  private_info: PrivateRescindInfo[];
}

export interface TokenHolding {
  stage: number;
  period: number;
  quantity: number;
  price_paid_per_token: number;
  points_per_token: number;
}

export interface PrivateRescindInfo {
  /** The stage and period where extra supply will appear. */
  target_stage: number;
  target_period: number;
  tokens: number;
  /** When this info becomes public (absolute period index). */
  reveal_at_absolute_period: number;
}

// ─── Period ─────────────────────────────────────────────────────────────────────

export interface PeriodContext {
  stage: number;
  period: number;

  /** Absolute period index across the tournament (0-26 for 3×9). */
  absolute_period: number;

  /** Tokens available this period (base + any revealed rescinds). */
  tokens_available: number;

  /** Floor price for this period. */
  floor_price: number;

  /** Points per token in this stage. */
  points_per_token: number;
}

// ─── Bids ───────────────────────────────────────────────────────────────────────

export interface Bid {
  id: string;
  bot_id: string;
  stage: number;
  period: number;

  /** Price per token the bot is willing to pay. */
  price_per_token: number;

  /** Total cost = price_per_token × tokens_available (for Vickrey: bidding for entire supply). */
  total_cost: number;

  submitted_at: Date;
}

// ─── Period Result ──────────────────────────────────────────────────────────────

export interface PeriodResult {
  stage: number;
  period: number;
  absolute_period: number;

  tokens_available: number;
  floor_price: number;
  points_per_token: number;

  /** The clearing/winning price (second-highest for Vickrey). */
  clearing_price: number;

  /** Which bot(s) won and their allocations. */
  allocations: PeriodAllocation[];

  /** Whether the winner rescinded (null = not yet revealed). */
  rescinded: boolean | null;

  /** ID of winning bot (for single-winner mechanisms). */
  winner_bot_id: string | null;

  /** All bids submitted (revealed post-clearing for analysis). */
  bids_submitted: Bid[];

  /** Which clearing strategy was used. */
  strategy_used: ClearingStrategyType;
}

export interface PeriodAllocation {
  bot_id: string;
  tokens_allocated: number;
  price_paid_per_token: number;
  total_paid: number;
}

// ─── Rescind ────────────────────────────────────────────────────────────────────

export interface PendingRescind {
  bot_id: string;
  source_stage: number;
  source_period: number;
  tokens: number;
  price_refunded_per_token: number;
  total_refunded: number;

  /** Absolute period when the rescind was made. */
  rescinded_at_absolute: number;

  /** Absolute period when this becomes public and tokens enter supply. */
  reveal_at_absolute: number;
}

export interface RescindSupplyEntry {
  target_absolute_period: number;
  tokens: number;
  source_description: string;
}

// ─── Clearing Strategy Interface (Strategy Pattern) ─────────────────────────────

/**
 * All clearing mechanisms implement this interface.
 * The tournament engine calls `clear()` each period with the collected bids,
 * and the strategy returns the result.
 *
 * To add a new auction mechanism:
 * 1. Add it to ClearingStrategyType
 * 2. Implement the ClearingStrategy interface
 * 3. Register it in the strategy factory
 */
export interface ClearingStrategy {
  readonly type: ClearingStrategyType;

  /**
   * Run the clearing algorithm for a single period.
   *
   * @param bids          - All valid bids submitted in this period
   * @param supply        - Tokens available this period
   * @param floorPrice    - Minimum price (bids below this are rejected upstream)
   * @returns             - Clearing result with price and allocations
   */
  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult;
}

export interface PeriodClearingResult {
  /** The price at which tokens are allocated. */
  clearing_price: number;

  /** Per-bot allocations. */
  allocations: PeriodAllocation[];

  /** Total tokens allocated (may be < supply if under-subscribed). */
  total_tokens_allocated: number;

  /** Metadata for analysis. */
  metadata: Record<string, unknown>;
}

// ─── Bot Interface (what bots implement) ────────────────────────────────────────

/**
 * The state snapshot sent to a bot before each bidding period.
 */
export interface BotObservation {
  /** Current position in the tournament. */
  stage: number;
  period: number;
  absolute_period: number;
  periods_remaining_in_stage: number;
  stages_remaining: number;

  /** This bot's state. */
  remaining_budget: number;
  holdings: TokenHolding[];
  weighted_points: number;
  tokens_per_stage: number[];
  sp: number;

  /** Current period info. */
  tokens_available: number;
  floor_price: number;
  points_per_token: number;

  /** Public history of all completed periods. */
  history: PeriodResult[];

  /** Public leaderboard. */
  leaderboard: LeaderboardEntry[];

  /** Private info (only populated for this bot's own rescinds). */
  private_rescind_info: PrivateRescindInfo[];
}

export interface LeaderboardEntry {
  bot_id: string;
  tokens_per_stage: number[];
  weighted_points: number;
  sp: number;
}

/**
 * What a bot returns as its bidding decision.
 */
export interface BotBidDecision {
  /** Bids to place this period (up to max_bids_per_period). */
  bids: { price_per_token: number }[];
}

/**
 * Rescind decision — only sent to the period winner.
 */
export interface BotRescindDecision {
  rescind: boolean;
}

/**
 * The interface a bot must implement to participate.
 */
export interface BotAgent {
  readonly bot_id: string;

  /**
   * Called at the start of each bidding period.
   * Returns bid(s) for this period.
   */
  decideBids(observation: BotObservation): BotBidDecision;

  /**
   * Called after winning a period.
   * Returns whether to rescind the win.
   */
  decideRescind(
    observation: BotObservation,
    winResult: PeriodResult,
  ): BotRescindDecision;
}

// ─── Experiment / Analysis Types ────────────────────────────────────────────────

export interface TournamentResult {
  config: TournamentConfig;
  final_leaderboard: LeaderboardEntry[];
  winner_bot_id: string;
  all_period_results: PeriodResult[];
  bot_summaries: Map<string, BotSummary>;
}

export interface BotSummary {
  bot_id: string;
  total_sp: number;
  weighted_points: number;
  tokens_per_stage: number[];
  budget_spent: number;
  budget_remaining: number;
  periods_won: number;
  rescinds_made: number;
  avg_price_paid: number;
  capital_efficiency: number; // weighted_points / budget_spent
}
