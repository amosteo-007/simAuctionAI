import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
} from '../models/types';

/**
 * A bot that defers every decision to an external handler.
 * Used for interactive play (human via CLI) or LLM-prompted play
 * (paste observation to LLM, paste response back).
 *
 * The handler is set before each period by the interactive runner.
 * If no handler is set, the bot skips bidding and keeps tokens.
 */
export class HumanProxyBot implements BotAgent {
  readonly bot_id: string;

  private bidHandler:
    | ((obs: BotObservation) => BotBidDecision)
    | null = null;

  private rescindHandler:
    | ((obs: BotObservation, result: PeriodResult) => BotRescindDecision)
    | null = null;

  constructor(id: string) {
    this.bot_id = id;
  }

  setBidHandler(fn: (obs: BotObservation) => BotBidDecision): void {
    this.bidHandler = fn;
  }

  setRescindHandler(
    fn: (obs: BotObservation, result: PeriodResult) => BotRescindDecision,
  ): void {
    this.rescindHandler = fn;
  }

  clearHandlers(): void {
    this.bidHandler = null;
    this.rescindHandler = null;
  }

  decideBids(obs: BotObservation): BotBidDecision {
    if (this.bidHandler) return this.bidHandler(obs);
    return { bids: [] };
  }

  decideRescind(obs: BotObservation, winResult: PeriodResult): BotRescindDecision {
    if (this.rescindHandler) return this.rescindHandler(obs, winResult);
    return { rescind: false };
  }
}
