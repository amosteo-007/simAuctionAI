import { TournamentEngine } from './core/engine';
import { createDefaultTournamentConfig } from './core/configs';
import { createBot, ALL_ARCHETYPES, BotArchetype } from './bots/archetypes';
import { GeminiBot } from './bots/gemini';
import { BotAgent, TournamentResult, resetIdCounter } from './models/types';

const NUM_RUNS = 500;
const hr = '═'.repeat(72);

function runBatch(
  label: string,
  makeBots: (run: number) => BotAgent[],
  runs: number = NUM_RUNS,
): Map<string, { wins: number; sp: number[]; pts: number[] }> {
  const stats = new Map<string, { wins: number; sp: number[]; pts: number[] }>();

  for (let i = 0; i < runs; i++) {
    resetIdCounter();
    const config = createDefaultTournamentConfig();
    const bots = makeBots(i);
    const engine = new TournamentEngine(config, bots);
    const result = engine.run();

    // Track winner
    const winnerId = result.winner_bot_id;
    // Map back to archetype name
    for (const entry of result.final_leaderboard) {
      const name = entry.bot_id.replace(/_r\d+$/, '');
      if (!stats.has(name)) stats.set(name, { wins: 0, sp: [], pts: [] });
      const s = stats.get(name)!;
      s.sp.push(entry.sp);
      s.pts.push(entry.weighted_points);
      if (entry.bot_id === winnerId) s.wins++;
    }
  }

  // Print
  console.log(`\n${hr}`);
  console.log(`  ${label} (${runs} runs)`);
  console.log(hr);

  const sorted = [...stats.entries()].sort((a, b) => b[1].wins - a[1].wins);
  for (const [name, s] of sorted) {
    const avgSP = (s.sp.reduce((a, b) => a + b, 0) / s.sp.length).toFixed(1);
    const avgPts = (s.pts.reduce((a, b) => a + b, 0) / s.pts.length).toFixed(0);
    const winRate = ((s.wins / runs) * 100).toFixed(1);
    console.log(
      `  ${name.padEnd(24)} Win: ${winRate.padStart(5)}% (${String(s.wins).padStart(3)}/${runs})  Avg SP: ${avgSP}  Avg Pts: ${avgPts}`,
    );
  }

  return stats;
}

// ── Test 1: Gemini vs all 6 archetypes ──────────────────────────────────────
const seed = { v: 42 };
runBatch('GEMINI vs ALL ARCHETYPES', (run) => {
  seed.v++;
  return [
    new GeminiBot(`gemini_r${run}`),
    createBot('adaptive_tracker', `adaptive_tracker_r${run}`, seed.v + 1),
    createBot('balanced_spreader', `balanced_spreader_r${run}`, seed.v + 2),
    createBot('patient_sniper', `patient_sniper_r${run}`, seed.v + 3),
    createBot('info_exploiter', `info_exploiter_r${run}`, seed.v + 4),
    createBot('chaos_agent', `chaos_agent_r${run}`, seed.v + 5),
    createBot('aggressive_early', `aggressive_early_r${run}`, seed.v + 6),
  ];
});

// ── Test 2: Gemini vs adaptive_tracker (the previous best) ──────────────────
seed.v = 100;
runBatch('GEMINI vs ADAPTIVE TRACKER (1v1)', (run) => {
  seed.v++;
  return [
    new GeminiBot(`gemini_r${run}`),
    createBot('adaptive_tracker', `adaptive_tracker_r${run}`, seed.v),
  ];
});

// ── Test 3: Gemini vs balanced_spreader ──────────────────────────────────────
seed.v = 200;
runBatch('GEMINI vs BALANCED SPREADER (1v1)', (run) => {
  seed.v++;
  return [
    new GeminiBot(`gemini_r${run}`),
    createBot('balanced_spreader', `balanced_spreader_r${run}`, seed.v),
  ];
});

// ── Test 4: 3 Geminis vs 3 trackers (does it break under self-competition?) ─
seed.v = 300;
runBatch('3× GEMINI vs 3× ADAPTIVE TRACKER', (run) => {
  seed.v++;
  return [
    new GeminiBot(`gemini_a_r${run}`),
    new GeminiBot(`gemini_b_r${run}`),
    new GeminiBot(`gemini_c_r${run}`),
    createBot('adaptive_tracker', `adaptive_tracker_a_r${run}`, seed.v + 1),
    createBot('adaptive_tracker', `adaptive_tracker_b_r${run}`, seed.v + 2),
    createBot('adaptive_tracker', `adaptive_tracker_c_r${run}`, seed.v + 3),
  ];
});

// ── Test 5: 3 Geminis vs 3 spreaders ────────────────────────────────────────
seed.v = 400;
runBatch('3× GEMINI vs 3× BALANCED SPREADER', (run) => {
  seed.v++;
  return [
    new GeminiBot(`gemini_a_r${run}`),
    new GeminiBot(`gemini_b_r${run}`),
    new GeminiBot(`gemini_c_r${run}`),
    createBot('balanced_spreader', `balanced_spreader_a_r${run}`, seed.v + 1),
    createBot('balanced_spreader', `balanced_spreader_b_r${run}`, seed.v + 2),
    createBot('balanced_spreader', `balanced_spreader_c_r${run}`, seed.v + 3),
  ];
});

// ── Test 6: All Geminis (mirror match — does it degenerate?) ────────────────
runBatch('6× GEMINI (mirror match)', (run) => {
  return [
    new GeminiBot(`gemini_1_r${run}`),
    new GeminiBot(`gemini_2_r${run}`),
    new GeminiBot(`gemini_3_r${run}`),
    new GeminiBot(`gemini_4_r${run}`),
    new GeminiBot(`gemini_5_r${run}`),
    new GeminiBot(`gemini_6_r${run}`),
  ];
});

console.log(`\n${hr}`);
console.log('  ANALYSIS COMPLETE');
console.log(hr);
