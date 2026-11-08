/* PSX Pulse engine: pure logic, no DOM. Works in the browser (window.PSXEngine) and in Node.

   - Seeded random generator (mulberry32) so a market can be saved, restored and replayed exactly.
   - Mock market: one-factor model. log-return = beta * market + sector + stock noise.
   - Circuit breaker: a stock is frozen at its limit for the rest of the session once it moves that far from the previous close.
   - Paper wallet: lots, commission, sales tax on commission, slippage, capital gains tax (filer / non-filer).
   - Risk: market-cap weights, sector shares, HHI, volatility, average correlation, and advisory flags. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.PSXEngine = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Random numbers ----------

  function makeRng(seed) {
    var s = seed | 0;
    return {
      next: function () {
        s = (s + 0x6d2b79f5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      state: function () { return s; },
      set: function (v) { s = v | 0; }
    };
  }

  // Standard normal draw (Box-Muller).
  function normal(rng) {
    var u1 = Math.max(rng.next(), 1e-12);
    var u2 = rng.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // ---------- Statistics ----------

  function mean(a) {
    if (!a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  function stdev(a) {
    if (a.length < 2) return 0;
    var m = mean(a);
    var v = 0;
    for (var i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    return Math.sqrt(v / (a.length - 1));
  }

  // Annualised volatility from per-tick log returns. Null until there are enough points.
  function volatility(returns, ticksPerSession) {
    if (!returns || returns.length < 5) return null;
    return stdev(returns) * Math.sqrt(ticksPerSession * 252);
  }

  // Pearson correlation of the last n points of two series.
  function correlation(a, b) {
    var n = Math.min(a.length, b.length);
    if (n < 5) return null;
    var x = a.slice(a.length - n), y = b.slice(b.length - n);
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) * (x[i] - mx);
      syy += (y[i] - my) * (y[i] - my);
    }
    if (sxx === 0 || syy === 0) return 0;
    return sxy / Math.sqrt(sxx * syy);
  }

  // Average correlation over all pairs in the list. Null if fewer than two usable series.
  function averageCorrelation(seriesList) {
    var total = 0, count = 0;
    for (var i = 0; i < seriesList.length; i++) {
      for (var j = i + 1; j < seriesList.length; j++) {
        var c = correlation(seriesList[i], seriesList[j]);
        if (c !== null) { total += c; count++; }
      }
    }
    return count ? total / count : null;
  }

  // ---------- Market ----------

  // opts: { instruments, ticksPerSession, seed, marketDaily, sectorDaily, breakerLimit }
  function createMarket(opts) {
    var ins = opts.instruments;
    var T = opts.ticksPerSession;
    var rng = makeRng(opts.seed);
    var mSig = opts.marketDaily / Math.sqrt(T);
    var sSig = opts.sectorDaily / Math.sqrt(T);
    var limit = opts.breakerLimit;
    var sectors = [];
    ins.forEach(function (i) { if (sectors.indexOf(i.s) < 0) sectors.push(i.s); });

    var st = { session: 1, tick: 0, prev: {}, price: {}, halted: {}, series: {}, ret: {} };

    function resetSession() {
      st.tick = 0;
      st.halted = {};
      st.series = {};
      st.ret = {};
      ins.forEach(function (i) {
        st.series[i.t] = [0];
        st.ret[i.t] = [];
      });
    }

    ins.forEach(function (i) {
      st.prev[i.t] = i.p;
      st.price[i.t] = i.p;
    });
    resetSession();

    // One tick. Returns false when the session is over.
    function step() {
      if (st.tick >= T) return false;
      st.tick++;
      var m = normal(rng) * mSig;
      var sec = {};
      sectors.forEach(function (k) { sec[k] = normal(rng) * sSig; });

      ins.forEach(function (i) {
        var t = i.t;
        var prev = st.prev[t];
        if (st.halted[t]) {
          st.ret[t].push(0);
          st.series[t].push(st.series[t][st.series[t].length - 1]);
          return;
        }
        var vSig = i.vol / Math.sqrt(T);
        var r = i.beta * m + sec[i.s] + vSig * normal(rng);
        var old = st.price[t];
        var p = old * Math.exp(r);
        var pct = p / prev - 1;
        if (pct >= limit) {
          p = prev * (1 + limit);
          st.halted[t] = "up";
        } else if (pct <= -limit) {
          p = prev * (1 - limit);
          st.halted[t] = "down";
        }
        st.price[t] = p;
        st.ret[t].push(Math.log(p / old));
        st.series[t].push((p / prev - 1) * 100);
      });
      return true;
    }

    // New trading day: today's last prices become the previous close.
    function nextSession() {
      ins.forEach(function (i) { st.prev[i.t] = st.price[i.t]; });
      st.session++;
      resetSession();
    }

    function quote(t) {
      var prev = st.prev[t];
      return {
        t: t,
        price: st.price[t],
        prev: prev,
        pct: (st.price[t] / prev - 1) * 100,
        halted: !!st.halted[t],
        dir: st.halted[t] || null
      };
    }

    function quotes() {
      var out = {};
      ins.forEach(function (i) { out[i.t] = quote(i.t); });
      return out;
    }

    function setLimit(v) {
      limit = v;
    }

    function state() {
      return JSON.parse(JSON.stringify({ seed: rng.state(), session: st.session, tick: st.tick,
        prev: st.prev, price: st.price, halted: st.halted, series: st.series, ret: st.ret, limit: limit }));
    }

    function restore(s) {
      rng.set(s.seed);
      st.session = s.session;
      st.tick = s.tick;
      st.prev = s.prev;
      st.price = s.price;
      st.halted = s.halted || {};
      st.series = s.series;
      st.ret = s.ret;
      limit = s.limit;
    }

    return {
      step: step,
      nextSession: nextSession,
      quote: quote,
      quotes: quotes,
      series: function (t) { return st.series[t] || []; },
      returns: function (t) { return st.ret[t] || []; },
      info: function () { return { session: st.session, tick: st.tick, ticks: T, limit: limit }; },
      setLimit: setLimit,
      state: state,
      restore: restore
    };
  }

  // ---------- Paper wallet ----------

  // opts: { cfg, startCash, filer, maxLog, state? }
  function createWallet(opts) {
    var c = opts.cfg;
    var blank = { cash: opts.startCash, positions: {}, realised: 0, fees: 0, tax: 0, filer: !!opts.filer, trades: [] };
    var s = opts.state && typeof opts.state === "object" ? opts.state : blank;

    function slip(vol, value) {
      return Math.min(0.02, c.baseSlippage + c.impact * vol * (value / 1e7));
    }

    function record(tr) {
      s.trades.unshift(tr);
      if (s.trades.length > opts.maxLog) s.trades.length = opts.maxLog;
    }

    function checkQty(qty) {
      if (!Number.isInteger(qty) || qty <= 0) throw new Error("Quantity must be a whole number of shares, above zero");
    }

    function checkQuote(t, quote) {
      if (!quote || !(quote.price > 0)) throw new Error("Price unavailable for " + t);
      if (quote.halted) throw new Error("Trading halted: " + t + " hit the circuit breaker this session");
    }

    // vol = annual-ish volatility used for slippage; pass the instrument's daily vol.
    function buy(t, qty, quote, vol) {
      checkQty(qty);
      checkQuote(t, quote);
      var ex = quote.price * (1 + slip(vol, qty * quote.price));
      var value = qty * ex;
      var comm = value * c.commission;
      var stax = comm * c.salesTaxOnCommission;
      var total = value + comm + stax;
      if (total > s.cash + 1e-6) {
        throw new Error("Not enough cash. Need PKR " + Math.ceil(total).toLocaleString("en-PK") +
          ", you have PKR " + Math.floor(s.cash).toLocaleString("en-PK"));
      }
      s.cash -= total;
      var pos = s.positions[t] || { qty: 0, cost: 0 };
      pos.qty += qty;
      pos.cost += total;
      s.positions[t] = pos;
      s.fees += comm + stax;
      record({ t: Date.now(), side: "buy", coin: t, qty: qty, price: ex, gross: value, fees: comm + stax, tax: 0, realised: null });
      return { qty: qty, price: ex, total: total, fees: comm + stax };
    }

    function sell(t, qty, quote, vol) {
      var pos = s.positions[t];
      if (!pos || pos.qty <= 0) throw new Error("You do not hold any " + t);
      checkQty(qty);
      if (qty > pos.qty) throw new Error("You only hold " + pos.qty + " shares of " + t);
      checkQuote(t, quote);
      var ex = quote.price * (1 - slip(vol, qty * quote.price));
      var proceeds = qty * ex;
      var comm = proceeds * c.commission;
      var stax = comm * c.salesTaxOnCommission;
      var net = proceeds - comm - stax;
      var costOut = (pos.cost / pos.qty) * qty;
      var gain = net - costOut;
      var rate = s.filer ? c.cgt.filer : c.cgt.nonFiler;
      var tax = gain > 0 ? gain * rate : 0;
      s.cash += net - tax;
      s.realised += gain - tax;
      s.tax += tax;
      s.fees += comm + stax;
      pos.qty -= qty;
      pos.cost -= costOut;
      if (pos.qty <= 1e-9) delete s.positions[t];
      record({ t: Date.now(), side: "sell", coin: t, qty: qty, price: ex, gross: proceeds, fees: comm + stax, tax: tax, realised: gain - tax });
      return { qty: qty, price: ex, net: net, realised: gain, tax: tax, after: gain - tax };
    }

    // quotes: { ticker: quote }. Holdings are valued at the quoted price, without slippage.
    function value(quotes) {
      var holdings = Object.keys(s.positions).map(function (t) {
        var pos = s.positions[t];
        var q = quotes && quotes[t];
        var price = q && q.price > 0 ? q.price : null;
        var worth = price === null ? pos.cost : pos.qty * price;
        return {
          t: t, qty: pos.qty, avg: pos.cost / pos.qty, price: price, value: worth,
          cost: pos.cost, unrealised: worth - pos.cost, noPrice: price === null
        };
      });
      var hv = holdings.reduce(function (a, h) { return a + h.value; }, 0);
      var total = s.cash + hv;
      return {
        cash: s.cash, holdings: holdings, holdingsValue: hv, total: total,
        pnl: total - opts.startCash, pnlPct: ((total - opts.startCash) / opts.startCash) * 100,
        realised: s.realised, fees: s.fees, tax: s.tax, filer: s.filer, startCash: opts.startCash,
        trades: s.trades.slice()
      };
    }

    function setFiler(b) { s.filer = !!b; }

    function reset() {
      s = { cash: opts.startCash, positions: {}, realised: 0, fees: 0, tax: 0, filer: s.filer, trades: [] };
    }

    function state() {
      return JSON.parse(JSON.stringify(s));
    }

    return { buy: buy, sell: sell, value: value, setFiler: setFiler, reset: reset, state: state };
  }

  // ---------- Risk advisory ----------

  // Market-cap weights of the index (placeholder share counts; see config).
  function capWeights(instruments, prices) {
    var caps = {};
    var total = 0;
    instruments.forEach(function (i) {
      var p = prices[i.t] ? prices[i.t].price : i.p;
      caps[i.t] = p * i.sh;
      total += caps[i.t];
    });
    var w = {};
    Object.keys(caps).forEach(function (t) { w[t] = total ? caps[t] / total : 0; });
    return { caps: caps, total: total, weights: w };
  }

  function sectorWeights(instruments, weights) {
    var out = {};
    instruments.forEach(function (i) {
      out[i.s] = (out[i.s] || 0) + (weights[i.t] || 0);
    });
    return out;
  }

  // Herfindahl-Hirschman index (0..1). Effective number of companies = 1 / HHI.
  function hhi(weights) {
    var h = 0;
    Object.keys(weights).forEach(function (k) { h += weights[k] * weights[k]; });
    return h;
  }

  // Builds the advisory list. Returns { weights, sectors, hhi, effectiveN, flags }.
  // ctx: { instruments, quotes, returnsByTicker, ticksPerSession, wallet (value output), conc (thresholds) }
  function assess(ctx) {
    var cap = capWeights(ctx.instruments, ctx.quotes);
    var secs = sectorWeights(ctx.instruments, cap.weights);
    var sectorOf = {};
    ctx.instruments.forEach(function (i) { sectorOf[i.t] = i.s; });
    var flags = [];
    var conc = ctx.conc;

    var topStock = Object.keys(cap.weights).sort(function (a, b) { return cap.weights[b] - cap.weights[a]; })[0];
    if (topStock && cap.weights[topStock] > conc.stockMax) {
      flags.push({ level: "warn", text: topStock + " is " + pct(cap.weights[topStock]) + " of the index (limit " + pct(conc.stockMax) + ")." });
    }
    Object.keys(secs).forEach(function (s) {
      if (secs[s] > conc.sectorMax) {
        flags.push({ level: "danger", text: s + " sector is " + pct(secs[s]) + " of the index (limit " + pct(conc.sectorMax) + "). Systemic exposure." });
      }
    });

    var halted = Object.keys(ctx.quotes).filter(function (t) { return ctx.quotes[t].halted; });
    if (halted.length) {
      flags.push({ level: "danger", text: halted.length + " stock(s) frozen by the circuit breaker: " + halted.join(", ") + "." });
    }

    var series = ctx.instruments.map(function (i) { return ctx.returnsByTicker[i.t] || []; });
    var avgCorr = averageCorrelation(series);
    if (avgCorr !== null && avgCorr > conc.corrMax) {
      flags.push({ level: "warn", text: "Stocks are moving together (average correlation " + avgCorr.toFixed(2) + "). Diversification is weaker than it looks." });
    }

    // Wallet concentration
    var w = ctx.wallet;
    var wv = w ? w.holdingsValue : 0;
    var walletSectors = {};
    if (w && wv > 0) {
      w.holdings.forEach(function (h) {
        var share = h.value / w.total;
        if (share > conc.walletStockMax) {
          flags.push({ level: "warn", text: "Your wallet is " + pct(share) + " in " + h.t + " (limit " + pct(conc.walletStockMax) + ")." });
        }
        var s = sectorOf[h.t];
        walletSectors[s] = (walletSectors[s] || 0) + h.value / w.total;
      });
      Object.keys(walletSectors).forEach(function (s) {
        if (walletSectors[s] > conc.walletSectorMax) {
          flags.push({ level: "danger", text: "Your wallet is " + pct(walletSectors[s]) + " in " + s + " (limit " + pct(conc.walletSectorMax) + ")." });
        }
      });
    }

    return {
      weights: cap.weights,
      caps: cap.caps,
      total: cap.total,
      sectors: secs,
      hhi: hhi(cap.weights),
      effectiveN: hhi(cap.weights) > 0 ? 1 / hhi(cap.weights) : 0,
      avgCorr: avgCorr,
      walletSectors: walletSectors,
      flags: flags
    };
  }

  function pct(x) {
    return (x * 100).toFixed(1) + "%";
  }

  return {
    makeRng: makeRng,
    normal: normal,
    mean: mean,
    stdev: stdev,
    volatility: volatility,
    correlation: correlation,
    averageCorrelation: averageCorrelation,
    createMarket: createMarket,
    createWallet: createWallet,
    capWeights: capWeights,
    sectorWeights: sectorWeights,
    hhi: hhi,
    assess: assess
  };
});
