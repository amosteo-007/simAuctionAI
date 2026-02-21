import { ClearingStrategy, ClearingStrategyType } from '../models/types';
import { VickreyStrategy } from './strategies/vickrey';
import { UniformPriceStrategy } from './strategies/uniformPrice';
import {
  DiscriminatoryStrategy,
  DutchAuctionStrategy,
  SealedFirstPriceStrategy,
} from './strategies/placeholders';

/**
 * Factory for creating clearing strategy instances.
 *
 * To register a new strategy:
 * 1. Implement ClearingStrategy interface
 * 2. Add entry in the strategyMap below
 * 3. Add type to ClearingStrategyType union in types.ts
 */
const strategyMap: Record<ClearingStrategyType, () => ClearingStrategy> = {
  vickrey: () => new VickreyStrategy(),
  uniform_price: () => new UniformPriceStrategy(),
  discriminatory: () => new DiscriminatoryStrategy(),
  dutch: () => new DutchAuctionStrategy(),
  sealed_first: () => new SealedFirstPriceStrategy(),
};

/**
 * Get a clearing strategy instance by type.
 * Strategies are stateless, so creating new instances is cheap.
 */
export function getStrategy(type: ClearingStrategyType): ClearingStrategy {
  const factory = strategyMap[type];
  if (!factory) {
    throw new Error(`Unknown clearing strategy: ${type}`);
  }
  return factory();
}

/**
 * Check if a strategy type is implemented (not a placeholder).
 */
export function isStrategyImplemented(type: ClearingStrategyType): boolean {
  try {
    const strategy = getStrategy(type);
    // Try calling clear with empty bids — placeholders will throw
    strategy.clear([], 0, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all registered strategy types.
 */
export function listStrategies(): ClearingStrategyType[] {
  return Object.keys(strategyMap) as ClearingStrategyType[];
}
