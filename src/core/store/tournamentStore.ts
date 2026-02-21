import {
  TournamentState,
  TournamentConfig,
  BotState,
  PeriodResult,
  PendingRescind,
  RescindSupplyEntry,
  Bid,
  TokenHolding,
} from '../../models/types';

/**
 * In-memory store for tournament state.
 * Single source of truth during a simulation run.
 */
export class TournamentStore {
  private state: TournamentState;

  constructor(config: TournamentConfig, botIds: string[]) {
    const tokensPerStage = new Array(config.stages.length).fill(0);

    const bots = new Map<string, BotState>();
    for (const id of botIds) {
      bots.set(id, {
        bot_id: id,
        remaining_budget: config.budget_per_bot,
        holdings: [],
        weighted_points: 0,
        tokens_per_stage: [...tokensPerStage],
        sp: 0,
        private_info: [],
      });
    }

    this.state = {
      config,
      phase: 'not_started',
      current_stage: -1,
      current_period: -1,
      bots,
      period_results: [],
      pending_rescinds: [],
      rescind_supply_queue: [],
    };
  }

  // ── State Access ────────────────────────────────────────────────────────

  getState(): Readonly<TournamentState> {
    return this.state;
  }

  getConfig(): TournamentConfig {
    return this.state.config;
  }

  getBot(botId: string): BotState | undefined {
    return this.state.bots.get(botId);
  }

  getAllBots(): BotState[] {
    return Array.from(this.state.bots.values());
  }

  getBotIds(): string[] {
    return Array.from(this.state.bots.keys());
  }

  // ── Phase Management ────────────────────────────────────────────────────

  setPhase(phase: TournamentState['phase']): void {
    this.state.phase = phase;
  }

  setCurrentStage(stage: number): void {
    this.state.current_stage = stage;
  }

  setCurrentPeriod(period: number): void {
    this.state.current_period = period;
  }

  // ── Budget ──────────────────────────────────────────────────────────────

  deductBudget(botId: string, amount: number): void {
    const bot = this.state.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    if (bot.remaining_budget < amount) {
      throw new Error(
        `Bot ${botId} cannot afford ${amount} (has ${bot.remaining_budget})`,
      );
    }
    bot.remaining_budget -= amount;
  }

  refundBudget(botId: string, amount: number): void {
    const bot = this.state.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    bot.remaining_budget += amount;
  }

  // ── Holdings ────────────────────────────────────────────────────────────

  addHolding(botId: string, holding: TokenHolding): void {
    const bot = this.state.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    bot.holdings.push(holding);
    bot.tokens_per_stage[holding.stage] += holding.quantity;
    bot.weighted_points += holding.quantity * holding.points_per_token;
  }

  removeHolding(botId: string, stage: number, period: number): TokenHolding | undefined {
    const bot = this.state.bots.get(botId);
    if (!bot) return undefined;
    const idx = bot.holdings.findIndex(
      (h: TokenHolding) => h.stage === stage && h.period === period,
    );
    if (idx === -1) return undefined;
    const [removed] = bot.holdings.splice(idx, 1);
    bot.tokens_per_stage[removed.stage] -= removed.quantity;
    bot.weighted_points -= removed.quantity * removed.points_per_token;
    return removed;
  }

  // ── Period Results ──────────────────────────────────────────────────────

  addPeriodResult(result: PeriodResult): void {
    this.state.period_results.push(result);
  }

  getPeriodResults(): PeriodResult[] {
    return this.state.period_results;
  }

  getPeriodResult(stage: number, period: number): PeriodResult | undefined {
    return this.state.period_results.find(
      (r: PeriodResult) => r.stage === stage && r.period === period,
    );
  }

  // ── Rescinds ────────────────────────────────────────────────────────────

  addPendingRescind(rescind: PendingRescind): void {
    this.state.pending_rescinds.push(rescind);
  }

  /**
   * Reveal all rescinds that should become public at the given absolute period.
   * Returns the revealed rescinds and removes them from pending.
   */
  revealRescinds(atAbsolutePeriod: number): PendingRescind[] {
    const toReveal = this.state.pending_rescinds.filter(
      (r: PendingRescind) => r.reveal_at_absolute <= atAbsolutePeriod,
    );
    this.state.pending_rescinds = this.state.pending_rescinds.filter(
      (r: PendingRescind) => r.reveal_at_absolute > atAbsolutePeriod,
    );
    return toReveal;
  }

  getPendingRescinds(): PendingRescind[] {
    return this.state.pending_rescinds;
  }

  // ── Rescind Supply Queue ────────────────────────────────────────────────

  addRescindSupply(entry: RescindSupplyEntry): void {
    this.state.rescind_supply_queue.push(entry);
  }

  /**
   * Get extra supply from rescinds targeting a specific absolute period.
   */
  getRescindSupplyForPeriod(absolutePeriod: number): number {
    return this.state.rescind_supply_queue
      .filter((e: RescindSupplyEntry) => e.target_absolute_period === absolutePeriod)
      .reduce((sum: number, e: RescindSupplyEntry) => sum + e.tokens, 0);
  }

  // ── SP Awards ───────────────────────────────────────────────────────────

  awardSP(botId: string, points: number): void {
    const bot = this.state.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    bot.sp += points;
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────

  /**
   * Get stage ranking by raw token count for a specific stage.
   * Returns bot IDs in descending order of tokens held in that stage.
   */
  getStageRanking(stage: number): { bot_id: string; tokens: number }[] {
    return this.getAllBots()
      .map((bot) => ({
        bot_id: bot.bot_id,
        tokens: bot.tokens_per_stage[stage] ?? 0,
      }))
      .filter((e) => e.tokens > 0)
      .sort((a, b) => {
        if (b.tokens !== a.tokens) return b.tokens - a.tokens;
        return a.bot_id.localeCompare(b.bot_id); // deterministic tiebreak
      });
  }

  /**
   * Get overall ranking by weighted points.
   */
  getOverallRanking(): { bot_id: string; weighted_points: number }[] {
    return this.getAllBots()
      .map((bot) => ({
        bot_id: bot.bot_id,
        weighted_points: bot.weighted_points,
      }))
      .sort((a, b) => {
        if (b.weighted_points !== a.weighted_points)
          return b.weighted_points - a.weighted_points;
        return a.bot_id.localeCompare(b.bot_id);
      });
  }
}
