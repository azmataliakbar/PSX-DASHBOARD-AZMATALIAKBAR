/* PSX Pulse controller: runs the mock market, the paper wallet and the risk advisory, and draws the UI.
   All maths lives in engine.js. Saved state (market and wallet) lives in this browser only. Runs on load. */
(function () {
  "use strict";
  var PSX = window.PSX;
  var cfg = PSX.config;
  var E = window.PSXEngine;
  var C = PSX.charts;
  var doc = document.documentElement;

  function $(id) { return document.getElementById(id); }

  var INST = cfg.instruments;
  var BY = {};
  INST.forEach(function (i) { BY[i.t] = i; });
  var TICKERS = INST.map(function (i) { return i.t; });
  var SECTORS = [];
  INST.forEach(function (i) { if (SECTORS.indexOf(i.s) < 0) SECTORS.push(i.s); });

  // Distinct colours for 20 companies and for the sectors.
  var COLOR = {};
  TICKERS.forEach(function (t, k) { COLOR[t] = "hsl(" + Math.round(k * 360 / TICKERS.length) + ", 85%, 62%)"; });
  var SECTOR_COLOR = {};
  SECTORS.forEach(function (s, k) { SECTOR_COLOR[s] = "hsl(" + Math.round(k * 360 / SECTORS.length + 20) + ", 80%, 60%)"; });

  // ---------- Formatting ----------
  var NF = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(v) { return (v < 0 ? "-" : "") + "PKR " + NF.format(Math.abs(v)); }
  function signedMoney(v) { return (v > 0 ? "+" : "") + money(v); }
  function pctText(p) { return (p > 0 ? "+" : "") + p.toFixed(2) + "%"; }
  function dirClass(v) { return v > 0 ? "up" : v < 0 ? "down" : "flat"; }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- Storage (this browser only) ----------
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: keep going in memory */ }
  }

  // ---------- State ----------
  var settings = load(cfg.storage.settings, null) || { filer: false, breaker: cfg.breakerDefault };
  if (cfg.breakerOptions.indexOf(settings.breaker) < 0) settings.breaker = cfg.breakerDefault;

  function newSeed() { return Math.floor(Math.random() * 2147483647); }

  function makeMarket(seed) {
    return E.createMarket({
      instruments: INST, ticksPerSession: cfg.ticksPerSession, seed: seed,
      marketDaily: cfg.marketDaily, sectorDaily: cfg.sectorDaily, breakerLimit: settings.breaker
    });
  }

  function initMarket() {
    var saved = load(cfg.storage.market, null);
    var ok = saved && saved.price && TICKERS.every(function (t) { return saved.price[t] !== undefined; });
    var m = makeMarket(newSeed());
    if (ok) m.restore(saved);
    m.setLimit(settings.breaker);
    return m;
  }

  var market = initMarket();
  var wallet = E.createWallet({
    cfg: cfg, startCash: cfg.startCash, filer: settings.filer, maxLog: 50,
    state: load(cfg.storage.wallet, null)
  });
  // The wallet's saved filer status is the source of truth on load.
  settings.filer = !!wallet.state().filer;

  var state = {
    running: true,
    speed: 1,
    timer: 0,
    section: "market",
    selected: TICKERS[0],
    chartSel: TICKERS.slice(0, 5),
    tradeMsgEl: $("trade-msg")
  };

  // ---------- Market loop ----------
  function persistMarket() { save(cfg.storage.market, market.state()); }
  function persistWallet() { save(cfg.storage.wallet, wallet.state()); }
  function persistSettings() { save(cfg.storage.settings, settings); }

  function tick() {
    if (!market.step()) {
      market.nextSession();
      setMsg(state.tradeMsgEl, "New trading day. Yesterday's close is now the reference price.", false);
    }
    persistMarket();
    renderAll();
  }

  function restartTimer() {
    clearInterval(state.timer);
    state.timer = 0;
    if (state.running) state.timer = setInterval(tick, cfg.tickMs / state.speed);
    $("run").textContent = state.running ? "Pause" : "Start";
    $("speed").textContent = state.speed + "x";
  }

  // ---------- Rendering ----------
  function quotes() { return market.quotes(); }

  function renderHeader(q) {
    var info = market.info();
    $("session-info").textContent = "Day " + info.session + " · minute " + info.tick + " of " + info.ticks +
      " · breaker ±" + (info.limit * 100).toFixed(1) + "%";
    var frozen = TICKERS.filter(function (t) { return q[t].halted; });
    var b = $("breaker");
    if (frozen.length) {
      b.textContent = "CIRCUIT BREAKER: " + frozen.map(function (t) {
        return t + " frozen at " + pctText(q[t].pct) + " from previous close (trading halted for today)";
      }).join(" · ");
      b.hidden = false;
    } else {
      b.hidden = true;
    }
  }

  function renderBoard(q) {
    $("board").innerHTML = INST.map(function (i) {
      var x = q[i.t];
      var cls = "row" + (i.t === state.selected ? " is-selected" : "") + (x.halted ? " is-halted" : "");
      return '<li><button type="button" class="' + cls + '" style="--accent:' + COLOR[i.t] + '" data-t="' + esc(i.t) +
        '" aria-pressed="' + (i.t === state.selected) + '">' +
        "<span><span class=\"sym\">" + esc(i.t) + "</span>" + (x.halted ? '<span class="tag-halt">HALTED</span>' : "") +
        '<br><span class="name">' + esc(i.n) + " · " + esc(i.s) + "</span></span>" +
        '<span><span class="price">' + esc(money(x.price)) + "</span><br>" +
        '<span class="chg ' + dirClass(x.pct) + '">' + esc(pctText(x.pct)) + "</span></span>" +
        "</button></li>";
    }).join("");
  }

  function renderChips() {
    $("chips").innerHTML = TICKERS.map(function (t) {
      var on = state.chartSel.indexOf(t) >= 0;
      return '<button type="button" class="chip' + (on ? " is-on" : "") + '" style="--accent:' + COLOR[t] +
        '" data-chip="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + "</button>";
    }).join("");
  }

  function renderCharts(q, risk) {
    var series = state.chartSel.map(function (t) {
      return { label: t, color: COLOR[t], values: market.series(t) };
    });
    C.line($("line-chart"), series, { label: "Percent change since previous close" });

    var slices = SECTORS.map(function (s) {
      return { label: s, value: risk.sectors[s] || 0, color: SECTOR_COLOR[s] };
    }).sort(function (a, b) { return b.value - a.value; });
    // Market caps are in PKR millions, so divide by 1e6 for trillions.
    C.donut($("sector-donut"), slices, { label: "Sector share of market cap", center: "PKR " + (risk.total / 1e6).toFixed(2) + " tn" });

    var vols = TICKERS.map(function (t) {
      var v = E.volatility(market.returns(t), cfg.ticksPerSession);
      return { label: t, value: v || 0, color: COLOR[t], text: v === null ? "warming up" : (v * 100).toFixed(1) + "%" };
    }).sort(function (a, b) { return b.value - a.value; });
    C.hbars($("vol-bars"), vols, { label: "Annualised volatility by company" });
  }

  function renderRisk(q, risk, wv) {
    var summary = [
      "<div><dt>Companies</dt><dd>" + TICKERS.length + "</dd></div>",
      "<div><dt>Effective number</dt><dd>" + risk.effectiveN.toFixed(1) + "</dd></div>",
      "<div><dt>Avg correlation</dt><dd>" + (risk.avgCorr === null ? "warming up" : risk.avgCorr.toFixed(2)) + "</dd></div>",
      "<div><dt>Frozen today</dt><dd>" + TICKERS.filter(function (t) { return q[t].halted; }).length + "</dd></div>"
    ];
    $("risk-summary").innerHTML = '<h3>Index snapshot</h3><dl class="summary">' + summary.join("") + "</dl>" +
      '<p class="hint">Effective number = 1 / HHI. With 20 equal stocks it would be 20. Lower means more concentrated.</p>';

    var list = $("risk-flags");
    if (!risk.flags.length) {
      list.innerHTML = '<li class="log-item ok">No flags. Everything is within the limits set in config.</li>';
    } else {
      list.innerHTML = risk.flags.map(function (f) {
        return '<li class="log-item ' + (f.level === "danger" ? "danger" : "warn") + '">' + esc(f.text) + "</li>";
      }).join("");
    }
  }

  // Learning notes built from the numbers on screen, so each lesson points at something the user can see.
  function renderLessons(q, risk, v) {
    var sectorTop = Object.keys(risk.sectors).sort(function (a, b) { return risk.sectors[b] - risk.sectors[a]; })[0];
    var vols = TICKERS.map(function (t) {
      return { t: t, v: E.volatility(market.returns(t), cfg.ticksPerSession) };
    }).filter(function (x) { return x.v !== null; }).sort(function (a, b) { return b.v - a.v; });
    var frozen = TICKERS.filter(function (t) { return q[t].halted; });
    var fees = 0, gross = 0;
    v.trades.forEach(function (t) { fees += t.fees; gross += t.gross; });

    var lines = [
      ["Diversification", "Effective number of companies is " + risk.effectiveN.toFixed(1) + " out of " + TICKERS.length +
        ". The largest sector, " + sectorTop + ", is " + pctOf(risk.sectors[sectorTop]) +
        " of the index. The more concentrated the index, the more one sector's bad day moves everything."],
      ["Correlation", risk.avgCorr === null
        ? "Correlation needs a few minutes of ticks before it means anything."
        : "Average correlation is " + risk.avgCorr.toFixed(2) + ". " +
          (risk.avgCorr > cfg.concentration.corrMax ? "High: stocks are moving together, so owning many of them protects you less."
            : risk.avgCorr > 0.3 ? "Moderate: some shared movement."
              : "Low: stocks are moving more independently of each other.")],
      ["Volatility and risk", vols.length
        ? "Most volatile right now: " + vols[0].t + " at " + (vols[0].v * 100).toFixed(1) + "% a year. Least: " +
          vols[vols.length - 1].t + " at " + (vols[vols.length - 1].v * 100).toFixed(1) +
          "%. Higher volatility means wider outcomes in both directions, not just more profit."
        : "Volatility appears after a few minutes of ticks."],
      ["Costs and tax", v.trades.length
        ? "Your trades so far paid " + money(fees) + " in fees and sales tax, " + pctOf(gross ? fees / gross : 0) +
          " of the value traded. Small trades can look profitable before costs are taken out."
        : "Every buy and sell pays commission and sales tax. Make a trade to see what it costs you."],
      ["Circuit breaker", frozen.length
        ? frozen.length + " stock(s) frozen today. A frozen stock cannot be sold until the next day, so you can be stuck with a loss for that session."
        : "No stock is frozen right now. A stock freezes once it moves past the breaker limit from the previous close."],
      ["Mock data", "Prices here come from a model with placeholder inputs. They show how markets can behave, but they are not predictions and not real PSX prices."]
    ];
    $("lessons").innerHTML = lines.map(function (l) {
      return "<li><strong>" + esc(l[0]) + ":</strong> " + esc(l[1]) + "</li>";
    }).join("");
  }

  function renderQuestions(risk, v) {
    var qs = [];
    var sectorMax = 0, sectorName = null;
    Object.keys(risk.walletSectors).forEach(function (s) {
      if (risk.walletSectors[s] > sectorMax) { sectorMax = risk.walletSectors[s]; sectorName = s; }
    });
    if (sectorName && sectorMax > cfg.concentration.walletSectorMax) {
      qs.push("Your wallet is " + pctOf(sectorMax) + " in " + sectorName + ". Which holdings would you keep if that sector had a bad year?");
    }
    qs.push("What is my reason for owning each company, and what would make me sell it?");
    qs.push("If a holding hit the breaker limit tomorrow and could not be sold, could I live with that loss?");
    qs.push("After commission, sales tax and capital gains tax, do I still have a gain?");
    qs.push("Am I trading to a plan, or because I just saw a price move?");
    $("questions").innerHTML = qs.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("");
  }

  function pctOf(x) {
    return (x * 100).toFixed(1) + "%";
  }

  function renderWallet(q, v) {
    $("wallet-summary").innerHTML =
      '<h3>Wallet</h3><p class="total">' + esc(money(v.total)) + "</p>" +
      '<dl class="summary">' +
      "<div><dt>Cash</dt><dd>" + esc(money(v.cash)) + "</dd></div>" +
      '<div><dt>Total P&amp;L</dt><dd class="' + dirClass(v.pnl) + '">' + esc(signedMoney(v.pnl)) + "</dd></div>" +
      "<div><dt>Realised (after tax)</dt><dd>" + esc(signedMoney(v.realised)) + "</dd></div>" +
      "<div><dt>Tax paid</dt><dd>" + esc(money(v.tax)) + "</dd></div>" +
      "<div><dt>Fees paid</dt><dd>" + esc(money(v.fees)) + "</dd></div>" +
      "<div><dt>Tax rate</dt><dd>" + (v.filer ? (cfg.cgt.filer * 100) : (cfg.cgt.nonFiler * 100)).toFixed(0) + "% on gains</dd></div>" +
      "</dl>";

    $("holdings").innerHTML = v.holdings.length ? v.holdings.map(function (h) {
      return '<li class="log-item"><div><strong>' + esc(h.t) + "</strong> " + esc(h.qty.toLocaleString("en-PK")) +
        " shares · avg " + esc(money(h.avg)) + "</div>" +
        '<div class="muted">Now ' + esc(h.noPrice ? "—" : money(h.price)) + " · value " + esc(money(h.value)) + "</div>" +
        '<div class="' + dirClass(h.unrealised) + '">' + esc(signedMoney(h.unrealised)) + " unrealised</div></li>";
    }).join("") : '<li class="empty">No holdings yet. Pick a company above and buy some shares.</li>';

    $("trade-log").innerHTML = v.trades.length ? v.trades.slice(0, 15).map(function (t) {
      var what = t.side === "buy"
        ? "Bought " + t.qty.toLocaleString("en-PK") + " " + t.coin + " at " + money(t.price)
        : "Sold " + t.qty.toLocaleString("en-PK") + " " + t.coin + " at " + money(t.price) +
          " · realised " + signedMoney(t.realised);
      return '<li class="log-item"><div>' + esc(what) + '</div><div class="muted">Fees ' + esc(money(t.fees)) +
        (t.tax ? " · tax " + esc(money(t.tax)) : "") + "</div></li>";
    }).join("") : '<li class="empty">No trades yet.</li>';

    renderTradeQuote(q);
  }

  function renderTradeQuote(q) {
    var t = state.selected;
    var x = q[t];
    var disabled = !!x.halted;
    $("buy-btn").disabled = disabled;
    $("sell-btn").disabled = disabled;
    $("sell-all-btn").disabled = disabled;
    $("trade-quote").textContent = t + " · " + BY[t].n + " · last " + money(x.price) +
      " · " + pctText(x.pct) + " vs previous close" + (x.halted ? " · HALTED for today" : "") +
      ". Buy and sell in whole shares, with commission, sales tax and slippage.";
  }

  function renderAll() {
    var q = quotes();
    var v = wallet.value(q);
    var returnsByTicker = {};
    TICKERS.forEach(function (t) { returnsByTicker[t] = market.returns(t); });
    // One advisory pass: index concentration, correlation, and the wallet's own concentration.
    var risk = E.assess({
      instruments: INST, quotes: q, returnsByTicker: returnsByTicker, ticksPerSession: cfg.ticksPerSession,
      wallet: { holdings: v.holdings.map(function (h) { return { t: h.t, value: h.value }; }), holdingsValue: v.holdingsValue, total: v.total },
      conc: cfg.concentration
    });

    renderHeader(q);
    renderBoard(q);
    renderChips();
    renderCharts(q, risk);
    renderRisk(q, risk, v);
    renderLessons(q, risk, v);
    renderQuestions(risk, v);
    renderWallet(q, v);
  }

  // ---------- Messages ----------
  function setMsg(el, text, isError) {
    el.textContent = text;
    el.className = isError ? "error" : "ok";
  }

  // ---------- Controls ----------
  $("board").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-t]");
    if (!btn) return;
    state.selected = btn.getAttribute("data-t");
    $("trade-t").value = state.selected;
    renderAll();
  });

  $("chips").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-chip]");
    if (!btn) return;
    var t = btn.getAttribute("data-chip");
    var i = state.chartSel.indexOf(t);
    if (i >= 0) state.chartSel.splice(i, 1); else state.chartSel.push(t);
    renderAll();
  });

  $("run").addEventListener("click", function () {
    state.running = !state.running;
    restartTimer();
  });

  $("speed").addEventListener("click", function () {
    var order = [1, 4, 10];
    state.speed = order[(order.indexOf(state.speed) + 1) % order.length];
    restartTimer();
  });

  $("next-day").addEventListener("click", function () {
    market.nextSession();
    persistMarket();
    setMsg(state.tradeMsgEl, "Day closed early. Current prices are the new reference.", false);
    renderAll();
  });

  $("reset-market").addEventListener("click", function () {
    if (!window.confirm("Start a brand-new market? Prices, halts and the chart history will be reset. Your wallet is not affected.")) return;
    market = makeMarket(newSeed());
    market.setLimit(settings.breaker);
    persistMarket();
    renderAll();
  });

  // Trade form
  function tradeTicker() { return $("trade-t").value; }

  $("trade-t").addEventListener("change", function () {
    state.selected = tradeTicker();
    renderAll();
  });

  $("trade-form").addEventListener("submit", function (e) {
    e.preventDefault();
    doTrade("buy", Number($("trade-qty").value));
  });
  $("sell-btn").addEventListener("click", function () {
    doTrade("sell", Number($("trade-qty").value));
  });
  $("sell-all-btn").addEventListener("click", function () {
    var t = tradeTicker();
    var h = wallet.value(quotes()).holdings.filter(function (x) { return x.t === t; })[0];
    if (!h) { setMsg($("trade-msg"), "You do not hold any " + t + ".", true); return; }
    doTrade("sell", h.qty);
  });

  function doTrade(side, qty) {
    var t = tradeTicker();
    var quote = market.quote(t);
    try {
      if (side === "buy") {
        var b = wallet.buy(t, qty, quote, BY[t].vol);
        setMsg($("trade-msg"), "Bought " + b.qty + " " + t + " at " + money(b.price) + ". Total " + money(b.total) + " incl. fees.", false);
      } else {
        var s = wallet.sell(t, qty, quote, BY[t].vol);
        setMsg($("trade-msg"), "Sold " + s.qty + " " + t + " at " + money(s.price) + ". Realised " + signedMoney(s.realised) +
          ". Costs: fees " + money(s.fees) + " (" + pctOf(s.gross ? s.fees / s.gross : 0) + " of the sale) and tax " +
          money(s.tax) + ". Learning point: costs come out of every gain.", false);
      }
      persistWallet();
    } catch (err) {
      setMsg($("trade-msg"), err.message, true);
    }
    renderAll();
  }

  $("filer").addEventListener("change", function () {
    settings.filer = this.checked;
    wallet.setFiler(settings.filer);
    persistSettings();
    persistWallet();
    renderAll();
  });

  $("breaker-limit").addEventListener("change", function () {
    settings.breaker = Number(this.value);
    market.setLimit(settings.breaker);
    persistSettings();
    persistMarket();
    updateBreakerNote();
    renderAll();
  });

  function updateBreakerNote() {
    $("breaker-note").textContent = "Limit ±" + (settings.breaker * 100).toFixed(1) + "% from previous close. " +
      "10% is the SECP-approved phased rule (2024); its current status is unconfirmed, so check the PSX notice. " +
      "A change applies from the next minute.";
  }

  $("reset-wallet").addEventListener("click", function () {
    if (!window.confirm("Reset the wallet to PKR 1,000,000 and clear all trades?")) return;
    wallet.reset();
    wallet.setFiler(settings.filer);
    persistWallet();
    setMsg($("trade-msg"), "Wallet reset to PKR 1,000,000.", false);
    renderAll();
  });

  // Pause while the tab is hidden, resume if it was running.
  var wasRunning = false;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      wasRunning = state.running;
      state.running = false;
    } else if (wasRunning) {
      state.running = true;
    }
    restartTimer();
  });

  // ---------- Tabs (phones) ----------
  var mqTablet = window.matchMedia("(min-width: 640px)");
  var mqDesktop = window.matchMedia("(min-width: 1024px)");

  function applySection() {
    document.querySelectorAll("[data-section]").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-section") === state.section);
    });
    document.querySelectorAll("[data-target]").forEach(function (btn) {
      var on = btn.getAttribute("data-target") === state.section;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  function applyLayout() {
    doc.dataset.layout = mqDesktop.matches ? "desktop" : mqTablet.matches ? "tablet" : "mobile";
  }

  document.querySelectorAll("[data-target]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.section = btn.getAttribute("data-target");
      applySection();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  mqTablet.addEventListener("change", applyLayout);
  mqDesktop.addEventListener("change", applyLayout);

  // ---------- Start ----------
  function populateSelects() {
    $("trade-t").innerHTML = INST.map(function (i) {
      return '<option value="' + esc(i.t) + '">' + esc(i.t) + " · " + esc(i.n) + "</option>";
    }).join("");
    $("trade-t").value = state.selected;
    $("breaker-limit").innerHTML = cfg.breakerOptions.map(function (v) {
      return '<option value="' + v + '">±' + (v * 100).toFixed(1) + "%</option>";
    }).join("");
    $("breaker-limit").value = String(settings.breaker);
    $("filer").checked = !!settings.filer;
    updateBreakerNote();
  }

  // Practice-only notice: dismissed once, remembered in this browser.
  $("disclaimer").hidden = !!settings.hideDisclaimer;
  $("dismiss").addEventListener("click", function () {
    settings.hideDisclaimer = true;
    persistSettings();
    $("disclaimer").hidden = true;
  });

  populateSelects();
  applyLayout();
  applySection();
  renderAll();
  restartTimer();
  persistMarket();
})();
