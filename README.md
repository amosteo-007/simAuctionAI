# CCA Auction Simulation Engine

A multi-stage, multi-mechanism auction tournament engine for studying how autonomous agents bid in token auctions. Designed for both programmatic bots and LLM-powered agents.

---

## Setup

```bash
git clone <repo-url>
cd cca-auction-sim
npm install
npm test          # 61 tests
npm start         # run 100 simulated tournaments
```

Requires Node.js 20+. The only runtime dependency is `decimal.js`.

### Run Commands

```bash
npm start                                           # 100 tournaments, fixed population
npm run sim:quick                                   # 20 tournaments (fast check)
npm run sim:full                                    # 500 tournaments (statistical confidence)
npm run sim:random                                  # random bot populations each run
npm start -- --runs=200 --seed=123                  # custom run count and seed
npm start -- --mode=random_pool --pool=8            # 8 random bots per tournament
npm start -- --json                                 # export results to JSON file
```

### Project Structure

```
src/
├── models/types.ts                  # All interfaces and type definitions
├── core/
│   ├── engine.ts                    # TournamentEngine — orchestrates the auction
│   ├── configs.ts                   # Default, test, and mixed-strategy configs
│   ├── strategyFactory.ts           # Registry for clearing mechanisms
│   ├── strategies/
│   │   ├── vickrey.ts               # Second-price single-winner (implemented)
│   │   ├── uniformPrice.ts          # Uniform price multi-winner (implemented)
│   │   └── placeholders.ts          # Dutch, discriminatory, sealed-first (stubs)
│   └── store/
│       └── tournamentStore.ts       # In-memory state management
├── bots/
│   └── archetypes.ts                # 6 stochastic bot archetypes
├── simulation/
│   └── harness.ts                   # Multi-run simulation engine with stats
├── utils/
│   └── random.ts                    # Seeded PRNG for reproducible randomness
├── run.ts                           # CLI entry point
└── index.ts                         # Public API barrel exports

tests/
├── vickrey.test.ts                  # 10 tests
├── uniformPrice.test.ts             # 5 tests
├── strategyFactory.test.ts          # 7 tests
├── store.test.ts                    # 13 tests
├── tournament.test.ts               # 12 tests
└── simulation.test.ts               # 14 tests
```

---

## How the Auction Works

This section is the complete rule set. Read this before building a bot.

### Tournament Structure

A tournament has **3 stages**. Each stage has **9 periods** of 1 minute each. That is 27 periods total. Every period, one batch of tokens is auctioned. The highest bidder wins the batch, pays the second-highest price, and then decides whether to keep the tokens or rescind.

### Tokens, Points, and Scoring

Each token is worth a number of **points** that depends on which stage it came from. After each stage, the bots with the most tokens in that stage earn **Stage Points (SP)**. The bot with the most SP at the end wins the tournament.

**Default configuration:**

| | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| Total tokens | 900 | 600 | 300 |
| Tokens per period | 100 | ~67 | ~33 |
| Floor price | $10.00 | $10.50 | $11.03 |
| Points per token | 1.0× | 1.5× | 2.5× |
| Total points available | 900 | 900 | 750 |

Stage 1 is cheap and abundant. Stage 3 is scarce and expensive but each token is worth 2.5× in points. The floor price escalates ~5% per stage.

**SP awards after each stage:**

| Rank by raw token count | SP |
|---|---|
| 1st place | 3 |
| 2nd place | 2 |
| 3rd place | 1 |

**Overall bonus:** after all three stages, the bot with the highest cumulative weighted points (sum of tokens × points_per_token across all stages) earns 1 additional SP.

**Winner:** highest total SP. Maximum possible is 10 (3+3+3+1). Tiebreaker: highest weighted points.

### Budget

Every bot starts with **$10,000**. This budget is shared across all three stages. It does not reset. A bid's total cost is `price_per_token × tokens_available_this_period`. If you cannot afford the full batch at your bid price, the bid is rejected.

### Bidding (Vickrey Second-Price)

Each period, your bot submits bids. Each bid is a price per token. Under the default Vickrey mechanism:

