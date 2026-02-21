import { UniformPriceStrategy } from '../src/core/strategies/uniformPrice';
import { Bid } from '../src/models/types';

function makeBid(
  bot_id: string,
  price: number,
  totalCost: number,
  msOffset = 0,
): Bid {
  return {
    id: `bid_${bot_id}`,
    bot_id,
    stage: 0,
    period: 0,
    price_per_token: price,
    total_cost: totalCost,
    submitted_at: new Date(1000 + msOffset),
  };
}

describe('UniformPriceStrategy', () => {
  const strategy = new UniformPriceStrategy();

  test('type is uniform_price', () => {
    expect(strategy.type).toBe('uniform_price');
  });

  test('no bids → empty result at floor', () => {
    const result = strategy.clear([], 100, 10);
    expect(result.clearing_price).toBe(10);
    expect(result.allocations).toHaveLength(0);
  });

  test('under-subscription → all fill at floor', () => {
    const bids = [
      makeBid('A', 15, 150), // wants 10 tokens at $15
      makeBid('B', 12, 120), // wants 10 tokens at $12
    ];
    const result = strategy.clear(bids, 100, 10); // 100 supply, only 20 demanded

    expect(result.clearing_price).toBe(10); // floor
    expect(result.allocations).toHaveLength(2);
    expect(result.total_tokens_allocated).toBeCloseTo(20, 4);
  });

  test('over-subscription → clearing price set by marginal bid', () => {
    const bids = [
      makeBid('A', 15, 750),  // wants 50 tokens
      makeBid('B', 12, 600),  // wants 50 tokens
      makeBid('C', 10, 1000), // wants 100 tokens
    ];
    // Supply = 100, total demand at $10+ = 200
    const result = strategy.clear(bids, 100, 8);

    // Cumulative: A(50), A+B(100) → clearing at $12
    expect(result.clearing_price).toBe(12);
    // A at $15 > $12 → full fill: 50 tokens
    expect(result.allocations.find((a: any) => a.bot_id === 'A')?.tokens_allocated)
      .toBeCloseTo(50, 4);
    // B at $12 = $12 → pro-rata of remaining 50
    expect(result.allocations.find((a: any) => a.bot_id === 'B')?.tokens_allocated)
      .toBeCloseTo(50, 4);
    // C at $10 < $12 → nothing
    expect(result.allocations.find((a: any) => a.bot_id === 'C')).toBeUndefined();
  });

  test('multiple bids at clearing price → pro-rata', () => {
    const bids = [
      makeBid('A', 15, 750),  // wants 50
      makeBid('B', 11, 550),  // wants 50
      makeBid('C', 11, 550),  // wants 50
    ];
    // Supply = 80, A gets 50, 30 remaining split between B and C
    const result = strategy.clear(bids, 80, 10);

    expect(result.clearing_price).toBe(11);
    const aAlloc = result.allocations.find((a) => a.bot_id === 'A')!;
    const bAlloc = result.allocations.find((a) => a.bot_id === 'B')!;
    const cAlloc = result.allocations.find((a) => a.bot_id === 'C')!;

    expect(aAlloc.tokens_allocated).toBeCloseTo(50, 4);
    expect(bAlloc.tokens_allocated).toBeCloseTo(15, 4);
    expect(cAlloc.tokens_allocated).toBeCloseTo(15, 4);
    expect(result.total_tokens_allocated).toBeCloseTo(80, 4);
  });
});
