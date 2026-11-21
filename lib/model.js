// Token Launch Radar — the value model (radar-loglog-1).
//
// A protocol that records no token is worth what the market already pays
// for the same shape of protocol that does have one. The model is a
// power-law fit of ln(market cap) on ln(TVL) over the snapshot's own traded
// protocols (the core comps), then two small, stated adjustments:
//
//   implied = exp(a + b * ln TVL) * growth * age
//
//   growth = 1 + clamp(change_7d, -50, +100) / 200   (null change -> 1.0)
//   age    = 1 + 0.15 * min(years listed, 4) / 4      (null listed_at -> 1.0)
//
// On this snapshot the fit over the 90 core comps gives a = 8.8089,
// b = 0.4142. Leave-one-out backtest on those comps: median prediction
// within 3.65x, 37% within 2x. The data is extremely noisy, so every
// implied value is a point estimate with a wide honest band, never a price.
// No protocol name is ever special-cased: the same formula scores all 198.

export const MODEL_VERSION = 'radar-loglog-1';

// Categories the watchlist rule already keeps out of the pre-token board.
export const WATCHLIST_EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

// Categories kept out of the traded comps as well (a wrapped, bridged or
// staked product's market cap is not the market pricing a protocol).
export const COMP_EXCLUDED_CATEGORIES = new Set([
  ...WATCHLIST_EXCLUDED_CATEGORIES,
  'Cross Chain Bridge',
  'Stablecoin Wrapper',
]);

// A version marker: a space followed by V2, v2, 2.0 or the like.
export const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// A whole word wrapped, staked or staking, in any case.
export const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// Exchange names: a protocol beginning with one is the exchange's product.
export const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** True when the snapshot records no token for the protocol at all. */
export function isPreToken(p) {
  return p.mcap_usd == null && p.gecko_id == null && p.symbol == null;
}

/**
 * True when a pre-token protocol may be ranked: it passes the same
 * exclusions the watchlist rule applies (wrapped / staked / bridged /
 * versioned / exchange products are products of tokens that already
 * trade, not protocols still waiting on a launch of their own).
 */
export function isRankable(p) {
  if (!isPreToken(p)) return false;
  if (WATCHLIST_EXCLUDED_CATEGORIES.has(p.category)) return false;
  const name = p.name || '';
  if (VERSION_MARKER.test(name)) return false;
  if (WRAPPED_WORD.test(name)) return false;
  if (EXCHANGE_NAMES.some((e) => name.startsWith(e))) return false;
  return true;
}

/** Whole days between listed_at and the snapshot's as_of date, or null. */
export function ageDays(p, asOf) {
  if (!p.listed_at) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(listed) || Number.isNaN(at)) return null;
  const days = Math.floor((at - listed) / 86400000);
  return days < 0 ? 0 : days;
}

/** Traded protocols that can price a pre-token one: mcap and TVL both set. */
export function coreComps(protocols) {
  return protocols.filter(
    (p) =>
      p.mcap_usd != null &&
      p.mcap_usd > 0 &&
      p.tvl_usd != null &&
      p.tvl_usd > 0 &&
      !COMP_EXCLUDED_CATEGORIES.has(p.category),
  );
}

/** Least-squares fit of ln(mcap) on ln(TVL): { a, b, n }. */
export function fitLogLog(comps) {
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b, n };
}

/** Growth multiplier from the 7-day TVL change, clipped to -50..+100%. */
export function growthMultiplier(p) {
  if (p.change_7d == null) return 1;
  const c = Math.max(-50, Math.min(100, p.change_7d));
  return 1 + c / 200;
}

/** Age multiplier: up to +15% for four years listed with no token. */
export function ageMultiplier(days) {
  if (days == null) return 1;
  const years = Math.min(days / 365.25, 4);
  return 1 + (0.15 * years) / 4;
}

/**
 * The implied value of a launch, with the working parts exposed so the
 * dashboard can show the whole calculation for one protocol.
 */
export function impliedValue(p, fit, asOf) {
  const base = Math.exp(fit.a + fit.b * Math.log(p.tvl_usd));
  const growth = growthMultiplier(p);
  const days = ageDays(p, asOf);
  const ageMult = ageMultiplier(days);
  const implied = Math.max(1, Math.round(base * growth * ageMult));
  return { implied, base, growth, ageMult, ageDays: days };
}

/**
 * Leave-one-out backtest on the core comps: refit without each comp,
 * predict it, and measure the log error. Returns the median factor error
 * and the share predicted within 2x.
 */
export function backtest(comps) {
  const errs = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const fit = fitLogLog(rest);
    const pred = Math.exp(fit.a + fit.b * Math.log(comps[i].tvl_usd));
    errs.push(Math.abs(Math.log(pred / comps[i].mcap_usd)));
  }
  errs.sort((x, y) => x - y);
  const median = errs[Math.floor(errs.length / 2)];
  const within2x = errs.filter((e) => e < Math.log(2)).length / errs.length;
  return {
    n: comps.length,
    median_factor: Math.round(Math.exp(median) * 100) / 100,
    within_2x: Math.round(within2x * 100),
  };
}
