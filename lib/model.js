// Token-radar model: a power-law fit on the snapshot's own traded protocols.
//
// The implied value of a pre-token protocol is built only from the sealed
// snapshot's own figures, never from a list of names:
//
//   base   = exp(a + b * ln(tvl_usd))
//   growth = 1 + clamp(change_7d, -50, +100) / 200   (null -> 1.00)
//   age    = 1 + 0.15 * min(years since listed_at, 4) / 4   (null -> 1.00)
//   implied = max(1, round(base * growth * age))
//
// a and b are the least-squares fit of ln(market cap) on ln(TVL) over the
// core comps: the traded protocols (mcap_usd > 0) outside the exchange /
// bridge / liquid-staking families, whose market-cap / TVL ratios do not
// describe a DeFi protocol: CEX, Bridge, Canonical Bridge, Cross Chain
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and Stablecoin
// Wrapper. On this snapshot that leaves 90 comps, with a = 8.81 and
// b = 0.41.
//
// Leave-one-out backtest on those 90 comps (each protocol predicted from
// the other 89): median absolute error 1.27 in log terms, about 3.6x,
// with 37% of predictions within 2x. Token values are noisy; the board
// states the implied value as a point estimate and the dashboard shows
// the uncertainty band the backtest implies. No name is ever
// special-cased: the same function scores every row.

export const MODEL_VERSION = 'radar-loglog-1';

export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
export const GROWTH_DIVISOR = 200;
export const AGE_BONUS = 0.15;
export const AGE_CAP_YEARS = 4;

const DAY_MS = 86_400_000;

/** Categories whose traded ratios do not describe a DeFi protocol. */
export const CORE_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
]);

/** The house watchlist rule's exclusions, for protocols below the floor. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = new Set(['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']);
const WATCHLIST_EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol's record carries no token at all. */
export function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a below-floor protocol may join the board: pre-token and not a
 *  wrapped, staked, bridged, versioned or exchange product. */
export function isRankable(p) {
  if (!isPreToken(p)) return false;
  if (WATCHLIST_EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  const first = (p.name.split(/\s+/)[0] ?? '').toLowerCase();
  if (EXCHANGE_NAMES.has(first)) return false;
  return true;
}

/** Whole days from listed_at to asOf, or null when either date is missing. */
export function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The core comps: traded protocols outside the excluded families. */
export function coreComps(protocols) {
  return protocols.filter(
    (p) =>
      typeof p.mcap_usd === 'number' &&
      p.mcap_usd > 0 &&
      typeof p.tvl_usd === 'number' &&
      p.tvl_usd > 0 &&
      !CORE_EXCLUDED_CATEGORIES.has(p.category),
  );
}

/** Least-squares fit of ln(mcap) on ln(TVL) over the core comps. */
export function fitLogLog(protocols) {
  const comps = coreComps(protocols);
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = den === 0 ? 0 : num / den;
  const a = my - b * mx;
  return { a, b, n };
}

/** The growth multiplier from a 7-day TVL change in per cent. */
export function growthMultiplier(change7d) {
  if (typeof change7d !== 'number' || !Number.isFinite(change7d)) return 1;
  const clipped = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, change7d));
  return 1 + clipped / GROWTH_DIVISOR;
}

/** The age multiplier from whole days listed (null: no bonus). */
export function ageMultiplier(age) {
  if (age === null || age === undefined) return 1;
  const years = Math.min(Math.max(age, 0) / 365.25, AGE_CAP_YEARS);
  return 1 + AGE_BONUS * (years / AGE_CAP_YEARS);
}

/** Score one protocol: its implied value and every factor behind it. */
export function impliedValue(p, asOf, fit) {
  const age = ageDays(asOf, p.listed_at);
  const base = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd));
  const growth = growthMultiplier(p.change_7d);
  const ageMult = ageMultiplier(age);
  const implied = Math.max(1, Math.round(base * growth * ageMult));
  return { implied, base: Math.round(base), growth, ageMult, age };
}

/** Leave-one-out backtest of the fitted model on the core comps: median
 *  absolute log error and the share of predictions within 2x and 3x. */
export function backtest(protocols, asOf) {
  const comps = coreComps(protocols);
  const errors = [];
  for (const p of comps) {
    const others = comps.filter((q) => q !== p);
    const fit = fitLogLog(others);
    const { implied } = impliedValue(p, asOf, fit);
    errors.push(Math.abs(Math.log(p.mcap_usd / implied)));
  }
  errors.sort((a, b) => a - b);
  const med = errors.length === 0 ? 0 : errors[Math.floor(errors.length / 2)];
  const within2 = errors.filter((e) => e < Math.log(2)).length;
  const within3 = errors.filter((e) => e < Math.log(3)).length;
  return {
    n: comps.length,
    median_log_error: Math.round(med * 1000) / 1000,
    median_factor: Math.round(Math.exp(med) * 100) / 100,
    within_2x: errors.length === 0 ? 0 : Math.round((within2 / errors.length) * 100),
    within_3x: errors.length === 0 ? 0 : Math.round((within3 / errors.length) * 100),
  };
}
