# PSX Pulse Analytics

An educational dashboard for 20 Pakistan Stock Exchange companies. It shows a mock market, risk advisory and a PKR paper wallet. It is plain HTML, CSS and JavaScript, with no build step, no npm and no API keys.

**Mock data.** Prices are generated, not live. Nothing in this app reflects real PSX trading. It is for learning about risk, diversification and circuit breakers. It is not investment advice.

## Run it

Double-click `index.html`. No server is needed. Press **Start** on the Market tab to run the market.

## What it does

- **Market:** 20 companies (10 blue chips and 10 from other sectors). Each tick is one simulated minute, and a session is one trading day.
- **Charts:** a multi-series % change chart with toggles for each company, a sector wheel (market-cap share), and a volatility ranking (fat-line bars).
- **Risk advisory:** flags for over-concentrated companies and sectors, stocks moving together, frozen stocks, and your own wallet's concentration.
- **Circuit breaker:** a stock that moves past the limit from the previous close freezes for the rest of the day. A neon banner shows which stocks are frozen.
- **Paper wallet:** starts with PKR 1,000,000. Buys and sells are in whole shares, with commission, sales tax on commission, slippage, and capital gains tax on profits (filer or non-filer rate).
- **Saved in this browser only:** the market and the wallet are saved in `localStorage`. Use "New market" or "Reset wallet" to start again.

## Placeholders: check before relying on any figure

All of these live in `js/config.js`:

- **Reference prices and share counts** are placeholders, so the sector and concentration flags reflect the placeholders, not the real index.
- **Circuit breaker:** 10% is the SECP-approved phased rule (2024). Its current status is unconfirmed. You can choose 7.5% in the Wallet settings.
- **Tax and commission:** the capital gains rates (15% filer, 30% non-filer), commission and sales tax are placeholders. Verify them against the Finance Act and your broker.
- **Three tickers** (HCAR, ABOT and UNITY) are in the index but are not yet confirmed on PSX.

## Tests

```bash
node --test tests/engine.test.js
```

The 14 tests cover the random generator, market reproducibility, saving and restoring a market, the circuit breaker freezing at the exact limit, next-day resets, commission and tax on buys and sells, halted trades, whole shares and cash limits, filer and non-filer tax, average cost, slippage, index weights and the risk flags.

## Structure

```
index.html           page: header, breaker banner, four tabs, signature footer
css/app.css          layout, breakpoints, neon breaker banner, tabs, footer
js/config.js         instruments, market model, circuit breaker, wallet rates, thresholds
js/engine.js         pure logic: random generator, market, circuit breaker, wallet, risk
js/charts.js         hand-drawn SVG charts (line, donut, horizontal bars)
js/app.js            controller: loop, rendering, trades, settings, tabs
tests/engine.test.js Node tests for the engine
```

## Responsive layout

- **Phones (270px and up):** four tabs at the bottom (Market, Charts, Risk, Wallet). The 20 companies appear as one column of compact rows.
- **Tablet and up:** the company rows form two columns.
- **Footer:** the "Idea By: Azmat Ali" signature stays fixed at the bottom in a calligraphy font. It never wraps.
