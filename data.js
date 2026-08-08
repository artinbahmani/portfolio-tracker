/* ============================================================
   data.js — CoinGecko access, offline cache, sample fallback,
   and localStorage persistence helpers.
   Exposes globals: CoinData, Store
   ============================================================ */
'use strict';

/* ---------- persistence ---------- */
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full / private mode — non-fatal */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

/* ---------- sample data (offline fallback) ---------- */
/* Deterministic pseudo-random walk so the demo sparkline is stable
   between reloads instead of flickering. */
function synthSparkline(base, driftPct) {
  let seed = (Math.floor(base * 100) % 9973) + 11;
  const points = [];
  let v = base * (1 - driftPct / 200);
  for (let i = 0; i < 48; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const noise = (seed / 2147483648) - 0.5;
    v = v * (1 + noise * 0.02 + driftPct / 4800);
    points.push(v);
  }
  return points;
}

const SAMPLE_MARKET = [
  { id: 'bitcoin',      symbol: 'btc',  name: 'Bitcoin',   price: 97412, change24h: 2.14  },
  { id: 'ethereum',     symbol: 'eth',  name: 'Ethereum',  price: 3621,  change24h: 1.23  },
  { id: 'solana',       symbol: 'sol',  name: 'Solana',    price: 212.4, change24h: -3.42 },
  { id: 'binancecoin',  symbol: 'bnb',  name: 'BNB',       price: 695.8, change24h: 0.61  },
  { id: 'ripple',       symbol: 'xrp',  name: 'XRP',       price: 2.35,  change24h: 4.86  },
  { id: 'cardano',      symbol: 'ada',  name: 'Cardano',   price: 1.02,  change24h: -1.94 },
  { id: 'dogecoin',     symbol: 'doge', name: 'Dogecoin',  price: 0.32,  change24h: 2.41  },
  { id: 'avalanche-2',  symbol: 'avax', name: 'Avalanche', price: 41.5,  change24h: -0.83 },
  { id: 'chainlink',    symbol: 'link', name: 'Chainlink', price: 22.8,  change24h: 1.72  },
  { id: 'polkadot',     symbol: 'dot',  name: 'Polkadot',  price: 8.91,  change24h: -2.26 }
].map(c => ({
  id: c.id,
  symbol: c.symbol,
  name: c.name,
  current_price: c.price,
  price_change_percentage_24h: c.change24h,
  sparkline_in_7d: { price: synthSparkline(c.price, c.change24h * 4) },
  market_cap_rank: 0
}));

/* ---------- CoinGecko API layer ---------- */
const CoinData = {
  API: 'https://api.coingecko.com/api/v3',
  CACHE_KEY: 'pt_market_cache',
  FETCH_TIMEOUT_MS: 9000,

  /**
   * Fetch market data: top 100 coins (powers the search list) plus any
   * held coins outside the top 100. Returns:
   *   { ok, byId, list, error } — byId maps coin id -> market record.
   */
  async fetchMarket(extraIds) {
    const topUrl = this.API + '/coins/markets?vs_currency=usd&order=market_cap_desc' +
      '&per_page=100&page=1&sparkline=true&price_change_percentage=24h';

    try {
      const top = await this._getJSON(topUrl);
      const byId = {};
      const list = [];
      for (const c of top) {
        byId[c.id] = c;
        list.push({ id: c.id, symbol: c.symbol, name: c.name, rank: c.market_cap_rank });
      }

      // Holdings outside the top 100 need their own call.
      const missing = (extraIds || []).filter(id => !byId[id]);
      if (missing.length > 0) {
        const idsUrl = this.API + '/coins/markets?vs_currency=usd&sparkline=true' +
          '&price_change_percentage_24h&ids=' + encodeURIComponent(missing.join(','));
        try {
          const extra = await this._getJSON(idsUrl);
          for (const c of extra) byId[c.id] = c;
        } catch (e) { /* keep top-100 data; missing coins show stale/unknown */ }
      }
      return { ok: true, byId, list, error: null };
    } catch (err) {
      return { ok: false, byId: {}, list: [], error: err };
    }
  },

  async _getJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 429) throw Object.assign(new Error('rate limited'), { code: 429 });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /* ----- cache ----- */
  saveCache(byId, list) {
    Store.set(this.CACHE_KEY, { byId, list, updatedAt: Date.now() });
  },
  loadCache() {
    return Store.get(this.CACHE_KEY, null);
  },

  /* ----- sample fallback ----- */
  sampleData() {
    const byId = {};
    const list = [];
    for (const c of SAMPLE_MARKET) {
      byId[c.id] = c;
      list.push({ id: c.id, symbol: c.symbol, name: c.name, rank: 0 });
    }
    return { byId, list };
  }
};
