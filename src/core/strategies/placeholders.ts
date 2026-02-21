import {
  ClearingStrategy,
  ClearingStrategyType,
  Bid,
  PeriodClearingResult,
} from '../../models/types';

/**
 * Discriminatory (Pay-As-Bid) Auction Strategy — PLACEHOLDER
 *
 * Multi-winner: all bids above clearing price are filled.
 * Each winner pays their OWN bid price (not a uniform price).
 *
 * Strategic implications:
 * - Bots are incentivized to shade bids downward
 * - No dominant strategy truthfulness
 * - Revenue can be higher or lower than uniform price depending on shading
 *
 * TODO: Implement fully for simulation experiments.
 */
export class DiscriminatoryStrategy implements ClearingStrategy {
  readonly type: ClearingStrategyType = 'discriminatory';

  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult {
    // TODO: Implement discriminatory (pay-as-bid) auction
    // Key differences from uniform price:
    // 1. Sort bids descending by price
    // 2. Fill from highest bid down until supply exhausted
    // 3. Each winner pays their own bid price (no uniform clearing price)
    // 4. Pro-rata at the marginal price if needed
    // 5. "clearing_price" in the result represents the lowest accepted bid
    throw new Error(
      'DiscriminatoryStrategy not yet implemented. ' +
      'See uniformPrice.ts for reference implementation pattern.',
    );
  }
}

/**
 * Dutch Auction Strategy — PLACEHOLDER
 *
 * Descending price auction: price starts high and drops over time.
 * First bot to accept the current price wins.
 *
 * In a discrete-period simulation, this works differently:
 * - Period 1: price = ceiling, bots decide accept/pass
 * - If no one accepts, Period 2: price drops by decrement
 * - Continue until someone accepts or floor is reached
 *
 * Strategic implications:
 * - Equivalent to first-price sealed bid in theory
 * - Creates urgency: wait too long and someone else accepts
 * - In simulation, requires a different period structure (many short rounds)
 *
 * TODO: Implement with configurable ceiling, decrement, and tick duration.
 */
export class DutchAuctionStrategy implements ClearingStrategy {
  readonly type: ClearingStrategyType = 'dutch';

  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult {
    // TODO: Implement Dutch auction
    // Design considerations:
    // 1. Requires `ceiling_price` and `price_decrement` in config
    // 2. Each "period" represents a price tick, not a time window
    // 3. Bots submit accept/pass decisions, not price bids
    // 4. The BotBidDecision interface may need extension for Dutch auctions
    //    (e.g., { action: 'accept' | 'pass' } instead of { price_per_token })
    // 5. Multiple bots accepting at same price → FIFO or random tiebreak
    throw new Error(
      'DutchAuctionStrategy not yet implemented. ' +
      'Requires changes to the BotBidDecision interface for accept/pass semantics.',
    );
  }
}

/**
 * Sealed First-Price Auction Strategy — PLACEHOLDER
 *
 * Single-winner: highest bidder wins and pays their own bid.
 * Like Vickrey but winner pays first price, not second.
 *
 * Strategic implications:
 * - NOT truthful: bots should shade bids below true valuation
 * - Winner's curse is a real concern
 * - Simpler than Vickrey to understand but harder to bid optimally
 *
 * TODO: Implement (straightforward — copy Vickrey, change payment rule).
 */
export class SealedFirstPriceStrategy implements ClearingStrategy {
  readonly type: ClearingStrategyType = 'sealed_first';

  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult {
    // TODO: Implement sealed first-price auction
    // Almost identical to Vickrey except:
    // 1. Winner pays their OWN bid price (not second-highest)
    // 2. clearing_price = winner's bid
    // 3. No truthfulness guarantee, so bot strategies differ significantly
    throw new Error(
      'SealedFirstPriceStrategy not yet implemented. ' +
      'See vickrey.ts — change payment rule from second-price to first-price.',
    );
  }
}
