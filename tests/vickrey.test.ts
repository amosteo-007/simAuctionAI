import { VickreyStrategy } from '../src/core/strategies/vickrey';
import { Bid } from '../src/models/types';

function makeBid(
  bot_id: string,
  price: number,
  supply: number,
  msOffset = 0,
): Bid {
  return {
    id: `bid_${bot_id}_${price}`,
    bot_id,
    stage: 0,
    period: 0,
    price_per_token: price,
    total_cost: price * supply,
    submitted_at: new Date(1000 + msOffset),
  };
}

describe('VickreyStrategy', () => {
  const strategy = new VickreyStrategy();

  test('type is vickrey', () => {
    expect(strategy.type).toBe('vickrey');
  });

  test('no bids → no allocation, clearing at floor', () => {
    const result = strategy.clear([], 100, 10);
    expect(result.clearing_price).toBe(10);
    expect(result.allocations).toHaveLength(0);
    expect(result.total_tokens_allocated).toBe(0);
  });

  test('single bid → winner pays floor price', () => {
    const bids = [makeBid('A', 15, 100)];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].bot_id).toBe('A');
    expect(result.allocations[0].tokens_allocated).toBe(100);
    expect(result.allocations[0].price_paid_per_token).toBe(10); // floor
    expect(result.allocations[0].total_paid).toBe(1000);
    expect(result.clearing_price).toBe(10);
  });

  test('two bids → winner pays second-highest price', () => {
    const bids = [
      makeBid('A', 15, 100, 0),
      makeBid('B', 12, 100, 1),
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].bot_id).toBe('A');
    expect(result.allocations[0].price_paid_per_token).toBe(12);
    expect(result.allocations[0].total_paid).toBe(1200);
    expect(result.clearing_price).toBe(12);
  });

  test('three bids → winner pays second-highest, third ignored', () => {
    const bids = [
      makeBid('A', 20, 100, 0),
      makeBid('B', 15, 100, 1),
      makeBid('C', 11, 100, 2),
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations[0].bot_id).toBe('A');
    expect(result.allocations[0].price_paid_per_token).toBe(15);
    expect(result.total_tokens_allocated).toBe(100);
  });

  test('tied bids → FIFO tiebreak (earlier submission wins)', () => {
    const bids = [
      makeBid('B', 15, 100, 10), // submitted later
      makeBid('A', 15, 100, 0),  // submitted earlier
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations[0].bot_id).toBe('A'); // earlier wins
    // With a tie, second price = same price (15), but the "second bidder" also bid 15
    expect(result.allocations[0].price_paid_per_token).toBe(15);
  });

  test('all bids below floor → no allocation', () => {
    const bids = [
      makeBid('A', 8, 100),
      makeBid('B', 9, 100),
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations).toHaveLength(0);
    expect(result.total_tokens_allocated).toBe(0);
  });

  test('one bid at floor, one below → winner pays floor', () => {
    const bids = [
      makeBid('A', 10, 100, 0),
      makeBid('B', 8, 100, 1),
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].bot_id).toBe('A');
    expect(result.allocations[0].price_paid_per_token).toBe(10); // floor, since B is invalid
  });

  test('second-highest below floor → winner pays floor', () => {
    const bids = [
      makeBid('A', 15, 100, 0),
      makeBid('B', 8, 100, 1), // below floor
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.allocations[0].bot_id).toBe('A');
    // B is filtered out, so only one valid bid → pays floor
    expect(result.allocations[0].price_paid_per_token).toBe(10);
  });

  test('metadata includes surplus info', () => {
    const bids = [
      makeBid('A', 20, 100, 0),
      makeBid('B', 12, 100, 1),
    ];
    const result = strategy.clear(bids, 100, 10);

    expect(result.metadata.highest_bid).toBe(20);
    expect(result.metadata.second_highest_bid).toBe(12);
    expect(result.metadata.winner_surplus).toBe(8); // 20 - 12
  });
});