- The **highest bidder** wins ALL tokens in the period.
- The winner pays the **second-highest bid** per token, not their own bid.
- If only one bot bids, the winner pays the **floor price**.
- Tied bids are broken by submission order (earlier wins).
- Bids below the floor price are rejected.
- Up to 10 bids per period are accepted. Only your highest matters in Vickrey.

Because this is second-price, **bidding your true valuation is the dominant strategy**. You never overpay because the price is set by someone else's bid.

### The Rescind Mechanic

After winning a period, your bot decides: **keep or rescind?**

**If you rescind:**
- Your tokens are removed and your budget is fully refunded.
- The rescinded tokens enter a future period with a **2-period delay**. Rescinding in period 3 means the tokens appear in period 5's supply.
- Only you know about the rescind for those 2 periods. Other bots see `rescinded: null` in the period history until it is publicly revealed.
- When the target period arrives, all bots see the increased supply and the rescind is revealed.

**Why rescind?**
- You overpaid and want your budget back.
- You are already leading the stage and additional tokens do not improve your rank.
- You want to inflate a future period's supply to dilute competitors.
- You want private information: during the 2-period delay, only you know a supply increase is coming.

**Cross-stage rescinds:** rescinding in stage 1 period 8 pushes tokens to stage 2 period 1 (absolute period 10, two periods later). Private information can cross stage boundaries.

**Restriction:** rescinds are not allowed in the final 2 periods of stage 3 (periods 8 and 9) because there is no period N+2 to receive the tokens.

### What Your Bot Sees

Before each period, your bot receives a `BotObservation`:

| Field | Description |
|---|---|
| `stage`, `period`, `absolute_period` | Where you are in the tournament (0-indexed) |
| `periods_remaining_in_stage` | How many periods left in this stage |
| `stages_remaining` | How many stages left after this one |
| `remaining_budget` | Your current budget |
| `holdings` | Array of your token holdings (stage, period, quantity, price, points) |
| `weighted_points` | Your total points (tokens × multiplier) |
| `tokens_per_stage` | Your token count in each stage |
| `sp` | Your current Stage Points |
| `tokens_available` | Tokens being auctioned this period (base + rescind supply) |
| `floor_price` | Minimum bid this period |
| `points_per_token` | Point multiplier for this stage |
| `history` | All completed periods: clearing price, winner, allocations, rescind status |
| `leaderboard` | Every bot's tokens, weighted points, and SP |
| `private_rescind_info` | Your pending rescinds not yet public (target period, token count) |

**You do NOT see:** other bots' active bids, other bots' budgets, or unrevealed rescind decisions by other bots.

---

## Building a Bot

### The Interface

Your bot implements two methods:

```typescript
import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
} from './src';

class MyBot implements BotAgent {
  readonly bot_id = 'my_bot';

  decideBids(obs: BotObservation): BotBidDecision {
    // Return { bids: [{ price_per_token: number }, ...] }
    // Return { bids: [] } to skip this period.
  }

  decideRescind(
    obs: BotObservation,
    winResult: PeriodResult,
  ): BotRescindDecision {
    // Only called if you won.
    // Return { rescind: true } to give up tokens and get budget back.
    // Return { rescind: false } to keep.
  }
}
```

If either method throws an error, the engine catches it and skips your action for that period. Your state is unaffected.

### Running Your Bot

```typescript
import { TournamentEngine, createDefaultTournamentConfig } from './src';

const config = createDefaultTournamentConfig();
const engine = new TournamentEngine(config, [
  new MyBot(),
  new OpponentBot(),
  // ... more bots
]);

const result = engine.run();
console.log(result.final_leaderboard);
```

### Strategy Considerations

**Budget allocation** is the most important decision. You have $10,000 for 27 periods across 3 stages. Spending aggressively early leaves you unable to compete later. Saving everything for stage 3 means 0 SP from the first two stages.

**Track clearing prices.** The `obs.history` array tells you what the winning price was in every completed period. If prices are trending down, competitors are running out of budget. If prices spike, someone is fighting for the stage lead.

**Read the leaderboard.** If a bot already has 3 SP locked from stage 1, competing with it for 1st in stage 2 may be a poor use of budget. Target 2nd place (2 SP) instead.

