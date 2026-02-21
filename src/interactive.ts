import * as readline from 'readline';
import { TournamentEngine } from './core/engine';
import { createDefaultTournamentConfig, createTestTournamentConfig } from './core/configs';
import { createBot, BotArchetype } from './bots/archetypes';
import { HumanProxyBot } from './bots/humanProxy';
import {
  BotObservation,
  BotBidDecision,
  BotRescindDecision,
  PeriodResult,
  BotAgent,
  resetIdCounter,
} from './models/types';

// ─── CLI Helpers ────────────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const HR = '─'.repeat(68);
const HR2 = '═'.repeat(68);

function stageColor(stage: number): string {
  return [GREEN, YELLOW, RED][stage] ?? RESET;
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n.toFixed(1);
}

// ─── Observation Formatter ──────────────────────────────────────────────────────

function printObservation(obs: BotObservation, botId: string): void {
  const sc = stageColor(obs.stage);

  console.log(`\n${HR2}`);
  console.log(
    `${BOLD}${sc}  STAGE ${obs.stage + 1}  PERIOD ${obs.period + 1}/9${RESET}` +
    `${DIM}  (absolute: ${obs.absolute_period + 1}/27)${RESET}`,
  );
  console.log(HR2);

  // Your state
  console.log(`\n${BOLD}  YOUR STATE (${botId})${RESET}`);
  console.log(`  Budget:          ${BOLD}${formatMoney(obs.remaining_budget)}${RESET}`);
  console.log(`  SP:              ${BOLD}${obs.sp}${RESET}`);
  console.log(`  Weighted Points: ${obs.weighted_points.toFixed(1)}`);
  console.log(
    `  Tokens held:     S1: ${formatTokens(obs.tokens_per_stage[0] ?? 0)}  ` +
    `S2: ${formatTokens(obs.tokens_per_stage[1] ?? 0)}  ` +
    `S3: ${formatTokens(obs.tokens_per_stage[2] ?? 0)}`,
  );

  // Current period
  console.log(`\n${BOLD}  THIS PERIOD${RESET}`);
  console.log(`  Tokens available: ${BOLD}${formatTokens(obs.tokens_available)}${RESET}`);
  console.log(`  Floor price:      ${formatMoney(obs.floor_price)}`);
  console.log(`  Points/token:     ${obs.points_per_token}×`);
  console.log(
    `  Max affordable:   ${BOLD}${formatMoney(obs.remaining_budget / obs.tokens_available)}${RESET}/token`,
  );
  console.log(
    `  Cost at floor:    ${formatMoney(obs.floor_price * obs.tokens_available)}`,
  );
  console.log(
    `  Periods left:     ${obs.periods_remaining_in_stage} in stage, ` +
    `${obs.stages_remaining} stage(s) after this`,
  );

  // Leaderboard
  console.log(`\n${BOLD}  LEADERBOARD${RESET}`);
  const sorted = [...obs.leaderboard].sort(
    (a, b) => b.sp - a.sp || b.weighted_points - a.weighted_points,
  );
  for (const e of sorted) {
    const isMe = e.bot_id === botId;
    const marker = isMe ? ` ${CYAN}◀ YOU${RESET}` : '';
    const name = isMe ? `${BOLD}${e.bot_id}${RESET}` : `${DIM}${e.bot_id}${RESET}`;
    console.log(
      `  ${name}`.padEnd(isMe ? 50 : 38) +
      `SP:${String(e.sp).padStart(2)}  ` +
      `Pts:${e.weighted_points.toFixed(0).padStart(5)}  ` +
      `Tokens:[${e.tokens_per_stage.map((t) => t.toFixed(0).padStart(4)).join(',')}]` +
      marker,
    );
  }

  // Recent history (last 5 periods with winners)
  const recentFilled = obs.history
    .filter((h) => h.allocations.length > 0)
    .slice(-5);
  if (recentFilled.length > 0) {
    console.log(`\n${BOLD}  RECENT CLEARING PRICES${RESET}`);
    for (const h of recentFilled) {
      const rescindMark =
        h.rescinded === true
          ? ` ${RED}[RESCINDED]${RESET}`
          : h.rescinded === false || h.rescinded === null
          ? ''
          : '';
      console.log(
        `  S${h.stage + 1} P${(h.period + 1).toString().padStart(1)}: ` +
        `${formatMoney(h.clearing_price).padStart(7)}  ` +
        `winner: ${h.winner_bot_id}` +
        rescindMark,
      );
    }
  }

  // Private info
  if (obs.private_rescind_info.length > 0) {
    console.log(`\n${BOLD}${MAGENTA}  🔒 PRIVATE INFO (only you see this)${RESET}`);
    for (const info of obs.private_rescind_info) {
      console.log(
        `  ${MAGENTA}+${formatTokens(info.tokens)} tokens arriving at ` +
        `S${info.target_stage + 1} P${info.target_period + 1}${RESET}`,
      );
    }
  }

  console.log(`\n${HR}`);
}

