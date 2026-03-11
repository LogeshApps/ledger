# GoldLedger – Gold & Money Ledger Management

A complete ledger system for gold traders, jewellers, and workers.

## Features
- 🪙 Gold & money transaction tracking
- ⚖️ Auto purity conversion (22K, 916, 750, etc → pure 24K)
- 📊 Running balance ledger per customer/worker
- 📈 Monthly & person-wise reports
- 💾 Data stored in GitHub repo via API
- 📱 Mobile responsive

## Setup

### 1. Configure your GitHub details
Edit `src/App.jsx` — fill in at the top:
```js
const GITHUB_USERNAME = "your-username";
const GITHUB_REPO     = "your-repo-name";
const PAT_PART1       = "first-half-of-your-PAT";
const PAT_PART2       = "second-half-of-your-PAT";
```

### 2. Run locally
```bash
npm install
npm run dev
```
Open: http://localhost:5173/goldledger/

### Default Login
- Username: `admin`
- Password: `admin123`

## Deploy to GitHub Pages
Push to GitHub → Actions tab will auto-build and deploy.

Your live URL: `https://yourusername.github.io/goldledger/`

## Gold Purity Reference
| Purity | Fineness | Pure Gold % |
|--------|----------|-------------|
| 24K    | 999      | 99.9%       |
| 22K    | 916      | 91.6%       |
| 18K    | 750      | 75.0%       |
| 14K    | 585      | 58.5%       |
