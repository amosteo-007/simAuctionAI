import Decimal from 'decimal.js';
import {
  ClearingStrategy,
  ClearingStrategyType,
  Bid,
  PeriodClearingResult,
  PeriodAllocation,
} from '../../models/types';

/**
 * Uniform Price Auction Strategy (original CCA mechanism)
 *
 * Multi-winner: all bids at or above the clearing price are filled.
 * Everyone pays the same clearing price (the price at which cumulative
 * demand meets supply). Pro-rata allocation at the margin.
 *
 * In this context, each bid's `price_per_token` is the max they'll pay,
 * and the quantity they want is determined by their total_cost / price_per_token.
 */
export class UniformPriceStrategy implements ClearingStrategy {
  readonly type: ClearingStrategyType = 'uniform_price';

  clear(
    bids: Bid[],
    supply: number,
    floorPrice: number,
  ): PeriodClearingResult {
    const supplyDec = new Decimal(supply);
    const floor = new Decimal(floorPrice);

    // Filter valid bids
    const validBids = bids.filter(
      (b) => new Decimal(b.price_per_token).gte(floor) && b.total_cost > 0,
    );

    if (validBids.length === 0) {
      return {
        clearing_price: floorPrice,
        allocations: [],
        total_tokens_allocated: 0,
        metadata: { reason: 'no_valid_bids' },
      };
    }

    // Build demand entries: each bid wants total_cost / price_per_token tokens
    const entries = validBids.map((b) => ({
      bid: b,
      price: new Decimal(b.price_per_token),
      quantity: new Decimal(b.total_cost).div(new Decimal(b.price_per_token)),
    }));

    // Sort descending by price, FIFO tiebreak
    entries.sort((a, b) => {
      const diff = b.price.minus(a.price).toNumber();
      if (diff !== 0) return diff;
      return a.bid.submitted_at.getTime() - b.bid.submitted_at.getTime();
    });

    // Check total demand
    const totalDemand = entries.reduce(
      (sum, e) => sum.plus(e.quantity),
      new Decimal(0),
    );

    let clearingPrice: Decimal;

    if (totalDemand.lte(supplyDec)) {
      // Under-subscription: fill all at floor
      clearingPrice = floor;
      const allocations: PeriodAllocation[] = entries.map((e) => ({
        bot_id: e.bid.bot_id,
        tokens_allocated: e.quantity.toNumber(),
        price_paid_per_token: floor.toNumber(),
        total_paid: e.quantity.mul(floor).toNumber(),
      }));

      return {
        clearing_price: floor.toNumber(),
        allocations,
        total_tokens_allocated: totalDemand.toNumber(),
        metadata: { reason: 'under_subscribed', total_demand: totalDemand.toNumber() },
      };
    }

    // Over-subscription: find clearing price
    let cumulative = new Decimal(0);
    clearingPrice = floor;

    for (const entry of entries) {
      cumulative = cumulative.plus(entry.quantity);
      if (cumulative.gte(supplyDec)) {
        clearingPrice = entry.price;
        break;
      }
    }

    // Allocate: above clearing → full, at clearing → pro-rata, below → nothing
    const aboveClearing = entries.filter((e) => e.price.gt(clearingPrice));
    const atClearing = entries.filter((e) => e.price.eq(clearingPrice));

    const allocations: PeriodAllocation[] = [];
    let tokensAllocated = new Decimal(0);

    // Full fill for above-clearing bids
    for (const entry of aboveClearing) {
      allocations.push({
        bot_id: entry.bid.bot_id,
        tokens_allocated: entry.quantity.toNumber(),
        price_paid_per_token: clearingPrice.toNumber(),
        total_paid: entry.quantity.mul(clearingPrice).toNumber(),
      });
      tokensAllocated = tokensAllocated.plus(entry.quantity);
    }

    // Pro-rata for at-clearing bids
    const remaining = supplyDec.minus(tokensAllocated);
    if (remaining.gt(0) && atClearing.length > 0) {
      const totalAtClearing = atClearing.reduce(
        (sum, e) => sum.plus(e.quantity),
        new Decimal(0),
      );

      let proRataAllocated = new Decimal(0);
      for (let i = 0; i < atClearing.length; i++) {
        const entry = atClearing[i];
        let tokens: Decimal;

        if (i === atClearing.length - 1) {
          tokens = remaining.minus(proRataAllocated);
        } else {
          const share = entry.quantity.div(totalAtClearing);
          tokens = remaining.mul(share).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN);
        }

        if (tokens.gt(0)) {
          allocations.push({
            bot_id: entry.bid.bot_id,
            tokens_allocated: tokens.toNumber(),
            price_paid_per_token: clearingPrice.toNumber(),
            total_paid: tokens.mul(clearingPrice).toNumber(),
          });
          tokensAllocated = tokensAllocated.plus(tokens);
          proRataAllocated = proRataAllocated.plus(tokens);
        }
      }
    }

    return {
      clearing_price: clearingPrice.toNumber(),
      allocations,
      total_tokens_allocated: tokensAllocated.toNumber(),
      metadata: {
        total_demand: totalDemand.toNumber(),
        num_winners: allocations.length,
      },
    };
  }
}
