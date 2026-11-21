// Token Launch Radar — the farm plan.
//
// Every ranked protocol gets six concrete steps: what to do, what it
// costs and how long it takes. The steps are built from the protocol's own
// record (its category, its chains, its TVL, how long it has run), never
// from a list of names, so the same rules write every protocol's plan.

/** Capital to put to work, by the protocol's size. */
export function capitalFor(tvl) {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  return 100;
}

/** Days to hold the position, by how long the protocol has run. */
export function holdDaysFor(ageDays) {
  if (ageDays == null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/**
 * The one qualifying action for a category: the thing a farmer actually
 * does on that kind of protocol. Unknown categories fall back to a plain
 * deposit, which every protocol in the snapshot can take.
 */
export const CATEGORY_ACTIONS = {
  Lending: 'lend into a market',
  CDP: 'open a vault and mint against collateral',
  Dexs: 'add liquidity to a pool',
  'Yield Aggregator': 'deposit into a vault',
  Yield: 'deposit into a yield strategy',
  'Liquid Staking': 'stake and hold the receipt token',
  'Liquid Restaking': 'restake and hold the receipt token',
  Restaking: 'restake and hold the receipt token',
  Bridge: 'bridge assets across once a week',
  'Cross Chain Bridge': 'bridge assets across once a week',
  Perps: 'open a small perpetual position',
  Derivatives: 'open a small derivatives position',
  'Options Vault': 'deposit into an options vault',
  'Prediction Market': 'place a small prediction',
  'Risk Curators': 'deposit into a curated vault',
  'Onchain Capital Allocator': 'allocate into a managed vault',
  RWA: 'buy into a tokenised asset pool',
  'Real World Assets': 'buy into a tokenised asset pool',
  Insurance: 'buy cover for a position',
  'Basis Trading': 'deposit into a basis strategy',
  OTC: 'settle a small over-the-counter trade',
  'Algo-Stables': 'mint the stable against collateral',
  'Stablecoin Issuer': 'mint the stable against collateral',
  Payments: 'route a payment through the protocol',
  Privacy: 'make a private transfer',
  Governance: 'vote on a live proposal',
  'NFT Lending': 'lend against an NFT',
  'NFT Marketplace': 'list or buy an NFT',
  Gaming: 'play a session and hold the in-game asset',
  'Social Fi': 'post and hold the social token position',
  'Liquid Restaking Tokens': 'hold the restaking receipt token',
  'Tokenized Gold': 'hold the tokenised gold position',
  'Deri': 'open a small derivatives position',
  'Farm': 'stake in a farm pool',
  'Staking': 'stake and hold the receipt token',
  'Validator': 'delegate to a validator',
  'Chain': 'bridge in and use the chain',
  'Wallets': 'hold funds in the wallet',
  'Indexes': 'buy the index',
  'Leveraged Farming': 'open a small leveraged farm',
  'Options': 'buy a small option',
  'Structured Products': 'buy a structured product',
  'Synthetics': 'mint a small synthetic position',
  'Uncollateralized Lending': 'lend into a credit pool',
  'Reserve Currency': 'hold the reserve asset',
  'Treasury': 'deposit into the treasury vault',
  'Launchpad': 'join a launch allocation',
  'Meme': 'hold a small meme position',
  'AI': 'use the agent and hold the position',
  'Infra': 'run the service and hold the position',
  'DeFi': 'deposit into a vault',
};

export function actionFor(category) {
  return CATEGORY_ACTIONS[category] || 'deposit into a vault';
}

/**
 * Six farm steps for one protocol. Each step is one string carrying its
 * action, its cost and its time. p is { slug, name, category, chains,
 * tvl_usd }; ageDays is the whole days since listed_at, or null.
 */
export function farmStepsFor(p, ageDays) {
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(ageDays);
  const chain = (p.chains && p.chains[0]) || 'its main chain';
  const action = actionFor(p.category);
  const gas = p.tvl_usd >= 1_000_000_000 ? 8 : 5;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    `Allocate $${capital} to ${action} on ${p.name} on ${chain} and keep the position for the full holding period. Cost: $${capital} of capital and about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeated use. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}