**Rescind strategically.** If you are ahead in a stage, winning more periods costs budget without improving your SP. Rescind, recover your budget, and use the private information window to make better bids in the next 2 periods.

**Points per token matter for the overall bonus.** Stage 3 tokens are worth 2.5× stage 1 tokens. A bot with 100 stage 3 tokens (250 points) beats a bot with 200 stage 1 tokens (200 points) for the overall bonus SP.

---

## Building an LLM-Powered Bot

An LLM bot wraps the `BotAgent` interface around an API call to a language model. The observation is serialized into a prompt, the LLM reasons about strategy, and its response is parsed into a bid decision.

### Basic LLM Bot Template

```typescript
import {
  BotAgent,
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
} from './src';

class LLMBot implements BotAgent {
  readonly bot_id: string;
  private apiKey: string;
  private model: string;

  constructor(id: string, apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.bot_id = id;
    this.apiKey = apiKey;
    this.model = model;
  }

  decideBids(obs: BotObservation): BotBidDecision {
    const prompt = this.buildBidPrompt(obs);
    const response = this.callLLM(prompt);
    return this.parseBidResponse(response, obs);
  }

  decideRescind(
    obs: BotObservation,
    winResult: PeriodResult,
  ): BotRescindDecision {
    const prompt = this.buildRescindPrompt(obs, winResult);
    const response = this.callLLM(prompt);
    return this.parseRescindResponse(response);
  }

  private buildBidPrompt(obs: BotObservation): string {
    return `You are a bidding agent in a token auction tournament.

CURRENT STATE:
- Stage ${obs.stage + 1} of 3, Period ${obs.period + 1} of 9
- Your budget: $${obs.remaining_budget.toFixed(2)}
- Your SP: ${obs.sp} | Your weighted points: ${obs.weighted_points.toFixed(1)}
- Tokens available this period: ${obs.tokens_available.toFixed(1)}
- Floor price: $${obs.floor_price.toFixed(2)}
- Points per token this stage: ${obs.points_per_token}x

YOUR HOLDINGS:
${obs.tokens_per_stage.map((t, i) => `  Stage ${i + 1}: ${t.toFixed(0)} tokens`).join('\n')}

LEADERBOARD:
${obs.leaderboard
  .sort((a, b) => b.sp - a.sp || b.weighted_points - a.weighted_points)
  .map((e) => `  ${e.bot_id}: ${e.sp} SP, ${e.weighted_points.toFixed(0)} pts, tokens [${e.tokens_per_stage.map((t) => t.toFixed(0)).join(', ')}]`)
  .join('\n')}

RECENT CLEARING PRICES:
${obs.history
  .filter((h) => h.allocations.length > 0)
  .slice(-5)
  .map((h) => `  Stage ${h.stage + 1} P${h.period + 1}: $${h.clearing_price.toFixed(2)} (winner: ${h.winner_bot_id})`)
  .join('\n') || '  No history yet'}
${obs.private_rescind_info.length > 0
  ? `\nPRIVATE INFO (only you know this):\n  Extra supply of ${obs.private_rescind_info[0].tokens.toFixed(0)} tokens arriving in period ${obs.private_rescind_info[0].target_period + 1} of stage ${obs.private_rescind_info[0].target_stage + 1}`
  : ''}

RULES REMINDER:
- Highest bidder wins all tokens, pays second-highest price (Vickrey auction)
- Bidding your true value is optimal since you never pay your own bid
- Your bid cost = price x ${obs.tokens_available.toFixed(1)} tokens, must be <= $${obs.remaining_budget.toFixed(2)}
- Maximum affordable bid: $${(obs.remaining_budget / obs.tokens_available).toFixed(2)} per token

Decide: what price per token should you bid, or skip this period?
Respond with ONLY a JSON object: { "price_per_token": <number> } or { "skip": true }`;
  }

  private buildRescindPrompt(
    obs: BotObservation,
    winResult: PeriodResult,
  ): string {
    const alloc = winResult.allocations[0];
    return `You just won ${alloc.tokens_allocated.toFixed(0)} tokens at $${alloc.price_paid_per_token.toFixed(2)}/token (total: $${alloc.total_paid.toFixed(2)}).

