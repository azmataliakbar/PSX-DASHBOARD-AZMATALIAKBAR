/* Configuration for PSX Pulse Analytics. Educational mock simulation: no live prices, no API keys.
   Exposes window.PSX.config.

   IMPORTANT: every reference price and share count below is a PLACEHOLDER so the simulator has
   realistic-looking starting points. Replace them with current PSX data before using any figure.
   Tax and commission rates are also placeholders: verify them against the Finance Act and your broker. */
(function () {
  "use strict";
  var PSX = (window.PSX = window.PSX || {});

  // p = placeholder reference price (PKR, previous close), sh = placeholder shares (millions),
  // vol = placeholder daily volatility (fraction), beta = sensitivity to the market factor.
  var INSTRUMENTS = [
    { t: "SYS",    n: "Systems",          s: "Technology",    g: "Blue chip", p: 500,  sh: 200,  vol: 0.025, beta: 0.8 },
    { t: "ENGRO",  n: "Engro Corp",       s: "Conglomerate",  g: "Blue chip", p: 300,  sh: 280,  vol: 0.020, beta: 1.0 },
    { t: "HUBC",   n: "Hub Power",        s: "Power",         g: "Blue chip", p: 150,  sh: 1000, vol: 0.020, beta: 0.7 },
    { t: "OGDC",   n: "Oil & Gas Dev.",   s: "Oil & Gas",     g: "Blue chip", p: 200,  sh: 3800, vol: 0.018, beta: 0.9 },
    { t: "PPL",    n: "Pakistan Petrol.", s: "Oil & Gas",     g: "Blue chip", p: 100,  sh: 2000, vol: 0.020, beta: 0.9 },
    { t: "MCB",    n: "MCB Bank",         s: "Banking",       g: "Blue chip", p: 250,  sh: 900,  vol: 0.015, beta: 0.8 },
    { t: "UBL",    n: "United Bank",      s: "Banking",       g: "Blue chip", p: 300,  sh: 900,  vol: 0.016, beta: 0.85 },
    { t: "LUCK",   n: "Lucky Cement",     s: "Cement",        g: "Blue chip", p: 1200, sh: 220,  vol: 0.020, beta: 1.0 },
    { t: "EFERT",  n: "Engro Fertilizer", s: "Fertilizer",    g: "Blue chip", p: 150,  sh: 1500, vol: 0.020, beta: 0.9 },
    { t: "PSO",    n: "Pakistan State Oil", s: "Oil Marketing", g: "Blue chip", p: 200, sh: 680,  vol: 0.022, beta: 0.9 },
    { t: "NML",    n: "Nishat Mills",     s: "Textile",       g: "Extended",  p: 100,  sh: 500,  vol: 0.025, beta: 1.0 },
    { t: "TRG",    n: "TRG Pakistan",     s: "Technology",    g: "Extended",  p: 100,  sh: 300,  vol: 0.030, beta: 1.2 },
    { t: "INDU",   n: "Indus Motor",      s: "Auto",          g: "Extended",  p: 500,  sh: 60,   vol: 0.020, beta: 0.9 },
    { t: "HCAR",   n: "Honda Atlas",      s: "Auto",          g: "Extended",  p: 300,  sh: 100,  vol: 0.022, beta: 0.9 },
    { t: "SEARL",  n: "Searle Co.",       s: "Pharma",        g: "Extended",  p: 300,  sh: 200,  vol: 0.022, beta: 0.9 },
    { t: "ABOT",   n: "Abbott Pakistan",  s: "Pharma",        g: "Extended",  p: 500,  sh: 70,   vol: 0.018, beta: 0.8 },
    { t: "NESTLE", n: "Nestle Pakistan",  s: "Foods",         g: "Extended",  p: 5000, sh: 28,   vol: 0.015, beta: 0.7 },
    { t: "UNITY",  n: "Unity Foods",      s: "Foods",         g: "Extended",  p: 30,   sh: 700,  vol: 0.030, beta: 1.1 },
    { t: "MARI",   n: "Mari Energies",    s: "Oil & Gas",     g: "Extended",  p: 2000, sh: 90,   vol: 0.020, beta: 0.9 },
    { t: "KEL",    n: "K-Electric",       s: "Power",         g: "Extended",  p: 10,   sh: 6000, vol: 0.025, beta: 0.8 }
  ];

  PSX.config = {
    currency: "PKR",
    instruments: INSTRUMENTS,

    // Market session model. One tick = one simulated minute; a session is one trading day.
    ticksPerSession: 360,       // about 09:30 to 15:30 PKT
    tickMs: 2000,               // real time between ticks at 1x speed
    marketDaily: 0.008,         // daily volatility of the market factor (placeholder)
    sectorDaily: 0.006,         // daily volatility of each sector factor (placeholder)

    // Circuit breaker: a stock is frozen for the rest of the session once it moves this far from the previous close.
    // 10% is the rule the SECP approved in 2024 (phased in). Its current status is unconfirmed, so check the PSX notice.
    breakerDefault: 0.10,
    breakerOptions: [0.075, 0.10],

    // Paper wallet
    startCash: 1000000,         // PKR of mock money
    commission: 0.0015,         // broker commission per side (placeholder, verify)
    salesTaxOnCommission: 0.15, // sales tax on commission (placeholder, verify)
    baseSlippage: 0.0005,       // fixed execution slippage per trade
    impact: 0.1,                // extra slippage per unit of volatility and order size
    cgt: { filer: 0.15, nonFiler: 0.30 }, // capital gains tax on realised gains (placeholders, verify)

    // Risk advisory thresholds
    concentration: {
      stockMax: 0.10,           // one company above 10% of the index's market cap
      sectorMax: 0.25,          // one sector above 25% of the index's market cap
      walletStockMax: 0.20,     // one stock above 20% of your wallet
      walletSectorMax: 0.35,    // one sector above 35% of your wallet
      corrMax: 0.60             // average pairwise correlation above this = stocks moving together
    },

    storage: { market: "psx.market", wallet: "psx.wallet", settings: "psx.settings" }
  };
})();
