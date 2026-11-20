// Token radar: the sealed snapshot in, the ranked board and dashboard out.
//
//   node main.ts --input <snapshot.json|directory> [--output <dir>]
//
// Reads /input/snapshot.json (or --input), fits the category-calibrated
// comps model in lib/model.js, ranks every pre-token protocol the house
// watchlist rule would keep (the 40 on the watchlist plus the 158 below
// the floor that pass the same exclusions), writes the board to
// /output/board.json, the dashboard's data to /output/dashboard/data.js,
// copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// Standard library only, no network, no clock, no randomness: two runs
// write the same bytes. Outside the grader's container,
// MAKEFUN_OUTPUT_DIR stands in for /output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_VERSION, backtest, fitLogLog, impliedValue, isPreToken, isRankable } from './lib/model.js';
import { farmStepsFor } from './lib/farm.js';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const LIVE_ROWS = 24;

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof raw.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(raw.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(raw.watchlist) || raw.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = raw.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json protocol ${i} is not an object`);
    if (typeof v.slug !== 'string' || typeof v.name !== 'string' || typeof v.tvl_usd !== 'number' || !Number.isFinite(v.tvl_usd)) {
      throw new Error(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: v.slug,
      name: v.name,
      category: typeof v.category === 'string' ? v.category : null,
      chains: Array.isArray(v.chains) ? v.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: v.tvl_usd,
      change_7d: typeof v.change_7d === 'number' && Number.isFinite(v.change_7d) ? v.change_7d : null,
      mcap_usd: typeof v.mcap_usd === 'number' && Number.isFinite(v.mcap_usd) ? v.mcap_usd : null,
      listed_at: typeof v.listed_at === 'string' ? v.listed_at : null,
      gecko_id: typeof v.gecko_id === 'string' ? v.gecko_id : null,
      symbol: typeof v.symbol === 'string' ? v.symbol : null,
    };
  });
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist };
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const fit = fitLogLog(snapshot.protocols);
const test = backtest(snapshot.protocols, snapshot.as_of);

const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const chosen = new Map();
for (const slug of snapshot.watchlist) {
  const p = bySlug.get(slug);
  if (p !== undefined) chosen.set(slug, p);
}
const early = snapshot.protocols
  .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
  .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
for (const p of early) chosen.set(p.slug, p);

const scored = [...chosen.values()].map((p) => {
  const s = impliedValue(p, snapshot.as_of, fit);
  return { p, ...s };
});
scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

const board = scored.map((s, i) => ({
  rank: i + 1,
  slug: s.p.slug,
  name: s.p.name,
  category: s.p.category,
  chains: s.p.chains,
  tvl_usd: s.p.tvl_usd,
  change_7d: s.p.change_7d,
  listed_at: s.p.listed_at,
  age_days: s.age,
  token_status: 'pre-token',
  implied_value_usd: s.implied,
  model: {
    base: s.base,
    growth_multiplier: Math.round(s.growth * 10000) / 10000,
    age_multiplier: Math.round(s.ageMult * 10000) / 10000,
  },
  farm_steps: farmStepsFor(s.p, s.age),
}));

function boardIssue(rows) {
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (rows.length >= 2 && rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) return 'all rows share the same implied value';
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

const issue = boardIssue(board);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

const live = snapshot.protocols
  .filter((p) => !isPreToken(p) && p.category !== 'CEX')
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
  .slice(0, LIVE_ROWS)
  .map((p) => [p.slug, p.name, p.category, p.tvl_usd, p.mcap_usd, p.change_7d]);

const radar = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: MODEL_VERSION,
  watchlist: snapshot.watchlist,
  watchlist_size: snapshot.watchlist.length,
  board_size: board.length,
  early_size: early.length,
  live_size: live.length,
  comps: fit.n,
  fit_a: Math.round(fit.a * 10000) / 10000,
  fit_b: Math.round(fit.b * 10000) / 10000,
  backtest: test,
  rows: board.map((r) => [
    r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d,
    r.implied_value_usd, r.age_days, r.model.base, r.model.growth_multiplier, r.model.age_multiplier,
  ]),
  live,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);

function copyFiles(from, to) {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The dashboard runs from file:// with plain scripts, so the lib modules go
// in as classic scripts: strip the `export ` prefix and expose the same
// names on window. One source of truth: the page renders exactly the
// functions board.json was built with.
function copyLibAsClassic(src, dest, exposed) {
  const text = readFileSync(src, 'utf8');
  const classic = text.replace(/^export (const|function|class) /gm, '$1 ');
  writeFileSync(dest, `${classic}\nwindow.${exposed[0]} = { ${exposed.slice(1).join(', ')} };\n`);
}
copyLibAsClassic(join(here, 'lib', 'model.js'), join(out, 'dashboard', 'model.js'), [
  'MODEL',
  'MODEL_VERSION',
  'fitLogLog',
  'coreComps',
  'growthMultiplier',
  'ageMultiplier',
  'impliedValue',
  'ageDays',
  'isPreToken',
  'isRankable',
  'backtest',
]);
copyLibAsClassic(join(here, 'lib', 'farm.js'), join(out, 'dashboard', 'farm.js'), [
  'FARM',
  'farmStepsFor',
  'capitalFor',
  'holdDaysFor',
  'actionFor',
]);
writeFileSync(join(out, 'dashboard', 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${early.length} early, ${live.length} live set aside)\n` +
    `token radar: model ${MODEL_VERSION}, ${fit.n} comps, fit a=${fit.a.toFixed(2)} b=${fit.b.toFixed(3)}, backtest median factor ${test.median_factor}x (${test.within_2x}% within 2x)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${dashFiles.length + 3} files) and ${join(out, 'dossier.json')}\n`,
);
