// ─── Types ──────────────────────────────────────────────────────────────────────
export type {
  TournamentConfig,
  StageConfig,
  ClearingStrategyType,
  TournamentState,
  TournamentPhase,
  BotState,
  TokenHolding,
  PrivateRescindInfo,
  PeriodContext,
  Bid,
  PeriodResult,
  PeriodAllocation,
  PendingRescind,
  RescindSupplyEntry,
  ClearingStrategy,
  PeriodClearingResult,
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  LeaderboardEntry,
  TournamentResult,
  BotSummary,
} from './models/types';

export { generateId, resetIdCounter } from './models/types';

// ─── Engine ─────────────────────────────────────────────────────────────────────
export { TournamentEngine } from './core/engine';

// ─── Strategies ─────────────────────────────────────────────────────────────────
export { VickreyStrategy } from './core/strategies/vickrey';
export { UniformPriceStrategy } from './core/strategies/uniformPrice';
export { getStrategy, isStrategyImplemented, listStrategies } from './core/strategyFactory';

// ─── Configs ────────────────────────────────────────────────────────────────────
export {
  createDefaultTournamentConfig,
  createTestTournamentConfig,
  createMixedStrategyTournamentConfig,
} from './core/configs';

// ─── Store ──────────────────────────────────────────────────────────────────────
export { TournamentStore } from './core/store/tournamentStore';

// ─── Bots ───────────────────────────────────────────────────────────────────────
export {
  AggressiveEarlyBird,
  PatientSniper,
  AdaptiveTracker,
  BalancedSpreader,
  InformationExploiter,
  ChaosAgent,
  createBot,
  ALL_ARCHETYPES,
} from './bots/archetypes';
export type { BotArchetype } from './bots/archetypes';
export { HumanProxyBot } from './bots/humanProxy';
export { GeminiBot } from './bots/gemini';

// ─── Simulation ─────────────────────────────────────────────────────────────────
export { SimulationEngine, printSimulationReport } from './simulation/harness';
export type { SimulationConfig, SimulationResult, ArchetypeAverage } from './simulation/harness';

// ─── Utils ──────────────────────────────────────────────────────────────────────
export { SeededRandom } from './utils/random';