Your budget after this win: $${obs.remaining_budget.toFixed(2)}
Your SP: ${obs.sp} | Periods remaining in stage: ${obs.periods_remaining_in_stage}
Your stage token count: ${obs.tokens_per_stage[obs.stage].toFixed(0)}

If you RESCIND:
- You get $${alloc.total_paid.toFixed(2)} back
- The ${alloc.tokens_allocated.toFixed(0)} tokens enter supply 2 periods from now
- Only you know this for the next 2 periods (information advantage)

If you KEEP:
- You hold the tokens and points
- Budget stays at $${obs.remaining_budget.toFixed(2)}

Should you rescind? Respond with ONLY: { "rescind": true } or { "rescind": false }`;
  }

  private callLLM(prompt: string): string {
    // Replace with your actual LLM API call.
    //
    // For Anthropic Claude:
    //   POST https://api.anthropic.com/v1/messages
    //   Headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" }
    //   Body: {
    //     model: this.model,
    //     max_tokens: 200,
    //     messages: [{ role: "user", content: prompt }]
    //   }
    //   Parse: response.content[0].text
    //
    // For OpenAI:
    //   POST https://api.openai.com/v1/chat/completions
    //   Headers: { "Authorization": "Bearer " + this.apiKey }
    //   Body: {
    //     model: "gpt-4",
    //     max_tokens: 200,
    //     messages: [{ role: "user", content: prompt }]
    //   }
    //   Parse: response.choices[0].message.content
    //
    // IMPORTANT: This must be synchronous for fast-mode simulation.
    // Use execSync + curl, or the HTTP tournament server (Phase 4) for async.
    throw new Error('Implement callLLM with your API provider');
  }

  private parseBidResponse(
    response: string,
    obs: BotObservation,
  ): BotBidDecision {
    try {
      const clean = response.replace(/```json\n?|```/g, '').trim();
      const parsed = JSON.parse(clean);

      if (parsed.skip) return { bids: [] };

      const price = Number(parsed.price_per_token);
      if (!price || price < obs.floor_price) return { bids: [] };
      if (price * obs.tokens_available > obs.remaining_budget) return { bids: [] };

      return { bids: [{ price_per_token: price }] };
    } catch {
      return { bids: [] };
    }
  }

  private parseRescindResponse(response: string): BotRescindDecision {
    try {
      const clean = response.replace(/```json\n?|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return { rescind: Boolean(parsed.rescind) };
    } catch {
      return { rescind: false };
    }
  }
}
```

### Prompt Engineering Tips

**Keep it concise.** The observation contains a lot of data. Summarize only what matters for this period's decision. Show the last 3-5 clearing prices and the current leaderboard, not the full history.

**Include the math.** LLMs reason better when constraints are explicit. Always include: max affordable bid (`budget / tokens_available`), the floor price, and the implied cost at various price levels.

**Give strategic context.** "You are in 2nd place with 5 SP, the leader has 6 SP, and there are 2 stages remaining" is more actionable than raw numbers.

**Use a system prompt for persistent strategy.** Define your bot's personality and strategic principles in the system message. Use the user message for per-period state.

```typescript
const systemPrompt = `You are a tournament auction bot following a "balanced spread" 
strategy. Key principles:
1. Never spend more than 40% of remaining budget in a single stage
2. Bid aggressively only when behind in SP
3. Rescind if you paid more than 15% above floor price
4. When you have private rescind info, bid conservatively
Respond with JSON only. No explanations.`;
```

**Handle failures gracefully.** LLMs sometimes produce malformed JSON or extra text. Always wrap parsing in try/catch and default to a safe action (skip the period or keep tokens).

### Testing Your LLM Bot

Run your LLM bot against built-in archetypes:

```typescript
import {
  TournamentEngine,
  createDefaultTournamentConfig,
  createBot,
} from './src';

const config = createDefaultTournamentConfig();
const engine = new TournamentEngine(config, [
  new LLMBot('my_llm', process.env.API_KEY!),
  createBot('adaptive_tracker', 'tracker', 42),
  createBot('balanced_spreader', 'spreader', 43),
  createBot('patient_sniper', 'sniper', 44),
]);

