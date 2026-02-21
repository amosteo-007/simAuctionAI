import Decimal from 'decimal.js';
import {
  ClearingStrategy,
  ClearingStrategyType,
  Bid,
  PeriodClearingResult,
  PeriodAllocation,
} from '../../models/types';

/**
 * Vickrey (Second-Price) Auction Strategy
 *
 * Single-winner mechanism: the highest bidder wins ALL tokens in the period,
 * but pays the second-highest bid price per token.
 *
 * Properties:
 * - Truthful: dominant strategy is to bid true valuation
 * - Single winner per period
 * - Revenue = second-highest bid × supply
 *
 * Edge cases:
 * - Single bid: winner pays floor price (no second price exists)
 * - Tied highest bids: first submitted wins (FIFO tiebreaker)
 * - No bids: no allocation, clearing price = floor
 * - All bids below floor: no allocation
 */
export class VickreyStrategy implements ClearingStrategy {
  readonly type: ClearingStrategyType = 'vickrey';

  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult {
    const floor = new Decimal(floorPrice);

    // Filter bids at or above floor price
    const validBids = bids.filter(
      (b) => new Decimal(b.price_per_token).gte(floor),
    );

    // ── No valid bids ─────────────────────────────────────────────────────
    if (validBids.length === 0) {
      return {
        clearing_price: floorPrice,
        allocations: [],
        total_tokens_allocated: 0,
        metadata: {
          num_bids: bids.length,
          num_valid_bids: 0,
          reason: 'no_valid_bids',
        },
      };
    }

    // ── Sort by price descending, then by submission time (FIFO tiebreak) ─
    const sorted = [...validBids].sort((a, b) => {
      const priceDiff = b.price_per_token - a.price_per_token;
      if (priceDiff !== 0) return priceDiff;
      return a.submitted_at.getTime() - b.submitted_at.getTime();
    });

    const winner = sorted[0];
    const winnerPrice = new Decimal(winner.price_per_token);

    // ── Determine payment price (second-highest or floor) ─────────────────
    let paymentPrice: Decimal;

    if (sorted.length >= 2) {
      // Second-highest bid determines price
      paymentPrice = new Decimal(sorted[1].price_per_token);
    } else {
      // Only one bidder: pays floor price
      paymentPrice = floor;
    }

    // Payment price cannot be below floor
    if (paymentPrice.lt(floor)) {
      paymentPrice = floor;
    }

    // ── Check if winner can afford the full supply at payment price ───────
    const totalCost = paymentPrice.mul(new Decimal(supply));
    const winnerBudgetImplied = winnerPrice.mul(new Decimal(supply));

    // Winner bid price_per_token implies willingness to pay up to that price.
    // The actual cost is payment_price × supply. We check this against the
    // bot's budget upstream in the engine, but here we just compute the allocation.
    const tokensAllocated = supply;
    const pricePerToken = paymentPrice.toNumber();
    const totalPaid = totalCost.toNumber();

    const allocation: PeriodAllocation = {
      bot_id: winner.bot_id,
      tokens_allocated: tokensAllocated,
      price_paid_per_token: pricePerToken,
      total_paid: totalPaid,
    };

    return {
      clearing_price: pricePerToken,
      allocations: [allocation],
      total_tokens_allocated: tokensAllocated,
      metadata: {
        num_bids: bids.length,
        num_valid_bids: validBids.length,
        highest_bid: winnerPrice.toNumber(),
        second_highest_bid: paymentPrice.toNumber(),
        winner_bot_id: winner.bot_id,
        winner_surplus: winnerPrice.minus(paymentPrice).toNumber(),
      },
    };
  }
}