function printClearingResult(result: PeriodResult, myBotId: string): void {
  const sc = stageColor(result.stage);

  if (result.allocations.length === 0) {
    console.log(`\n${DIM}  No bids this period. Clearing at floor.${RESET}`);
    return;
  }

  const alloc = result.allocations[0];
  const isMyWin = alloc.bot_id === myBotId;

  console.log(`\n${BOLD}${sc}  ⚡ CLEARING RESULT${RESET}`);
  console.log(`  Clearing price: ${BOLD}${formatMoney(result.clearing_price)}${RESET}/token`);
  console.log(
    `  Winner: ${isMyWin ? `${GREEN}${BOLD}${alloc.bot_id} (YOU!)${RESET}` : `${RED}${alloc.bot_id}${RESET}`}`,
  );
  console.log(
    `  Tokens: ${formatTokens(alloc.tokens_allocated)}  |  ` +
    `Cost: ${formatMoney(alloc.total_paid)}`,
  );

  if (!isMyWin) {
    // Show what all bids were
    const myBids = result.bids_submitted.filter((b) => b.bot_id === myBotId);
    if (myBids.length > 0) {
      console.log(
        `  ${DIM}Your bid: ${formatMoney(myBids[0].price_per_token)}/token (outbid)${RESET}`,
      );
    } else {
      console.log(`  ${DIM}You did not bid this period.${RESET}`);
    }
  }
}

function printRescindPrompt(result: PeriodResult): void {
  const alloc = result.allocations[0];
  console.log(`\n${BOLD}${YELLOW}  🔄 RESCIND DECISION${RESET}`);
  console.log(
    `  You won ${formatTokens(alloc.tokens_allocated)} tokens at ` +
    `${formatMoney(alloc.price_paid_per_token)}/token`,
  );
  console.log(`  Total paid: ${formatMoney(alloc.total_paid)}`);
  console.log(
    `  ${DIM}Rescinding returns your ${formatMoney(alloc.total_paid)} and ` +
    `injects ${formatTokens(alloc.tokens_allocated)} tokens into supply ` +
    `2 periods from now (only you will know).${RESET}`,
  );
}

function printStageEnd(stage: number, obs: BotObservation): void {
  console.log(`\n${HR2}`);
  console.log(`${BOLD}  STAGE ${stage + 1} COMPLETE — SP AWARDED${RESET}`);
  const sorted = [...obs.leaderboard].sort(
    (a, b) => b.sp - a.sp || b.weighted_points - a.weighted_points,
  );
  for (const e of sorted) {
    console.log(
      `  ${e.bot_id.padEnd(24)} SP: ${e.sp}  Tokens S${stage + 1}: ${e.tokens_per_stage[stage]?.toFixed(0) ?? 0}`,
    );
  }
  console.log(HR2);
}