const result = engine.run();
const llm = result.bot_summaries.get('my_llm')!;
console.log(`LLM: ${llm.total_sp} SP, ${llm.periods_won} wins, efficiency ${llm.capital_efficiency.toFixed(4)}`);
```

### Async LLM Bots (Future: HTTP Tournament Mode)

The current engine runs synchronously. For real LLM API latency, Phase 4 will add an HTTP server where bots register webhooks and the engine calls them with real 60-second bidding windows:

```
POST /your-bot/decide-bids     → BotObservation JSON → BotBidDecision JSON
POST /your-bot/decide-rescind  → BotObservation + PeriodResult JSON → BotRescindDecision JSON
```

Until then, for synchronous LLM calls, use `execSync` with curl or a blocking HTTP client.

---

## Working with Results

### After Each Period

Every period produces a `PeriodResult`:

```typescript
{
  stage: number;                  // 0, 1, or 2
  period: number;                 // 0-8 within the stage
  absolute_period: number;        // 0-26 across the tournament
  tokens_available: number;       // base supply + rescind overflow
  floor_price: number;
  points_per_token: number;
  clearing_price: number;         // second-highest bid (Vickrey)
  winner_bot_id: string | null;   // null if no bids
  allocations: [{
    bot_id: string;
    tokens_allocated: number;
    price_paid_per_token: number;
    total_paid: number;
  }];
  rescinded: boolean | null;      // null = not yet revealed (2-period delay)
  bids_submitted: Bid[];          // all bids for post-hoc analysis
  strategy_used: string;          // 'vickrey', 'uniform_price', etc.
}
```

### After Each Stage

```typescript
for (let stage = 0; stage < 3; stage++) {
  const periods = result.all_period_results.filter((pr) => pr.stage === stage);
  const revenue = periods.reduce(
    (sum, pr) => sum + pr.allocations.reduce((s, a) => s + a.total_paid, 0),
    0,
  );
  console.log(`Stage ${stage + 1}: $${revenue.toFixed(2)} revenue`);
}
```

### Final Results

```typescript
// Leaderboard
for (const entry of result.final_leaderboard) {
  console.log(`${entry.bot_id}: ${entry.sp} SP, ${entry.weighted_points.toFixed(1)} pts`);
}

// Per-bot summary
for (const [id, s] of result.bot_summaries) {
  console.log(`${id}: $${s.budget_spent.toFixed(2)} spent, ${s.periods_won} wins, ` +
    `${s.rescinds_made} rescinds, ${s.capital_efficiency.toFixed(4)} pts/$`);
}
```

### Batch Simulations

```typescript
import { SimulationEngine, printSimulationReport, createDefaultTournamentConfig } from './src';

const sim = new SimulationEngine({
  num_runs: 500,
  tournament_config: createDefaultTournamentConfig(),
  master_seed: 42,
  population_mode: 'fixed',
});

console.log(printSimulationReport(sim.run()));
```

**Population modes:**

| Mode | Behavior |
|---|---|
| `fixed` | One of each archetype, new seeds per run |
| `random_pool` | N random bots from pool each run |
| `custom` | Explicit archetype list |

---

## Built-in Archetypes

| Archetype | Strategy | Key Trait |
|---|---|---|
| `aggressive_early` | Heavy spending in stages 1-2 | High markup, stage-weighted budgets |
| `patient_sniper` | Skips early, all-in on stage 2 or 3 | Low early activity, high target aggression |
| `adaptive_tracker` | Follows clearing price average | Bids above recent trend, reserves budget |
| `balanced_spreader` | Monitors rank, adjusts intensity | Harder when behind, saves when leading |
| `info_exploiter` | Wins and rescinds frequently | Exploits private info window |
| `chaos_agent` | Random bids and rescinds | Noise injection, robustness testing |

```typescript
import { createBot } from './src';
const bot = createBot('adaptive_tracker', 'my_tracker', 42);
```

---

## Adding a Clearing Strategy

1. Add type to `ClearingStrategyType` in `src/models/types.ts`
2. Implement `ClearingStrategy` interface in `src/core/strategies/`
3. Register in `src/core/strategyFactory.ts`
4. Use in stage config: `{ clearing_strategy: 'your_type' }`

Each stage can use a different strategy.

---

## License

Proprietary — all rights reserved.
