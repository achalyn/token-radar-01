// Token Launch Radar — the entrypoint (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol
// with the model in lib/model.js, writes the ranked board to
// /output/board.json, writes the dashboard's data into /output/dashboard,
// copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: it reads
// dashboard/data.js, which this program writes from the same board the
// gate reads, and its model.js / farm.js are generated here from lib/ so
// the page runs byte-identical logic to the board's generator.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_VERSION,
  ageDays,
  backtest,
  coreComps,
  fitLogLog,
  impliedValue,
  isRankable,
} from './lib/model.js';
import { farmStepsFor } from './lib/farm.js';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const LIVE_COUNT = 24;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));
if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
  process.stderr.write('token radar: snapshot has no protocols or watchlist arrays\n');
  process.exit(2);
}
const FIELDS = [
  'slug',
  'name',
  'category',
  'chains',
  'tvl_usd',
  'change_7d',
  'mcap_usd',
  'listed_at',
  'gecko_id',
  'symbol',
];
for (const p of snapshot.protocols) {
  for (const f of FIELDS) {
    if (!(f in p)) {
      process.stderr.write(`token radar: protocol ${p.slug ?? '?'} has no ${f}\n`);
      process.exit(2);
    }
  }
}

// The fit, from the snapshot's own traded protocols.
const comps = coreComps(snapshot.protocols);
const fit = fitLogLog(comps);
const back = backtest(comps);

// The board: every watchlist protocol plus every rankable protocol below
// the floor, ranked by implied value, slug ascending on a tie.
const scored = snapshot.protocols
  .filter((p: any) => isRankable(p))
  .map((p: any) => {
    const v = impliedValue(p, fit, snapshot.as_of);
    return { p, ...v };
  });
scored.sort((x: any, y: any) => y.implied - x.implied || (x.p.slug < y.p.slug ? -1 : 1));

const rows = scored.map((s: any, i: number) => ({
  slug: s.p.slug,
  name: s.p.name,
  rank: i + 1,
  implied_value_usd: s.implied,
  farm_steps: farmStepsFor(s.p, s.ageDays),
}));

// The gate's own checks, run here before anything is written.
function boardIssue(): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(rows.map((r: any) => r.slug));
  for (const w of snapshot.watchlist) {
    if (!slugs.has(w)) return `watchlist slug ${w} is missing from the board`;
  }
  const seen = new Set<number>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = rows.length > 1;
  for (const r of rows) {
    if (!Number.isInteger(r.rank) || r.rank < 1 || seen.has(r.rank)) return `rank ${r.rank} is not a fresh positive whole number`;
    seen.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) {
      return `implied value ${r.implied_value_usd} for ${r.slug} is not a positive whole number under 10^14`;
    }
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    if (r.implied_value_usd !== prev && prev !== Number.POSITIVE_INFINITY) allSame = false;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} carries ${r.farm_steps?.length ?? 0} farm steps, the gate wants 3 to 12`;
    }
    for (const s of r.farm_steps) {
      const t = String(s).trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters, the gate wants 20 to 600`;
    }
  }
  for (let i = 1; i <= rows.length; i++) if (!seen.has(i)) return `rank ${i} is missing`;
  if (allSame) return 'every implied value is the same: that is not a ranking';
  return null;
}
const issue = boardIssue();
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// The live tokens, shown apart and never ranked: the largest traded
// protocols by market cap, exchanges left out.
const live = snapshot.protocols
  .filter((p: any) => p.mcap_usd != null && p.mcap_usd > 0 && p.category !== 'CEX')
  .sort((a: any, b: any) => b.mcap_usd - a.mcap_usd)
  .slice(0, LIVE_COUNT)
  .map((p: any) => [p.slug, p.name, p.category, p.tvl_usd, p.mcap_usd, p.change_7d]);

const watchlistSet = new Set(snapshot.watchlist);
const radar = {
  as_of: snapshot.as_of,
  board_size: rows.length,
  watchlist_size: snapshot.watchlist.length,
  early_size: rows.length - snapshot.watchlist.length,
  live_size: live.length,
  comps: comps.length,
  model_version: MODEL_VERSION,
  fit_a: Math.round(fit.a * 10000) / 10000,
  fit_b: Math.round(fit.b * 10000) / 10000,
  backtest: back,
  watchlist: [...snapshot.watchlist].sort(),
  rows: scored.map((s: any, i: number) => [
    i + 1,
    s.p.slug,
    s.p.name,
    s.p.category,
    s.p.chains,
    s.p.tvl_usd,
    s.p.change_7d,
    s.implied,
    s.ageDays,
    Math.round(s.base),
    Math.round(s.growth * 100) / 100,
    Math.round(s.ageMult * 100) / 100,
  ]),
  live,
};

mkdirSync(out, { recursive: true });
mkdirSync(join(out, 'dashboard'), { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'dashboard', 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`);

/** Copy one directory's regular files into `to`, skipping dot-names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * A lib file as a classic script: strip the leading `export ` from its
 * declarations and attach its names to window, so the page runs the same
 * code the board was built with.
 */
function copyLibAsClassic(from: string, to: string, globalName: string, names: string[]): void {
  const src = readFileSync(from, 'utf8').replace(/^export (const|function|class) /gm, '$1 ');
  const attach = `window.${globalName} = { ${names.join(', ')} };\n`;
  writeFileSync(to, `${src}\n${attach}`);
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
copyLibAsClassic(
  join(here, 'lib', 'model.js'),
  join(out, 'dashboard', 'model.js'),
  'MODEL',
  [
    'MODEL_VERSION',
    'WATCHLIST_EXCLUDED_CATEGORIES',
    'COMP_EXCLUDED_CATEGORIES',
    'VERSION_MARKER',
    'WRAPPED_WORD',
    'EXCHANGE_NAMES',
    'isPreToken',
    'isRankable',
    'ageDays',
    'coreComps',
    'fitLogLog',
    'growthMultiplier',
    'ageMultiplier',
    'impliedValue',
    'backtest',
  ],
);
copyLibAsClassic(
  join(here, 'lib', 'farm.js'),
  join(out, 'dashboard', 'farm.js'),
  'FARM',
  ['capitalFor', 'holdDaysFor', 'CATEGORY_ACTIONS', 'actionFor', 'farmStepsFor'],
);

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output
// and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: model ${MODEL_VERSION}, ${comps.length} comps, fit a=${fit.a.toFixed(2)} b=${fit.b.toFixed(3)}, backtest median factor ${back.median_factor}x (${back.within_2x}% within 2x)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${dashFiles.length + 3} files) and ${join(out, 'dossier.json')}\n`,
);
