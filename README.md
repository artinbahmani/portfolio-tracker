# portfolio-tracker

Crypto portfolio tracker on the free CoinGecko API — live prices, P&L, sparklines, allocation donut, price alerts, CSV I/O. Vanilla JS, no dependencies.

## Features

- Holdings tracking: search any top-100 coin, enter amount and average buy price; re-adding the same coin merges positions with a weighted-average cost basis
- Live prices from the CoinGecko API (fetch, no API key) with a 60-second auto-refresh plus a manual refresh button
- Graceful degradation: offline or rate-limited → last cached prices; no cache → built-in sample data, with a status badge that always shows which source is active
- Per-asset rows: current price, 24h change, value, cost basis, P&L ($ and %), and a 7-day sparkline rendered as inline SVG
- Portfolio header: total value, total P&L (with all-time %), aggregate 24h change, allocation donut chart (inline SVG), top/worst performer by P&L %
- Price alerts per coin (rises above / falls below a target); triggered alerts highlight and pulse in the alert panel against live or cached prices
- CSV export/import of holdings, localStorage persistence for holdings, alerts, and the price cache
- Keyboard shortcuts: `R` refresh, `E` export CSV, `Enter` submit add form

## Run

Open `index.html` in any modern browser. No build step, no dependencies.

## Usage

1. Type a coin name or symbol in the search box, pick it from the dropdown.
2. Enter the amount you hold and your average buy price, then **Add Holding**.
3. Set alerts in the Price Alerts panel — they evaluate on every refresh.
4. Use **Export CSV** / **Import CSV** to move holdings between machines; format: `id,symbol,name,amount,avg_buy_price`.
5. **Load demo portfolio** seeds a sample BTC/ETH/SOL portfolio to explore the UI.

## Tech notes

- Single CoinGecko `/coins/markets` call (`sparkline=true`, `price_change_percentage=24h`) powers prices, 24h change, 7-day sparklines, and the search list at once; holdings outside the top 100 get a follow-up `ids=` query
- Sparklines and the donut are hand-built inline SVG (polyline normalization; stroke-dasharray ring segments), no chart library
- Fetch has an AbortController timeout; 429 responses are detected explicitly so the badge can say "rate limited" instead of "offline"
- Plain (non-module) script tags in a fixed order (`data.js` → `charts.js` → `app.js`) so the app works from `file://` with a double-click

## Roadmap

- Multi-currency support (EUR, AED) via CoinGecko `vs_currency`
- Historical portfolio-value chart using stored daily snapshots
- Browser Notifications API for triggered alerts while the tab is open
- Per-holding notes and transaction history (multiple buy lots instead of one merged position)
- Sortable holdings table columns and a fiat-deposit tracking mode
- PWA manifest + service worker for full offline install (requires serving over HTTP)