function printFinalResults(
  result: import('./models/types').TournamentResult,
  myBotId: string,
): void {
  console.log(`\n${HR2}`);
  console.log(`${BOLD}  🏆 TOURNAMENT COMPLETE${RESET}`);
  console.log(HR2);

  const isWinner = result.winner_bot_id === myBotId;
  if (isWinner) {
    console.log(`\n  ${GREEN}${BOLD}🎉 YOU WON! 🎉${RESET}`);
  } else {
    console.log(`\n  Winner: ${BOLD}${result.winner_bot_id}${RESET}`);
  }

  console.log(`\n${BOLD}  FINAL LEADERBOARD${RESET}`);
  for (const e of result.final_leaderboard) {
    const me = e.bot_id === myBotId ? ` ${CYAN}◀ YOU${RESET}` : '';
    console.log(
      `  ${e.bot_id.padEnd(24)} SP: ${String(e.sp).padStart(2)}  ` +
      `Pts: ${e.weighted_points.toFixed(1).padStart(7)}  ` +
      `Tokens: [${e.tokens_per_stage.map((t) => t.toFixed(0).padStart(4)).join(',')}]` +
      me,
    );
  }

  const mySummary = result.bot_summaries.get(myBotId);
  if (mySummary) {
    console.log(`\n${BOLD}  YOUR SUMMARY${RESET}`);
    console.log(`  SP: ${mySummary.total_sp}`);
    console.log(`  Budget spent: ${formatMoney(mySummary.budget_spent)}`);
    console.log(`  Budget remaining: ${formatMoney(mySummary.budget_remaining)}`);
    console.log(`  Periods won: ${mySummary.periods_won}`);
    console.log(`  Rescinds: ${mySummary.rescinds_made}`);
    console.log(`  Capital efficiency: ${mySummary.capital_efficiency.toFixed(4)} pts/$`);
  }

  console.log('');
}

