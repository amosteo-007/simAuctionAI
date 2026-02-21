import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
} from '../models/types';

export class GeminiBot implements BotAgent {
  readonly bot_id: string;

  constructor(id: string) {
    this.bot_id = id;
  }

  decideBids(obs: BotObservation): BotBidDecision {
    const { stage, period, remaining_budget, tokens_available, floor_price, leaderboard } = obs;
    const absPeriod = (stage * 9) + period;

    // 1. Check our standing. Are we losing?
    const mySP = obs.sp || 0;
    const maxSP = Math.max(...leaderboard.map(b => b.sp || 0));
    const isLosing = mySP < maxSP || absPeriod > 18;

    // 2. Aggressive Multipliers
    let multiplier = 1.3;

    if (stage === 1) multiplier = 1.6;
    if (stage === 2) {
      const periodsLeft = 9 - period;
      const maxBid = (remaining_budget / (tokens_available * periodsLeft));
      multiplier = Math.max(2.0, maxBid / floor_price);
    }

    // 3. The Taxman
    if (stage === 0 && !isLosing) {
      multiplier = 1.4;
    }

    let bidPrice = floor_price * multiplier;

    if (bidPrice * tokens_available > remaining_budget) {
      bidPrice = remaining_budget / tokens_available;
    }

    return bidPrice >= floor_price ? { bids: [{ price_per_token: bidPrice }] } : { bids: [] };
  }

  decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
    const { stage, period, floor_price, tokens_per_stage, leaderboard } = obs;
    const pricePaid = winResult.clearing_price;

    if (stage === 2) return { rescind: false };

    const myStageTokens = tokens_per_stage[stage] || 0;
    const topComp = Math.max(...leaderboard.filter(b => b.bot_id !== this.bot_id).map(b => b.tokens_per_stage[stage] || 0));
    const tokensLeft = ([100, 67, 33][stage]) * (8 - period);

    if (myStageTokens > topComp + tokensLeft) return { rescind: true };
    if (pricePaid > floor_price * 2.0) return { rescind: true };

    return { rescind: false };
  }
}
