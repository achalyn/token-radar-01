// Farm plans: six concrete steps per protocol, derived from the protocol's
// own record (category, chains, TVL, age) — never from a list of names.
//
// Every step is one string: the action, what it costs, how long it takes.
// The same function runs in main.ts (for board.json) and in the dashboard
// (for the detail view), so the page and the board always agree.

/** Capital for one farm position, from the protocol's TVL. */
export function capitalFor(tvlUsd) {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  return 100;
}

/** How long to hold, from the protocol's age in days. */
export function holdDaysFor(age) {
  if (age === null || age === undefined) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function chainOf(p) {
  return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

/** The category's core action, in the words a farmer can follow. */
export function actionFor(p, capital, chain) {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral, then borrow a small amount against it so the position counts as active lending.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} in the USDC pair, and keep the LP position open.`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside the protocol's own app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it after a week.`;
  if (c.includes('prediction'))
    return `Fund your account with $${capital} and place one position on a high-volume market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital'))
    return `Allocate $${capital} into a ${name} vault on ${chain} and keep the vault shares for the full holding period.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it to accrue the underlying yield.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the holding period.`;
  if (c.includes('basis'))
    return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open through one funding cycle.`;
  if (c.includes('otc'))
    return `Complete one OTC trade of at least $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('chain'))
    return `Bridge $${capital} of USDC onto ${name} and use it in one of the chain's own apps, keeping the funds on-chain.`;
  if (c.includes('payment'))
    return `Send one payment of $${capital} through ${name} on ${chain} and keep the transaction receipt in the farming wallet.`;
  if (c.includes('governance'))
    return `Lock $${capital} of assets in ${name}'s governance vault on ${chain} and vote in the next proposal.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step as a single string, with cost and time, within 20..600 chars. */
function step(text, cost, time) {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** A protocol's six-step farm plan. `p` carries slug, name, category,
 *  chains and tvl_usd; `age` is whole days since listed_at, or null. */
export function farmStepsFor(p, age) {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    step(
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    step(actionFor(p, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    step(
      'Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeated use',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    step(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    step(
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes",
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    step(
      'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}
