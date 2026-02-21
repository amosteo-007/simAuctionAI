import {
  getStrategy,
  isStrategyImplemented,
  listStrategies,
} from '../src/core/strategyFactory';

describe('strategyFactory', () => {
  test('getStrategy returns vickrey', () => {
    const s = getStrategy('vickrey');
    expect(s.type).toBe('vickrey');
  });

  test('getStrategy returns uniform_price', () => {
    const s = getStrategy('uniform_price');
    expect(s.type).toBe('uniform_price');
  });

  test('getStrategy throws for unknown type', () => {
    expect(() => getStrategy('nonexistent' as any)).toThrow('Unknown clearing strategy');
  });

  test('isStrategyImplemented returns true for vickrey', () => {
    expect(isStrategyImplemented('vickrey')).toBe(true);
  });

  test('isStrategyImplemented returns true for uniform_price', () => {
    expect(isStrategyImplemented('uniform_price')).toBe(true);
  });

  test('isStrategyImplemented returns false for placeholders', () => {
    expect(isStrategyImplemented('discriminatory')).toBe(false);
    expect(isStrategyImplemented('dutch')).toBe(false);
    expect(isStrategyImplemented('sealed_first')).toBe(false);
  });

  test('listStrategies returns all registered types', () => {
    const types = listStrategies();
    expect(types).toContain('vickrey');
    expect(types).toContain('uniform_price');
    expect(types).toContain('discriminatory');
    expect(types).toContain('dutch');
    expect(types).toContain('sealed_first');
    expect(types.length).toBe(5);
  });
});