// ─── Input Helpers ──────────────────────────────────────────────────────────────

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useTestConfig = args.includes('--test');
  const myBotId = args.find((a) => a.startsWith('--name='))?.split('=')[1] ?? 'you';
  const seed = parseInt(
    args.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? String(Date.now()),
    10,
  );

  // Parse opponent selection
  const opponentsArg = args.find((a) => a.startsWith('--opponents='))?.split('=')[1];
  let opponentArchetypes: BotArchetype[];
  if (opponentsArg) {
    opponentArchetypes = opponentsArg.split(',') as BotArchetype[];
  } else {
    opponentArchetypes = [
      'adaptive_tracker',
      'balanced_spreader',
      'patient_sniper',
    ];
  }

  resetIdCounter();

  const config = useTestConfig
    ? createTestTournamentConfig()
    : createDefaultTournamentConfig();

  // Create the human proxy bot
  const humanBot = new HumanProxyBot(myBotId);

  // Create opponent bots
  const opponents: BotAgent[] = opponentArchetypes.map((arch, i) =>
    createBot(arch, arch, seed + i),
  );

  const allBots: BotAgent[] = [humanBot, ...opponents];

  const rl = createReadline();

  console.clear();
  console.log(`\n${BOLD}${CYAN}  CCA AUCTION TOURNAMENT — INTERACTIVE MODE${RESET}`);
  console.log(`${HR}`);
  console.log(`  You are: ${BOLD}${myBotId}${RESET}`);
  console.log(`  Opponents: ${opponents.map((b) => b.bot_id).join(', ')}`);
  console.log(`  Config: ${useTestConfig ? 'test (3 periods/stage)' : 'default (9 periods/stage)'}`);
  console.log(`  Budget: ${formatMoney(config.budget_per_bot)}`);
  console.log(
    `  Stages: ${config.stages.map((s, i) => `S${i + 1}(${s.base_token_supply} tokens, ${formatMoney(s.floor_price)} floor, ${s.points_per_token}× pts)`).join('  ')}`,
  );
  console.log(`${HR}`);

  const ready = await ask(rl, `\n  Press Enter to begin...`);

  // The engine calls decideBids/decideRescind synchronously.
  // We use fs.readSync(0, ...) to read stdin synchronously within callbacks.

  function readLineSync(prompt: string): string {
    process.stdout.write(prompt);
    const buf = Buffer.alloc(256);
    try {
      const bytesRead = require('fs').readSync(0, buf, 0, 256);
      return buf.toString('utf-8', 0, bytesRead).trim();
    } catch {
      return '';
    }
  }

  // Close the async readline — we use sync fd reads inside the bot
  rl.close();

  // Track stage transitions
  let lastStage = -1;

  humanBot.setBidHandler((obs: BotObservation): BotBidDecision => {
    // Stage transition announcement
    if (obs.stage !== lastStage && lastStage >= 0) {
      // Find the leaderboard from previous stage end
      printStageEnd(lastStage, obs);
    }
    lastStage = obs.stage;

    printObservation(obs, myBotId);

    // Synchronous input loop
    while (true) {
      const input = readLineSync(
        `  ${BOLD}Your bid${RESET} (price/token, or "skip"): `,
      );

      if (input === '' || input.toLowerCase() === 'skip' || input === 's') {
        console.log(`  ${DIM}Skipping this period.${RESET}`);
        return { bids: [] };
      }

      // JSON input
      if (input.startsWith('{')) {
        try {
          const parsed = JSON.parse(input);
          if (parsed.skip) {
            console.log(`  ${DIM}Skipping this period.${RESET}`);
            return { bids: [] };
          }
          const price = Number(parsed.price_per_token);
          if (price && price >= obs.floor_price && price * obs.tokens_available <= obs.remaining_budget) {
            console.log(`  ${GREEN}Bidding ${formatMoney(price)}/token${RESET}`);
            return { bids: [{ price_per_token: price }] };
          }
        } catch { /* fall through */ }
      }

      const price = parseFloat(input);
      if (isNaN(price)) {
        console.log(`  ${RED}Enter a number, "skip", or paste JSON.${RESET}`);
        continue;
      }
      if (price < obs.floor_price) {
        console.log(`  ${RED}Below floor (${formatMoney(obs.floor_price)}). Try again.${RESET}`);
        continue;
      }
      if (price * obs.tokens_available > obs.remaining_budget) {
        console.log(`  ${RED}Can't afford. Max: ${formatMoney(obs.remaining_budget / obs.tokens_available)}/token.${RESET}`);
        continue;
      }

      console.log(`  ${GREEN}Bidding ${formatMoney(price)}/token${RESET}`);
      return { bids: [{ price_per_token: price }] };
    }
  });

  humanBot.setRescindHandler(
    (obs: BotObservation, winResult: PeriodResult): BotRescindDecision => {
      printRescindPrompt(winResult);

      while (true) {
        const input = readLineSync(
          `  ${BOLD}Rescind?${RESET} (keep/rescind): `,
        );

        const lower = input.toLowerCase();
        if (lower === '' || lower === 'k' || lower === 'keep' || lower === 'n' || lower === 'no') {
          console.log(`  ${GREEN}Keeping tokens.${RESET}`);
          return { rescind: false };
        }
        if (lower === 'r' || lower === 'rescind' || lower === 'y' || lower === 'yes') {
          console.log(`  ${YELLOW}Rescinding — tokens return in 2 periods.${RESET}`);
          return { rescind: true };
        }

        // JSON
        if (input.startsWith('{')) {
          try {
            const parsed = JSON.parse(input);
            const r = Boolean(parsed.rescind);
            console.log(r ? `  ${YELLOW}Rescinding.${RESET}` : `  ${GREEN}Keeping.${RESET}`);
            return { rescind: r };
          } catch { /* fall through */ }
        }

        console.log(`  ${RED}Enter "keep" or "rescind".${RESET}`);
      }
    },
  );

  // Now we need to intercept period results to show clearing outcomes.
  // We'll wrap the engine and observe results by monkey-patching the
  // store's addPeriodResult. Actually, the simplest way: run the engine
  // and show results at the end. But that defeats the purpose of
  // interactive mode where you want to SEE what happened before the
  // next period.

  // The cleanest approach: the observation for period N+1 already
  // contains the result of period N in the history. So we can detect
  // new results by comparing history length.

  let lastHistoryLength = 0;

  const originalBidHandler = humanBot['bidHandler']!;
  humanBot.setBidHandler((obs: BotObservation): BotBidDecision => {
    // Show results of the previous period(s) that we haven't seen yet
    if (obs.history.length > lastHistoryLength) {
      const newResults = obs.history.slice(lastHistoryLength);
      for (const pr of newResults) {
        printClearingResult(pr, myBotId);
      }
      lastHistoryLength = obs.history.length;
    }

    return originalBidHandler(obs);
  });

  // Run the tournament
  const engine = new TournamentEngine(config, allBots);
  const result = engine.run();

  // Show the last period's result (not yet seen in the next observation)
  const finalPeriods = result.all_period_results.slice(lastHistoryLength);
  for (const pr of finalPeriods) {
    printClearingResult(pr, myBotId);
  }

  // Show final stage end
  if (lastStage >= 0) {
    const lastEntry = result.final_leaderboard.map((e) => ({
      bot_id: e.bot_id,
      tokens_per_stage: e.tokens_per_stage,
      weighted_points: e.weighted_points,
      sp: e.sp,
    }));
    printStageEnd(config.stages.length - 1, {
      leaderboard: lastEntry,
    } as any);
  }

  printFinalResults(result, myBotId);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
