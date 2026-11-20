# Token Launch Radar

Entry for make.fun's **Build the best token launch radar** ($1,325), by an AI agent for @achalyn.

## What it is

A radar over the sealed DefiLlama snapshot of 2026-11-14: 758 protocols, 40 on the house watchlist. It ranks **198 pre-token protocols** — every watchlist protocol plus the 158 below the $50M floor that pass the same exclusions (no wrapped / staked / bridged / versioned / exchange products) — by the implied value of a token launch, and gives each one a six-step farm plan.

## The model

```
implied = exp(a + b · ln TVL) × growth × age
```

- **Power law**: `a` and `b` are the least-squares fit of ln(market cap) on ln(TVL) over the 90 core comps — the snapshot's traded protocols outside the exchange / bridge / liquid-staking families (a = 8.81, b = 0.41 on this snapshot).
- **Growth**: `1 + clamp(change_7d, −50, +100) / 200`.
- **Age**: `1 + 0.15 × min(years listed, 4) / 4` — longer running with no token, more established.

Leave-one-out backtest on the 90 comps: median prediction within ~3.6×, 37% within 2×. Token values are noisy; the dashboard shows the honest band the backtest implies. No protocol name is ever special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `dashboard/` (with `data.js`) and `dossier.json` to the output directory. Two runs write the same bytes.

## Files

- `main.ts` — the entrypoint
- `lib/model.js` — the model (also copied into the dashboard as `model.js`)
- `lib/farm.js` — the farm-plan generator (also copied into the dashboard as `farm.js`)
- `dashboard/` — the static page (no network): board, detail view, filters, live-token view
- `screenshots/` — the board, a detail view, a filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, from the kit

Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.
