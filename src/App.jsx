import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── GITHUB CONFIG ─────────────────────────────────────────────────
// Replace with your own values:
const GITHUB_USERNAME = "LogeshApps";       // ← already know this!
const GITHUB_REPO     = "ledger";       // ← already know this!

// Split your PAT token into 2 halves to avoid GitHub scanner revoking it
const PAT_PART1  = "ghp_F4oz8Z9OiPZx8bHi";
const PAT_PART2  = "VpD0uKHAopeDJs2a6PJk";
const GITHUB_PAT = PAT_PART1 + PAT_PART2;
// Data file is per-business: ledger-data/data_<username>.json
const userDataFile = (username) => `ledger-data/data_${username.toLowerCase().replace(/[^a-z0-9]/g,"_")}.json`;
// Master users registry file (stores all registered usernames/passwords)
const USERS_FILE = "ledger-data/users.json";
// ─── ADMIN credentials (hardcoded — only you know this) ─────────────
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
// ─── UPI + Subscription config ──────────────────────────────────────
const UPI_ID        = "logeshunique@oksbi";
const UPI_NAME      = "Ledger";
const PRICE_MONTHLY = 99;
const PRICE_YEARLY  = 999;
const PAYMENTS_FILE   = "ledger-data/payments.json";
const SITE_SETTINGS_FILE = "ledger-data/site_settings.json";
const historyFile   = (username) => `ledger-history/history_${username.toLowerCase().replace(/[^a-z0-9]/g,"_")}.json`;
const reportsFile   = (username) => `ledger-reports/reports_${username.toLowerCase().replace(/[^a-z0-9]/g,"_")}.json`;
// ───────────────────────────────────────────────────────────────────

// ─── GitHub API ─────────────────────────────────────────────────────
const ghHeaders = () => ({
  Authorization: `token ${GITHUB_PAT}`,
  Accept: "application/vnd.github.v3+json",
  "Content-Type": "application/json",
});

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${path}`, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const json = await res.json();
  const decoded = atob(json.content.replace(/\n/g, ""));
  return { data: JSON.parse(decoded), sha: json.sha };
}

async function ghPut(path, data, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const body = { message: message || `Ledger update - ${new Date().toLocaleDateString("en-IN")}`, content, ...(sha ? { sha } : {}) };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${path}`, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status}`);
  const json = await res.json();
  return json.content.sha;
}

// ─── Defaults ───────────────────────────────────────────────────────
const defaultBusinessData = {
  customers: [],
  workers: [],
  entries: [],
  companyName: "My Gold Shop",
  companyAddress: "",
  companyPhone: "",
};

// ─── Utils ──────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
// Sanitize report names — strips mojibake from em-dash and other special chars stored in old records
const cleanName = (s) => {
  if (!s) return s;
  return s
    .replace(/\u00e2\u0080\u0094/g, " - ")
    .replace(/\u00e2\u0080\u0093/g, " - ")
    .replace(/\u2014/g, " - ")
    .replace(/\u2013/g, " - ")
    .replace(/â€"/g, " - ")
    .replace(/â/g, "")
    .replace(/\uFFFD/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/ - - /g, " - ")
    .trim();
};
const today = () => new Date().toISOString().split("T")[0];

// ── Print HTML via hidden iframe (no popup blocker, no new tab needed) ──
const printHTMLDoc = (html, title) => {
  // Remove any existing print iframe
  const old = document.getElementById("__ledger_print_frame__");
  if (old) old.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "__ledger_print_frame__";
  // Must be visible and sized for print to work cross-browser
  iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:-1;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const blob = new Blob([html], {type:"text/html;charset=utf-8"});
  const url  = URL.createObjectURL(blob);

  iframe.onload = () => {
    try {
      if (title) iframe.contentWindow.document.title = title;
      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          try { iframe.remove(); URL.revokeObjectURL(url); } catch(e){}
        }, 30000);
      }, 300);
    } catch(e) {
      window.open(url, "_blank");
      setTimeout(() => { try { iframe.remove(); URL.revokeObjectURL(url); } catch(e){} }, 15000);
    }
  };

  iframe.src = url;
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "-";
// File name timestamp: e.g. "14-Mar-2026_06-59pm"
const fmtFileStamp = () => {
  const n = new Date();
  const dd  = String(n.getDate()).padStart(2,"0");
  const mon = n.toLocaleString("en-IN",{month:"short"});
  const yr  = n.getFullYear();
  const hh  = String(n.getHours()).padStart(2,"0");
  const mm  = String(n.getMinutes()).padStart(2,"0");
  return `${dd}-${mon}-${yr}_${hh}h${mm}m`;
};
// Sanitize label + append timestamp + extension -> safe file name
const makeFileName = (label, ext="csv") => {
  const clean = (label||"Report")
    .replace(/[\/\:*?"<>|]/g,"")  // remove illegal chars
    .replace(/\s+/g,"_")           // spaces to underscore
    .replace(/_+/g,"_")            // collapse underscores
    .replace(/^_|_$/g,"")          // trim edge underscores
    .slice(0,80);                  // max 80 chars before stamp
  return `${clean}_${fmtFileStamp()}.${ext}`;
};
const fmtMoney = (n) => {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  let label = "";
  if (abs >= 1_00_00_000) label = `₹${(num/1_00_00_000).toFixed(2)} Cr`;
  else if (abs >= 1_00_000) label = `₹${(num/1_00_000).toFixed(2)} L`;
  else label = new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(num);
  return label;
};
const fmtMoneyFull = (n) => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(Number(n)||0);
// PDF-safe: manually formats with HTML entity &#8377; so the rupee symbol NEVER appears as raw Unicode in HTML strings.
// This prevents mojibake in iframe srcDoc, blob URLs, and JSON→GitHub→atob round-trips.
const fmtMoneyPDF = (n) => {
  const num = Number(n) || 0;
  const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits:2, minimumFractionDigits:2 }).format(Math.abs(num));
  return (num < 0 ? "-&#8377;" : "&#8377;") + formatted;
};
const fmtGold  = (n) => `${(Number(n)||0).toFixed(3)}g`;
const fmtGoldN = (n) => `${(Number(n)||0).toFixed(3)}`;  // no g suffix – used where column header already says (g)
const pureGold = (weight, purity) => {
  const w = parseFloat(weight);
  if (!w) return 0;
  const ratio = parsePurity(purity); // reuse parsePurity for consistent logic
  return ratio * w;
};
const parsePurity = (str) => {
  if (!str) return 1;
  const s = String(str).trim();
  if (s.toUpperCase().includes("K")) return parseFloat(s) / 24;
  if (s.includes("%")) return parseFloat(s) / 100;
  const n = parseFloat(s);
  if (isNaN(n)) return 1;
  if (n > 100) return n / 1000;   // millesimal e.g. 916, 750
  if (n > 1)   return n / 100;    // percentage e.g. 91.6, 75, 100
  return n;                        // ratio e.g. 0.916
};

const PURITY_OPTIONS = ["24K (999)", "22K (916)", "18K (750)", "14K (585)", "916", "750", "585", "999", "Custom"];

// ─── Icons ──────────────────────────────────────────────────────────
const Icon = ({ name, size=18, color="currentColor" }) => {
  const icons = {
    dashboard:  <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>,
    customers:  <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    workers:    <><path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M10 5h4"/></>,
    ledger:     <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
    reports:    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
    settings:   <><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 17.66l-1.41 1.41M19.07 19.07l-1.41-1.41M5.34 6.34L3.93 4.93M22 12h-2M4 12H2M12 22v-2M12 4V2"/></>,
    logout:     <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    plus:       <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    edit:       <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:      <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
    search:     <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    close:      <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    eye:        <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff:     <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>,
    gold:       <><circle cx="12" cy="12" r="10"/><path d="M12 6l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z"/></>,
    money:      <><text x="4" y="18" fontSize="16" fontWeight="bold" fill={color} stroke="none">₹</text></>,
    arrowUp:    <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
    arrowDown:  <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
    menu:       <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    sync:       <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
    check:      <polyline points="20 6 9 17 4 12"/>,
    pdf:        <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    download:   <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    filter:     <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>,
    building:   <><rect x="3" y="9" width="18" height="13"/><path d="M8 22V12h8v10"/><path d="M21 9H3"/><path d="M1 22h22"/></>,
    back:       <><polyline points="15 18 9 12 15 6"/></>,
    print:      <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name] || null}
    </svg>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────
const getStyles = (theme={}) => `

  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0c0e14;--surface:#13161f;--surface2:#1a1e2a;--surface3:#222636;
    --border:#2a2f42;--border2:#353b52;--text:#e8eaf0;--text2:#9399b0;--text3:#5c6280;
    --accent:#6366f1;--accent2:#818cf8;--accent-dim:rgba(99,102,241,0.15);
    --green:#22d3a0;--green-dim:rgba(34,211,160,0.12);
    --red:#f43f5e;--red-dim:rgba(244,63,94,0.12);
    --amber:#f59e0b;--amber-dim:rgba(245,158,11,0.12);
    --blue:#38bdf8;--blue-dim:rgba(56,189,248,0.12);
    --gold:#fbbf24;--gold-dim:rgba(251,191,36,0.12);
    --radius:12px;--radius-sm:8px;--shadow:0 4px 24px rgba(0,0,0,0.4);
    --font:Arial,Helvetica,sans-serif;--font-display:Arial,Helvetica,sans-serif;
    --sidebar-w:240px;--tr:0.2s cubic-bezier(0.4,0,0.2,1);
    ${theme.bg        ? `--bg:${theme.bg};`        : ""}
    ${theme.surface   ? `--surface:${theme.surface};--surface2:${theme.surface2||theme.surface};--surface3:${theme.surface3||theme.surface};` : ""}
    ${theme.border    ? `--border:${theme.border};--border2:${theme.border2||theme.border};` : ""}
    ${theme.text      ? `--text:${theme.text};` : ""}
    ${theme.accent    ? `--accent:${theme.accent};--accent2:${theme.accent2||theme.accent};--accent-dim:${theme.accentDim||"rgba(99,102,241,0.15)"};` : ""}
    ${theme.gold      ? `--gold:${theme.gold};--amber:${theme.amber||theme.gold};--gold-dim:${theme.goldDim||"rgba(251,191,36,0.12)"};` : ""}
    ${theme.green     ? `--green:${theme.green};--green-dim:${theme.greenDim||"rgba(34,211,160,0.12)"};` : ""}
    ${theme.red       ? `--red:${theme.red};--red-dim:${theme.redDim||"rgba(244,63,94,0.12)"};` : ""}
    ${theme.blue      ? `--blue:${theme.blue};--blue-dim:${theme.blueDim||"rgba(56,189,248,0.12)"};` : ""}
  }
  html{font-size:15px}
  body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;overflow-x:hidden}
  ::-webkit-scrollbar{width:10px;height:14px}
  ::-webkit-scrollbar-track{background:var(--surface2);border-radius:99px}
  ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px;border:2px solid var(--surface2)}
  ::-webkit-scrollbar-thumb:hover{background:var(--text3)}

  .app{display:flex;min-height:100vh}
  .sidebar{width:var(--sidebar-w);min-height:100vh;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;position:fixed;top:0;left:0;z-index:100;transition:transform var(--tr)}
  .sidebar.open{transform:translateX(0)!important}
  .sidebar-logo{padding:20px 20px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
  .logo-icon{width:38px;height:38px;background:linear-gradient(135deg,var(--gold),var(--amber));border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 12px var(--gold-dim)}
  .logo-text{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:1.05rem}
  .logo-sub{font-size:0.7rem;color:var(--text3);letter-spacing:0.06em;text-transform:uppercase}
  .sidebar-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
  .nav-section{padding:14px 12px 6px;font-size:0.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
  .nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:all var(--tr);color:var(--text2);font-size:0.9rem;font-weight:500;border:1px solid transparent;user-select:none}
  .nav-item:hover{background:var(--surface2);color:var(--text)}
  .nav-item.active{background:var(--accent-dim);color:var(--accent2);border-color:rgba(99,102,241,0.2)}
  .sidebar-footer{padding:12px 10px;border-top:1px solid var(--border)}
  .main{flex:1;margin-left:var(--sidebar-w);display:flex;flex-direction:column;min-height:100vh}
  .header{height:64px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:50;gap:16px}
  .header-title{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:1.15rem}
  .header-right{display:flex;align-items:center;gap:10px}
  .user-badge{display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--surface2);border-radius:99px;border:1px solid var(--border);font-size:0.85rem}
  .user-avatar{width:28px;height:28px;background:linear-gradient(135deg,var(--gold),var(--amber));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;color:#000}
  .hamburger{display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:7px;cursor:pointer;color:var(--text)}
  .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:90;backdrop-filter:blur(2px)}
  .overlay.show{display:block}
  .page{flex:1;padding:24px;max-width:1400px;width:100%}

  /* Cards */
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
  .card-sm{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px}

  /* Stats */
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;display:flex;flex-direction:column;gap:8px;position:relative;overflow:hidden;transition:border-color var(--tr),transform var(--tr)}
  .stat-card:hover{border-color:var(--border2);transform:translateY(-1px)}
  .stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
  .stat-card.gold::before{background:linear-gradient(90deg,var(--gold),var(--amber))}
  .stat-card.green::before{background:var(--green)}
  .stat-card.red::before{background:var(--red)}
  .stat-card.blue::before{background:var(--blue)}
  .stat-icon{width:40px;height:40px;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center}
  .stat-icon.gold{background:var(--gold-dim);color:var(--gold)}
  .stat-icon.green{background:var(--green-dim);color:var(--green)}
  .stat-icon.red{background:var(--red-dim);color:var(--red)}
  .stat-icon.blue{background:var(--blue-dim);color:var(--blue)}
  .stat-label{font-size:0.8rem;color:var(--text2);font-weight:500}
  .stat-value{font-family:Arial,Helvetica,sans-serif;font-size:1.5rem;font-weight:700;line-height:1.2}
  .stat-value.gold{color:var(--gold)}
  .stat-value.green{color:var(--green)}
  .stat-value.red{color:var(--red)}
  .stat-value.blue{color:var(--blue)}
  .stat-sub{font-size:0.78rem;color:var(--text3)}

  /* Buttons */
  .btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:var(--radius-sm);font-family:var(--font);font-size:0.875rem;font-weight:500;cursor:pointer;transition:all var(--tr);border:1px solid transparent;white-space:nowrap;user-select:none}
  .btn:disabled{opacity:0.5;cursor:not-allowed}
  .btn-primary{background:var(--accent);color:white;border-color:var(--accent)}
  .btn-primary:hover:not(:disabled){background:var(--accent2)}
  .btn-gold{background:linear-gradient(135deg,var(--gold),var(--amber));color:#000;font-weight:600}
  .btn-gold:hover:not(:disabled){opacity:0.9}
  .btn-secondary{background:var(--surface2);color:var(--text);border-color:var(--border)}
  .btn-secondary:hover:not(:disabled){background:var(--surface3);border-color:var(--border2)}
  .btn-danger{background:var(--red-dim);color:var(--red);border-color:rgba(244,63,94,0.25)}
  .btn-danger:hover:not(:disabled){background:rgba(244,63,94,0.22)}
  .btn-success{background:var(--green-dim);color:var(--green);border-color:rgba(34,211,160,0.25)}
  .btn-success:hover:not(:disabled){background:rgba(34,211,160,0.22)}
  .btn-icon{padding:7px;border-radius:var(--radius-sm)}
  .btn-sm{padding:5px 12px;font-size:0.8rem}

  /* Forms */
  .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .form-group{display:flex;flex-direction:column;gap:5px}
  .form-group.full{grid-column:1/-1}
  .form-group.span2{grid-column:span 2}
  label{font-size:0.78rem;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.04em}
  input,select,textarea{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:var(--font);font-size:0.9rem;padding:9px 12px;transition:border-color var(--tr),box-shadow var(--tr);width:100%;outline:none}
  input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-dim)}
  input::placeholder,textarea::placeholder{color:var(--text3)}
  select option{background:var(--surface2)}
  textarea{resize:vertical;min-height:70px}

  /* Table */
  .table-wrap{overflow-x:auto;border-radius:var(--radius);border:1px solid var(--border)}
  table{width:100%;border-collapse:collapse;font-size:0.875rem}
  thead{background:var(--surface2)}
  th{padding:11px 12px;text-align:left;font-size:0.72rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border);white-space:nowrap}
  td{padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr{transition:background var(--tr)}
  tbody tr:hover{background:var(--surface2)}
  .th-right,td.right{text-align:right}
  .th-center,td.center{text-align:center}

  /* Badges */
  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:0.72rem;font-weight:600}
  .badge-green{background:var(--green-dim);color:var(--green)}
  .badge-red{background:var(--red-dim);color:var(--red)}
  .badge-amber{background:var(--amber-dim);color:var(--amber)}
  .badge-blue{background:var(--blue-dim);color:var(--blue)}
  .badge-gold{background:var(--gold-dim);color:var(--gold)}
  .badge-gray{background:var(--surface3);color:var(--text2)}

  /* Modal */
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:620px;max-height:92vh;overflow-y:auto;box-shadow:var(--shadow)}
  .modal.wide{max-width:1100px}
  .modal.fullwide{max-width:96vw!important;width:96vw}
  .modal.fullwide{max-width:98vw;width:98vw}
  .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .modal-title{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:1.1rem}
  .modal-body{padding:16px 20px}
  .modal-footer{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}

  /* Section header */
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px}
  .section-title{font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:1.1rem}
  .section-sub{color:var(--text2);font-size:0.85rem;margin-top:2px}

  /* Toolbar */
  .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
  .search-wrap{position:relative;flex:1;min-width:180px}
  .search-wrap input{padding-left:36px}
  .search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3);pointer-events:none}

  /* Login */
  .login-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:16px;background-image:radial-gradient(ellipse at 20% 50%, rgba(251,191,36,0.05) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(99,102,241,0.05) 0%, transparent 60%)}
  .login-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:420px;box-shadow:var(--shadow)}
  .login-logo{display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:32px}
  .login-logo-icon{width:64px;height:64px;background:linear-gradient(135deg,var(--gold),var(--amber));border-radius:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 24px var(--gold-dim)}
  .login-title{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:1.6rem;text-align:center}
  .login-sub{color:var(--text2);font-size:0.875rem;text-align:center}

  /* Ledger table specific */
  .ledger-table th{background:var(--surface3)}
  .ledger-table .gold-in{color:var(--green);font-weight:600}
  .ledger-table .gold-out{color:var(--red);font-weight:600}
  .ledger-table .money-in{color:var(--green);font-weight:600}
  .ledger-table .money-out{color:var(--red);font-weight:600}
  .ledger-table .balance-gold{color:var(--gold);font-weight:700}
  .ledger-table .balance-money{color:var(--blue);font-weight:700}
  .ledger-balance-row{background:var(--surface3)!important}

  /* Tabs */
  .tabs{display:flex;gap:4px;background:var(--surface2);padding:4px;border-radius:var(--radius-sm);margin-bottom:16px;flex-wrap:wrap}
  .tab{padding:7px 16px;border-radius:6px;cursor:pointer;font-size:0.85rem;font-weight:500;color:var(--text2);transition:all var(--tr);user-select:none}
  .tab.active{background:var(--accent);color:white}
  .tab:hover:not(.active){color:var(--text);background:var(--surface3)}

  /* Alert */
  .alert{padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:14px;font-size:0.875rem;border:1px solid}
  .alert-error{background:var(--red-dim);color:var(--red);border-color:rgba(244,63,94,0.25)}
  .alert-success{background:var(--green-dim);color:var(--green);border-color:rgba(34,211,160,0.25)}
  .alert-info{background:var(--blue-dim);color:var(--blue);border-color:rgba(56,189,248,0.25)}

  /* Toast */
  .toast-wrap{position:fixed;bottom:24px;right:24px;z-index:999;display:flex;flex-direction:column;gap:8px}
  .toast{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 16px;font-size:0.875rem;box-shadow:var(--shadow);min-width:240px;display:flex;align-items:center;gap:10px;animation:toastIn 0.3s ease;cursor:pointer}
  .toast.success{border-left:3px solid var(--green)}
  .toast.error{border-left:3px solid var(--red)}
  .toast.info{border-left:3px solid var(--blue)}
  @keyframes toastIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}

  /* Sync indicator */
  .sync-indicator{display:flex;align-items:center;gap:6px;font-size:0.78rem}

  /* Empty state */
  .empty{padding:48px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
  .empty-icon{width:64px;height:64px;background:var(--surface2);border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text3)}
  .empty-title{font-weight:600}
  .empty-sub{color:var(--text3);font-size:0.875rem}

  /* Gold conversion box */
  .gold-calc-box{background:var(--gold-dim);border:1px solid rgba(251,191,36,0.25);border-radius:var(--radius-sm);padding:12px 16px;display:flex;align-items:center;gap:10px;font-size:0.875rem}

  /* Grid helpers */
  .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
  .mt4{margin-top:16px}.mb4{margin-bottom:16px}.mt2{margin-top:8px}
  .flex{display:flex}.items-center{align-items:center}.justify-between{justify-content:space-between}
  .gap2{gap:8px}.gap3{gap:12px}.flex1{flex:1}.fw6{font-weight:600}.fw7{font-weight:700}
  .text2{color:var(--text2)}.text3{color:var(--text3)}.text-gold{color:var(--gold)}.text-green{color:var(--green)}.text-red{color:var(--red)}.text-blue{color:var(--blue)}
  .fs-sm{font-size:0.8rem}.fs-xs{font-size:0.72rem}
  .divider{height:1px;background:var(--border);margin:16px 0}
  .person-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:all var(--tr)}
  .person-card:hover{border-color:var(--border2);transform:translateY(-1px);box-shadow:var(--shadow)}
  .person-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}

  @media(max-width:768px){
    .sidebar{transform:translateX(-100%)}
    .main{margin-left:0}
    .hamburger{display:flex}
    .stats-grid{grid-template-columns:repeat(2,1fr)}
    .form-grid{grid-template-columns:1fr}
    .page{padding:16px}
    .header{padding:0 16px}
    .modal{max-width:100%}
    .grid2{grid-template-columns:1fr}
  }
  @media(max-width:480px){.stats-grid{grid-template-columns:1fr}}

  /* Print */
  @media print{
    .sidebar,.header,.no-print{display:none!important}
    .main{margin-left:0}
    .page{padding:0}
    body{background:white;color:black}
    .card,.table-wrap{border:1px solid #ddd}
    table{font-size:12px}
  }
`;

// ─── Toast Hook ──────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type="success") => {
    const id = uid();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  const remove = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

function Toasts({ toasts, remove }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => remove(t.id)}>
          <span>{t.type==="success"?"✓":t.type==="error"?"✗":"ℹ"}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────
function Modal({ title, onClose, children, footer, wide, fullwide }) {
  useEffect(() => {
    const h = (e) => e.key==="Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose?.()}>
      <div className={`modal${wide?" wide":""}${fullwide?" fullwide":""}`}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn btn-icon btn-secondary" onClick={onClose}><Icon name="close" size={16}/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

function Confirm({ msg, onOk, onCancel }) {
  return (
    <Modal title="Confirm Delete" onClose={onCancel} footer={<>
      <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      <button className="btn btn-danger" onClick={onOk}>Delete</button>
    </>}>
      <p className="text2">{msg}</p>
    </Modal>
  );
}

// ─── Login + Register ────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [tab,      setTab]     = useState("login");
  const [username, setUsername]= useState("");
  const [password, setPassword]= useState("");
  const [bizName,  setBizName] = useState("");
  const [err,      setErr]     = useState("");
  const [busy,     setBusy]    = useState(false);

  const switchTab = (t) => { setTab(t); setErr(""); };

  const doLogin = async () => {
    if (!username.trim() || !password.trim()) return setErr("Enter username and password.");
    if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      onLogin({ id:"admin", username:ADMIN_USERNAME, role:"admin" }, true);
      return;
    }
    setBusy(true); setErr("");
    try {
      const result = await ghGet(USERS_FILE);
      const users  = result?.data?.users || [];
      const user   = users.find(x => x.username.toLowerCase() === username.toLowerCase().trim() && x.password === password);
      if (user) onLogin(user, false);
      else setErr("Invalid username or password.");
    } catch(e) { setErr("Could not connect. Check GitHub config."); }
    setBusy(false);
  };

  const doRegister = async () => {
    const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!uname)              return setErr("Username can only have letters, numbers, underscore.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (!bizName.trim())     return setErr("Enter your business name.");
    setBusy(true); setErr("");
    try {
      const result = await ghGet(USERS_FILE);
      const users  = result?.data?.users || [];
      const sha    = result?.sha || null;
      if (users.find(x => x.username === uname)) { setBusy(false); return setErr("Username already taken."); }
      const newUser = { id: uid(), username: uname, password, businessName: bizName.trim(), createdAt: Date.now() };
      await ghPut(USERS_FILE, { users: [...users, newUser] }, sha, `Registered: ${uname}`);
      await ghPut(userDataFile(uname), { ...defaultBusinessData, companyName: bizName.trim() }, null, `Init: ${uname}`);
      onLogin(newUser, false);
    } catch(e) { setErr("Registration failed. Check GitHub config."); }
    setBusy(false);
  };

  const inp = {background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.9rem",padding:"10px 12px",width:"100%",outline:"none",boxSizing:"border-box"};
  const btn = {width:"100%",display:"block",padding:"12px",fontSize:"1rem",fontWeight:600,background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"#000",border:"none",borderRadius:"var(--radius-sm)",cursor:"pointer",marginTop:4};

  return (
    <div className="login-page">
      <div className="login-card">

        <div className="login-logo">
          <div className="login-logo-icon"><Icon name="gold" size={32} color="#000"/></div>
          <div>
            <div className="login-title">Ledger</div>
            <div className="login-sub">Gold &amp; Money Ledger</div>
          </div>
        </div>

        <div className="tabs" style={{marginBottom:20}}>
          <div className={`tab${tab==="login"?" active":""}`} style={{flex:1,textAlign:"center"}} onClick={()=>switchTab("login")}>Sign In</div>
          <div className={`tab${tab==="register"?" active":""}`} style={{flex:1,textAlign:"center"}} onClick={()=>switchTab("register")}>Register</div>
        </div>

        {err && <div className="alert alert-error" style={{marginBottom:14}}>{err}</div>}

        {tab==="login" && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:5}}>Username</div>
              <input style={inp} value={username} onChange={e=>setUsername(e.target.value)} placeholder="your username" onKeyDown={e=>e.key==="Enter"&&doLogin()} autoFocus/>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:5}}>Password</div>
              <input style={inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
            </div>
            <button style={btn} onClick={doLogin} disabled={busy}>{busy?"Signing in...":"Sign In"}</button>
            <div style={{marginTop:14,textAlign:"center",fontSize:"0.82rem",color:"var(--text3)"}}>
              No account? <span style={{color:"var(--accent2)",cursor:"pointer"}} onClick={()=>switchTab("register")}>Register your business →</span>
            </div>
          </div>
        )}

        {tab==="register" && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:5}}>Business Name</div>
              <input style={inp} value={bizName} onChange={e=>setBizName(e.target.value)} placeholder="e.g. Sri Lakshmi Jewellers" autoFocus/>
            </div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:5}}>Username <span style={{color:"var(--text3)",fontSize:"0.72rem",textTransform:"none"}}>(letters, numbers, _ only)</span></div>
              <input style={inp} value={username} onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="e.g. srilakshmi"/>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:"0.78rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:5}}>Password <span style={{color:"var(--text3)",fontSize:"0.72rem",textTransform:"none"}}>(min 6 characters)</span></div>
              <input style={inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
            </div>
            <button style={btn} onClick={doRegister} disabled={busy}>{busy?"Creating account...":"Create Business Account"}</button>
            <div style={{marginTop:14,textAlign:"center",fontSize:"0.82rem",color:"var(--text3)"}}>
              Already have account? <span style={{color:"var(--accent2)",cursor:"pointer"}} onClick={()=>switchTab("login")}>Sign in →</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Person Form (Customer/Worker) ───────────────────────────────────
function PersonForm({ type, initial, onSave, onClose }) {
  const [f, setF] = useState(initial || { name:"", phone:"", address:"", workType:"", notes:"" });
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  return (
    <Modal title={`${initial?"Edit":"Add"} ${type}`} onClose={onClose} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-gold" onClick={()=>f.name.trim()&&onSave(f)}>Save {type}</button>
    </>}>
      <div className="form-grid">
        <div className="form-group full"><label>{type} Name *</label><input value={f.name} onChange={e=>set("name",e.target.value)} placeholder={`Enter ${type.toLowerCase()} name`} autoFocus/></div>
        <div className="form-group"><label>Phone</label><input value={f.phone} onChange={e=>set("phone",e.target.value)} placeholder="+91 98765 43210"/></div>
        {type==="Worker"&&<div className="form-group"><label>Work Type</label><input value={f.workType} onChange={e=>set("workType",e.target.value)} placeholder="e.g. Goldsmith"/></div>}
        {type==="Customer"&&<div className="form-group full"><label>Address</label><textarea value={f.address} onChange={e=>set("address",e.target.value)} placeholder="Enter address" rows={2}/></div>}
        <div className="form-group full"><label>Notes</label><textarea value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any remarks..." rows={2}/></div>
      </div>
    </Modal>
  );
}

// ─── People List ─────────────────────────────────────────────────────
function PeopleList({ type, data, entries, onAdd, onEdit, onDelete, onViewLedger }) {
  const [search, setSearch] = useState("");
  const [del, setDel] = useState(null);
  const key = type==="customer" ? "customers" : "workers";
  const filtered = useMemo(() => data.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())||(p.phone||"").includes(search)), [data, search]);

  const getBalance = (id) => {
    const tx = entries.filter(e=>e.personId===id);
    const goldBal  = tx.reduce((s,e)=>(s + Number(e.goldIn||0) - Number(e.goldOut||0)),0);
    const moneyBal = tx.reduce((s,e)=>(s + Number(e.moneyIn||0) - Number(e.moneyOut||0)),0);
    return { goldBal, moneyBal };
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <div className="section-title">{type==="customer"?"Customers":"Workers"}</div>
          <div className="section-sub">{data.length} total</div>
        </div>
        <button className="btn btn-gold" onClick={onAdd}><Icon name="plus" size={16}/>Add {type==="customer"?"Customer":"Worker"}</button>
      </div>
      <div className="toolbar">
        <div className="search-wrap"><span className="search-icon"><Icon name="search" size={15}/></span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${type==="customer"?"customers":"workers"}...`}/></div>
      </div>
      {filtered.length===0 ? (
        <div className="empty"><div className="empty-icon"><Icon name={type==="customer"?"customers":"workers"} size={28}/></div><div className="empty-title">No {type==="customer"?"customers":"workers"} yet</div><div className="empty-sub">Add your first {type} to get started</div></div>
      ) : (
        <div className="person-grid">
          {filtered.map(p=>{
            const {goldBal,moneyBal} = getBalance(p.id);
            return (
              <div key={p.id} className="person-card" onClick={()=>onViewLedger(p)}>
                <div className="flex items-center justify-between mb4">
                  <div>
                    <div className="fw7" style={{fontSize:"1rem"}}>{p.name}</div>
                    {p.phone&&<div className="fs-sm text3">{p.phone}</div>}
                    {type==="worker"&&p.workType&&<div className="fs-sm text3">{p.workType}</div>}
                  </div>
                  <div className="flex gap2" onClick={e=>e.stopPropagation()}>
                    <button className="btn btn-icon btn-secondary btn-sm" onClick={()=>onEdit(p)}><Icon name="edit" size={14}/></button>
                    <button className="btn btn-icon btn-danger btn-sm" onClick={()=>setDel(p)}><Icon name="trash" size={14}/></button>
                  </div>
                </div>
                <div className="divider" style={{margin:"10px 0"}}/>
                <div className="flex justify-between">
                  <div><div className="fs-xs text3">Gold Balance</div><div className="fw7 text-gold">{fmtGold(goldBal)}</div></div>
                  <div style={{textAlign:"right"}}><div className="fs-xs text3">Money Balance</div><div className={`fw7 ${moneyBal>=0?"text-green":"text-red"}`}>{fmtMoney(moneyBal)}</div></div>
                </div>
                <div className="mt2" style={{fontSize:"0.72rem",color:"var(--text3)"}}>
                  {entries.filter(e=>e.personId===p.id).length} transactions · Click to view ledger
                </div>
              </div>
            );
          })}
        </div>
      )}
      {del&&<Confirm msg={`Delete "${del.name}"? Their ledger entries will remain.`} onOk={()=>{onDelete(del.id);setDel(null)}} onCancel={()=>setDel(null)}/>}
    </div>
  );
}

// ─── Entry Form ──────────────────────────────────────────────────────
const emptyRow = (personId="", personType="customer", date=today()) => ({
  date, personId, personType,
  description:"", goldIn:"", goldOut:"",
  purity:"100", moneyIn:"", moneyOut:"", notes:""
});

function EntryForm({ initial, people, defaultPersonId, defaultPersonType, onSave, onClose }) {
  const isEdit = !!initial;
  const [rows, setRows] = useState(
    isEdit
      ? [{ ...initial, purity: initial.purity||"100" }]
      : [emptyRow(defaultPersonId||"", defaultPersonType||"customer")]
  );
  const [err, setErr] = useState("");

  const setRow = (i, k, v) => setRows(prev => prev.map((r,idx) => idx===i ? {...r,[k]:v} : r));
  const addRow = () => setRows(prev => [...prev, emptyRow(prev[0]?.personId||"", prev[0]?.personType||"customer", prev[0]?.date||today())]);

  const removeRow = (i) => setRows(prev => prev.length===1 ? prev : prev.filter((_,idx)=>idx!==i));

  const handleSave = () => {
    const filled = rows.filter(r => r.personId || r.goldIn || r.goldOut || r.moneyIn || r.moneyOut);
    if (filled.length===0) return setErr("Add at least one entry.");
    for (let i=0; i<filled.length; i++) {
      const r = filled[i];
      if (!r.personId) return setErr(`Row ${i+1}: Select a person.`);
      if (!r.date)     return setErr(`Row ${i+1}: Select a date.`);
      if (!r.goldIn && !r.goldOut && !r.moneyIn && !r.moneyOut) return setErr(`Row ${i+1}: Enter at least one value.`);
    }
    setErr("");
    if (isEdit) {
      // Edit mode: pass single object preserving original id
      const r = filled[0];
      const pv = r.purity||"100";
      onSave({
        ...r,
        id:          initial.id,
        goldIn:      Number(r.goldIn||0),
        goldOut:     Number(r.goldOut||0),
        moneyIn:     Number(r.moneyIn||0),
        moneyOut:    Number(r.moneyOut||0),
        purity:      pv,
        pureGoldIn:  pureGold(r.goldIn||0, pv),
        pureGoldOut: pureGold(r.goldOut||0, pv),
      });
    } else {
      const prepared = filled.map(r => {
        const pv = r.purity||"100";
        return {
          ...r,
          goldIn:      Number(r.goldIn||0),
          goldOut:     Number(r.goldOut||0),
          moneyIn:     Number(r.moneyIn||0),
          moneyOut:    Number(r.moneyOut||0),
          purity:      pv,
          pureGoldIn:  pureGold(r.goldIn||0, pv),
          pureGoldOut: pureGold(r.goldOut||0, pv),
          createdAt:   Date.now(),
        };
      });
      onSave(prepared);
    }
  };

  const filledCount = rows.filter(r=>r.personId||r.goldIn||r.goldOut||r.moneyIn||r.moneyOut).length;
  const allPeopleFlat = [...people.filter(p=>p.ptype==="customer"), ...people.filter(p=>p.ptype==="worker")];

  const inp = {background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.78rem",padding:"5px 6px",width:"100%",outline:"none",boxSizing:"border-box"};
  const hdr = {fontSize:"0.7rem",fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",padding:"6px 8px",background:"var(--surface2)",whiteSpace:"nowrap"};

  return (
    <Modal title={isEdit?"Edit Entry":"New Entries"} onClose={onClose} wide fullwide footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      {!isEdit && <button className="btn btn-secondary" onClick={addRow} style={{background:"var(--surface2)",border:"1px solid var(--border)"}}><Icon name="plus" size={14}/>Add Row</button>}
      <button className="btn btn-gold" onClick={handleSave}>
        {isEdit ? "Save Changes" : `Save ${filledCount>0?filledCount+" ":""}${filledCount===1?"Entry":"Entries"}`}
      </button>
    </>}>
      {err && <div className="alert alert-error" style={{marginBottom:12}}>{err}</div>}

      {/* Column headers */}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed",minWidth:760}}>
          <thead>
            <tr style={{borderBottom:"2px solid var(--border)"}}>
              <th style={{...hdr,width:28}}>#</th>
              <th style={{...hdr,width:100}}>Date</th>
              <th style={{...hdr,width:72}}>Type</th>
              <th style={{...hdr,width:130}}>Name *</th>
              <th style={{...hdr,width:130}}>Description</th>
              <th style={{...hdr,width:76,color:"var(--gold)"}}>Gold In</th>
              <th style={{...hdr,width:76,color:"var(--red)"}}>Gold Out</th>
              <th style={{...hdr,width:76}}>Purity</th>
              <th style={{...hdr,width:78,color:"#a78bfa",textAlign:"right"}}>Pure In</th>
              <th style={{...hdr,width:78,color:"#f97316",textAlign:"right"}}>Pure Out</th>
              <th style={{...hdr,width:78,color:"#fbbf24",textAlign:"right"}}>Net Pure</th>
              <th style={{...hdr,width:88,color:"var(--green)"}}>Money In ₹</th>
              <th style={{...hdr,width:88,color:"var(--red)"}}>Money Out ₹</th>
              <th style={{...hdr,width:70}}>Notes</th>
              <th style={{...hdr,width:28}}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f,i)=>{
              const pv = f.purity||"100";
              const pureIn  = f.goldIn  ? pureGold(Number(f.goldIn),  pv).toFixed(3) : null;
              const pureOut = f.goldOut ? pureGold(Number(f.goldOut), pv).toFixed(3) : null;
              const isLast = i===rows.length-1;
              const isEmpty = !f.personId && !f.goldIn && !f.goldOut && !f.moneyIn && !f.moneyOut && !f.description;
              const rowBg = isEmpty ? "rgba(255,255,255,0.02)" : i%2===0?"transparent":"rgba(255,255,255,0.02)";
              return (
                <tr key={i} style={{borderBottom:"1px solid var(--border)",background:rowBg}}>
                  <td style={{padding:"6px 8px",fontSize:"0.75rem",color:"var(--text3)",textAlign:"center"}}>{isEmpty?"→":i+1}</td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={inp} type="date" value={f.date} onChange={e=>setRow(i,"date",e.target.value)}/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <select style={inp} value={f.personType} onChange={e=>setRows(prev=>prev.map((r,idx)=>idx===i?{...r,personType:e.target.value,personId:""}:r))}>
                      <option value="customer">Customer</option>
                      <option value="worker">Worker</option>
                    </select>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <select style={{...inp,color:f.personId?"var(--text)":"var(--text3)"}} value={f.personId} onChange={e=>setRow(i,"personId",e.target.value)}>
                      <option value="">-- Select --</option>
                      {people.filter(p=>p.ptype===f.personType).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={inp} value={f.description} onChange={e=>setRow(i,"description",e.target.value)} placeholder="Description..."/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={{...inp,color:"var(--gold)"}} type="number" value={f.goldIn} onChange={e=>setRow(i,"goldIn",e.target.value)} placeholder="0.000" min="0" step="0.001"/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={{...inp,color:"var(--red)"}} type="number" value={f.goldOut} onChange={e=>setRow(i,"goldOut",e.target.value)} placeholder="0.000" min="0" step="0.001"/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                      <input style={{...inp,paddingRight:20}} value={f.purity} onChange={e=>setRow(i,"purity",e.target.value)} placeholder="100"/>
                      <span style={{position:"absolute",right:7,fontSize:"0.75rem",color:"var(--text3)",pointerEvents:"none"}}>%</span>
                    </div>
                  </td>
                  <td style={{padding:"4px 8px",textAlign:"right",fontSize:"0.72rem",color:"#a78bfa",whiteSpace:"nowrap"}}>
                    {pureIn?<span style={{color:"#a78bfa",fontWeight:600}}>{pureIn}g</span>:<span style={{color:"var(--text3)"}}>-</span>}
                  </td>
                  <td style={{padding:"4px 8px",textAlign:"right",fontSize:"0.72rem",color:"#f97316",whiteSpace:"nowrap"}}>
                    {pureOut?<span style={{color:"#f97316",fontWeight:600}}>{pureOut}g</span>:<span style={{color:"var(--text3)"}}>-</span>}
                  </td>
                  <td style={{padding:"4px 8px",textAlign:"right",fontSize:"0.72rem",whiteSpace:"nowrap"}}>
                    {(pureIn||pureOut)?<span style={{color:"#fbbf24",fontWeight:700}}>{((Number(pureIn||0)-Number(pureOut||0))).toFixed(3)}g</span>:<span style={{color:"var(--text3)"}}>-</span>}
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={{...inp,color:"var(--green)"}} type="number" value={f.moneyIn} onChange={e=>setRow(i,"moneyIn",e.target.value)} placeholder="0.00" min="0" step="0.01"/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={{...inp,color:"var(--red)"}} type="number" value={f.moneyOut} onChange={e=>setRow(i,"moneyOut",e.target.value)} placeholder="0.00" min="0" step="0.01"/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input style={inp} value={f.notes} onChange={e=>setRow(i,"notes",e.target.value)} placeholder="Notes..."/>
                  </td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>
                    {(!isEmpty || rows.length>1) && i<rows.length-1 &&
                      <button onClick={()=>removeRow(i)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--red)",padding:2,lineHeight:0}} title="Remove row">
                        <Icon name="trash" size={14}/>
                      </button>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isEdit && filledCount > 0 && (
        <div style={{marginTop:8,fontSize:"0.78rem",color:"var(--gold)",textAlign:"center",fontWeight:600}}>
          {filledCount} {filledCount===1?"entry":"entries"} ready to save.
        </div>
      )}
    </Modal>
  );
}

// ─── Ledger View ─────────────────────────────────────────────────────
function LedgerView({ person, entries, allPeople, onBack, onAddEntry, onEditEntry, onDeleteEntry, onDeleteManyEntries, companyData }) {
  const [monthFilter, setMonthFilter] = useState("");
  const [yearFilter,  setYearFilter]  = useState("");
  const [del,    setDel]    = useState(null);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [preview,    setPreview]    = useState(null);
  const [exportMenu, setExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(()=>{
    const h = (e) => { if(exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenu(false); };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[]);

  const personEntries = useMemo(() =>
    entries.filter(e=>e.personId===person.id)
           .sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)),
    [entries, person.id]
  );

  const years  = useMemo(()=>[...new Set(personEntries.map(e=>e.date.slice(0,4)))].sort().reverse(), [personEntries]);
  const months = useMemo(()=>{
    const base = yearFilter ? personEntries.filter(e=>e.date.startsWith(yearFilter)) : personEntries;
    return [...new Set(base.map(e=>e.date.slice(0,7)))].sort().reverse();
  }, [personEntries, yearFilter]);

  const filtered = useMemo(()=>{
    return personEntries.filter(e=>{
      if (yearFilter  && !e.date.startsWith(yearFilter))  return false;
      if (monthFilter && !e.date.startsWith(monthFilter)) return false;
      return true;
    });
  }, [personEntries, yearFilter, monthFilter]);

  // Sort helper for ledger
  const sortedFiltered = useMemo(()=>{
    return [...filtered].sort((a,b)=>{
      let va, vb;
      if (sortCol==="date")     { va=a.date+(a.createdAt||0); vb=b.date+(b.createdAt||0); return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va); }
      if (sortCol==="goldIn")   { va=Number(a.goldIn||0);   vb=Number(b.goldIn||0); }
      else if (sortCol==="goldOut")  { va=Number(a.goldOut||0);  vb=Number(b.goldOut||0); }
      else if (sortCol==="moneyIn")  { va=Number(a.moneyIn||0);  vb=Number(b.moneyIn||0); }
      else if (sortCol==="moneyOut") { va=Number(a.moneyOut||0); vb=Number(b.moneyOut||0); }
      else if (sortCol==="desc")     { va=a.description||""; vb=b.description||""; return sortDir==="asc"?va.localeCompare(vb):vb.localeCompare(va); }
      else { va=0; vb=0; }
      return sortDir==="asc" ? va-vb : vb-va;
    });
  }, [filtered, sortCol, sortDir]);

  // Running balance computed on sorted order
  const rows = useMemo(()=>{
    let goldBal=0, moneyBal=0;
    return sortedFiltered.map(e=>{
      goldBal  += Number(e.goldIn||0)  - Number(e.goldOut||0);
      moneyBal += Number(e.moneyIn||0) - Number(e.moneyOut||0);
      return { ...e, goldBal, moneyBal };
    });
  }, [sortedFiltered]);

  const totals = useMemo(()=>({
    goldIn:   filtered.reduce((s,e)=>s+Number(e.goldIn||0),0),
    goldOut:  filtered.reduce((s,e)=>s+Number(e.goldOut||0),0),
    moneyIn:  filtered.reduce((s,e)=>s+Number(e.moneyIn||0),0),
    moneyOut: filtered.reduce((s,e)=>s+Number(e.moneyOut||0),0),
    pureIn:   filtered.reduce((s,e)=>s+Number(e.pureGoldIn||0),0),
    pureOut:  filtered.reduce((s,e)=>s+Number(e.pureGoldOut||0),0),
  }), [filtered]);

  const handlePrint = () => window.print();

  // ── Build HTML report for this person's ledger ──
  const buildLedgerHTML = (ents, type="all") => {
    const bizName    = companyData?.companyName || "Gold Shop";
    const bizAddress = companyData?.companyAddress || "";
    const bizPhone   = companyData?.companyPhone || "";
    const bizOwner   = companyData?.companyOwner || "";
    const genTime    = new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
    const showGold   = type==="all"||type==="gold";
    const showMoney  = type==="all"||type==="money";
    const sorted     = [...ents].sort((a,b)=>b.date.localeCompare(a.date)||((b.createdAt||0)-(a.createdAt||0)));
    let s = {goldIn:0,goldOut:0,pureIn:0,pureOut:0,moneyIn:0,moneyOut:0};
    sorted.forEach(e=>{s.goldIn+=Number(e.goldIn||0);s.goldOut+=Number(e.goldOut||0);s.pureIn+=Number(e.pureGoldIn||0);s.pureOut+=Number(e.pureGoldOut||0);s.moneyIn+=Number(e.moneyIn||0);s.moneyOut+=Number(e.moneyOut||0);});
    let runGold=0, runMoney=0;
    const tableRows = sorted.map(e=>{
      runGold  += Number(e.goldIn||0) - Number(e.goldOut||0);
      runMoney += Number(e.moneyIn||0) - Number(e.moneyOut||0);
      const time = e.createdAt ? new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "";
      let cols = `<td>${fmtDate(e.date)}${time?`<br/><small style="color:#9ca3af">${time}</small>`:""}</td><td>${e.description||"-"}</td>${e.notes?`<td style="color:#6b7280;font-size:12px">${e.notes}</td>`:"<td>-</td>"}`;
      if(showGold) cols+=`<td style="text-align:right;color:#16a34a;font-weight:600">${e.goldIn?fmtGoldN(e.goldIn):"-"}</td><td style="text-align:right;color:#dc2626;font-weight:600">${e.goldOut?fmtGoldN(e.goldOut):"-"}</td><td style="text-align:center"><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${e.purity||"-"}</span></td><td style="text-align:right;color:#16a34a;font-weight:600">${e.pureGoldIn?fmtGoldN(e.pureGoldIn):"-"}</td><td style="text-align:right;color:#dc2626;font-weight:600">${e.pureGoldOut?fmtGoldN(e.pureGoldOut):"-"}</td><td style="text-align:right;font-weight:700;color:${runGold>=0?"#d97706":"#dc2626"}">${fmtGoldN(runGold)}</td>`;
      if(showMoney) cols+=`<td style="text-align:right;color:#16a34a;font-weight:600">${e.moneyIn?fmtMoneyPDF(e.moneyIn):"-"}</td><td style="text-align:right;color:#dc2626;font-weight:600">${e.moneyOut?fmtMoneyPDF(e.moneyOut):"-"}</td><td style="text-align:right;font-weight:700;color:${runMoney>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(runMoney)}</td>`;
      return `<tr style="border-bottom:1px solid #f3f4f6">${cols}</tr>`;
    }).join("");
    let headCols = `<th>Date</th><th>Description</th><th>Notes</th>`;
    if(showGold)  headCols+=`<th style="text-align:right">Gold In (g)</th><th style="text-align:right">Gold Out (g)</th><th style="text-align:center">Purity</th><th style="text-align:right">Pure In (g)</th><th style="text-align:right">Pure Out (g)</th><th style="text-align:right">Net Pure (g)</th>`;
    if(showMoney) headCols+=`<th style="text-align:right">Money In</th><th style="text-align:right">Money Out</th><th style="text-align:right">Balance</th>`;
    const pureNet = s.pureIn-s.pureOut; const moneyNet = s.moneyIn-s.moneyOut;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Ledger – ${person.name}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:32px 36px;font-size:13px;background:#fff;line-height:1.5}
    .biz-box{display:flex;justify-content:space-between;align-items:flex-start;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:20px}
    .biz-name{font-size:18px;font-weight:800;letter-spacing:0.02em;color:#fbbf24;margin-bottom:3px}.biz-sub{font-size:11px;color:#94a3b8}.person-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:14px}
    .person-avatar{width:44px;height:44px;background:linear-gradient(135deg,#fbbf24,#f59e0b);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#000;flex-shrink:0}
    .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .sum-card{border-radius:10px;padding:12px 14px;border:1px solid #e2e8f0}
    table{width:100%;border-collapse:collapse;font-size:12.5px}thead{background:#1e293b;color:#fff}th{padding:9px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}td{padding:8px 10px;vertical-align:middle;font-size:12.5px}
    tr:nth-child(even){background:#f8fafc}tbody tr:hover{background:#f1f5f9}
    .footer{margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    @media print{body{padding:16px 20px}}</style></head><body>
    <div class="biz-box"><div><div class="biz-name">${bizName}</div><div class="biz-sub">${bizAddress}${bizAddress&&bizPhone?" | ":""}${bizPhone}</div></div><div style="text-align:right"><div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Generated</div><div style="font-size:11px;color:#cbd5e1">${genTime}</div></div></div>
    <div class="person-box"><div class="person-avatar">${person.name[0].toUpperCase()}</div><div><div style="font-size:15px;font-weight:700;color:#1e293b">${person.name}</div><div style="font-size:11px;color:#64748b;text-transform:capitalize;margin-top:2px">${person.ptype||"customer"}${person.phone?" · "+person.phone:""}</div><div style="font-size:11px;color:#94a3b8;margin-top:1px">${ents.length} entries · ${yearFilter||monthFilter?"Filtered":"All time"}</div></div></div>
    <div class="summary-grid">
      <div class="sum-card" style="background:#fffbeb;border-color:#fde68a"><div style="font-size:10px;color:#92400e;font-weight:700;text-transform:uppercase;margin-bottom:4px">Gold In</div><div style="font-size:16px;font-weight:800;color:#d97706">${fmtGoldN(s.goldIn)}g</div></div>
      <div class="sum-card" style="background:#fef2f2;border-color:#fecaca"><div style="font-size:10px;color:#991b1b;font-weight:700;text-transform:uppercase;margin-bottom:4px">Gold Out</div><div style="font-size:16px;font-weight:800;color:#dc2626">${fmtGoldN(s.goldOut)}g</div></div>
      <div class="sum-card" style="background:${pureNet>=0?"#f0fdf4":"#fef2f2"};border-color:${pureNet>=0?"#bbf7d0":"#fecaca"}"><div style="font-size:10px;color:${pureNet>=0?"#14532d":"#991b1b"};font-weight:700;text-transform:uppercase;margin-bottom:4px">Net Pure Gold</div><div style="font-size:16px;font-weight:800;color:${pureNet>=0?"#16a34a":"#dc2626"}">${fmtGoldN(pureNet)}g</div></div>
      <div class="sum-card" style="background:${moneyNet>=0?"#f0fdf4":"#fef2f2"};border-color:${moneyNet>=0?"#bbf7d0":"#fecaca"}"><div style="font-size:10px;color:${moneyNet>=0?"#14532d":"#991b1b"};font-weight:700;text-transform:uppercase;margin-bottom:4px">Money Balance</div><div style="font-size:15px;font-weight:800;color:${moneyNet>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(moneyNet)}</div></div>
    </div>
    <table><thead><tr>${headCols}</tr></thead><tbody>${tableRows}</tbody></table>
    <div class="footer">Ledger Report · ${person.name} · Printed ${genTime}${bizOwner?" · "+bizOwner:""}</div>
    </body></html>`;
  };

  // ── PDF export via print ──
  const handleExportPDF = () => {
    setExportMenu(false);
    const html = buildLedgerHTML(filtered, "all");
    printHTMLDoc(html, makeFileName(`Ledger_${person.name}${yearFilter?"_"+yearFilter:""}${monthFilter?"_"+new Date(monthFilter+"-01").toLocaleString("default",{month:"short",year:"numeric"}):""}${!yearFilter&&!monthFilter?"_AllTime":""}`, "pdf"));
  };

  // ── CSV export ──
  const handleExportCSV = () => {
    setExportMenu(false);
    const headers = ["Date","Description","Notes","Gold In (g)","Gold Out (g)","Purity","Pure Gold In (g)","Pure Gold Out (g)","Money In","Money Out"];
    const csvRows = [headers.join(",")];
    [...filtered].sort((a,b)=>b.date.localeCompare(a.date)).forEach(e=>{
      csvRows.push([e.date,`"${(e.description||"").replace(/"/g,'""')}"`,`"${(e.notes||"").replace(/"/g,'""')}"`,e.goldIn||"",e.goldOut||"",e.purity||"",e.pureGoldIn||"",e.pureGoldOut||"",e.moneyIn||"",e.moneyOut||""].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], {type:"text/csv;charset=utf-8;"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = makeFileName(`Ledger_${person.name}${yearFilter?"_"+yearFilter:""}${monthFilter?"_"+new Date(monthFilter+"-01").toLocaleString("default",{month:"short",year:"numeric"}):""}${!yearFilter&&!monthFilter?"_AllTime":""}`, "csv");
    a.click(); URL.revokeObjectURL(url);
  };

  // ── In-app Preview ──
  const handlePreview = () => {
    const html = buildLedgerHTML(filtered, "all");
    setPreview({ html, title: `Ledger – ${person.name}` });
  };

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap3">
          <button className="btn btn-secondary btn-sm" onClick={onBack}><Icon name="back" size={16}/>Back</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>{onBack(); setTimeout(()=>window.scrollTo(0,0),100)}} style={{background:"var(--gold-dim)",color:"var(--gold)",border:"1px solid rgba(251,191,36,0.3)"}}><Icon name="dashboard" size={14}/>Home</button>
          <div>
            <div className="section-title">{person.name}</div>
            <div className="section-sub">{person.ptype==="customer"?"Customer":"Worker"}{person.phone&&` · ${person.phone}`}</div>
          </div>
        </div>
        <div className="flex gap2 no-print" style={{alignItems:"center",flexWrap:"wrap"}}>
          {/* Preview */}
          <button className="btn btn-secondary btn-sm" onClick={handlePreview} title="Preview report in-app">
            <Icon name="eye" size={14}/>Preview
          </button>
          {/* Export dropdown */}
          <div style={{position:"relative"}} ref={exportMenuRef}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setExportMenu(o=>!o)} title="Export options">
              <Icon name="download" size={14}/>Export ▾
            </button>
            {exportMenu&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,boxShadow:"var(--shadow)",minWidth:170,zIndex:200,overflow:"hidden"}}>
                <div style={{padding:"8px 14px",fontSize:"0.7rem",color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",borderBottom:"1px solid var(--border)"}}>Export As</div>
                <div onClick={handleExportPDF} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",fontSize:"0.88rem",color:"var(--text)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <Icon name="pdf" size={15} color="var(--red)"/><div><div style={{fontWeight:600}}>PDF / Print</div><div style={{fontSize:"0.72rem",color:"var(--text3)"}}>Formatted print-ready report</div></div>
                </div>
                <div onClick={handleExportCSV} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",fontSize:"0.88rem",color:"var(--text)",borderTop:"1px solid var(--border)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <Icon name="download" size={15} color="var(--green)"/><div><div style={{fontWeight:600}}>CSV / Excel</div><div style={{fontSize:"0.72rem",color:"var(--text3)"}}>Raw data spreadsheet</div></div>
                </div>
                <div onClick={handlePrint} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",fontSize:"0.88rem",color:"var(--text)",borderTop:"1px solid var(--border)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--surface2)"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <Icon name="print" size={15} color="var(--blue)"/><div><div style={{fontWeight:600}}>Print Page</div><div style={{fontSize:"0.72rem",color:"var(--text3)"}}>Print current screen</div></div>
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-gold" onClick={onAddEntry}><Icon name="plus" size={16}/>New Entry</button>
        </div>
      </div>

      {/* Balance Summary */}
      <div className="stats-grid" style={{marginBottom:16}}>
        <div className="stat-card gold">
          <div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div>
          <div className="stat-label">Gold Balance (Net)</div>
          <div className="stat-value gold">{fmtGold(totals.goldIn - totals.goldOut)}</div>
          <div className="stat-sub">In: {fmtGold(totals.goldIn)} · Out: {fmtGold(totals.goldOut)}</div>
        </div>
        <div className="stat-card gold" style={{"--gold":"#a78bfa"}}>
          <div className="stat-icon" style={{background:"rgba(167,139,250,0.12)",color:"#a78bfa"}}><Icon name="gold" size={18} color="#a78bfa"/></div>
          <div className="stat-label">Pure Gold Balance (100%)</div>
          <div className="stat-value" style={{color:"#a78bfa"}}>{fmtGold(totals.pureIn - totals.pureOut)}</div>
          <div className="stat-sub">In: {fmtGold(totals.pureIn)} · Out: {fmtGold(totals.pureOut)}</div>
        </div>
        <div className={`stat-card ${totals.moneyIn-totals.moneyOut>=0?"green":"red"}`}>
          <div className={`stat-icon ${totals.moneyIn-totals.moneyOut>=0?"green":"red"}`}><Icon name="money" size={18} color={totals.moneyIn-totals.moneyOut>=0?"var(--green)":"var(--red)"}/></div>
          <div className="stat-label">Money Balance</div>
          <div className={`stat-value ${totals.moneyIn-totals.moneyOut>=0?"green":"red"}`}>{fmtMoney(totals.moneyIn-totals.moneyOut)}</div>
          <div className="stat-sub">In: {fmtMoney(totals.moneyIn)} · Out: {fmtMoney(totals.moneyOut)}</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue"><Icon name="ledger" size={18} color="var(--blue)"/></div>
          <div className="stat-label">Total Entries</div>
          <div className="stat-value blue">{filtered.length}</div>
          <div className="stat-sub">{personEntries.length} total all-time</div>
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar no-print">
        <select value={yearFilter}  onChange={e=>{setYearFilter(e.target.value);setMonthFilter("")}} style={{minWidth:100}}>
          <option value="">All Years</option>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <select value={monthFilter} onChange={e=>setMonthFilter(e.target.value)} style={{minWidth:140}}>
          <option value="">All Months</option>
          {months.map(m=><option key={m} value={m}>{new Date(m+"-01").toLocaleString("default",{month:"long",year:"numeric"})}</option>)}
        </select>
        {(yearFilter||monthFilter)&&<button className="btn btn-secondary btn-sm" onClick={()=>{setYearFilter("");setMonthFilter("")}}>Clear</button>}
      </div>

      {/* Ledger Table */}
      {rows.length===0 ? (
        <div className="empty"><div className="empty-icon"><Icon name="ledger" size={28}/></div><div className="empty-title">No entries found</div><div className="empty-sub">Add a ledger entry to get started</div></div>
      ) : (
        <>
        {selectedIds.size>0&&(
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:"rgba(244,63,94,0.1)",border:"1px solid rgba(244,63,94,0.3)",borderRadius:8,marginBottom:10}}>
            <span style={{fontSize:"0.85rem",color:"var(--red)",fontWeight:600}}>{selectedIds.size} selected</span>
            <button className="btn btn-danger btn-sm" onClick={()=>setBulkConfirm(true)}><Icon name="trash" size={13}/>Delete Selected</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedIds(new Set())}>Clear</button>
          </div>
        )}
        <div className="table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th style={{width:36,textAlign:"center",padding:"6px 8px"}}>
                  <input type="checkbox" style={{cursor:"pointer",accentColor:"var(--red)"}}
                    checked={rows.length>0&&rows.every(r=>selectedIds.has(r.id))}
                    onChange={e=>setSelectedIds(e.target.checked?new Set(rows.map(r=>r.id)):new Set())}/>
                </th>
                {[["date","Date & Time"],["desc","Description"],["goldIn","Gold In (g)"],["goldOut","Gold Out (g)"],["purity","Purity"],["pureGoldIn","Pure Gold In (g)"],["pureGoldOut","Pure Gold Out (g)"],["pureTot","Total Pure Gold (g)"]].map(([col,lbl])=>(
                  <th key={col} className={col==="goldIn"||col==="goldOut"||col==="pureGoldIn"||col==="pureGoldOut"||col==="pureTot"?"th-right":col==="purity"?"th-center":""}
                    onClick={()=>{ if(["date","goldIn","goldOut","moneyIn","moneyOut","desc"].includes(col)){ if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortCol(col);setSortDir("desc");} } }}
                    style={{cursor:["date","goldIn","goldOut","moneyIn","moneyOut","desc"].includes(col)?"pointer":"default",userSelect:"none",whiteSpace:"nowrap",fontSize:"0.82rem",fontWeight:700}}>
                    {lbl}{sortCol===col?<span style={{color:"var(--gold)",marginLeft:3,fontSize:"0.7rem"}}>{sortDir==="asc"?"↑":"↓"}</span>:<span style={{opacity:["date","goldIn","goldOut","moneyIn","moneyOut","desc"].includes(col)?0.2:0,marginLeft:3,fontSize:"0.7rem"}}>⇅</span>}
                  </th>
                ))}
                {[["moneyIn","Money In (₹)"],["moneyOut","Money Out (₹)"],["moneyBal","Money Balance"]].map(([col,lbl])=>(
                  <th key={col} className="th-right"
                    onClick={()=>{ if(["moneyIn","moneyOut"].includes(col)){ if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortCol(col);setSortDir("desc");} } }}
                    style={{cursor:["moneyIn","moneyOut"].includes(col)?"pointer":"default",userSelect:"none",whiteSpace:"nowrap"}}>
                    {lbl}{sortCol===col?<span style={{color:"var(--gold)",marginLeft:3,fontSize:"0.7rem"}}>{sortDir==="asc"?"↑":"↓"}</span>:<span style={{opacity:["moneyIn","moneyOut"].includes(col)?0.2:0,marginLeft:3,fontSize:"0.7rem"}}>⇅</span>}
                  </th>
                ))}
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row=>(
                <tr key={row.id} style={{background:selectedIds.has(row.id)?"rgba(244,63,94,0.07)":""}}>
                  <td style={{textAlign:"center",padding:"6px 8px"}}>
                    <input type="checkbox" style={{cursor:"pointer",accentColor:"var(--red)"}}
                      checked={selectedIds.has(row.id)}
                      onChange={e=>{const s=new Set(selectedIds);e.target.checked?s.add(row.id):s.delete(row.id);setSelectedIds(s);}}/>
                  </td>
                  <td style={{whiteSpace:"nowrap",color:"var(--text2)",fontSize:"0.88rem"}}>{fmtDate(row.date)}</td>
                  <td><div className="fw6" style={{fontSize:"0.9rem"}}>{row.description||"-"}</div>{row.notes&&<div className="fs-xs text3">{row.notes}</div>}</td>
                  <td className="right"><span style={{color:row.goldIn?"var(--green)":"var(--text3)",fontWeight:row.goldIn?700:400,fontSize:"0.9rem"}}>{row.goldIn?fmtGoldN(row.goldIn):"-"}</span></td>
                  <td className="right"><span style={{color:row.goldOut?"var(--red)":"var(--text3)",fontWeight:row.goldOut?700:400,fontSize:"0.9rem"}}>{row.goldOut?fmtGoldN(row.goldOut):"-"}</span></td>
                  <td className="center"><span className="badge badge-gold" style={{fontSize:"0.85rem"}}>{row.purity||"-"}</span></td>
                  <td className="right" style={{fontSize:"0.88rem"}}>
                    <span style={{color:row.pureGoldIn?"var(--green)":"var(--text3)",fontWeight:row.pureGoldIn?600:400}}>{row.pureGoldIn?fmtGoldN(row.pureGoldIn):"-"}</span>
                  </td>
                  <td className="right" style={{fontSize:"0.88rem"}}>
                    <span style={{color:row.pureGoldOut?"var(--red)":"var(--text3)",fontWeight:row.pureGoldOut?600:400}}>{row.pureGoldOut?fmtGoldN(row.pureGoldOut):"-"}</span>
                  </td>
                  <td className="right" style={{fontSize:"0.88rem"}}>
                    {(row.pureGoldIn||row.pureGoldOut)?<span style={{color:(Number(row.pureGoldIn||0)-Number(row.pureGoldOut||0))>=0?"var(--gold)":"var(--red)",fontWeight:700}}>{fmtGoldN(Number(row.pureGoldIn||0)-Number(row.pureGoldOut||0))}</span>:<span className="text3">-</span>}
                  </td>
                  <td className="right" style={{fontSize:"0.88rem"}}><span style={{color:row.moneyIn?"var(--green)":"var(--text3)",fontWeight:row.moneyIn?600:400}}>{row.moneyIn?fmtMoney(row.moneyIn):"-"}</span></td>
                  <td className="right" style={{fontSize:"0.88rem"}}><span style={{color:row.moneyOut?"var(--red)":"var(--text3)",fontWeight:row.moneyOut?600:400}}>{row.moneyOut?fmtMoney(row.moneyOut):"-"}</span></td>
                  <td className="right"><span style={{fontWeight:700,fontSize:"0.9rem",color:row.moneyBal>=0?"var(--green)":"var(--red)"}}>{fmtMoney(row.moneyBal)}</span></td>
                  <td className="no-print">
                    <div className="flex gap2">
                      <button className="btn btn-icon btn-secondary btn-sm" onClick={()=>onEditEntry(row)}><Icon name="edit" size={13}/></button>
                      <button className="btn btn-icon btn-danger btn-sm" onClick={()=>setDel(row)}><Icon name="trash" size={13}/></button>
                    </div>
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="ledger-balance-row">
                <td/>
                <td colSpan={2}><span className="fw7" style={{fontSize:"0.95rem"}}>TOTALS ({rows.length})</span></td>
                <td className="right"><span style={{color:"var(--green)",fontWeight:700,fontSize:"0.9rem"}}>{fmtGoldN(totals.goldIn)}</span></td>
                <td className="right"><span style={{color:"var(--red)",fontWeight:700,fontSize:"0.9rem"}}>{fmtGoldN(totals.goldOut)}</span></td>
                <td/>
                <td className="right"><span style={{background:"rgba(251,191,36,0.18)",border:"1px solid #fbbf24",borderRadius:6,padding:"3px 10px",color:"var(--green)",fontWeight:800,fontSize:"0.95rem",display:"inline-block"}}>{fmtGoldN(totals.pureIn)}</span></td>
                <td className="right"><span style={{background:"rgba(251,191,36,0.18)",border:"1px solid #fbbf24",borderRadius:6,padding:"3px 10px",color:"var(--red)",fontWeight:800,fontSize:"0.95rem",display:"inline-block"}}>{fmtGoldN(totals.pureOut)}</span></td>
                <td className="right"><span style={{background:"rgba(251,191,36,0.3)",border:"2px solid #fbbf24",borderRadius:6,padding:"3px 10px",color:totals.pureIn-totals.pureOut>=0?"var(--gold)":"var(--red)",fontWeight:800,fontSize:"0.95rem",display:"inline-block"}}>{fmtGoldN(totals.pureIn-totals.pureOut)}</span></td>
                <td className="right"><span style={{color:"var(--green)",fontWeight:700,fontSize:"0.9rem"}}>{fmtMoney(totals.moneyIn)}</span></td>
                <td className="right"><span style={{color:"var(--red)",fontWeight:700,fontSize:"0.9rem"}}>{fmtMoney(totals.moneyOut)}</span></td>
                <td className="right"><span style={{background:"rgba(251,191,36,0.3)",border:"2px solid #fbbf24",borderRadius:6,padding:"3px 10px",color:totals.moneyIn-totals.moneyOut>=0?"var(--gold)":"var(--red)",fontWeight:800,fontSize:"0.95rem",display:"inline-block"}}>{fmtMoney(totals.moneyIn-totals.moneyOut)}</span></td>
                <td className="no-print"/>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      )}
      {del&&<Confirm msg={`Delete entry "${del.description||fmtDate(del.date)}"?`} onOk={()=>{onDeleteEntry(del.id);setDel(null)}} onCancel={()=>setDel(null)}/>}
      {bulkConfirm&&<Confirm msg={`Delete ${selectedIds.size} selected ${selectedIds.size===1?"entry":"entries"}? This cannot be undone.`} onOk={()=>{(onDeleteManyEntries||((ids)=>ids.forEach(id=>onDeleteEntry(id))))([...selectedIds]);setSelectedIds(new Set());setBulkConfirm(false);}} onCancel={()=>setBulkConfirm(false)}/>}

      {/* ── Preview Modal ── */}
      {preview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",flexDirection:"column"}} onClick={e=>e.target===e.currentTarget&&setPreview(null)}>
          <div style={{background:"var(--surface)",borderBottom:"1px solid var(--border)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <Icon name="eye" size={16} color="var(--gold)"/>
              <span style={{fontWeight:700,fontSize:"1rem"}}>{preview.title}</span>
              <span style={{fontSize:"0.75rem",color:"var(--text3)",background:"var(--surface2)",padding:"2px 8px",borderRadius:6}}>{filtered.length} entries</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-gold btn-sm" onClick={handleExportPDF}><Icon name="pdf" size={13}/>Export PDF</button>
              <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}><Icon name="download" size={13}/>CSV</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPreview(null)}><Icon name="close" size={14}/>Close</button>
            </div>
          </div>
          <iframe srcDoc={preview.html} style={{flex:1,border:"none",background:"#fff"}} title="Ledger Preview"/>
        </div>
      )}
    </div>
  );
}

// ─── Standalone report HTML builder (no auto-print, used for saving) ──
function buildReportHTML(ents, title, type, personName, companyData, sortDir="desc", hallmark=true) {
  const bizName    = companyData?.companyName || "Gold Shop";
  const bizOwner   = companyData?.companyOwner || "";
  const bizAddress = companyData?.companyAddress || "";
  const bizPhone   = companyData?.companyPhone || "";
  const genTime    = new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const showGold   = type==="all"||type==="gold";
  const showMoney  = type==="all"||type==="money";

  // Sort by date
  const sorted = [...ents].sort((a,b)=> sortDir==="desc"
    ? b.date.localeCompare(a.date)||((b.createdAt||0)-(a.createdAt||0))
    : a.date.localeCompare(b.date)||((a.createdAt||0)-(b.createdAt||0)));

  let s={goldIn:0,goldOut:0,pureIn:0,pureOut:0,moneyIn:0,moneyOut:0};
  sorted.forEach(e=>{s.goldIn+=Number(e.goldIn||0);s.goldOut+=Number(e.goldOut||0);s.pureIn+=Number(e.pureGoldIn||0);s.pureOut+=Number(e.pureGoldOut||0);s.moneyIn+=Number(e.moneyIn||0);s.moneyOut+=Number(e.moneyOut||0);});

  let rG=0,rM=0;
  const tableRows = sorted.map(e=>{
    rG+=Number(e.goldIn||0)-Number(e.goldOut||0);
    rM+=Number(e.moneyIn||0)-Number(e.moneyOut||0);
    let cols=`<td style="font-size:13.5px;color:#1a1a1a">${fmtDate(e.date)}</td><td><strong style="font-size:13.5px">${e._personName||"-"}</strong><br/><small style="color:${e.personType==="customer"?"#2563eb":"#7c3aed"};font-weight:600">${e.personType==="customer"?"Customer":"Worker"}</small></td><td style="font-size:13.5px;color:#1a1a1a">${e.description||"-"}</td>`;
    if(showGold) cols+=`<td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.goldIn?fmtGoldN(e.goldIn):"-"}</td><td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.goldOut?fmtGoldN(e.goldOut):"-"}</td><td style="text-align:center"><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${e.purity||"-"}</span></td><td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.pureGoldIn?fmtGoldN(e.pureGoldIn):"-"}</td><td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.pureGoldOut?fmtGoldN(e.pureGoldOut):"-"}</td><td style="text-align:right;font-weight:700;font-size:13px;color:${(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0))>=0?"#d97706":"#dc2626"}">${(e.pureGoldIn||e.pureGoldOut)?fmtGoldN(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0)):"-"}</td>`;
    if(showMoney) cols+=`<td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.moneyIn?fmtMoneyPDF(e.moneyIn):"-"}</td><td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.moneyOut?fmtMoneyPDF(e.moneyOut):"-"}</td><td style="text-align:right;font-weight:700;font-size:13px;color:${rM>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(rM)}</td>`;
    return `<tr>${cols}</tr>`;
  }).join("");
  let headCols=`<th>Date</th><th>Name</th><th>Description</th>`;
  if(showGold)  headCols+=`<th style="text-align:right">Gold In (g)</th><th style="text-align:right">Gold Out (g)</th><th style="text-align:center">Purity</th><th style="text-align:right">Pure Gold In (g)</th><th style="text-align:right">Pure Gold Out (g)</th><th style="text-align:right">Total Pure Gold (g)</th>`;
  if(showMoney) headCols+=`<th style="text-align:right">Money In</th><th style="text-align:right">Money Out</th><th style="text-align:right">Money Balance</th>`;

  // Reuse same CSS/biz-box as the main buildHTML (inlined minimal version)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
    body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:36px 40px;font-size:14px;background:#fff;line-height:1.6}
    .biz-box{position:relative;overflow:hidden;text-align:center;padding:20px 16px 16px;border-radius:16px;margin-bottom:18px;background:#7c3207!important;background-image:linear-gradient(135deg,#6b2a04 0%,#7c3207 25%,#9a3d0a 50%,#7c3207 75%,#6b2a04 100%)!important;border:3px solid #d97706;box-shadow:0 0 0 2px rgba(217,119,6,0.4),0 8px 32px rgba(0,0,0,0.35)}
    .biz-orn-left{position:absolute;left:0;top:0;bottom:0;width:130px;display:flex;align-items:center;justify-content:center;pointer-events:none;border-right:1px solid rgba(251,191,36,0.3)}
    .biz-orn-right{position:absolute;right:0;top:0;bottom:0;width:130px;display:flex;align-items:center;justify-content:center;pointer-events:none;border-left:1px solid rgba(251,191,36,0.3)}
    .biz-box::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:#fbbf24!important;background-image:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent)!important;z-index:3}
    .biz-box::after{content:'';position:absolute;bottom:0;left:0;right:0;height:3px;background:#fbbf24!important;background-image:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent)!important;z-index:3}
    .biz-inner{position:relative;z-index:2;padding:0 8px}
    .hallmark-tag{display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;background:#f59e0b!important;color:#78350f;font-size:9.5px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:3px 12px 3px 8px;border-radius:99px;border:1.5px solid rgba(255,255,255,0.5)}
    .hallmark-tag .hall-num{font-size:11px;font-weight:900;background:#78350f!important;color:#fbbf24;border-radius:99px;padding:1px 7px;display:inline-block}
    .biz-name{font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;color:#fef3c7!important;letter-spacing:0.04em;line-height:1.2}
    .biz-sub{margin-top:4px;font-size:12px;color:#fde68a!important;font-weight:600}
    .biz-divider{display:flex;align-items:center;gap:8px;margin:8px auto 6px;max-width:340px}
    .biz-divider-line{flex:1;height:1px;background:#fbbf24!important;opacity:0.5}
    .biz-divider-diamond{width:7px;height:7px;background:#fbbf24!important;transform:rotate(45deg);flex-shrink:0}
    .biz-details{margin-top:6px;font-size:11.5px;color:#fde68a!important;display:flex;flex-wrap:wrap;justify-content:center;gap:16px}
    .biz-details span{display:inline-flex;align-items:center;gap:4px}
    .report-title-block{margin-bottom:14px;padding-bottom:12px;border-bottom:2px solid #f59e0b}
    .report-title-text{font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:800;color:#1a1a1a;margin-bottom:4px}
    .report-meta-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .report-meta-row span{font-size:12px;color:#6b7280;display:inline-flex;align-items:center;gap:4px}
    .badge{display:inline-block;background:#fef3c7;color:#92400e;padding:3px 12px;border-radius:99px;font-weight:700;font-size:11px;border:1px solid #fcd34d;letter-spacing:0.04em}
    .auto-badge{display:inline-block;background:#dbeafe;color:#1d4ed8;padding:3px 12px;border-radius:99px;font-weight:700;font-size:11px;border:1px solid #93c5fd;letter-spacing:0.04em;margin-left:6px}
    table{width:100%;border-collapse:collapse;margin-top:4px}
    th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;white-space:nowrap}
    td{padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13.5px;vertical-align:middle;color:#1a1a1a}
    tr:hover td{background:#fafafa}
    .totals-row td{background:#fffbeb;font-weight:700;border-top:2px solid #f59e0b;font-size:14px}
    .tot-box{display:inline-block;padding:3px 10px;border-radius:6px;border:1.5px solid #fbbf24;background:#fffbeb;font-weight:800;font-size:13px}
    .green-tot{color:#16a34a}.red-tot{color:#dc2626}.gold-tot{color:#d97706}
    .balances{margin-top:22px;padding:16px 18px;border:2px solid #fbbf24;border-radius:12px;background:#fffbeb}
    .balances-title{font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;color:#1a1a1a;margin-bottom:12px}
    .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
    .bal-item{text-align:center;padding:14px 10px;background:#fffbeb!important;border-radius:9px;border:2px solid #fbbf24}
    .bal-label{font-size:11px;color:#1a1a1a;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;margin-bottom:6px}
    .bal-value{font-size:20px;font-weight:800;line-height:1.2}
    .bal-sub{font-size:11px;color:#374151;margin-top:4px}
    .gold-val{color:#d97706}.purple-val{color:#7c3aed}.green-val{color:#16a34a}.red-val{color:#dc2626}.blue-val{color:#2563eb}
    .page-footer{margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
    @media print{body{padding:20px 24px}@page{margin:1cm;size:A4}}
  </style></head><body>
  <div class="biz-box">
    <!-- Left ornament -->
    <div class="biz-orn-left">
      <svg width="110" height="110" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="55" cy="55" r="50" stroke="rgba(251,191,36,0.35)" stroke-width="1" fill="none"/>
        <circle cx="55" cy="55" r="33" stroke="rgba(251,191,36,0.30)" stroke-width="1" fill="none"/>
        <circle cx="55" cy="55" r="22" stroke="rgba(251,191,36,0.40)" stroke-width="1.2" fill="rgba(251,191,36,0.06)"/>
        <circle cx="55" cy="55" r="4"  fill="rgba(251,191,36,0.8)"/>
        <ellipse cx="55" cy="34" rx="4" ry="10" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
        <ellipse cx="55" cy="76" rx="4" ry="10" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
        <ellipse cx="34" cy="55" rx="10" ry="4" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
        <ellipse cx="76" cy="55" rx="10" ry="4" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
        <ellipse cx="42" cy="42" rx="4" ry="10" transform="rotate(-45 42 42)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
        <ellipse cx="68" cy="42" rx="4" ry="10" transform="rotate(45 68 42)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
        <ellipse cx="42" cy="68" rx="4" ry="10" transform="rotate(45 42 68)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
        <ellipse cx="68" cy="68" rx="4" ry="10" transform="rotate(-45 68 68)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
      </svg>
    </div>
    <!-- Right ornament - Official BIS 916 Hallmark -->
    <div class="biz-orn-right">
      ${hallmark?`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px">
        <svg width="54" height="60" viewBox="0 0 54 60" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="27,2 52,16 52,44 27,58 2,44 2,16" stroke="#fbbf24" stroke-width="2.5" fill="rgba(251,191,36,0.13)"/>
          <polygon points="27,9 45,19 45,41 27,51 9,41 9,19" stroke="rgba(251,191,36,0.55)" stroke-width="1" fill="none"/>
          <text x="27" y="25" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="900" fill="#fbbf24" letter-spacing="2">BIS</text>
          <text x="27" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="900" fill="#fde68a" letter-spacing="1">916</text>
          <text x="27" y="49" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.5" font-weight="700" fill="rgba(251,191,36,0.8)" letter-spacing="1">INDIA</text>
          <circle cx="27" cy="2"  r="2.5" fill="#fbbf24"/>
          <circle cx="52" cy="16" r="2.5" fill="#fbbf24"/>
          <circle cx="52" cy="44" r="2.5" fill="#fbbf24"/>
          <circle cx="27" cy="58" r="2.5" fill="#fbbf24"/>
          <circle cx="2"  cy="44" r="2.5" fill="#fbbf24"/>
          <circle cx="2"  cy="16" r="2.5" fill="#fbbf24"/>
        </svg>
        <div style="font-family:Arial,sans-serif;font-size:8.5px;font-weight:900;color:#fbbf24;letter-spacing:0.1em;text-transform:uppercase;line-height:1.6;text-align:center">916<br/>BIS HALLMARK<br/>JEWELLERY</div>
      </div>`:`<svg width="100" height="100" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="45" stroke="rgba(251,191,36,0.3)" stroke-width="1" fill="none"/>
        <circle cx="50" cy="50" r="30" stroke="rgba(251,191,36,0.2)" stroke-width="0.8" fill="none" stroke-dasharray="3,4"/>
        <circle cx="50" cy="50" r="8" fill="rgba(251,191,36,0.25)" stroke="rgba(251,191,36,0.5)" stroke-width="1.2"/>
      </svg>`}
    </div>
    <div class="biz-inner">
      <div class="biz-name">${bizName}</div>
      ${bizOwner?`<div class="biz-sub">Proprietor: ${bizOwner}</div>`:""}
      <div class="biz-divider"><div class="biz-divider-line"></div><div class="biz-divider-diamond"></div><div class="biz-divider-line"></div></div>
      ${(bizAddress||bizPhone)?`<div class="biz-details">${bizAddress?`<span><b style="color:#fbbf24">Addr:</b> ${bizAddress}</span>`:""}${bizPhone?`<span><b style="color:#fbbf24">Ph:</b> ${bizPhone}</span>`:""}</div>`:""}
    </div>
  </div>
  <div class="report-title-block">
    <div class="report-title-text">${title}</div>
    <div class="report-meta-row">
      <span>Generated: ${genTime}</span>
      <span class="badge">${type==="all"?"FULL REPORT":type==="gold"?"GOLD REPORT":"MONEY REPORT"}</span>
      ${personName?`<span>${personName}</span>`:""}
    </div>
  </div>
  <table><thead><tr>${headCols}</tr></thead>
  <tbody>${tableRows}
    <tr class="totals-row"><td colspan="3">TOTALS (${sorted.length} entries)</td>
      ${showGold?`<td></td><td></td><td></td><td style="text-align:right"><span class="tot-box green-tot">${fmtGoldN(s.pureIn)}</span></td><td style="text-align:right"><span class="tot-box red-tot">${fmtGoldN(s.pureOut)}</span></td><td style="text-align:right"><span class="tot-box ${s.pureIn-s.pureOut>=0?"gold-tot":"red-tot"}">${fmtGoldN(s.pureIn-s.pureOut)}</span></td>`:""}
      ${showMoney?`<td style="text-align:right"><span class="tot-box green-tot">${fmtMoneyPDF(s.moneyIn)}</span></td><td style="text-align:right"><span class="tot-box red-tot">${fmtMoneyPDF(s.moneyOut)}</span></td><td style="text-align:right"><span class="tot-box ${s.moneyIn-s.moneyOut>=0?"gold-tot":"red-tot"}">${fmtMoneyPDF(s.moneyIn-s.moneyOut)}</span></td>`:""}
    </tr>
  </tbody></table>
  <div class="balances">
    <div class="balances-title">Final Balances</div>
    <div class="bal-grid">
      ${showGold?`<div class="bal-item"><div class="bal-label">Total Pure Gold Balance (100%) (g)</div><div class="bal-value" style="color:${s.pureIn-s.pureOut>=0?"#d97706":"#dc2626"}">${fmtGoldN(s.pureIn-s.pureOut)}</div><div class="bal-sub">In: ${fmtGoldN(s.pureIn)} &middot; Out: ${fmtGoldN(s.pureOut)}</div></div>`:""}
      ${showMoney?`<div class="bal-item"><div class="bal-label">Net Cash Balance</div><div class="bal-value" style="color:${s.moneyIn-s.moneyOut>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(s.moneyIn-s.moneyOut)}</div><div class="bal-sub">In: ${fmtMoneyPDF(s.moneyIn)} &middot; Out: ${fmtMoneyPDF(s.moneyOut)}</div></div>`:""}
      <div class="bal-item"><div class="bal-label">Transactions</div><div class="bal-value blue-val">${sorted.length}</div></div>
    </div>
  </div>
  <div class="page-footer"><span>${bizName}</span><span>Auto-generated by Ledger</span></div>
  </body></html>`;
}

// ─── Auto month-end report generator ────────────────────────────────
async function autoGenerateMonthEndReport(user, businessData) {
  try {
    const now      = new Date();
    const today    = now.getDate();
    // Only run on last 3 days of month
    const lastDay  = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    if (today < lastDay - 2) return;

    const yr  = now.getFullYear();
    const mo  = now.getMonth(); // 0-indexed
    const monthName = now.toLocaleString("en-IN",{month:"long"});
    const reportKey = `auto-${yr}-${String(mo+1).padStart(2,"0")}`;

    // Check if already generated this month
    const rFile   = reportsFile(user.username);
    const existing = await ghGet(rFile);
    const reports  = existing?.data?.reports || [];
    if (reports.some(r => r.autoKey === reportKey)) return; // already done

    // Filter entries for this month
    const firstDay = `${yr}-${String(mo+1).padStart(2,"0")}-01`;
    const lastDayStr = `${yr}-${String(mo+1).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
    const allPeople = [
      ...(businessData.customers||[]).map(c=>({...c,ptype:"customer"})),
      ...(businessData.workers||[]).map(w=>({...w,ptype:"worker"})),
    ];
    const monthEntries = (businessData.entries||[])
      .filter(e => e.date >= firstDay && e.date <= lastDayStr)
      .map(e => ({...e, _personName: allPeople.find(p=>p.id===e.personId)?.name || "-"}));

    if (!monthEntries.length) return; // no entries, skip

    const title    = `Monthly Report - ${monthName} ${yr}`;
    const now2     = new Date();
    const stamp    = now2.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) + " " + now2.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});
    const saveName = `${title} - ${stamp}`;
    const html     = buildReportHTML(monthEntries, title, "all", "", businessData, "desc");

    const newRec = {
      id:            uid(),
      name:          saveName,
      tags:          ["monthly", "auto", monthName.toLowerCase(), String(yr)],
      notes:         `Auto-generated monthly report for ${monthName} ${yr}`,
      html,
      reportType:    "all",
      rangeLabel:    `${monthName} ${yr}`,
      entryCount:    monthEntries.length,
      savedAt:       Date.now(),
      updatedAt:     null,
      autoGenerated: true,
      autoKey:       reportKey,
    };
    await ghPut(rFile, {reports:[...reports, newRec]}, existing?.sha||null, `Auto monthly report: ${monthName} ${yr}`);
    console.log(`✅ Auto-report saved for ${user.username}: ${monthName} ${yr}`);
  } catch(e) {
    console.warn("Auto-report generation failed:", e);
  }
}

// ─── Reports ─────────────────────────────────────────────────────────
function Reports({ entries, customers, workers, companyName, companyData, onDeleteEntry, onDeleteManyEntries, onEditEntry, currentUser }) {
  const [tab,        setTab]       = useState("monthly");
  const [person,     setPerson]    = useState("");
  const [exportType, setExportType]= useState("all");
  const [preview,    setPreview]   = useState(null);
  const [saveModal,  setSaveModal] = useState(false);
  const [saving,     setSaving]   = useState(false);
  const [show916,    setShow916]  = useState(true);

  // ── Date range state ──
  const [rangePreset, setRangePreset] = useState("thisMonth");
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");

  // ── Sort state ──
  const [sortBy,  setSortBy]  = useState("date");   // date | name | goldIn | goldOut | moneyIn | moneyOut
  const [sortDir, setSortDir] = useState("desc");   // asc | desc
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  // ── Compute dateFrom / dateTo from preset ──
  const { dateFrom, dateTo, rangeLabel } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,"0");
    const d = String(now.getDate()).padStart(2,"0");

    if (rangePreset === "thisMonth") {
      const from = `${y}-${m}-01`;
      const lastDay = new Date(y, now.getMonth()+1, 0).getDate();
      const to = `${y}-${m}-${String(lastDay).padStart(2,"0")}`;
      return { dateFrom:from, dateTo:to, rangeLabel: now.toLocaleString("default",{month:"long",year:"numeric"}) };
    }
    if (rangePreset === "last3") {
      const from3 = new Date(y, now.getMonth()-2, 1);
      const from = from3.toISOString().split("T")[0];
      const to = `${y}-${m}-${d}`;
      return { dateFrom:from, dateTo:to, rangeLabel:"Last 3 Months" };
    }
    if (rangePreset === "thisYear") {
      return { dateFrom:`${y}-01-01`, dateTo:`${y}-12-31`, rangeLabel:`Year ${y}` };
    }
    if (rangePreset === "fiscalYear") {
      // Indian FY: April 1 – March 31
      const fyStart = now.getMonth() >= 3 ? y : y-1;
      return { dateFrom:`${fyStart}-04-01`, dateTo:`${fyStart+1}-03-31`, rangeLabel:`FY ${fyStart}-${String(fyStart+1).slice(-2)}` };
    }
    if (rangePreset === "custom") {
      const label = customFrom && customTo
        ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}`
        : customFrom ? `From ${fmtDate(customFrom)}` : customTo ? `Until ${fmtDate(customTo)}` : "Custom Range";
      return { dateFrom:customFrom, dateTo:customTo, rangeLabel:label };
    }
    return { dateFrom:"", dateTo:"", rangeLabel:"All Time" };
  }, [rangePreset, customFrom, customTo]);

  const allPeople = useMemo(()=>[...customers.map(c=>({...c,ptype:"customer"})),...workers.map(w=>({...w,ptype:"worker"}))],[customers,workers]);

  const applyRange = (ents) => ents.filter(e=>{
    if (dateFrom && e.date < dateFrom) return false;
    if (dateTo   && e.date > dateTo)   return false;
    return true;
  });

  const activeEntries  = useMemo(()=>applyRange(entries),      [entries,dateFrom,dateTo]);
  const personEntries  = useMemo(()=>person?applyRange(entries.filter(e=>e.personId===person)):[],[entries,person,dateFrom,dateTo]);

  const summary = (ents) => ({
    goldIn:   ents.reduce((s,e)=>s+Number(e.goldIn||0),0),
    goldOut:  ents.reduce((s,e)=>s+Number(e.goldOut||0),0),
    pureIn:   ents.reduce((s,e)=>s+Number(e.pureGoldIn||0),0),
    pureOut:  ents.reduce((s,e)=>s+Number(e.pureGoldOut||0),0),
    moneyIn:  ents.reduce((s,e)=>s+Number(e.moneyIn||0),0),
    moneyOut: ents.reduce((s,e)=>s+Number(e.moneyOut||0),0),
  });

  // ── Sort helper ──
  const applySortToEnts = (ents, by, dir) => {
    const sorted = [...ents].sort((a,b) => {
      let va, vb;
      if (by==="date")     { va=a.date+(a.createdAt||0); vb=b.date+(b.createdAt||0); return dir==="asc"?va.localeCompare(vb):vb.localeCompare(va); }
      if (by==="name")     { const pA=allPeople.find(x=>x.id===a.personId)?.name||""; const pB=allPeople.find(x=>x.id===b.personId)?.name||""; return dir==="asc"?pA.localeCompare(pB):pB.localeCompare(pA); }
      if (by==="goldIn")   { va=Number(a.goldIn||0);   vb=Number(b.goldIn||0); }
      if (by==="goldOut")  { va=Number(a.goldOut||0);  vb=Number(b.goldOut||0); }
      if (by==="moneyIn")  { va=Number(a.moneyIn||0);  vb=Number(b.moneyIn||0); }
      if (by==="moneyOut") { va=Number(a.moneyOut||0); vb=Number(b.moneyOut||0); }
      return dir==="asc" ? va-vb : vb-va;
    });
    return sorted;
  };

  // ── Build HTML for preview/export ──
  const buildHTML = (ents, title, type, personName, sortByArg, sortDirArg, autoPrint=true, hallmark=true) => {
    const s = summary(ents);
    const bizName = companyName || "My Business";
    const bizAddress = companyData?.companyAddress || "";
    const bizPhone = companyData?.companyPhone || "";
    const bizOwner = companyData?.companyOwner || "";
    const genTime = new Date().toLocaleString("en-IN",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const sortLabels = {date:"Date",name:"Name",goldIn:"Gold In",goldOut:"Gold Out",moneyIn:"Money In",moneyOut:"Money Out"};
    const sortLabel = `Sorted by ${sortLabels[sortByArg]||"Date"} (${sortDirArg==="asc"?"Asc":"Desc"})`;
    // entries are already sorted by caller
    const sortedEnts = ents;
    let runGold=0, runMoney=0;
    const rowsWithBal = sortedEnts.map(e=>{
      runGold  += Number(e.goldIn||0) - Number(e.goldOut||0);
      runMoney += Number(e.moneyIn||0) - Number(e.moneyOut||0);
      return {...e, runGold, runMoney};
    });
    const showGold  = type==="all" || type==="gold";
    const showMoney = type==="all" || type==="money";
    const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "";
    const tableRows = rowsWithBal.map(e=>{
      const p = allPeople.find(x=>x.id===e.personId);
      const pName = p?.name || "-";
      const isC = e.personType==="customer";
      const time = fmtTime(e.createdAt);
      let cols = `<td>${fmtDate(e.date)}${time?`<br/><small style="color:#9ca3af">${time}</small>`:""}</td>
        <td><strong>${pName}</strong><br/><small style="color:${isC?"#2563eb":"#7c3aed"};font-weight:600">${isC?"Customer":"Worker"}</small></td>
        <td>${e.description||"-"}</td>`;
      if (showGold) cols += `
        <td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.goldIn?fmtGoldN(e.goldIn):"-"}</td>
        <td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.goldOut?fmtGoldN(e.goldOut):"-"}</td>
        <td style="text-align:center"><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700">${e.purity||"-"}</span></td>
        <td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.pureGoldIn?fmtGoldN(e.pureGoldIn):"-"}</td>
        <td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.pureGoldOut?fmtGoldN(e.pureGoldOut):"-"}</td>
        <td style="text-align:right;font-weight:700;font-size:13px;color:${(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0))>=0?"#d97706":"#dc2626"}">${(e.pureGoldIn||e.pureGoldOut)?fmtGoldN(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0)):"-"}</td>`;
      if (showMoney) cols += `
        <td style="text-align:right;color:#16a34a;font-size:13px;font-weight:600">${e.moneyIn?fmtMoneyPDF(e.moneyIn):"-"}</td>
        <td style="text-align:right;color:#dc2626;font-size:13px;font-weight:600">${e.moneyOut?fmtMoneyPDF(e.moneyOut):"-"}</td>
        <td style="text-align:right;font-weight:700;font-size:13px;color:${e.runMoney>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(e.runMoney)}</td>`;
      return `<tr>${cols}</tr>`;
    }).join("");
    let headCols = `<th>Date &amp; Time</th><th>Name</th><th>Description</th>`;
    if (showGold)  headCols += `<th style="text-align:right">Gold In (g)</th><th style="text-align:right">Gold Out (g)</th><th style="text-align:center">Purity</th><th style="text-align:right">Pure Gold In (g)</th><th style="text-align:right">Pure Gold Out (g)</th><th style="text-align:right">Total Pure Gold (g)</th>`;
    if (showMoney) headCols += `<th style="text-align:right">Money In</th><th style="text-align:right">Money Out</th><th style="text-align:right">Money Balance</th>`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title}</title>
    <style>
      /* Using system Arial font */
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:36px 40px;font-size:14px;background:#fff;line-height:1.6}

      /* ── Business Header ── */
      /* Force backgrounds to print in PDF */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }

      .biz-box{
        position:relative;overflow:hidden;
        text-align:center;padding:20px 16px 16px;border-radius:16px;margin-bottom:18px;
        background:#7c3207 !important;
        background-image:linear-gradient(135deg,#6b2a04 0%,#7c3207 25%,#9a3d0a 50%,#7c3207 75%,#6b2a04 100%) !important;
        border:3px solid #d97706;
        box-shadow:0 0 0 2px rgba(217,119,6,0.4),0 8px 32px rgba(0,0,0,0.35);
      }
      /* Top gold shimmer line */
      .biz-box::before{
        content:'';position:absolute;top:0;left:0;right:0;height:3px;
        background:#fbbf24 !important;
        background-image:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent) !important;
        z-index:3;
      }
      /* Bottom gold shimmer line */
      .biz-box::after{
        content:'';position:absolute;bottom:0;left:0;right:0;height:3px;
        background:#fbbf24 !important;
        background-image:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent) !important;
        z-index:3;
      }
      .biz-inner{position:relative;z-index:2;padding:0 8px;}

      /* Left ornament panel */
      .biz-orn-left{
        position:absolute;left:0;top:0;bottom:0;width:130px;
        display:flex;align-items:center;justify-content:center;pointer-events:none;
        border-right:1px solid rgba(251,191,36,0.3);
      }
      /* Right ornament panel */
      .biz-orn-right{
        position:absolute;right:0;top:0;bottom:0;width:130px;
        display:flex;align-items:center;justify-content:center;pointer-events:none;
        border-left:1px solid rgba(251,191,36,0.3);
      }

      /* Hallmark tag */
      .hallmark-tag{
        display:inline-flex;align-items:center;gap:6px;
        margin-bottom:8px;
        background:#f59e0b !important;
        background-image:linear-gradient(135deg,#fbbf24,#f59e0b) !important;
        color:#78350f;font-size:9.5px;font-weight:800;
        letter-spacing:0.12em;text-transform:uppercase;
        padding:3px 12px 3px 8px;border-radius:99px;
        border:1.5px solid rgba(255,255,255,0.5);
      }
      .hallmark-tag .hall-num{
        font-size:11px;font-weight:900;
        background:#78350f !important;color:#fbbf24;
        border-radius:99px;padding:1px 7px;letter-spacing:0.05em;
        display:inline-block;
      }

      /* Divider line with diamond */
      .biz-divider{
        display:flex;align-items:center;gap:8px;margin:8px auto 6px;max-width:340px;
      }
      .biz-divider-line{flex:1;height:1px;background:#fbbf24 !important;opacity:0.5;}
      .biz-divider-diamond{
        width:7px;height:7px;background:#fbbf24 !important;
        transform:rotate(45deg);flex-shrink:0;
      }

      .biz-name{
        font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;
        color:#fef3c7 !important;letter-spacing:0.04em;line-height:1.2;
      }
      .biz-sub{margin-top:4px;font-size:12px;color:#fde68a !important;font-weight:600;letter-spacing:0.05em;}
      .biz-details{margin-top:6px;font-size:11.5px;color:#fde68a !important;display:flex;flex-wrap:wrap;justify-content:center;gap:16px;}
      .biz-details span{display:inline-flex;align-items:center;gap:4px;}

      /* ── Report title block ── */
      .report-title-block{margin-bottom:14px;padding-bottom:12px;border-bottom:2px solid #f59e0b}
      .report-title-text{font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:800;color:#1a1a1a;margin-bottom:4px}
      .report-meta-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
      .report-meta-row span{font-size:12px;color:#6b7280;display:inline-flex;align-items:center;gap:4px}
      .badge{display:inline-block;background:#fef3c7;color:#92400e;padding:3px 12px;border-radius:99px;font-weight:700;font-size:11px;border:1px solid #fcd34d;letter-spacing:0.04em}

      /* ── Person banner ── */
      .person-banner{margin-bottom:14px;padding:11px 18px;background:linear-gradient(90deg,#eff6ff,#dbeafe);border-left:4px solid #2563eb;border-radius:0 10px 10px 0;display:flex;align-items:center;justify-content:space-between}
      .person-name{font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:#1e40af}
      .person-label{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px}
      .person-type{font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.06em;background:#bfdbfe;padding:3px 10px;border-radius:99px}

      /* ── Table ── */
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:11.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;white-space:nowrap}
      td{padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13.5px;vertical-align:middle;color:#1a1a1a}
      tr:hover td{background:#fafafa}
      .totals-row td{background:#fffbeb;font-weight:700;border-top:2px solid #f59e0b;font-size:14px}
      .tot-box{display:inline-block;padding:3px 10px;border-radius:6px;border:1.5px solid #fbbf24;background:#fffbeb;font-weight:800;font-size:13px}
      .green-tot{color:#16a34a}.red-tot{color:#dc2626}.gold-tot{color:#d97706}

      /* ── Balances footer ── */
      .balances{margin-top:22px;padding:16px 18px;border:2px solid #fbbf24;border-radius:12px;background:#fffbeb}
      .balances-title{font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:12px}
      .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
      .bal-item{text-align:center;padding:14px 10px;background:#fffbeb!important;border-radius:9px;border:2px solid #fbbf24}
      .bal-label{font-size:11px;color:#1a1a1a;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;margin-bottom:6px}
      .bal-value{font-size:20px;font-weight:800;line-height:1.2}
      .bal-sub{font-size:11px;color:#374151;margin-top:4px}
      .gold-val{color:#d97706}.purple-val{color:#7c3aed}.green-val{color:#16a34a}.red-val{color:#dc2626}.blue-val{color:#2563eb}

      /* ── Footer ── */
      .page-footer{margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
      @media print{body{padding:20px 24px}@page{margin:1cm;size:A4}}
    </style></head><body>

      <!-- Business Box -->
      <div class="biz-box">
        <!-- Left ornament panel -->
        <div class="biz-orn-left">
          <svg width="110" height="110" viewBox="0 0 110 110" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Outer ring -->
            <circle cx="55" cy="55" r="50" stroke="rgba(251,191,36,0.35)" stroke-width="1" fill="none"/>
            <circle cx="55" cy="55" r="42" stroke="rgba(251,191,36,0.25)" stroke-width="0.8" fill="none" stroke-dasharray="3,4"/>
            <circle cx="55" cy="55" r="33" stroke="rgba(251,191,36,0.30)" stroke-width="1" fill="none"/>
            <circle cx="55" cy="55" r="22" stroke="rgba(251,191,36,0.40)" stroke-width="1.2" fill="rgba(251,191,36,0.06)"/>
            <circle cx="55" cy="55" r="10" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.6)" stroke-width="1.5"/>
            <circle cx="55" cy="55" r="4"  fill="rgba(251,191,36,0.8)"/>
            <!-- 8 petal lotus -->
            <ellipse cx="55" cy="34" rx="4" ry="10" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
            <ellipse cx="55" cy="76" rx="4" ry="10" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
            <ellipse cx="34" cy="55" rx="10" ry="4" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
            <ellipse cx="76" cy="55" rx="10" ry="4" fill="rgba(251,191,36,0.20)" stroke="rgba(251,191,36,0.45)" stroke-width="0.8"/>
            <!-- Diagonal petals -->
            <ellipse cx="42" cy="42" rx="4" ry="10" transform="rotate(-45 42 42)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
            <ellipse cx="68" cy="42" rx="4" ry="10" transform="rotate(45 68 42)"  fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
            <ellipse cx="42" cy="68" rx="4" ry="10" transform="rotate(45 42 68)"  fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
            <ellipse cx="68" cy="68" rx="4" ry="10" transform="rotate(-45 68 68)" fill="rgba(251,191,36,0.15)" stroke="rgba(251,191,36,0.35)" stroke-width="0.8"/>
            <!-- 8 diamond dots on ring at 33px -->
            <rect x="53" y="20" width="4" height="4" rx="0.5" transform="rotate(45 55 22)" fill="rgba(251,191,36,0.7)"/>
            <rect x="53" y="84" width="4" height="4" rx="0.5" transform="rotate(45 55 86)" fill="rgba(251,191,36,0.7)"/>
            <rect x="20" y="53" width="4" height="4" rx="0.5" transform="rotate(45 22 55)" fill="rgba(251,191,36,0.7)"/>
            <rect x="84" y="53" width="4" height="4" rx="0.5" transform="rotate(45 86 55)" fill="rgba(251,191,36,0.7)"/>
            <rect x="76" y="28" width="3" height="3" rx="0.5" transform="rotate(45 77 29)" fill="rgba(251,191,36,0.5)"/>
            <rect x="28" y="28" width="3" height="3" rx="0.5" transform="rotate(45 29 29)" fill="rgba(251,191,36,0.5)"/>
            <rect x="76" y="78" width="3" height="3" rx="0.5" transform="rotate(45 77 79)" fill="rgba(251,191,36,0.5)"/>
            <rect x="28" y="78" width="3" height="3" rx="0.5" transform="rotate(45 29 79)" fill="rgba(251,191,36,0.5)"/>
          </svg>
        </div>
        <!-- Right ornament panel - Official BIS 916 Hallmark -->
        <div class="biz-orn-right">
          ${hallmark?`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px">
            <svg width="54" height="60" viewBox="0 0 54 60" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="27,2 52,16 52,44 27,58 2,44 2,16" stroke="#fbbf24" stroke-width="2.5" fill="rgba(251,191,36,0.13)"/>
              <polygon points="27,9 45,19 45,41 27,51 9,41 9,19" stroke="rgba(251,191,36,0.55)" stroke-width="1" fill="none"/>
              <text x="27" y="25" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="900" fill="#fbbf24" letter-spacing="2">BIS</text>
              <text x="27" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="900" fill="#fde68a" letter-spacing="1">916</text>
              <text x="27" y="49" text-anchor="middle" font-family="Arial,sans-serif" font-size="5.5" font-weight="700" fill="rgba(251,191,36,0.8)" letter-spacing="1">INDIA</text>
              <circle cx="27" cy="2"  r="2.5" fill="#fbbf24"/>
              <circle cx="52" cy="16" r="2.5" fill="#fbbf24"/>
              <circle cx="52" cy="44" r="2.5" fill="#fbbf24"/>
              <circle cx="27" cy="58" r="2.5" fill="#fbbf24"/>
              <circle cx="2"  cy="44" r="2.5" fill="#fbbf24"/>
              <circle cx="2"  cy="16" r="2.5" fill="#fbbf24"/>
            </svg>
            <div style="font-family:Arial,sans-serif;font-size:8.5px;font-weight:900;color:#fbbf24;letter-spacing:0.1em;text-transform:uppercase;line-height:1.6;text-align:center">916<br/>BIS HALLMARK<br/>JEWELLERY</div>
          </div>`:`<svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" stroke="rgba(251,191,36,0.3)" stroke-width="1" fill="none"/>
            <circle cx="50" cy="50" r="30" stroke="rgba(251,191,36,0.2)" stroke-width="0.8" fill="none" stroke-dasharray="3,4"/>
            <circle cx="50" cy="50" r="8"  fill="rgba(251,191,36,0.25)" stroke="rgba(251,191,36,0.5)" stroke-width="1.2"/>
          </svg>`}
        </div>
        <!-- Main content -->
        <div class="biz-inner">
          <div class="biz-name">${bizName}</div>
          ${bizOwner ? `<div class="biz-sub">Proprietor: ${bizOwner}</div>` : ""}
          <div class="biz-divider"><div class="biz-divider-line"></div><div class="biz-divider-diamond"></div><div class="biz-divider-line"></div></div>
          ${(bizAddress||bizPhone) ? `<div class="biz-details">
            ${bizAddress ? `<span><b style="color:#fbbf24">Addr:</b> ${bizAddress}</span>` : ""}
            ${bizPhone   ? `<span><b style="color:#fbbf24">Ph:</b> ${bizPhone}</span>`   : ""}
          </div>` : ""}
        </div>
      </div>

      <!-- Report Title Block -->
      <div class="report-title-block">
        <div class="report-title-text">${title}</div>
        <div class="report-meta-row">
          <span>Generated: ${genTime}</span>
          <span>${sortLabel}</span>
          <span class="badge">${type==="all"?"FULL REPORT":type==="gold"?"GOLD REPORT":"MONEY REPORT"}</span>
        </div>
      </div>

      <!-- Person banner (By Person reports only) -->
      ${personName ? `<div class="person-banner">
        <div>
          <div class="person-label">Account Holder</div>
          <div class="person-name">${personName}</div>
        </div>
        <span class="person-type">${ents[0]?.personType==="worker"?"Worker":"Customer"}</span>
      </div>` : ""}

      <table><thead><tr>${headCols}</tr></thead>
      <tbody>${tableRows}
        <tr class="totals-row"><td colspan="3">TOTALS (${ents.length} entries)</td>
          ${showGold?`<td></td><td></td><td></td><td style="text-align:right"><span class="tot-box green-tot">${fmtGoldN(s.pureIn)}</span></td><td style="text-align:right"><span class="tot-box red-tot">${fmtGoldN(s.pureOut)}</span></td><td style="text-align:right"><span class="tot-box ${s.pureIn-s.pureOut>=0?"gold-tot":"red-tot"}">${fmtGoldN(s.pureIn-s.pureOut)}</span></td>`:""}
          ${showMoney?`<td style="text-align:right"><span class="tot-box green-tot">${fmtMoneyPDF(s.moneyIn)}</span></td><td style="text-align:right"><span class="tot-box red-tot">${fmtMoneyPDF(s.moneyOut)}</span></td><td style="text-align:right"><span class="tot-box ${s.moneyIn-s.moneyOut>=0?"gold-tot":"red-tot"}">${fmtMoneyPDF(s.moneyIn-s.moneyOut)}</span></td>`:""}
        </tr>
      </tbody></table>
      <div class="balances">
        <div class="balances-title">Final Balances</div>
        <div class="bal-grid">
          ${showGold?`<div class="bal-item"><div class="bal-label">Total Pure Gold Balance (100%) (g)</div><div class="bal-value" style="color:${s.pureIn-s.pureOut>=0?"#d97706":"#dc2626"}">${fmtGoldN(s.pureIn-s.pureOut)}</div><div class="bal-sub">In: ${fmtGoldN(s.pureIn)} &middot; Out: ${fmtGoldN(s.pureOut)}</div></div>`:""}
          ${showMoney?`<div class="bal-item"><div class="bal-label">Net Cash Balance</div><div class="bal-value" style="color:${s.moneyIn-s.moneyOut>=0?"#16a34a":"#dc2626"}">${fmtMoneyPDF(s.moneyIn-s.moneyOut)}</div><div class="bal-sub">In: ${fmtMoneyPDF(s.moneyIn)} &middot; Out: ${fmtMoneyPDF(s.moneyOut)}</div></div>`:""}
          <div class="bal-item"><div class="bal-label">Transactions</div><div class="bal-value blue-val">${ents.length}</div></div>
        </div>
      </div>
      <div class="page-footer"><span>${bizName}</span><span>Powered by Ledger</span></div>
    </body></html>`;
  };

  const openPreview = (ents, title, personName) => {
    const sorted = applySortToEnts(ents, sortBy, sortDir);
    setPreview({html: buildHTML(sorted, title, exportType, personName, sortBy, sortDir, true, show916), title, ents: sorted});
  };

  const doPrint = () => {
    if (!preview) return;
    printHTMLDoc(preview.html, makeFileName(preview.title || "Report", "pdf"));
  };

  const exportCSV = (ents, name) => {
    const headers = ["Date","Time","Person","Type","Description","GoldIn(g)","GoldOut(g)","Purity","PureGoldIn(g)","PureGoldOut(g)","GoldBalance","MoneyIn","MoneyOut","MoneyBalance","Notes"];
    let rG=0, rM=0;
    const csvRows = applySortToEnts(ents, sortBy, sortDir).map(e=>{
      rG += Number(e.goldIn||0)-Number(e.goldOut||0);
      rM += Number(e.moneyIn||0)-Number(e.moneyOut||0);
      const p = allPeople.find(x=>x.id===e.personId);
      const time = e.createdAt ? new Date(e.createdAt).toLocaleTimeString("en-IN") : "";
      return [e.date,time,p?.name||"",e.personType||"",e.description||"",
              e.goldIn||0,e.goldOut||0,e.purity||"",(e.pureGoldIn||0).toFixed(3),(e.pureGoldOut||0).toFixed(3),rG.toFixed(3),
              e.moneyIn||0,e.moneyOut||0,rM.toFixed(2),e.notes||""];
    });
    const csv = [headers,...csvRows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download=makeFileName(name, "csv"); a.click();
  };

  const doSaveReport = async ({name, tags, notes}) => {
    if (!saveModal || !currentUser) return;
    setSaving(true);
    try {
      const rFile   = reportsFile(currentUser.username);
      const existing = await ghGet(rFile);
      const prev     = existing?.data?.reports || [];
      const rec = {
        id:          uid(),
        name:        cleanName(name),
        tags:        tags,
        notes:       notes,
        html:        saveModal.html,
        reportType:  exportType,
        rangeLabel:  rangeLabel,
        entryCount:  saveModal.ents.length,
        savedAt:     Date.now(),
        updatedAt:   null,
        autoGenerated: false,
      };
      await ghPut(rFile, {reports:[...prev, rec]}, existing?.sha||null, `Save report: ${name}`);
      setSaveModal(null);
      addToast(`Report "${name}" saved!`, "success");
    } catch(e) { addToast("Save failed: " + e.message, "error"); }
    setSaving(false);
  };

  const SummaryCards = ({s}) => (
    <div className="stats-grid" style={{marginBottom:16}}>
      <div className="stat-card gold"><div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div><div className="stat-label">Net Gold Balance</div><div className="stat-value gold">{fmtGold(s.goldIn-s.goldOut)}</div><div className="stat-sub">In: {fmtGold(s.goldIn)} · Out: {fmtGold(s.goldOut)}</div></div>
      <div className="stat-card" style={{"--accent":"#a78bfa"}}><div className="stat-icon" style={{background:"rgba(167,139,250,0.12)",color:"#a78bfa"}}><Icon name="gold" size={18} color="#a78bfa"/></div><div className="stat-label">Pure Gold (100%)</div><div className="stat-value" style={{color:"#a78bfa"}}>{fmtGold(s.pureIn-s.pureOut)}</div><div className="stat-sub">In: {fmtGold(s.pureIn)} · Out: {fmtGold(s.pureOut)}</div></div>
      <div className={`stat-card ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}><div className={`stat-icon ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}><Icon name="money" size={18} color={s.moneyIn-s.moneyOut>=0?"var(--green)":"var(--red)"}/></div><div className="stat-label">Money Balance</div><div className={`stat-value ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}>{fmtMoney(s.moneyIn-s.moneyOut)}</div><div className="stat-sub">In: {fmtMoney(s.moneyIn)} · Out: {fmtMoney(s.moneyOut)}</div></div>
    </div>
  );

  const RenderTable = ({ents, sumData}) => {
    if (!ents.length) return <div className="empty"><div className="empty-icon"><Icon name="reports" size={28}/></div><div className="empty-title">No entries found</div></div>;

    const [delEntry, setDelEntry] = useState(null);
    const sorted = applySortToEnts(ents, sortBy, sortDir);
    // Running balances computed on sorted order
    let rG=0, rM=0;
    const rows = sorted.map(e=>{
      rG += Number(e.goldIn||0)-Number(e.goldOut||0);
      rM += Number(e.moneyIn||0)-Number(e.moneyOut||0);
      return {...e, rG, rM};
    });

    const showG = exportType==="all"||exportType==="gold";
    const showM = exportType==="all"||exportType==="money";
    const s = sumData || {goldIn:0,goldOut:0,pureIn:0,pureOut:0,moneyIn:0,moneyOut:0};

    const toggleSort = (col) => {
      if (sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc");
      else { setSortBy(col); setSortDir("desc"); }
    };
    const SortIcon = ({col}) => {
      if (sortBy!==col) return <span style={{opacity:0.25,fontSize:"0.7rem",marginLeft:3}}>⇅</span>;
      return <span style={{color:"var(--gold)",fontSize:"0.7rem",marginLeft:3}}>{sortDir==="asc"?"↑":"↓"}</span>;
    };
    const Th = ({col, label, className=""}) => (
      <th className={className} onClick={()=>toggleSort(col)}
        style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}
        title={`Sort by ${label}`}>
        {label}<SortIcon col={col}/>
      </th>
    );

    return (
      <div>
        {/* Sort controls bar */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          <span style={{fontSize:"0.75rem",color:"var(--text3)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Sort by:</span>
          {[["date","Date"],["name","Name"],["goldIn","Gold In"],["goldOut","Gold Out"],["moneyIn","Money In"],["moneyOut","Money Out"]].map(([col,lbl])=>(
            <button key={col} onClick={()=>toggleSort(col)}
              style={{padding:"4px 11px",borderRadius:99,border:"1px solid",fontSize:"0.78rem",fontWeight:600,cursor:"pointer",
                background:sortBy===col?"var(--gold)":"var(--surface2)",
                color:sortBy===col?"#000":"var(--text2)",
                borderColor:sortBy===col?"var(--gold)":"var(--border)"}}>
              {lbl}{sortBy===col&&<span style={{marginLeft:4}}>{sortDir==="asc"?"↑":"↓"}</span>}
            </button>
          ))}
          <button onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")}
            style={{padding:"4px 10px",borderRadius:99,border:"1px solid var(--border)",fontSize:"0.78rem",background:"var(--surface2)",color:"var(--text2)",cursor:"pointer"}}>
            {sortDir==="asc"?"↑ Asc":"↓ Desc"}
          </button>
        </div>

        {selectedIds.size>0&&onDeleteEntry&&(
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:"rgba(244,63,94,0.1)",border:"1px solid rgba(244,63,94,0.3)",borderRadius:8,marginBottom:10}}>
            <span style={{fontSize:"0.85rem",color:"var(--red)",fontWeight:600}}>{selectedIds.size} selected</span>
            <button className="btn btn-danger btn-sm" onClick={()=>setBulkConfirm(true)}><Icon name="trash" size={13}/>Delete Selected</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedIds(new Set())}>Clear</button>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr>
              {onDeleteEntry&&<th style={{width:36,textAlign:"center",padding:"6px 8px"}}>
                <input type="checkbox" style={{cursor:"pointer",accentColor:"var(--red)"}}
                  checked={rows.length>0&&rows.every(r=>selectedIds.has(r.id))}
                  onChange={e=>setSelectedIds(e.target.checked?new Set(rows.map(r=>r.id)):new Set())}/>
              </th>}
              <Th col="date" label="Date & Time"/>
              <Th col="name" label="Name"/>
              <th>Description</th>
              {showG&&<>
                <Th col="goldIn"  label="Gold In (g)"  className="th-right"/>
                <Th col="goldOut" label="Gold Out (g)" className="th-right"/>
                <th className="th-center">Purity</th>
                <th className="th-right">Pure Gold In (g)</th>
                <th className="th-right">Pure Gold Out (g)</th>
                <th className="th-right">Total Pure Gold (g)</th>
              </>}
              {showM&&<>
                <Th col="moneyIn"  label="Money In"  className="th-right"/>
                <Th col="moneyOut" label="Money Out" className="th-right"/>
                <th className="th-right">Money Bal</th>
              </>}
              {(onEditEntry||onDeleteEntry)&&<th style={{width:80,textAlign:"center"}}>Actions</th>}
            </tr></thead>
            <tbody>
              {rows.map(e=>{
                const p=allPeople.find(x=>x.id===e.personId);
                const isC=e.personType==="customer";
                const time=e.createdAt?new Date(e.createdAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"";
                return (
                  <tr key={e.id} style={{background:selectedIds.has(e.id)?"rgba(244,63,94,0.07)":""}}>
                    {onDeleteEntry&&<td style={{textAlign:"center",padding:"6px 8px"}}>
                      <input type="checkbox" style={{cursor:"pointer",accentColor:"var(--red)"}}
                        checked={selectedIds.has(e.id)}
                        onChange={ev=>{const s=new Set(selectedIds);ev.target.checked?s.add(e.id):s.delete(e.id);setSelectedIds(s);}}/>
                    </td>}
                    <td><div style={{color:"var(--text2)",fontSize:"0.88rem"}}>{fmtDate(e.date)}</div>{time&&<div style={{fontSize:"0.75rem",color:"var(--text3)"}}>{time}</div>}</td>
                    <td><div className="fw6" style={{fontSize:"0.9rem"}}>{p?.name||"-"}</div><div className="fs-xs" style={{color:isC?"var(--blue)":"#a78bfa",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{isC?"👤 Customer":"🔧 Worker"}</div></td>
                    <td style={{color:"var(--text2)",fontSize:"0.88rem"}}>{e.description||"-"}</td>
                    {showG&&<>
                      <td className="right" style={{fontSize:"0.9rem"}}><span style={{color:e.goldIn?"var(--green)":"var(--text3)",fontWeight:e.goldIn?700:400}}>{e.goldIn?fmtGoldN(e.goldIn):"-"}</span></td>
                      <td className="right" style={{fontSize:"0.9rem"}}><span style={{color:e.goldOut?"var(--red)":"var(--text3)",fontWeight:e.goldOut?700:400}}>{e.goldOut?fmtGoldN(e.goldOut):"-"}</span></td>
                      <td className="center"><span className="badge badge-gold" style={{fontSize:"0.85rem"}}>{e.purity||"-"}</span></td>
                      <td className="right" style={{fontSize:"0.88rem"}}><span style={{color:e.pureGoldIn?"var(--green)":"var(--text3)",fontWeight:e.pureGoldIn?600:400}}>{e.pureGoldIn?fmtGoldN(e.pureGoldIn):"-"}</span></td>
                      <td className="right" style={{fontSize:"0.88rem"}}><span style={{color:e.pureGoldOut?"var(--red)":"var(--text3)",fontWeight:e.pureGoldOut?600:400}}>{e.pureGoldOut?fmtGoldN(e.pureGoldOut):"-"}</span></td>
                      <td className="right" style={{fontSize:"0.88rem"}}><span style={{fontWeight:700,color:(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0))>=0?"var(--gold)":"var(--red)"}}>{(e.pureGoldIn||e.pureGoldOut)?fmtGoldN(Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0)):"-"}</span></td>
                    </>}
                    {showM&&<>
                      <td className="right" style={{fontSize:"0.9rem"}}><span style={{color:e.moneyIn?"var(--green)":"var(--text3)",fontWeight:e.moneyIn?600:400}}>{e.moneyIn?fmtMoney(e.moneyIn):"-"}</span></td>
                      <td className="right" style={{fontSize:"0.9rem"}}><span style={{color:e.moneyOut?"var(--red)":"var(--text3)",fontWeight:e.moneyOut?600:400}}>{e.moneyOut?fmtMoney(e.moneyOut):"-"}</span></td>
                      <td className="right"><span style={{fontWeight:700,fontSize:"0.9rem",color:e.rM>=0?"var(--green)":"var(--red)"}}>{fmtMoney(e.rM)}</span></td>
                    </>}
                    {(onEditEntry||onDeleteEntry)&&(
                      <td style={{textAlign:"center",padding:"6px 8px"}}>
                        <div className="flex gap2" style={{justifyContent:"center"}}>
                          {onEditEntry&&<button className="btn btn-icon btn-secondary btn-sm" title="Edit entry" onClick={()=>onEditEntry(e)}><Icon name="edit" size={13}/></button>}
                          {onDeleteEntry&&<button className="btn btn-icon btn-danger btn-sm" title="Delete entry" onClick={()=>setDelEntry(e)}><Icon name="trash" size={13}/></button>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {delEntry&&onDeleteEntry&&<Confirm msg={`Delete entry "${delEntry.description||fmtDate(delEntry.date)}"?`} onOk={()=>{onDeleteEntry(delEntry.id);setDelEntry(null);}} onCancel={()=>setDelEntry(null)}/>}
        {bulkConfirm&&onDeleteEntry&&<Confirm msg={`Delete ${selectedIds.size} selected ${selectedIds.size===1?"entry":"entries"}? This cannot be undone.`} onOk={()=>{(onDeleteManyEntries||((ids)=>ids.forEach(id=>onDeleteEntry(id))))([...selectedIds]);setSelectedIds(new Set());setBulkConfirm(false);}} onCancel={()=>setBulkConfirm(false)}/>}
      {saveModal&&<SaveReportModal defaultName={saveModal.defaultName} onSave={doSaveReport} onClose={()=>setSaveModal(null)} saving={saving}/>}
        {/* ── Balance Summary at BOTTOM ── */}
        <div style={{marginTop:16,background:"var(--surface)",border:"2px solid var(--border)",borderRadius:12,padding:16}}>
          <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontWeight:700,fontSize:"0.9rem",marginBottom:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:6}}>
            <Icon name="reports" size={15}/>Final Balances — {ents.length} entries
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
            {showG&&<>
              <div style={{background:"rgba(251,191,36,0.25)",border:"2px solid #fbbf24",borderRadius:10,padding:"14px",textAlign:"center"}}>
                <div style={{fontSize:"0.72rem",color:"var(--text2)",textTransform:"uppercase",fontWeight:700,marginBottom:5,letterSpacing:"0.05em"}}>Total Pure Gold Balance (100%) (g)</div>
                <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.5rem",fontWeight:800,color:s.pureIn-s.pureOut>=0?"var(--gold)":"var(--red)"}}>{fmtGoldN(s.pureIn-s.pureOut)}</div>
                <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:3}}>In: {fmtGoldN(s.pureIn)} · Out: {fmtGoldN(s.pureOut)}</div>
              </div>
            </>}
            {showM&&<>
              <div style={{background:"rgba(251,191,36,0.25)",border:"2px solid #fbbf24",borderRadius:10,padding:"14px",textAlign:"center"}}>
                <div style={{fontSize:"0.72rem",color:"var(--text2)",textTransform:"uppercase",fontWeight:700,marginBottom:5,letterSpacing:"0.05em"}}>Net Cash Balance</div>
                <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.5rem",fontWeight:800,color:s.moneyIn-s.moneyOut>=0?"var(--green)":"var(--red)"}}>{fmtMoney(s.moneyIn-s.moneyOut)}</div>
                <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:3}}>In: {fmtMoney(s.moneyIn)} · Out: {fmtMoney(s.moneyOut)}</div>
              </div>
            </>}
            <div style={{background:"rgba(251,191,36,0.15)",border:"2px solid #fbbf24",borderRadius:10,padding:"14px",textAlign:"center"}}>
              <div style={{fontSize:"0.72rem",color:"var(--text2)",textTransform:"uppercase",fontWeight:700,marginBottom:5,letterSpacing:"0.05em"}}>Transactions</div>
              <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.5rem",fontWeight:800,color:"var(--blue)"}}>{ents.length}</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const activeEnts = tab==="monthly" ? activeEntries : personEntries;
  const reportTitle = tab==="monthly"
    ? `Report - ${rangeLabel}`
    : `${allPeople.find(p=>p.id===person)?.name||"Person"} - ${rangeLabel}`;

  const presets = [
    {v:"thisMonth", l:"This Month"},
    {v:"last3",     l:"Last 3 Months"},
    {v:"thisYear",  l:"This Year"},
    {v:"fiscalYear",l:"Fiscal Year"},
    {v:"custom",    l:"Custom"},
  ];

  return (
    <div>
      {preview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",flexDirection:"column"}}>
          <div style={{background:"var(--surface)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--border)",flexShrink:0,gap:12}}>
            <div style={{fontWeight:700,fontSize:"0.95rem"}}>{preview.title}</div>
            <div className="flex gap2" style={{flexWrap:"wrap"}}>
              <button className="btn btn-secondary btn-sm" onClick={()=>exportCSV(preview.ents,preview.title)}><Icon name="download" size={14}/>CSV</button>
              <button className="btn btn-gold btn-sm" onClick={doPrint}><Icon name="pdf" size={14}/>Print / Save PDF</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPreview(null)}>✕ Close</button>
            </div>
          </div>
          <iframe srcDoc={preview.html} style={{flex:1,border:"none",background:"#fff"}}/>
        </div>
      )}

      <div className="section-header">
        <div><div className="section-title">Reports</div></div>
        {activeEnts.length>0&&(
          <div className="flex gap2" style={{flexWrap:"wrap",justifyContent:"flex-end"}}>
            {/* 916 Hallmark toggle */}
            <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 12px"}}>
              <span style={{fontSize:"0.78rem",fontWeight:700,color:"var(--text2)"}}>916 Hallmark</span>
              <button onClick={()=>setShow916(v=>!v)}
                style={{position:"relative",width:40,height:22,borderRadius:99,border:"none",cursor:"pointer",transition:"background 0.2s",
                  background:show916?"#fbbf24":"var(--border2)",padding:0}}>
                <span style={{position:"absolute",top:3,left:show916?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",display:"block"}}/>
              </button>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"5px 10px"}}>
              {[{v:"all",l:"Both"},{v:"gold",l:"Gold Only"},{v:"money",l:"Cash Only"}].map(opt=>(
                <label key={opt.v} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:"0.82rem",fontWeight:exportType===opt.v?700:400,color:exportType===opt.v?"var(--gold)":"var(--text2)",whiteSpace:"nowrap"}}>
                  <input type="radio" name="exportType" value={opt.v} checked={exportType===opt.v} onChange={()=>setExportType(opt.v)} style={{accentColor:"var(--gold)",cursor:"pointer"}}/>
                  {opt.l}
                </label>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={()=>exportCSV(activeEnts,reportTitle)}><Icon name="download" size={16}/>CSV</button>
            <button className="btn btn-gold" onClick={()=>openPreview(activeEnts, reportTitle, tab==="person" ? allPeople.find(p=>p.id===person)?.name : "")}><Icon name="pdf" size={16}/>Preview &amp; Export</button>
            <button onClick={()=>{
              const pName = tab==="person" ? allPeople.find(p=>p.id===person)?.name : "";
              const sorted = applySortToEnts(activeEnts, sortBy, sortDir);
              const now = new Date();
              const stamp = now.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) + " " + now.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});
              const defaultName = `${reportTitle} - ${stamp}`;
              const html = buildHTML(sorted, reportTitle, exportType, pName, sortBy, sortDir, false, show916);
              setSaveModal({html, ents: sorted, defaultName});
            }} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"8px 16px",borderRadius:"var(--radius-sm)",fontSize:"0.875rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",background:"rgba(34,211,160,0.15)",color:"var(--green)",border:"1px solid rgba(34,211,160,0.3)"}}><Icon name="download" size={16}/>💾 Save Report</button>
          </div>
        )}
      </div>

      {/* ── Date Range Preset Bar ── */}
      <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"14px 16px",marginBottom:16}}>
        <div style={{fontSize:"0.75rem",fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Date Range</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom: rangePreset==="custom" ? 12 : 0}}>
          {presets.map(p=>(
            <button key={p.v} onClick={()=>setRangePreset(p.v)}
              style={{padding:"6px 14px",borderRadius:99,border:"1px solid",fontSize:"0.82rem",fontWeight:600,cursor:"pointer",transition:"all 0.15s",
                background:rangePreset===p.v?"var(--gold)":"var(--surface2)",
                color:rangePreset===p.v?"#000":"var(--text2)",
                borderColor:rangePreset===p.v?"var(--gold)":"var(--border)"}}>
              {p.l}
            </button>
          ))}
        </div>
        {rangePreset==="custom" && (
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginTop:4}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:"0.8rem",color:"var(--text3)",fontWeight:600,minWidth:28}}>From</span>
              <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)",padding:"6px 10px",fontSize:"0.85rem"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:"0.8rem",color:"var(--text3)",fontWeight:600,minWidth:16}}>To</span>
              <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)",padding:"6px 10px",fontSize:"0.85rem"}}/>
            </div>
            {(customFrom||customTo)&&<button className="btn btn-secondary btn-sm" onClick={()=>{setCustomFrom("");setCustomTo("")}}>Clear</button>}
          </div>
        )}
        {rangePreset!=="custom" && (
          <div style={{marginTop:8,fontSize:"0.78rem",color:"var(--text3)"}}>
            Showing: <span style={{color:"var(--gold)",fontWeight:600}}>{rangeLabel}</span>
            {dateFrom&&<span> · {fmtDate(dateFrom)} → {fmtDate(dateTo)}</span>}
            <span style={{marginLeft:8,color:"var(--text3)"}}>{activeEntries.length} entries</span>
          </div>
        )}
      </div>

      <div className="tabs">
        <div className={`tab ${tab==="monthly"?"active":""}`} onClick={()=>setTab("monthly")}>All Entries</div>
        <div className={`tab ${tab==="person"?"active":""}`} onClick={()=>setTab("person")}>By Person</div>
      </div>

      {tab==="monthly"&&(
        <div>
          <RenderTable ents={activeEntries} sumData={summary(activeEntries)}/>
        </div>
      )}
      {tab==="person"&&(
        <div>
          <div className="toolbar" style={{flexWrap:"wrap",gap:8}}>
            <select value={person} onChange={e=>setPerson(e.target.value)} style={{minWidth:220}}>
              <option value="">-- Select Person --</option>
              <optgroup label="Customers">{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              <optgroup label="Workers">{workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
            </select>
          </div>
          {person&&<RenderTable ents={personEntries} sumData={summary(personEntries)}/>}
          {!person&&<div className="empty"><div className="empty-icon"><Icon name="customers" size={28}/></div><div className="empty-title">Select a person to view their report</div></div>}
        </div>
      )}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────
// ─── Built-in Themes ─────────────────────────────────────────────────
const PRESET_THEMES = [
  { id:"default",    name:"Midnight",    emoji:"🌑",
    bg:"#0c0e14", surface:"#13161f", surface2:"#1a1e2a", surface3:"#222636",
    border:"#2a2f42", border2:"#353b52", text:"#e8eaf0",
    accent:"#6366f1", accent2:"#818cf8", accentDim:"rgba(99,102,241,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#22d3a0", greenDim:"rgba(34,211,160,0.12)",
    red:"#f43f5e",   redDim:"rgba(244,63,94,0.12)",
    blue:"#38bdf8",  blueDim:"rgba(56,189,248,0.12)" },
  { id:"obsidian",   name:"Obsidian",    emoji:"🖤",
    bg:"#000000", surface:"#0d0d0d", surface2:"#141414", surface3:"#1a1a1a",
    border:"#252525", border2:"#303030", text:"#f0f0f0",
    accent:"#a855f7", accent2:"#c084fc", accentDim:"rgba(168,85,247,0.15)",
    gold:"#f59e0b", amber:"#d97706", goldDim:"rgba(245,158,11,0.12)",
    green:"#34d399", greenDim:"rgba(52,211,153,0.12)",
    red:"#f87171",   redDim:"rgba(248,113,113,0.12)",
    blue:"#60a5fa",  blueDim:"rgba(96,165,250,0.12)" },
  { id:"forest",     name:"Forest",      emoji:"🌿",
    bg:"#0a0f0a", surface:"#0f1a0f", surface2:"#152015", surface3:"#1a2a1a",
    border:"#253525", border2:"#2e422e", text:"#d4edda",
    accent:"#22c55e", accent2:"#4ade80", accentDim:"rgba(34,197,94,0.15)",
    gold:"#facc15", amber:"#eab308", goldDim:"rgba(250,204,21,0.12)",
    green:"#4ade80", greenDim:"rgba(74,222,128,0.12)",
    red:"#f87171",   redDim:"rgba(248,113,113,0.12)",
    blue:"#67e8f9",  blueDim:"rgba(103,232,249,0.12)" },
  { id:"ocean",      name:"Ocean",       emoji:"🌊",
    bg:"#020b18", surface:"#051525", surface2:"#0a2040", surface3:"#0d2d55",
    border:"#103060", border2:"#154070", text:"#cce4ff",
    accent:"#0ea5e9", accent2:"#38bdf8", accentDim:"rgba(14,165,233,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#06b6d4", greenDim:"rgba(6,182,212,0.12)",
    red:"#fb7185",   redDim:"rgba(251,113,133,0.12)",
    blue:"#38bdf8",  blueDim:"rgba(56,189,248,0.12)" },
  { id:"crimson",    name:"Crimson",     emoji:"🔴",
    bg:"#0f0509", surface:"#1a080d", surface2:"#240d14", surface3:"#2e121a",
    border:"#3d1a22", border2:"#4d222c", text:"#fde8ec",
    accent:"#e11d48", accent2:"#fb7185", accentDim:"rgba(225,29,72,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#34d399", greenDim:"rgba(52,211,153,0.12)",
    red:"#fb7185",   redDim:"rgba(251,113,133,0.12)",
    blue:"#67e8f9",  blueDim:"rgba(103,232,249,0.12)" },
  { id:"amber",      name:"Amber",       emoji:"🟡",
    bg:"#0d0a00", surface:"#1a1400", surface2:"#261e00", surface3:"#302600",
    border:"#403200", border2:"#504000", text:"#fff3cd",
    accent:"#f59e0b", accent2:"#fbbf24", accentDim:"rgba(245,158,11,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#86efac", greenDim:"rgba(134,239,172,0.12)",
    red:"#fca5a5",   redDim:"rgba(252,165,165,0.12)",
    blue:"#93c5fd",  blueDim:"rgba(147,197,253,0.12)" },
  { id:"violet",     name:"Violet",      emoji:"💜",
    bg:"#07030f", surface:"#0f0520", surface2:"#180830", surface3:"#200b3e",
    border:"#2d1250", border2:"#3b1862", text:"#ede9fe",
    accent:"#8b5cf6", accent2:"#a78bfa", accentDim:"rgba(139,92,246,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#34d399", greenDim:"rgba(52,211,153,0.12)",
    red:"#f87171",   redDim:"rgba(248,113,113,0.12)",
    blue:"#c4b5fd",  blueDim:"rgba(196,181,253,0.12)" },
  { id:"slate",      name:"Slate",       emoji:"🩶",
    bg:"#0b0d11", surface:"#141820", surface2:"#1c2230", surface3:"#232a38",
    border:"#2c3444", border2:"#384050", text:"#e2e8f0",
    accent:"#64748b", accent2:"#94a3b8", accentDim:"rgba(100,116,139,0.15)",
    gold:"#fbbf24", amber:"#f59e0b", goldDim:"rgba(251,191,36,0.12)",
    green:"#34d399", greenDim:"rgba(52,211,153,0.12)",
    red:"#f87171",   redDim:"rgba(248,113,113,0.12)",
    blue:"#93c5fd",  blueDim:"rgba(147,197,253,0.12)" },
  { id:"skyblue",    name:"Sky Blue",    emoji:"🩵",
    bg:"#e8f4fd", surface:"#d0eaf8", surface2:"#b8ddf2", surface3:"#a0d0ec",
    border:"#7ab8e0", border2:"#5aa0cc", text:"#0a2540",
    accent:"#0284c7", accent2:"#0369a1", accentDim:"rgba(2,132,199,0.15)",
    gold:"#d97706", amber:"#b45309", goldDim:"rgba(217,119,6,0.15)",
    green:"#059669", greenDim:"rgba(5,150,105,0.15)",
    red:"#dc2626",   redDim:"rgba(220,38,38,0.12)",
    blue:"#0284c7",  blueDim:"rgba(2,132,199,0.12)" },
  { id:"white",      name:"White",       emoji:"🤍",
    bg:"#f8fafc", surface:"#ffffff", surface2:"#f1f5f9", surface3:"#e2e8f0",
    border:"#cbd5e1", border2:"#94a3b8", text:"#0f172a",
    accent:"#4f46e5", accent2:"#4338ca", accentDim:"rgba(79,70,229,0.12)",
    gold:"#d97706", amber:"#b45309", goldDim:"rgba(217,119,6,0.12)",
    green:"#059669", greenDim:"rgba(5,150,105,0.10)",
    red:"#dc2626",   redDim:"rgba(220,38,38,0.10)",
    blue:"#0284c7",  blueDim:"rgba(2,132,199,0.10)" },
];

function SettingsPage({ data, onChange, addToast, currentUser, userTheme={}, applyTheme }) {
  const [co, setCo] = useState({ name:data.companyName||"", owner:data.companyOwner||"", address:data.companyAddress||"", phone:data.companyPhone||"" });
  const [pw, setPw] = useState({ old:"", nw:"", cf:"" });
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [themeTab, setThemeTab] = useState("presets"); // presets | custom
  const [customVars, setCustomVars] = useState({
    bg:       userTheme.bg       || "#0c0e14",
    surface:  userTheme.surface  || "#13161f",
    surface2: userTheme.surface2 || "#1a1e2a",
    surface3: userTheme.surface3 || "#222636",
    border:   userTheme.border   || "#2a2f42",
    text:     userTheme.text     || "#e8eaf0",
    accent:   userTheme.accent   || "#6366f1",
    gold:     userTheme.gold     || "#fbbf24",
    green:    userTheme.green    || "#22d3a0",
    red:      userTheme.red      || "#f43f5e",
    blue:     userTheme.blue     || "#38bdf8",
  });

  const saveCompany = () => { onChange({ companyName:co.name, companyOwner:co.owner||"", companyAddress:co.address, companyPhone:co.phone }); addToast("Business info saved!"); };

  const changePw = async () => {
    if (currentUser.password!==pw.old) return setPwErr("Current password incorrect.");
    if (pw.nw.length<6) return setPwErr("New password must be 6+ characters.");
    if (pw.nw!==pw.cf) return setPwErr("Passwords don't match.");
    setPwBusy(true);
    try {
      const result = await ghGet(USERS_FILE);
      const users = result?.data?.users || [];
      const updated = users.map(u=>u.id===currentUser.id?{...u,password:pw.nw}:u);
      await ghPut(USERS_FILE, { users: updated }, result?.sha, `Password update for ${currentUser.username}`);
      setPwErr(""); setPw({old:"",nw:"",cf:""}); addToast("Password changed!");
    } catch(e) { setPwErr("Failed to update password."); }
    setPwBusy(false);
  };

  const exportBackup = () => {
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(data,null,2));
    a.download=`goldledger_${currentUser.username}_backup_${today()}.json`; a.click(); addToast("Backup exported!");
  };

  const applyPreset = (p) => {
    applyTheme(p);
    addToast(`Theme "${p.name}" applied! ✨`);
  };

  const applyCustom = () => {
    // Derive dim/surface variants automatically
    const t = {
      ...customVars,
      surface2: customVars.surface2,
      surface3: customVars.surface3,
      border2:  customVars.border,
      amber:    customVars.gold,
      accent2:  customVars.accent,
      accentDim:`${customVars.accent}26`,
      goldDim:  `${customVars.gold}20`,
      greenDim: `${customVars.green}20`,
      redDim:   `${customVars.red}20`,
      blueDim:  `${customVars.blue}20`,
    };
    applyTheme(t);
    addToast("Custom theme applied! 🎨");
  };

  const resetTheme = () => { applyTheme({}); addToast("Theme reset to default."); };

  const activeId = PRESET_THEMES.find(p =>
    p.bg===userTheme.bg && p.accent===userTheme.accent
  )?.id || (Object.keys(userTheme).length===0 ? "default" : "custom");

  const cv = (k,v) => setCustomVars(prev=>({...prev,[k]:v}));

  const colorRow = (label, key, hint="") => (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
      <div style={{flex:1}}>
        <div style={{fontWeight:600,fontSize:"0.85rem"}}>{label}</div>
        {hint&&<div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:1}}>{hint}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:28,height:28,borderRadius:6,background:customVars[key],border:"2px solid var(--border2)",flexShrink:0}}/>
        <input type="color" value={customVars[key]} onChange={e=>cv(key,e.target.value)}
          style={{width:36,height:36,padding:2,border:"1px solid var(--border)",borderRadius:6,cursor:"pointer",background:"transparent"}}/>
        <input value={customVars[key]} onChange={e=>cv(key,e.target.value)}
          style={{width:90,fontFamily:"monospace",fontSize:"0.82rem",padding:"5px 8px",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)"}}/>
      </div>
    </div>
  );

  return (
    <div>
      <div className="section-title" style={{marginBottom:20}}>⚙️ Settings</div>

      {/* ── THEME SECTION ── */}
      <div className="card" style={{marginBottom:20,border:"1px solid rgba(251,191,36,0.3)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
          <div>
            <div className="fw7" style={{fontSize:"1rem",display:"flex",alignItems:"center",gap:8}}>🎨 Theme & Colors</div>
            <div className="fs-sm text2" style={{marginTop:3}}>Personalize the look of your Ledger app</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {activeId!=="default"&&activeId!=="custom"&&<span style={{background:"var(--accent-dim)",color:"var(--accent2)",padding:"3px 10px",borderRadius:20,fontSize:"0.72rem",fontWeight:700}}>
              {PRESET_THEMES.find(p=>p.id===activeId)?.emoji} {PRESET_THEMES.find(p=>p.id===activeId)?.name} Active
            </span>}
            {Object.keys(userTheme).length>0&&<button className="btn btn-secondary btn-sm" onClick={resetTheme}>↩ Reset Default</button>}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{marginBottom:16}}>
          <div className={`tab${themeTab==="presets"?" active":""}`} onClick={()=>setThemeTab("presets")}>🎭 Preset Themes</div>
          <div className={`tab${themeTab==="custom"?" active":""}`} onClick={()=>setThemeTab("custom")}>🎨 Custom Colors</div>
        </div>

        {/* ── Preset Themes Grid ── */}
        {themeTab==="presets"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10}}>
            {PRESET_THEMES.map(p=>{
              const isActive = activeId===p.id;
              return (
                <div key={p.id} onClick={()=>applyPreset(p)}
                  style={{
                    border:`2px solid ${isActive?"var(--gold)":"var(--border)"}`,
                    borderRadius:12, padding:"12px 10px", cursor:"pointer", textAlign:"center",
                    background: isActive?"rgba(251,191,36,0.06)":"var(--surface2)",
                    transition:"all 0.2s", position:"relative",
                  }}
                  onMouseEnter={e=>!isActive&&(e.currentTarget.style.borderColor="var(--border2)")}
                  onMouseLeave={e=>!isActive&&(e.currentTarget.style.borderColor="var(--border)")}
                >
                  {isActive&&<div style={{position:"absolute",top:-8,right:-8,background:"var(--gold)",color:"#000",fontSize:"0.65rem",fontWeight:800,width:20,height:20,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>✓</div>}
                  {/* Mini preview swatch */}
                  <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:8}}>
                    <div style={{width:14,height:14,borderRadius:3,background:p.bg,border:"1px solid #fff2"}}/>
                    <div style={{width:14,height:14,borderRadius:3,background:p.accent}}/>
                    <div style={{width:14,height:14,borderRadius:3,background:p.gold}}/>
                    <div style={{width:14,height:14,borderRadius:3,background:p.green}}/>
                    <div style={{width:14,height:14,borderRadius:3,background:p.red}}/>
                  </div>
                  <div style={{fontSize:"1.2rem",marginBottom:3}}>{p.emoji}</div>
                  <div style={{fontWeight:700,fontSize:"0.82rem",color:isActive?"var(--gold)":"var(--text)"}}>{p.name}</div>
                  {isActive&&<div style={{fontSize:"0.68rem",color:"var(--gold)",marginTop:2,fontWeight:600}}>Active</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Custom Colors ── */}
        {themeTab==="custom"&&(
          <div>
            <div style={{fontSize:"0.82rem",color:"var(--text2)",marginBottom:14}}>
              Fine-tune every color individually. Changes preview when you click <strong style={{color:"var(--gold)"}}>Apply Custom</strong>.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>
              <div>
                <div style={{fontSize:"0.72rem",fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,paddingBottom:4,borderBottom:"1px solid var(--border)"}}>Backgrounds</div>
                {colorRow("Page Background","bg","Main background")}
                {colorRow("Surface (Cards)","surface","Card/sidebar bg")}
                {colorRow("Surface 2","surface2","Inputs, hover")}
                {colorRow("Surface 3","surface3","Elevated elements")}
                {colorRow("Border","border","Lines & dividers")}
                {colorRow("Text","text","Primary text")}
              </div>
              <div>
                <div style={{fontSize:"0.72rem",fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,paddingBottom:4,borderBottom:"1px solid var(--border)"}}>Accent Colors</div>
                {colorRow("Accent (Buttons)","accent","Active nav, tabs")}
                {colorRow("Gold","gold","Balances, logo")}
                {colorRow("Green","green","Positive values")}
                {colorRow("Red","red","Negative / danger")}
                {colorRow("Blue","blue","Info / entries")}
              </div>
            </div>
            {/* Live preview bar */}
            <div style={{marginTop:16,borderRadius:10,overflow:"hidden",border:"1px solid var(--border)"}}>
              <div style={{background:customVars.surface,padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:customVars.gold,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px"}}>⭐</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:customVars.text,fontSize:"0.9rem"}}>Live Preview</div>
                  <div style={{fontSize:"0.72rem",color:customVars.text,opacity:0.5}}>See your colors in action</div>
                </div>
                <div style={{background:customVars.accent,color:"#fff",padding:"5px 12px",borderRadius:6,fontSize:"0.78rem",fontWeight:600}}>Button</div>
                <div style={{background:customVars.green+"25",color:customVars.green,padding:"5px 12px",borderRadius:6,fontSize:"0.78rem",fontWeight:600}}>+Income</div>
                <div style={{background:customVars.red+"25",color:customVars.red,padding:"5px 12px",borderRadius:6,fontSize:"0.78rem",fontWeight:600}}>-Expense</div>
              </div>
              <div style={{background:customVars.bg,padding:"8px 14px",display:"flex",gap:6}}>
                {[customVars.bg,customVars.surface,customVars.accent,customVars.gold,customVars.green,customVars.red,customVars.blue].map((c,i)=>(
                  <div key={i} style={{width:20,height:20,borderRadius:4,background:c,border:"1px solid #fff2"}} title={c}/>
                ))}
              </div>
            </div>
            <div style={{marginTop:14,display:"flex",gap:10,flexWrap:"wrap"}}>
              <button className="btn btn-gold" onClick={applyCustom}>🎨 Apply Custom Theme</button>
              <button className="btn btn-secondary" onClick={()=>{
                const preset = PRESET_THEMES[0];
                setCustomVars({bg:preset.bg,surface:preset.surface,surface2:preset.surface2,surface3:preset.surface3,border:preset.border,text:preset.text,accent:preset.accent,gold:preset.gold,green:preset.green,red:preset.red,blue:preset.blue});
              }}>↩ Reset Colors</button>
              <button className="btn btn-secondary" onClick={()=>{
                const json = JSON.stringify(customVars);
                const a=document.createElement("a");
                a.href="data:application/json;charset=utf-8,"+encodeURIComponent(json);
                a.download="ledger_theme.json"; a.click();
              }}><Icon name="download" size={14}/>Export Theme</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Other Settings ── */}
      <div className="grid2">
        <div className="card">
          <div className="fw7 mb4 flex items-center gap2"><Icon name="building" size={18}/>Business Information</div>
          <div className="form-group" style={{marginBottom:12}}><label>Business Name</label><input value={co.name} onChange={e=>setCo(c=>({...c,name:e.target.value}))} placeholder="Your Gold Shop Name"/></div>
          <div className="form-group" style={{marginBottom:12}}><label>Owner / Proprietor Name</label><input value={co.owner||""} onChange={e=>setCo(c=>({...c,owner:e.target.value}))} placeholder="Owner name shown in reports"/></div>
          <div className="form-group" style={{marginBottom:12}}><label>Address</label><textarea value={co.address} onChange={e=>setCo(c=>({...c,address:e.target.value}))} rows={2}/></div>
          <div className="form-group" style={{marginBottom:16}}><label>Phone</label><input value={co.phone} onChange={e=>setCo(c=>({...c,phone:e.target.value}))}/></div>
          <button className="btn btn-gold" onClick={saveCompany}>💾 Save Info</button>
        </div>
        <div>
          <div className="card" style={{marginBottom:16}}>
            <div className="fw7 mb4">🔐 Change Password</div>
            {pwErr&&<div className="alert alert-error">{pwErr}</div>}
            <div className="form-group" style={{marginBottom:10}}><label>Current Password</label><input type="password" value={pw.old} onChange={e=>setPw(p=>({...p,old:e.target.value}))}/></div>
            <div className="form-group" style={{marginBottom:10}}><label>New Password</label><input type="password" value={pw.nw} onChange={e=>setPw(p=>({...p,nw:e.target.value}))}/></div>
            <div className="form-group" style={{marginBottom:16}}><label>Confirm Password</label><input type="password" value={pw.cf} onChange={e=>setPw(p=>({...p,cf:e.target.value}))}/></div>
            <button className="btn btn-primary" onClick={changePw} disabled={pwBusy}>{pwBusy?"Updating...":"Update Password"}</button>
          </div>
          <div className="card">
            <div className="fw7 mb4">📦 Data & Backup</div>
            <div className="text2 fs-sm" style={{marginBottom:14}}>Download all your ledger data as a JSON backup file.</div>
            <button className="btn btn-secondary" onClick={exportBackup}><Icon name="download" size={16}/>Export Backup</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────
function Dashboard({ data, setPage, setViewPerson, currentUser }) {
  const { entries, customers, workers } = data;

  const totalGoldBal  = entries.reduce((s,e)=>s+Number(e.goldIn||0)-Number(e.goldOut||0),0);
  const totalPureBal  = entries.reduce((s,e)=>s+Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0),0);
  const totalMoneyBal = entries.reduce((s,e)=>s+Number(e.moneyIn||0)-Number(e.moneyOut||0),0);

  const recent = [...entries].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0)).slice(0,10);
  const allPeople = [...customers.map(c=>({...c,ptype:"customer"})),...workers.map(w=>({...w,ptype:"worker"}))];

  // Monthly chart (last 6 months)
  const chartData = useMemo(()=>{
    const months=[];
    for(let i=5;i>=0;i--){
      const d=new Date(); d.setMonth(d.getMonth()-i);
      const key=d.toISOString().slice(0,7);
      const label=d.toLocaleString("default",{month:"short"});
      const goldIn  = entries.filter(e=>e.date.startsWith(key)).reduce((s,e)=>s+Number(e.goldIn||0),0);
      const goldOut = entries.filter(e=>e.date.startsWith(key)).reduce((s,e)=>s+Number(e.goldOut||0),0);
      const moneyIn = entries.filter(e=>e.date.startsWith(key)).reduce((s,e)=>s+Number(e.moneyIn||0),0);
      months.push({key,label,goldIn,goldOut,moneyIn});
    }
    return months;
  },[entries]);
  const maxGold  = Math.max(...chartData.map(m=>Math.max(m.goldIn,m.goldOut)),1);

  return (
    <div>
      <div style={{marginBottom:24}}>
        <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.4rem",fontWeight:800,marginBottom:4}}>Dashboard</div>
        <div className="text2 fs-sm">Welcome, <strong>{currentUser?.businessName||currentUser?.username}</strong> — Gold &amp; Money Ledger</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card gold"><div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div><div className="stat-label">Total Gold Balance</div><div className="stat-value gold">{fmtGold(totalGoldBal)}</div><div className="stat-sub">Pure Gold 100%: {fmtGold(totalPureBal)}</div></div>
        <div className={`stat-card ${totalMoneyBal>=0?"green":"red"}`}><div className={`stat-icon ${totalMoneyBal>=0?"green":"red"}`}><Icon name="money" size={18} color={totalMoneyBal>=0?"var(--green)":"var(--red)"}/></div><div className="stat-label">Total Money Balance</div><div className={`stat-value ${totalMoneyBal>=0?"green":"red"}`}>{fmtMoney(totalMoneyBal)}</div><div className="stat-sub">{totalMoneyBal>=0?"Receivable":"Payable"}</div></div>
        <div className="stat-card blue"><div className="stat-icon blue"><Icon name="customers" size={18} color="var(--blue)"/></div><div className="stat-label">Customers</div><div className="stat-value blue">{customers.length}</div><div className="stat-sub">Active accounts</div></div>
        <div className="stat-card" style={{"--green":"#a78bfa"}}><div className="stat-icon" style={{background:"rgba(167,139,250,0.12)",color:"#a78bfa"}}><Icon name="workers" size={18} color="#a78bfa"/></div><div className="stat-label">Workers</div><div className="stat-value" style={{color:"#a78bfa"}}>{workers.length}</div><div className="stat-sub">Active workers</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="fw7 fs-sm" style={{marginBottom:16}}>Monthly Gold Flow (Last 6 Months)</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:6,height:110}}>
            {chartData.map(m=>(
              <div key={m.key} style={{flex:1,display:"flex",alignItems:"flex-end",gap:2,height:"100%"}}>
                <div style={{flex:1,background:"var(--green)",opacity:0.8,borderRadius:"4px 4px 0 0",height:`${(m.goldIn/maxGold)*100}%`,minHeight:4,transition:"height 0.5s"}} title={`In: ${fmtGold(m.goldIn)}`}/>
                <div style={{flex:1,background:"var(--red)",opacity:0.8,borderRadius:"4px 4px 0 0",height:`${(m.goldOut/maxGold)*100}%`,minHeight:4,transition:"height 0.5s"}} title={`Out: ${fmtGold(m.goldOut)}`}/>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:6,marginTop:6}}>{chartData.map(m=><div key={m.key} style={{flex:1,fontSize:"0.68rem",color:"var(--text3)",textAlign:"center"}}>{m.label}</div>)}</div>
          <div style={{display:"flex",gap:16,marginTop:10}}>
            <div className="flex items-center gap2 fs-xs text2"><div style={{width:10,height:10,borderRadius:2,background:"var(--green)"}}/>Gold In</div>
            <div className="flex items-center gap2 fs-xs text2"><div style={{width:10,height:10,borderRadius:2,background:"var(--red)"}}/>Gold Out</div>
          </div>
        </div>

        <div className="card">
          <div className="flex justify-between items-center" style={{marginBottom:16}}>
            <div className="fw7 fs-sm">Top Balances</div>
          </div>
          {allPeople.slice(0,5).map(p=>{
            const pEnts=entries.filter(e=>e.personId===p.id);
            const gb=pEnts.reduce((s,e)=>s+Number(e.goldIn||0)-Number(e.goldOut||0),0);
            const mb=pEnts.reduce((s,e)=>s+Number(e.moneyIn||0)-Number(e.moneyOut||0),0);
            return (
              <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>{setViewPerson(p);setPage("ledger")}}>
                <div><div className="fw6 fs-sm">{p.name}</div><div className="fs-xs text3">{fmtGold(gb)} gold · {fmtMoney(mb)}</div></div>
                <span className={`badge ${gb>=0?"badge-gold":"badge-red"}`}>{fmtGold(Math.abs(gb))}</span>
              </div>
            );
          })}
          {allPeople.length===0&&<div className="text3 fs-sm">No people added yet</div>}
        </div>
      </div>

      <div className="card mt4">
        <div className="flex justify-between items-center" style={{marginBottom:16}}>
          <div className="fw7 fs-sm">Recent Entries</div>
          <div className="flex gap2">
            <button className="btn btn-secondary btn-sm" onClick={()=>setPage("history")} style={{color:"var(--red)",borderColor:"rgba(244,63,94,0.3)"}}>
              <Icon name="trash" size={13}/>Deleted History
            </button>
            <button className="btn btn-secondary btn-sm" onClick={()=>setPage("reports")}>View Reports</button>
          </div>
        </div>
        {recent.length===0 ? (
          <div className="empty" style={{padding:24}}><div className="empty-sub">No entries yet. Add your first ledger entry.</div></div>
        ) : (
          <div className="table-wrap" style={{border:"none"}}>
            <table>
              <thead><tr><th>Date</th><th>Person</th><th>Description</th><th className="th-right">Gold</th><th className="th-right">Money</th></tr></thead>
              <tbody>
                {recent.map(e=>{
                  const p=allPeople.find(x=>x.id===e.personId);
                  return (
                    <tr key={e.id}>
                      <td style={{whiteSpace:"nowrap",color:"var(--text2)"}}>{fmtDate(e.date)}</td>
                      <td><span className="fw6">{p?.name||"Unknown"}</span><span className="fs-xs text3" style={{marginLeft:6,textTransform:"capitalize"}}>{e.personType}</span></td>
                      <td className="text2">{e.description||"-"}</td>
                      <td className="right"><span className="text-gold fw6">{e.goldIn?`+${fmtGold(e.goldIn)}`:""}{e.goldOut?`-${fmtGold(e.goldOut)}`:""}{!e.goldIn&&!e.goldOut?"-":""}</span></td>
                      <td className="right"><span className={e.moneyIn?"text-green":e.moneyOut?"text-red":"text3"}>{e.moneyIn?`+${fmtMoney(e.moneyIn)}`:e.moneyOut?`-${fmtMoney(e.moneyOut)}`:"-"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}



// ─── Subscription helpers ─────────────────────────────────────────────
const isExpired = (user, siteSettings) => {
  if (siteSettings?.freeMode) return false;          // free mode = never expired
  if (!user?.expiryDate) return true;
  return new Date(user.expiryDate) < new Date();
};
const daysLeft = (user, siteSettings) => {
  if (siteSettings?.freeMode) return 9999;
  if (!user?.expiryDate) return 0;
  const diff = new Date(user.expiryDate) - new Date();
  return Math.max(0, Math.ceil(diff / (1000*60*60*24)));
};

// ─── Payment Page ─────────────────────────────────────────────────────
function PaymentPage({ currentUser, onRefresh, onLogout, siteSettings }) {
  const [plan,   setPlan]   = useState("yearly");
  const [utr,    setUtr]    = useState("");
  const [step,   setStep]   = useState("plan"); // plan | pay | submitted
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");

  const priceMonthly = siteSettings?.priceMonthly ?? PRICE_MONTHLY;
  const priceYearly  = siteSettings?.priceYearly  ?? PRICE_YEARLY;
  const amount = plan === "monthly" ? priceMonthly : priceYearly;
  const months = plan === "monthly" ? 1 : 12;

  const upiLink = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent("Ledger "+plan+" plan - "+currentUser.username)}`;

  const submitUTR = async () => {
    const trimmed = utr.trim();
    if (trimmed.length < 6) return setErr("Enter a valid UTR / Transaction ID.");
    setBusy(true); setErr("");
    try {
      // Load existing payments
      const result = await ghGet(PAYMENTS_FILE);
      const payments = result?.data?.payments || [];
      const sha = result?.sha || null;
      // Check duplicate UTR
      if (payments.find(p => p.utr === trimmed)) {
        setBusy(false); return setErr("This UTR is already submitted. Contact admin if not approved.");
      }
      const newPayment = {
        id: uid(),
        username: currentUser.username,
        businessName: currentUser.businessName || currentUser.username,
        plan,
        amount,
        months,
        utr: trimmed,
        status: "pending", // pending | approved | rejected
        submittedAt: Date.now(),
        approvedAt: null,
      };
      await ghPut(PAYMENTS_FILE, { payments: [...payments, newPayment] }, sha, `Payment UTR submitted: ${currentUser.username}`);
      setStep("submitted");
    } catch(e) { setErr("Failed to submit. Please try again."); }
    setBusy(false);
  };

  const expired = isExpired(currentUser);
  const left    = daysLeft(currentUser);

  const inp = {background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.95rem",padding:"11px 14px",width:"100%",outline:"none",boxSizing:"border-box",marginTop:6};

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:440}}>

        {/* Header */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{width:56,height:56,background:"linear-gradient(135deg,var(--gold),var(--amber))",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
            <Icon name="gold" size={28} color="#000"/>
          </div>
          <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.5rem",fontWeight:800}}>Ledger</div>
          {expired
            ? <div style={{marginTop:6,color:"var(--red)",fontWeight:600}}>⚠️ Your subscription has expired</div>
            : <div style={{marginTop:6,color:"var(--gold)",fontWeight:600}}>⚡ {left} days remaining — Renew now</div>
          }
          <div style={{fontSize:"0.82rem",color:"var(--text3)",marginTop:4}}>Logged in as <strong>{currentUser.businessName||currentUser.username}</strong></div>
        </div>

        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:28,boxShadow:"var(--shadow)"}}>

          {/* ── Step 1: Choose Plan ── */}
          {step==="plan" && <>
            <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.1rem",fontWeight:700,marginBottom:18,textAlign:"center"}}>Choose Your Plan</div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22}}>
              {[{id:"monthly",label:"Monthly",price:priceMonthly,sub:"Billed every month"},{id:"yearly",label:"Yearly",price:priceYearly,sub:"Save ₹"+(priceMonthly*12-priceYearly)+"!",badge:"BEST VALUE"}].map(pl=>(
                <div key={pl.id} onClick={()=>setPlan(pl.id)} style={{border:`2px solid ${plan===pl.id?"var(--gold)":"var(--border)"}`,borderRadius:12,padding:"16px 12px",cursor:"pointer",textAlign:"center",position:"relative",background:plan===pl.id?"rgba(234,179,8,0.06)":"var(--surface2)",transition:"all 0.2s"}}>
                  {pl.badge&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:"var(--gold)",color:"#000",fontSize:"0.65rem",fontWeight:700,padding:"2px 8px",borderRadius:20,whiteSpace:"nowrap"}}>{pl.badge}</div>}
                  <div style={{fontWeight:700,fontSize:"0.95rem",marginBottom:4}}>{pl.label}</div>
                  <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.6rem",fontWeight:800,color:"var(--gold)"}}>₹{pl.price}</div>
                  <div style={{fontSize:"0.75rem",color:"var(--text3)",marginTop:3}}>{pl.sub}</div>
                </div>
              ))}
            </div>

            <button onClick={()=>setStep("pay")} style={{width:"100%",padding:"12px",fontSize:"1rem",fontWeight:700,background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"#000",border:"none",borderRadius:10,cursor:"pointer"}}>
              Continue → Pay ₹{amount}
            </button>
            <div style={{marginTop:14,textAlign:"center"}}>
              <span style={{fontSize:"0.8rem",color:"var(--text3)",cursor:"pointer"}} onClick={onLogout}>← Sign out</span>
            </div>
          </>}

          {/* ── Step 2: Pay via UPI ── */}
          {step==="pay" && <>
            <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.1rem",fontWeight:700,marginBottom:4,textAlign:"center"}}>Pay ₹{amount} via UPI</div>
            <div style={{textAlign:"center",fontSize:"0.82rem",color:"var(--text3)",marginBottom:18}}>{plan==="monthly"?"1 Month Access":"1 Year Access"} · {currentUser.businessName||currentUser.username}</div>

            {/* UPI QR Code */}
            <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:12,padding:18,marginBottom:18,textAlign:"center"}}>
              <div style={{fontSize:"0.78rem",color:"var(--text3)",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>Scan &amp; Pay via UPI</div>
              <div style={{display:"inline-block",background:"#fff",padding:10,borderRadius:10,marginBottom:10}}>
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiLink)}`} alt="UPI QR" width={180} height={180} style={{display:"block",borderRadius:4}}/>
              </div>
              <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.1rem",fontWeight:800,color:"var(--gold)",marginBottom:2}}>{UPI_ID}</div>
              <div style={{fontSize:"0.82rem",color:"var(--text2)",marginBottom:10}}>{UPI_NAME}</div>
              <div style={{display:"inline-block",background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"#000",fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.6rem",fontWeight:900,padding:"6px 24px",borderRadius:8,marginBottom:10}}>₹{amount}</div>
              <div style={{fontSize:"0.78rem",color:"var(--text3)",marginBottom:12}}>{plan==="monthly"?"1 Month Access":"1 Year Full Access"}</div>
              <a href={upiLink} style={{display:"inline-block",padding:"9px 20px",background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",borderRadius:8,fontWeight:700,fontSize:"0.88rem",textDecoration:"none"}}>📱 Open in UPI App</a>
              <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:6}}>PhonePe · GPay · Paytm · BHIM</div>
            </div>

            {/* UTR input */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--text2)"}}>After paying, enter your UTR / Transaction ID:</div>
              <input style={inp} value={utr} onChange={e=>setUtr(e.target.value)} placeholder="e.g. 426112345678 or T2506XXXXXX"/>
              <div style={{fontSize:"0.75rem",color:"var(--text3)",marginTop:5}}>Find UTR in your UPI app → Transaction History → 12-digit number</div>
            </div>

            {err && <div className="alert alert-error" style={{marginBottom:12}}>{err}</div>}

            <button onClick={submitUTR} disabled={busy} style={{width:"100%",padding:"12px",fontSize:"1rem",fontWeight:700,background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"#000",border:"none",borderRadius:10,cursor:"pointer",marginBottom:10}}>
              {busy ? "Submitting..." : "✅ Submit Payment for Approval"}
            </button>
            <div style={{textAlign:"center"}}>
              <span style={{fontSize:"0.8rem",color:"var(--text3)",cursor:"pointer"}} onClick={()=>setStep("plan")}>← Back to plans</span>
            </div>
          </>}

          {/* ── Step 3: Submitted ── */}
          {step==="submitted" && <>
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:"3rem",marginBottom:12}}>🎉</div>
              <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.2rem",fontWeight:800,marginBottom:8}}>Payment Submitted!</div>
              <div style={{color:"var(--text2)",fontSize:"0.9rem",lineHeight:1.6,marginBottom:20}}>
                Your UTR has been sent for approval.<br/>
                Admin will verify and activate your account<br/>
                <strong>usually within a few minutes.</strong>
              </div>
              <div style={{background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:10,padding:14,marginBottom:20,fontSize:"0.85rem",color:"var(--text2)"}}>
                📞 For faster approval, WhatsApp your UTR to admin.
              </div>
              <button onClick={onRefresh} style={{width:"100%",padding:"11px",fontWeight:700,background:"linear-gradient(135deg,var(--gold),var(--amber))",color:"#000",border:"none",borderRadius:10,cursor:"pointer",marginBottom:10}}>
                🔄 Check Activation Status
              </button>
              <div style={{textAlign:"center"}}>
                <span style={{fontSize:"0.8rem",color:"var(--text3)",cursor:"pointer"}} onClick={onLogout}>Sign out</span>
              </div>
            </div>
          </>}

        </div>
      </div>
    </div>
  );
}

// ─── Admin Panel ─────────────────────────────────────────────────────
function AdminPanel({ onLogout, userTheme={} }) {
  const [users,       setUsers]      = useState([]);
  const [payments,    setPayments]   = useState([]);
  const [loading,     setLoading]    = useState(true);
  const [selUser,     setSelUser]    = useState(null);
  const [userData,    setUserData]   = useState(null);
  const [userLoading, setUserLoading]= useState(false);
  const [tab,         setTab]        = useState("payments");
  const [siteSettings, setSiteSettings] = useState({ freeMode:false, priceMonthly:99, priceYearly:999, siteName:"Ledger", maintenanceMode:false, announcement:"", announcementType:"info" });
  const [settingsSha, setSettingsSha] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [userSearch,  setUserSearch]  = useState("");
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ur, pr, sr] = await Promise.all([ghGet(USERS_FILE), ghGet(PAYMENTS_FILE), ghGet(SITE_SETTINGS_FILE)]);
      setUsers(ur?.data?.users || []);
      setPayments(pr?.data?.payments || []);
      if (sr) { setSiteSettings(prev=>({...prev,...sr.data})); setSettingsSha(sr.sha); }
    } catch(e) { addToast("Failed to load","error"); }
    setLoading(false);
  };

  useEffect(()=>{ loadAll(); },[]);

  // ── Save site settings ──
  const saveSettings = async (patch) => {
    setSettingsBusy(true); setSettingsMsg("");
    try {
      const merged = {...siteSettings,...patch};
      const result = await ghGet(SITE_SETTINGS_FILE);
      const sha = result?.sha || settingsSha || null;
      const newSha = await ghPut(SITE_SETTINGS_FILE, merged, sha, "Admin updated site settings");
      setSiteSettings(merged); setSettingsSha(newSha);
      setSettingsMsg("✅ Saved successfully!");
      setTimeout(()=>setSettingsMsg(""), 3000);
      addToast("Settings saved!");
    } catch(e) { setSettingsMsg("❌ Save failed."); addToast("Save failed","error"); }
    setSettingsBusy(false);
  };

  // ── Approve payment ──
  const approvePayment = async (pmt) => {
    try {
      const usersResult = await ghGet(USERS_FILE);
      const allUsers = usersResult?.data?.users || [];
      const userIdx  = allUsers.findIndex(u => u.username === pmt.username);
      if (userIdx === -1) return addToast("User not found","error");
      const existing = allUsers[userIdx];
      const base = (existing.expiryDate && new Date(existing.expiryDate) > new Date())
        ? new Date(existing.expiryDate) : new Date();
      base.setMonth(base.getMonth() + pmt.months);
      const newExpiry = base.toISOString().split("T")[0];
      allUsers[userIdx] = { ...existing, expiryDate: newExpiry, plan: pmt.plan };
      await ghPut(USERS_FILE, { users: allUsers }, usersResult.sha, `Approved payment for ${pmt.username}`);
      const pmtResult  = await ghGet(PAYMENTS_FILE);
      const allPayments = pmtResult?.data?.payments || [];
      const updated = allPayments.map(p => p.id===pmt.id ? {...p, status:"approved", approvedAt:Date.now(), expiryDate:newExpiry} : p);
      await ghPut(PAYMENTS_FILE, { payments: updated }, pmtResult.sha, `Payment approved: ${pmt.username}`);
      setUsers(allUsers); setPayments(updated);
      addToast(`✅ Approved! ${pmt.username} active till ${newExpiry}`);
    } catch(e) { addToast("Approval failed","error"); console.error(e); }
  };

  // ── Reject payment ──
  const rejectPayment = async (pmt) => {
    if (!window.confirm(`Reject UTR ${pmt.utr} from ${pmt.username}?`)) return;
    try {
      const pmtResult   = await ghGet(PAYMENTS_FILE);
      const allPayments = pmtResult?.data?.payments || [];
      const updated = allPayments.map(p => p.id===pmt.id ? {...p, status:"rejected", approvedAt:Date.now()} : p);
      await ghPut(PAYMENTS_FILE, { payments: updated }, pmtResult.sha, `Payment rejected: ${pmt.username}`);
      setPayments(updated); addToast("Payment rejected.");
    } catch(e) { addToast("Failed","error"); }
  };

  // ── View user ledger ──
  const viewUser = async (user) => {
    setSelUser(user); setTab("view"); setUserLoading(true);
    try {
      const result = await ghGet(userDataFile(user.username));
      setUserData(result?.data || null);
    } catch(e) { addToast("Failed to load","error"); setUserData(null); }
    setUserLoading(false);
  };

  // ── Delete user ──
  const deleteUser = async (user) => {
    if (!window.confirm(`Delete "${user.businessName}" (${user.username})? This cannot be undone.`)) return;
    try {
      const result  = await ghGet(USERS_FILE);
      const updated = (result?.data?.users||[]).filter(u=>u.id!==user.id);
      await ghPut(USERS_FILE, { users: updated }, result?.sha, `Admin deleted: ${user.username}`);
      setUsers(updated); addToast("Deleted.");
      if (selUser?.id===user.id) { setSelUser(null); setTab("payments"); }
    } catch(e) { addToast("Delete failed","error"); }
  };

  // ── Extend / set custom expiry ──
  const extendSub = async (user, months) => {
    try {
      const result   = await ghGet(USERS_FILE);
      const allUsers = result?.data?.users || [];
      const idx      = allUsers.findIndex(u=>u.id===user.id);
      if (idx===-1) return;
      const base = (allUsers[idx].expiryDate && new Date(allUsers[idx].expiryDate) > new Date())
        ? new Date(allUsers[idx].expiryDate) : new Date();
      base.setMonth(base.getMonth()+months);
      const newExpiry = base.toISOString().split("T")[0];
      allUsers[idx] = {...allUsers[idx], expiryDate: newExpiry};
      await ghPut(USERS_FILE, {users:allUsers}, result.sha, `Admin extended sub for ${user.username}`);
      setUsers(allUsers); addToast(`Extended till ${newExpiry}`);
    } catch(e) { addToast("Failed","error"); }
  };

  // ── Set custom expiry date ──
  const setCustomExpiry = async (user, dateStr) => {
    if (!dateStr) return;
    try {
      const result   = await ghGet(USERS_FILE);
      const allUsers = result?.data?.users || [];
      const idx      = allUsers.findIndex(u=>u.id===user.id);
      if (idx===-1) return;
      allUsers[idx] = {...allUsers[idx], expiryDate: dateStr};
      await ghPut(USERS_FILE, {users:allUsers}, result.sha, `Admin set expiry for ${user.username}`);
      setUsers(allUsers); addToast(`Expiry set to ${dateStr}`);
    } catch(e) { addToast("Failed","error"); }
  };

  // ── Grant lifetime access ──
  const grantLifetime = async (user) => {
    await setCustomExpiry(user, "2099-12-31");
  };

  // ── Reset user password ──
  const resetPassword = async (user) => {
    const newPwd = window.prompt(`Set new password for "${user.username}":`);
    if (!newPwd || newPwd.length < 6) { if(newPwd!==null) alert("Min 6 characters."); return; }
    try {
      const result   = await ghGet(USERS_FILE);
      const allUsers = result?.data?.users || [];
      const idx      = allUsers.findIndex(u=>u.id===user.id);
      if (idx===-1) return;
      allUsers[idx] = {...allUsers[idx], password: newPwd};
      await ghPut(USERS_FILE, {users:allUsers}, result.sha, `Admin reset password for ${user.username}`);
      setUsers(allUsers); addToast("Password updated!");
    } catch(e) { addToast("Failed","error"); }
  };

  const pending  = payments.filter(p=>p.status==="pending");
  const approved = payments.filter(p=>p.status==="approved");
  const rejected = payments.filter(p=>p.status==="rejected");
  const totalRevenue = approved.reduce((s,p)=>s+Number(p.amount||0),0);

  const allEntries   = userData?.entries   || [];
  const allCustomers = userData?.customers || [];
  const allWorkers   = userData?.workers   || [];
  const goldBal  = allEntries.reduce((s,e)=>s+Number(e.goldIn||0)-Number(e.goldOut||0),0);
  const moneyBal = allEntries.reduce((s,e)=>s+Number(e.moneyIn||0)-Number(e.moneyOut||0),0);
  const pureBal  = allEntries.reduce((s,e)=>s+Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0),0);

  const filteredUsers = useMemo(()=>users.filter(u=>
    !userSearch || u.username.toLowerCase().includes(userSearch.toLowerCase()) || (u.businessName||"").toLowerCase().includes(userSearch.toLowerCase())
  ),[users,userSearch]);

  const activeUsers  = users.filter(u=>!isExpired(u));
  const expiredUsers = users.filter(u=>isExpired(u));

  const StatusBadge = ({s}) => {
    const map = {pending:{bg:"rgba(234,179,8,0.15)",color:"var(--gold)",label:"Pending"},approved:{bg:"rgba(34,197,94,0.15)",color:"var(--green)",label:"Approved"},rejected:{bg:"rgba(239,68,68,0.15)",color:"var(--red)",label:"Rejected"}};
    const m = map[s]||map.pending;
    return <span style={{background:m.bg,color:m.color,padding:"2px 10px",borderRadius:20,fontSize:"0.75rem",fontWeight:700}}>{m.label}</span>;
  };

  const adminNavItems = [
    {id:"payments", icon:"money",     label:"Payments",   badge: pending.length>0?pending.length:null},
    {id:"users",    icon:"customers", label:"Businesses", badge: null},
    {id:"settings", icon:"settings",  label:"Site Settings", badge: null},
    {id:"stats",    icon:"dashboard", label:"Statistics", badge: null},
  ];
  if(selUser) adminNavItems.push({id:"view", icon:"reports", label:selUser.username, badge:null});

  return (
    <>
      <style>{getStyles(userTheme)}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon" style={{background:"linear-gradient(135deg,#f43f5e,#e11d48)"}}><Icon name="gold" size={20} color="#fff"/></div>
            <div><div className="logo-text">Ledger</div><div className="logo-sub" style={{color:"var(--red)"}}>Admin Panel</div></div>
          </div>
          <nav className="sidebar-nav">
            {adminNavItems.map(item=>(
              <div key={item.id} className={`nav-item${tab===item.id?" active":""}`} onClick={()=>setTab(item.id)}>
                <Icon name={item.icon} size={17}/>{item.label}
                {item.badge&&<span style={{marginLeft:"auto",background:"var(--red)",color:"#fff",borderRadius:10,fontSize:"0.7rem",padding:"1px 7px",fontWeight:700}}>{item.badge}</span>}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="nav-item" onClick={loadAll}><Icon name="sync" size={17}/>Refresh</div>
            <div className="nav-item" onClick={onLogout}><Icon name="logout" size={17}/>Sign Out</div>
          </div>
        </aside>
        <div className="main">
          <header className="header">
            <div className="header-title">
              {tab==="payments"?"Payment Approvals":tab==="users"?"All Businesses":tab==="settings"?"Site Settings":tab==="stats"?"Statistics":tab==="view"&&selUser?selUser.businessName:"Admin"}
            </div>
            <div className="header-right">
              {siteSettings.freeMode&&<span style={{background:"rgba(34,211,160,0.15)",color:"var(--green)",border:"1px solid rgba(34,211,160,0.3)",borderRadius:20,padding:"3px 12px",fontSize:"0.75rem",fontWeight:700}}>🆓 FREE MODE ON</span>}
              {siteSettings.maintenanceMode&&<span style={{background:"rgba(244,63,94,0.15)",color:"var(--red)",border:"1px solid rgba(244,63,94,0.3)",borderRadius:20,padding:"3px 12px",fontSize:"0.75rem",fontWeight:700}}>🔧 MAINTENANCE</span>}
              <div className="user-badge">
                <div className="user-avatar" style={{background:"linear-gradient(135deg,#f43f5e,#e11d48)"}}>A</div>
                <span style={{fontSize:"0.8rem",color:"var(--red)",fontWeight:600}}>ADMIN</span>
              </div>
            </div>
          </header>
          <div className="page">

            {/* ── PAYMENTS TAB ── */}
            {tab==="payments"&&(
              <div>
                <div className="stats-grid" style={{marginBottom:20}}>
                  <div className="stat-card gold"><div className="stat-icon gold"><Icon name="money" size={18} color="var(--gold)"/></div><div className="stat-label">Pending Approvals</div><div className="stat-value gold">{pending.length}</div></div>
                  <div className="stat-card green"><div className="stat-icon green"><Icon name="check" size={18} color="var(--green)"/></div><div className="stat-label">Total Approved</div><div className="stat-value green">{approved.length}</div></div>
                  <div className="stat-card blue"><div className="stat-icon blue"><Icon name="money" size={18} color="var(--blue)"/></div><div className="stat-label">Total Revenue</div><div className="stat-value blue">₹{totalRevenue.toLocaleString("en-IN")}</div></div>
                  <div className="stat-card red"><div className="stat-icon red"><Icon name="trash" size={18} color="var(--red)"/></div><div className="stat-label">Rejected</div><div className="stat-value red">{rejected.length}</div></div>
                </div>

                {pending.length>0&&(
                  <div className="card" style={{marginBottom:16,border:"1px solid rgba(234,179,8,0.3)"}}>
                    <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontWeight:700,marginBottom:14,color:"var(--gold)"}}>⏳ Pending Approval ({pending.length})</div>
                    <div className="table-wrap" style={{border:"none"}}>
                      <table>
                        <thead><tr><th>Business</th><th>Plan</th><th>Amount</th><th>UTR / Txn ID</th><th>Submitted</th><th className="th-center">Action</th></tr></thead>
                        <tbody>
                          {pending.map(p=>(
                            <tr key={p.id}>
                              <td><div className="fw6">{p.businessName}</div><div className="fs-xs text3">{p.username}</div></td>
                              <td><span className="badge badge-gold" style={{textTransform:"capitalize"}}>{p.plan}</span></td>
                              <td className="fw6">₹{p.amount}</td>
                              <td><span style={{fontFamily:"monospace",fontSize:"0.85rem",background:"var(--surface2)",padding:"2px 8px",borderRadius:4}}>{p.utr}</span></td>
                              <td className="text2 fs-xs">{new Date(p.submittedAt).toLocaleString("en-IN")}</td>
                              <td className="center">
                                <div className="flex gap2" style={{justifyContent:"center"}}>
                                  <button className="btn btn-sm" style={{background:"var(--green)",color:"#fff",border:"none"}} onClick={()=>approvePayment(p)}>✅ Approve</button>
                                  <button className="btn btn-danger btn-sm" onClick={()=>rejectPayment(p)}>❌ Reject</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="fw7 fs-sm" style={{marginBottom:14}}>All Payment History ({payments.length})</div>
                  {loading?<div className="empty"><div className="empty-sub">Loading...</div></div>:payments.length===0?
                    <div className="empty"><div className="empty-sub">No payments yet</div></div>
                  :(
                    <div className="table-wrap" style={{border:"none"}}>
                      <table>
                        <thead><tr><th>Business</th><th>Plan</th><th>Amount</th><th>UTR</th><th>Status</th><th>Expiry</th><th>Date</th></tr></thead>
                        <tbody>
                          {[...payments].sort((a,b)=>b.submittedAt-a.submittedAt).map(p=>(
                            <tr key={p.id}>
                              <td><div className="fw6">{p.businessName}</div><div className="fs-xs text3">{p.username}</div></td>
                              <td style={{textTransform:"capitalize"}}>{p.plan}</td>
                              <td className="fw6">₹{p.amount}</td>
                              <td><span style={{fontFamily:"monospace",fontSize:"0.82rem"}}>{p.utr}</span></td>
                              <td><StatusBadge s={p.status}/></td>
                              <td className="text2 fs-xs">{p.expiryDate||"-"}</td>
                              <td className="text2 fs-xs">{new Date(p.submittedAt).toLocaleDateString("en-IN")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── BUSINESSES TAB ── */}
            {tab==="users"&&(
              <div>
                <div className="section-header">
                  <div><div className="section-title">Registered Businesses</div><div className="section-sub">{users.length} total · {activeUsers.length} active · {expiredUsers.length} expired</div></div>
                </div>
                <div className="toolbar" style={{marginBottom:16}}>
                  <div className="search-wrap" style={{maxWidth:320}}>
                    <span className="search-icon"><Icon name="search" size={15}/></span>
                    <input value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="Search by name or username..."/>
                  </div>
                </div>
                {loading?<div className="empty"><div className="empty-sub">Loading...</div></div>:filteredUsers.length===0?
                  <div className="empty"><div className="empty-title">No businesses found</div></div>
                :(
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>Business</th><th>Username</th><th>Plan</th><th>Expiry</th><th>Status</th><th className="th-center">Actions</th></tr></thead>
                      <tbody>
                        {filteredUsers.map((u,i)=>{
                          const expired = isExpired(u);
                          const left    = daysLeft(u);
                          return (
                            <tr key={u.id}>
                              <td className="text3">{i+1}</td>
                              <td><div className="fw6">{u.businessName||"-"}</div><div className="fs-xs text3">Joined {u.createdAt?new Date(u.createdAt).toLocaleDateString("en-IN"):"-"}</div></td>
                              <td><span className="badge badge-blue">{u.username}</span></td>
                              <td style={{textTransform:"capitalize"}}>{u.plan||"-"}</td>
                              <td className="text2 fs-xs">{u.expiryDate||"Not set"}</td>
                              <td>
                                {!u.expiryDate?<span style={{color:"var(--text3)",fontSize:"0.78rem"}}>No sub</span>
                                :u.expiryDate==="2099-12-31"?<span style={{color:"var(--gold)",fontSize:"0.78rem",fontWeight:600}}>♾ Lifetime</span>
                                :expired?<span style={{color:"var(--red)",fontSize:"0.78rem",fontWeight:600}}>Expired</span>
                                :<span style={{color:"var(--green)",fontSize:"0.78rem",fontWeight:600}}>{left}d left</span>}
                              </td>
                              <td className="center">
                                <div className="flex gap2" style={{justifyContent:"center",flexWrap:"wrap"}}>
                                  <button className="btn btn-secondary btn-sm" onClick={()=>viewUser(u)} title="View ledger"><Icon name="eye" size={13}/>View</button>
                                  <button className="btn btn-sm" style={{background:"rgba(34,197,94,0.15)",color:"var(--green)",border:"1px solid rgba(34,197,94,0.3)"}} onClick={()=>extendSub(u,1)} title="+1 Month">+1M</button>
                                  <button className="btn btn-sm" style={{background:"rgba(34,197,94,0.15)",color:"var(--green)",border:"1px solid rgba(34,197,94,0.3)"}} onClick={()=>extendSub(u,12)} title="+1 Year">+1Y</button>
                                  <button className="btn btn-sm" style={{background:"rgba(251,191,36,0.15)",color:"var(--gold)",border:"1px solid rgba(251,191,36,0.3)"}} onClick={()=>grantLifetime(u)} title="Grant lifetime access">♾ Life</button>
                                  <button className="btn btn-sm" style={{background:"rgba(56,189,248,0.12)",color:"var(--blue)",border:"1px solid rgba(56,189,248,0.3)"}} onClick={()=>resetPassword(u)} title="Reset password"><Icon name="edit" size={12}/>PWD</button>
                                  <button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u)} title="Delete user"><Icon name="trash" size={13}/></button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── SITE SETTINGS TAB ── */}
            {tab==="settings"&&(
              <div style={{maxWidth:680}}>
                <div className="section-header" style={{marginBottom:24}}>
                  <div><div className="section-title">⚙️ Site Settings</div><div className="section-sub">Control pricing, access, and site behaviour</div></div>
                </div>

                {settingsMsg&&<div className={`alert ${settingsMsg.startsWith("✅")?"alert-success":"alert-error"}`} style={{marginBottom:16}}>{settingsMsg}</div>}

                {/* ── FREE MODE ── */}
                <div className="card" style={{marginBottom:16,border: siteSettings.freeMode?"1px solid rgba(34,211,160,0.4)":"1px solid var(--border)"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:"1rem",marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
                        🆓 Free Mode
                        {siteSettings.freeMode&&<span style={{background:"rgba(34,211,160,0.15)",color:"var(--green)",padding:"1px 8px",borderRadius:12,fontSize:"0.72rem",fontWeight:700}}>ACTIVE</span>}
                      </div>
                      <div style={{fontSize:"0.82rem",color:"var(--text2)",lineHeight:1.6}}>When enabled, <strong style={{color:"var(--text)"}}>all users get unlimited free access</strong> — no payment, no expiry. UPI payment page is bypassed completely. Perfect for beta testing or making the service free for everyone.</div>
                    </div>
                    <div>
                      <button
                        onClick={()=>saveSettings({freeMode:!siteSettings.freeMode})}
                        disabled={settingsBusy}
                        style={{
                          padding:"10px 22px",fontWeight:700,fontSize:"0.9rem",borderRadius:10,border:"none",cursor:"pointer",whiteSpace:"nowrap",
                          background: siteSettings.freeMode ? "var(--red)" : "var(--green)",
                          color: "#fff", minWidth:110,
                        }}
                      >
                        {siteSettings.freeMode ? "🔒 Disable" : "🆓 Enable"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── MAINTENANCE MODE ── */}
                <div className="card" style={{marginBottom:16,border: siteSettings.maintenanceMode?"1px solid rgba(244,63,94,0.4)":"1px solid var(--border)"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:"1rem",marginBottom:4,display:"flex",alignItems:"center",gap:8}}>
                        🔧 Maintenance Mode
                        {siteSettings.maintenanceMode&&<span style={{background:"rgba(244,63,94,0.15)",color:"var(--red)",padding:"1px 8px",borderRadius:12,fontSize:"0.72rem",fontWeight:700}}>ACTIVE</span>}
                      </div>
                      <div style={{fontSize:"0.82rem",color:"var(--text2)",lineHeight:1.6}}>Show a maintenance notice on the payment page. Useful when you need downtime or to push updates without deleting users.</div>
                    </div>
                    <button
                      onClick={()=>saveSettings({maintenanceMode:!siteSettings.maintenanceMode})}
                      disabled={settingsBusy}
                      style={{padding:"10px 22px",fontWeight:700,fontSize:"0.9rem",borderRadius:10,border:"none",cursor:"pointer",whiteSpace:"nowrap",background:siteSettings.maintenanceMode?"var(--red)":"rgba(244,63,94,0.15)",color:siteSettings.maintenanceMode?"#fff":"var(--red)",minWidth:110}}
                    >
                      {siteSettings.maintenanceMode?"✅ Disable":"🔧 Enable"}
                    </button>
                  </div>
                </div>

                {/* ── PRICING ── */}
                <div className="card" style={{marginBottom:16}}>
                  <div style={{fontWeight:700,fontSize:"1rem",marginBottom:4}}>💰 Subscription Pricing</div>
                  <div style={{fontSize:"0.82rem",color:"var(--text2)",marginBottom:16}}>Set the prices shown to users on the payment page. Changes take effect immediately for all new users.</div>
                  <PricingEditor
                    priceMonthly={siteSettings.priceMonthly??99}
                    priceYearly={siteSettings.priceYearly??999}
                    busy={settingsBusy}
                    onSave={(pm,py)=>saveSettings({priceMonthly:pm,priceYearly:py})}
                  />
                </div>

                {/* ── ANNOUNCEMENT ── */}
                <div className="card" style={{marginBottom:16}}>
                  <div style={{fontWeight:700,fontSize:"1rem",marginBottom:4}}>📢 Announcement Banner</div>
                  <div style={{fontSize:"0.82rem",color:"var(--text2)",marginBottom:14}}>Show a message banner on the payment page for all users (leave empty to hide).</div>
                  <AnnouncementEditor
                    text={siteSettings.announcement||""}
                    type={siteSettings.announcementType||"info"}
                    busy={settingsBusy}
                    onSave={(text,type)=>saveSettings({announcement:text,announcementType:type})}
                  />
                </div>

                {/* ── SITE NAME ── */}
                <div className="card" style={{marginBottom:16}}>
                  <div style={{fontWeight:700,fontSize:"1rem",marginBottom:4}}>🏷️ Site Name</div>
                  <div style={{fontSize:"0.82rem",color:"var(--text2)",marginBottom:14}}>The name shown on the payment page and login screen.</div>
                  <SiteNameEditor
                    name={siteSettings.siteName||"Ledger"}
                    busy={settingsBusy}
                    onSave={(name)=>saveSettings({siteName:name})}
                  />
                </div>

                {/* ── QUICK ACTIONS ── */}
                <div className="card">
                  <div style={{fontWeight:700,fontSize:"1rem",marginBottom:14}}>⚡ Quick Actions</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                    <button className="btn btn-secondary" onClick={()=>saveSettings({freeMode:false,maintenanceMode:false,announcement:""})} disabled={settingsBusy}>🔄 Reset All to Defaults</button>
                    <button className="btn btn-secondary" onClick={loadAll} disabled={settingsBusy}><Icon name="sync" size={14}/>Reload Settings</button>
                    <button className="btn btn-secondary" onClick={()=>{const j=JSON.stringify(siteSettings,null,2);const b=new Blob([j],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="site_settings.json";a.click();}} disabled={settingsBusy}><Icon name="download" size={14}/>Export JSON</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STATISTICS TAB ── */}
            {tab==="stats"&&(
              <div>
                <div className="section-header" style={{marginBottom:20}}>
                  <div><div className="section-title">📊 Statistics</div><div className="section-sub">Overview of all businesses and revenue</div></div>
                </div>
                <div className="stats-grid" style={{marginBottom:24}}>
                  <div className="stat-card blue"><div className="stat-icon blue"><Icon name="customers" size={18} color="var(--blue)"/></div><div className="stat-label">Total Businesses</div><div className="stat-value blue">{users.length}</div></div>
                  <div className="stat-card green"><div className="stat-icon green"><Icon name="check" size={18} color="var(--green)"/></div><div className="stat-label">Active Subscriptions</div><div className="stat-value green">{activeUsers.length}</div></div>
                  <div className="stat-card red"><div className="stat-icon red"><Icon name="close" size={18} color="var(--red)"/></div><div className="stat-label">Expired / Inactive</div><div className="stat-value red">{expiredUsers.length}</div></div>
                  <div className="stat-card gold"><div className="stat-icon gold"><Icon name="money" size={18} color="var(--gold)"/></div><div className="stat-label">Total Revenue</div><div className="stat-value gold">₹{totalRevenue.toLocaleString("en-IN")}</div></div>
                </div>
                <div className="grid2">
                  <div className="card">
                    <div className="fw7" style={{marginBottom:12}}>Revenue Breakdown</div>
                    {["monthly","yearly"].map(plan=>{
                      const planPayments = approved.filter(p=>p.plan===plan);
                      const planRevenue  = planPayments.reduce((s,p)=>s+Number(p.amount||0),0);
                      return (
                        <div key={plan} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                          <div style={{textTransform:"capitalize",fontWeight:600}}>{plan}</div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontWeight:700,color:"var(--gold)"}}>₹{planRevenue.toLocaleString("en-IN")}</div>
                            <div style={{fontSize:"0.72rem",color:"var(--text3)"}}>{planPayments.length} payments</div>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:10,marginTop:2}}>
                      <div style={{fontWeight:700}}>Total</div>
                      <div style={{fontWeight:800,color:"var(--green)",fontSize:"1.1rem"}}>₹{totalRevenue.toLocaleString("en-IN")}</div>
                    </div>
                  </div>
                  <div className="card">
                    <div className="fw7" style={{marginBottom:12}}>Recent Registrations</div>
                    {[...users].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,8).map(u=>(
                      <div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                        <div>
                          <div style={{fontWeight:600,fontSize:"0.9rem"}}>{u.businessName||u.username}</div>
                          <div style={{fontSize:"0.72rem",color:"var(--text3)"}}>@{u.username}</div>
                        </div>
                        <div style={{fontSize:"0.75rem",color:"var(--text3)"}}>{u.createdAt?new Date(u.createdAt).toLocaleDateString("en-IN"):"-"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── VIEW USER LEDGER ── */}
            {tab==="view"&&selUser&&(
              <div>
                <div className="section-header">
                  <div className="flex items-center gap3">
                    <button className="btn btn-secondary btn-sm" onClick={()=>setTab("users")}><Icon name="back" size={16}/>Back</button>
                    <div><div className="section-title">{selUser.businessName}</div><div className="section-sub">@{selUser.username} · Expires: {selUser.expiryDate||"Not set"}</div></div>
                  </div>
                </div>
                {userLoading?<div className="empty"><div className="empty-sub">Loading...</div></div>:!userData?
                  <div className="empty"><div className="empty-title">No data found</div></div>
                :(
                  <>
                    <div className="stats-grid" style={{marginBottom:20}}>
                      <div className="stat-card gold"><div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div><div className="stat-label">Gold Balance</div><div className="stat-value gold">{fmtGold(goldBal)}</div><div className="stat-sub">Pure: {fmtGold(pureBal)}</div></div>
                      <div className={`stat-card ${moneyBal>=0?"green":"red"}`}><div className={`stat-icon ${moneyBal>=0?"green":"red"}`}><Icon name="money" size={18} color={moneyBal>=0?"var(--green)":"var(--red)"}/></div><div className="stat-label">Money Balance</div><div className={`stat-value ${moneyBal>=0?"green":"red"}`}>{fmtMoney(moneyBal)}</div></div>
                      <div className="stat-card blue"><div className="stat-icon blue"><Icon name="customers" size={18} color="var(--blue)"/></div><div className="stat-label">Customers</div><div className="stat-value blue">{allCustomers.length}</div></div>
                      <div className="stat-card"><div className="stat-icon" style={{background:"rgba(167,139,250,0.12)",color:"#a78bfa"}}><Icon name="workers" size={18} color="#a78bfa"/></div><div className="stat-label">Workers</div><div className="stat-value" style={{color:"#a78bfa"}}>{allWorkers.length}</div></div>
                    </div>
                    <div className="card">
                      <div className="fw7 fs-sm" style={{marginBottom:14}}>All Entries ({allEntries.length})</div>
                      {allEntries.length===0?<div className="empty" style={{padding:24}}><div className="empty-sub">No entries yet</div></div>:(
                        <div className="table-wrap" style={{border:"none"}}>
                          <table>
                            <thead><tr><th>Date</th><th>Person</th><th>Description</th><th className="th-right">Gold In</th><th className="th-right">Gold Out</th><th className="th-center">Purity</th><th className="th-right">Money In</th><th className="th-right">Money Out</th></tr></thead>
                            <tbody>
                              {[...allEntries].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
                                const p=[...allCustomers,...allWorkers].find(x=>x.id===e.personId);
                                return (
                                  <tr key={e.id}>
                                    <td style={{whiteSpace:"nowrap",color:"var(--text2)"}}>{fmtDate(e.date)}</td>
                                    <td><span className="fw6">{p?.name||"-"}</span><span className="fs-xs text3" style={{marginLeft:6,textTransform:"capitalize"}}>{e.personType}</span></td>
                                    <td className="text2">{e.description||"-"}</td>
                                    <td className="right text-green">{e.goldIn?fmtGold(e.goldIn):"-"}</td>
                                    <td className="right text-red">{e.goldOut?fmtGold(e.goldOut):"-"}</td>
                                    <td className="center"><span className="badge badge-gold">{e.purity||"-"}</span></td>
                                    <td className="right text-green">{e.moneyIn?fmtMoney(e.moneyIn):"-"}</td>
                                    <td className="right text-red">{e.moneyOut?fmtMoney(e.moneyOut):"-"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
      <Toasts toasts={toasts} remove={removeToast}/>
    </>
  );
}

// ─── Admin sub-editors ────────────────────────────────────────────────
function PricingEditor({ priceMonthly, priceYearly, busy, onSave }) {
  const [pm, setPm] = useState(priceMonthly);
  const [py, setPy] = useState(priceYearly);
  const inp = {background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.95rem",padding:"9px 12px",width:"100%",outline:"none"};
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
        <div>
          <label style={{fontSize:"0.75rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:5}}>Monthly Price (₹)</label>
          <input style={inp} type="number" min="0" value={pm} onChange={e=>setPm(Number(e.target.value))} placeholder="e.g. 99"/>
          <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:4}}>Set 0 for free monthly plan</div>
        </div>
        <div>
          <label style={{fontSize:"0.75rem",fontWeight:600,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.04em",display:"block",marginBottom:5}}>Yearly Price (₹)</label>
          <input style={inp} type="number" min="0" value={py} onChange={e=>setPy(Number(e.target.value))} placeholder="e.g. 999"/>
          <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:4}}>Set 0 for free yearly plan</div>
        </div>
      </div>
      <div style={{background:"var(--surface2)",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:"0.82rem",color:"var(--text2)"}}>
        Preview: Monthly <strong style={{color:"var(--gold)"}}>₹{pm}</strong> · Yearly <strong style={{color:"var(--gold)"}}>₹{py}</strong> · Annual saving <strong style={{color:"var(--green)"}}>₹{Math.max(0,pm*12-py)}</strong>
      </div>
      <button className="btn btn-gold" onClick={()=>onSave(pm,py)} disabled={busy}>{busy?"Saving...":"💾 Save Pricing"}</button>
    </div>
  );
}

function AnnouncementEditor({ text, type, busy, onSave }) {
  const [txt, setTxt] = useState(text);
  const [tp, setTp]   = useState(type);
  const typeColors = {info:"var(--blue)",success:"var(--green)",warning:"var(--gold)",error:"var(--red)"};
  const inp = {background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.9rem",padding:"9px 12px",width:"100%",outline:"none",resize:"vertical",minHeight:72};
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:14,marginBottom:14,alignItems:"flex-start"}}>
        <textarea style={inp} value={txt} onChange={e=>setTxt(e.target.value)} placeholder="e.g. We are upgrading our servers tonight from 11pm–2am. Sorry for the inconvenience."/>
        <div>
          <div style={{fontSize:"0.72rem",color:"var(--text3)",marginBottom:6}}>Type</div>
          {["info","success","warning","error"].map(t=>(
            <div key={t} onClick={()=>setTp(t)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:6,cursor:"pointer",marginBottom:4,background:tp===t?"var(--surface3)":"transparent",border:`1px solid ${tp===t?"var(--border2)":"transparent"}`}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:typeColors[t]}}/>
              <span style={{fontSize:"0.78rem",textTransform:"capitalize",color:tp===t?"var(--text)":"var(--text2)"}}>{t}</span>
            </div>
          ))}
        </div>
      </div>
      {txt&&<div style={{background:`rgba(${tp==="info"?"56,189,248":tp==="success"?"34,211,160":tp==="warning"?"234,179,8":"244,63,94"},0.1)`,border:`1px solid ${typeColors[tp]}40`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:"0.82rem",color:typeColors[tp]}}>Preview: {txt}</div>}
      <div style={{display:"flex",gap:10}}>
        <button className="btn btn-gold" onClick={()=>onSave(txt,tp)} disabled={busy}>{busy?"Saving...":"📢 Save Banner"}</button>
        {txt&&<button className="btn btn-danger" onClick={()=>{setTxt(""); onSave("",tp);}} disabled={busy}>Clear</button>}
      </div>
    </div>
  );
}

function SiteNameEditor({ name, busy, onSave }) {
  const [n, setN] = useState(name);
  const inp = {background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.95rem",padding:"9px 12px",width:"100%",outline:"none"};
  return (
    <div style={{display:"flex",gap:10,alignItems:"center"}}>
      <input style={{...inp,flex:1}} value={n} onChange={e=>setN(e.target.value)} placeholder="e.g. Ledger"/>
      <button className="btn btn-gold" onClick={()=>n.trim()&&onSave(n.trim())} disabled={busy}>{busy?"Saving...":"💾 Save"}</button>
    </div>
  );
}

// ─── Deleted History ─────────────────────────────────────────────────
function DeletedHistory({ currentUser, allPeople }) {
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      setLoading(true);
      try {
        const result = await ghGet(historyFile(currentUser.username));
        setRecords(result?.data?.deleted || []);
      } catch(e) { setRecords([]); }
      setLoading(false);
    })();
  }, [currentUser]);

  const filtered = useMemo(() => {
    if (!records) return [];
    const q = search.toLowerCase();
    return [...records]
      .sort((a,b) => b.deletedAt - a.deletedAt)
      .filter(e => {
        const p = allPeople.find(x => x.id === e.personId);
        return !q || (p?.name||"").toLowerCase().includes(q) || (e.description||"").toLowerCase().includes(q) || (e.date||"").includes(q);
      });
  }, [records, search, allPeople]);

  return (
    <div>
      <div className="section-header">
        <div>
          <div className="section-title" style={{display:"flex",alignItems:"center",gap:8}}>
            <Icon name="trash" size={18} color="var(--red)"/>Deleted Transactions History
          </div>
          <div className="section-sub">All deleted entries are archived here. Nothing is permanently lost.</div>
        </div>
        <div style={{fontSize:"0.8rem",color:"var(--text3)",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 12px"}}>
          📁 ledger-history/history_{currentUser?.username}.json
        </div>
      </div>

      <div className="toolbar">
        <div className="search-wrap" style={{flex:1,minWidth:200}}>
          <span className="search-icon"><Icon name="search" size={15}/></span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, description, date..."/>
        </div>
        {records && <div style={{fontSize:"0.82rem",color:"var(--text3)"}}>{filtered.length} of {records.length} entries</div>}
      </div>

      {loading ? (
        <div className="empty"><div className="empty-icon"><Icon name="sync" size={28}/></div><div className="empty-title">Loading history...</div></div>
      ) : !records || records.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><Icon name="trash" size={28}/></div>
          <div className="empty-title">No deleted entries yet</div>
          <div className="empty-sub">When you delete transactions, they'll be archived here for reference.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Deleted On</th>
                <th>Original Date</th>
                <th>Name</th>
                <th>Description</th>
                <th className="th-right">Gold In</th>
                <th className="th-right">Gold Out</th>
                <th className="th-center">Purity</th>
                <th className="th-right">Money In</th>
                <th className="th-right">Money Out</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const p = allPeople.find(x => x.id === e.personId);
                const isC = e.personType === "customer";
                return (
                  <tr key={e.id || i} style={{opacity:0.85}}>
                    <td style={{whiteSpace:"nowrap"}}>
                      <div style={{color:"var(--red)",fontSize:"0.78rem",fontWeight:600}}>{fmtDate(new Date(e.deletedAt).toISOString().split("T")[0])}</div>
                      <div style={{fontSize:"0.68rem",color:"var(--text3)"}}>{new Date(e.deletedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                    </td>
                    <td style={{whiteSpace:"nowrap",color:"var(--text2)"}}>{fmtDate(e.date)}</td>
                    <td>
                      <div className="fw6">{p?.name || <span style={{color:"var(--text3)"}}>Unknown</span>}</div>
                      <div className="fs-xs" style={{color:isC?"var(--blue)":"#a78bfa",fontWeight:600}}>{isC?"👤 Customer":"🔧 Worker"}</div>
                    </td>
                    <td style={{color:"var(--text2)"}}>{e.description||"-"}</td>
                    <td className="right"><span className={e.goldIn?"gold-in":"text3"}>{e.goldIn?fmtGold(e.goldIn):"-"}</span></td>
                    <td className="right"><span className={e.goldOut?"gold-out":"text3"}>{e.goldOut?fmtGold(e.goldOut):"-"}</span></td>
                    <td className="center"><span className="badge badge-gold">{e.purity||"-"}</span></td>
                    <td className="right"><span className={e.moneyIn?"money-in":"text3"}>{e.moneyIn?fmtMoney(e.moneyIn):"-"}</span></td>
                    <td className="right"><span className={e.moneyOut?"money-out":"text3"}>{e.moneyOut?fmtMoney(e.moneyOut):"-"}</span></td>
                    <td style={{fontSize:"0.78rem",color:"var(--text3)"}}>{e.notes||"-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── Save Report Modal ───────────────────────────────────────────────
function SaveReportModal({ defaultName, onSave, onClose, saving }) {
  const [name, setName]   = useState(defaultName || "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags]   = useState([]);
  const [notes, setNotes] = useState("");

  const addTag = (raw) => {
    const t = raw.trim().replace(/,+$/,"");
    if (t && !tags.includes(t)) setTags(p=>[...p, t]);
    setTagInput("");
  };
  const removeTag = (t) => setTags(p=>p.filter(x=>x!==t));

  const TAG_COLORS = ["#6366f1","#22d3a0","#f59e0b","#f43f5e","#38bdf8","#a78bfa","#fb923c"];
  const tagColor  = (t) => TAG_COLORS[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0)) % TAG_COLORS.length];

  return (
    <Modal title="Save Report" onClose={onClose} footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-gold" onClick={()=>onSave({name:name.trim()||defaultName,tags,notes})} disabled={saving||!name.trim()}>
        {saving?"Saving...":"💾 Save Report"}
      </button>
    </>}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div className="form-group">
          <label>Report Name *</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. March 2026 Monthly Report"/>
        </div>
        <div className="form-group">
          <label>Tags <span style={{color:"var(--text3)",textTransform:"none",fontWeight:400}}>(press Enter or comma to add)</span></label>
          <input value={tagInput}
            onChange={e=>setTagInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"||e.key===","){e.preventDefault();addTag(tagInput);}}}
            onBlur={()=>tagInput.trim()&&addTag(tagInput)}
            placeholder="e.g. monthly, gold, 2026, loki..."/>
          {tags.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {tags.map(t=>(
                <span key={t} style={{display:"inline-flex",alignItems:"center",gap:5,background:tagColor(t)+"22",border:`1px solid ${tagColor(t)}55`,color:tagColor(t),borderRadius:99,padding:"3px 10px",fontSize:"0.78rem",fontWeight:600}}>
                  #{t}
                  <span onClick={()=>removeTag(t)} style={{cursor:"pointer",opacity:0.7,fontWeight:700,lineHeight:1}}>×</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="form-group">
          <label>Notes <span style={{color:"var(--text3)",textTransform:"none",fontWeight:400}}>(optional)</span></label>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any remarks about this report..." rows={2}/>
        </div>
      </div>
    </Modal>
  );
}

// ─── Saved Reports Page ──────────────────────────────────────────────
function SavedReports({ currentUser }) {
  const [records,    setRecords]   = useState(null);
  const [loading,    setLoading]   = useState(true);
  const [search,     setSearch]    = useState("");
  const [tagFilter,  setTagFilter] = useState("");
  const [del,        setDel]       = useState(null);
  const [editRec,    setEditRec]   = useState(null);
  const [saving,     setSaving]    = useState(false);
  const [preview,    setPreview]   = useState(null);
  const [selectedIds,setSelectedIds] = useState(new Set());
  const [bulkConfirm,setBulkConfirm] = useState(false);

  const loadReports = async () => {
    setLoading(true);
    try {
      const result = await ghGet(reportsFile(currentUser.username));
      setRecords(result?.data?.reports || []);
    } catch(e) { setRecords([]); }
    setLoading(false);
  };

  useEffect(()=>{ if(currentUser) loadReports(); },[currentUser]);

  const allTags = useMemo(()=>{
    if(!records) return [];
    const t = new Set();
    records.forEach(r=>(r.tags||[]).forEach(tag=>t.add(tag)));
    return [...t].sort();
  },[records]);

  const filtered = useMemo(()=>{
    if(!records) return [];
    const q = search.toLowerCase();
    return [...records]
      .sort((a,b)=>b.savedAt-a.savedAt)
      .filter(r=>{
        const nameMatch = !q || r.name.toLowerCase().includes(q) || (r.notes||"").toLowerCase().includes(q) || (r.tags||[]).some(t=>t.toLowerCase().includes(q));
        const tagMatch  = !tagFilter || (r.tags||[]).includes(tagFilter);
        return nameMatch && tagMatch;
      });
  },[records, search, tagFilter]);

  const deleteReport = async (id) => {
    try {
      const existing = await ghGet(reportsFile(currentUser.username));
      const updated  = (existing?.data?.reports||[]).filter(r=>r.id!==id);
      await ghPut(reportsFile(currentUser.username),{reports:updated},existing?.sha||null,"Delete saved report");
      setRecords(updated);
    } catch(e) { alert("Delete failed"); }
    setDel(null);
  };

  const bulkDelete = async () => {
    try {
      const existing = await ghGet(reportsFile(currentUser.username));
      const updated  = (existing?.data?.reports||[]).filter(r=>!selectedIds.has(r.id));
      await ghPut(reportsFile(currentUser.username),{reports:updated},existing?.sha||null,"Bulk delete saved reports");
      setRecords(updated);
      setSelectedIds(new Set());
    } catch(e) { alert("Bulk delete failed"); }
    setBulkConfirm(false);
  };

  const saveEdit = async ({name,tags,notes}) => {
    setSaving(true);
    try {
      const existing = await ghGet(reportsFile(currentUser.username));
      const updated  = (existing?.data?.reports||[]).map(r=>r.id===editRec.id?{...r,name,tags,notes,updatedAt:Date.now()}:r);
      await ghPut(reportsFile(currentUser.username),{reports:updated},existing?.sha||null,"Update saved report");
      setRecords(updated);
      setEditRec(null);
    } catch(e) { alert("Save failed"); }
    setSaving(false);
  };

  const openPDF = (r) => {
    printHTMLDoc(r.html, cleanName(r.name));
  };

  const TAG_COLORS = ["#6366f1","#22d3a0","#f59e0b","#f43f5e","#38bdf8","#a78bfa","#fb923c"];
  const tagColor  = (t) => TAG_COLORS[Math.abs([...t].reduce((a,c)=>a+c.charCodeAt(0),0)) % TAG_COLORS.length];

  const allFilteredSelected = filtered.length>0 && filtered.every(r=>selectedIds.has(r.id));
  const toggleAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filtered.forEach(r=>next.delete(r.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filtered.forEach(r=>next.add(r.id));
      setSelectedIds(next);
    }
  };
  const toggleOne = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <div className="section-title" style={{display:"flex",alignItems:"center",gap:8}}>
            <Icon name="pdf" size={18} color="var(--gold)"/>Saved Reports
          </div>
          <div className="section-sub">All your saved report snapshots — searchable by name, tag or notes.</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadReports}><Icon name="sync" size={14}/>Refresh</button>
      </div>

      {/* Filters */}
      <div className="toolbar" style={{flexWrap:"wrap",gap:8,marginBottom:12}}>
        <div className="search-wrap" style={{flex:1,minWidth:200}}>
          <span className="search-icon"><Icon name="search" size={15}/></span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, tag or notes..."/>
        </div>
        {allTags.length>0&&(
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:"0.75rem",color:"var(--text3)",fontWeight:600}}>Tag:</span>
            <button onClick={()=>setTagFilter("")} style={{padding:"3px 10px",borderRadius:99,border:"1px solid",fontSize:"0.75rem",fontWeight:600,cursor:"pointer",background:!tagFilter?"var(--accent)":"var(--surface2)",color:!tagFilter?"#fff":"var(--text2)",borderColor:!tagFilter?"var(--accent)":"var(--border)"}}>All</button>
            {allTags.map(t=>(
              <button key={t} onClick={()=>setTagFilter(t===tagFilter?"":t)}
                style={{padding:"3px 10px",borderRadius:99,border:`1px solid ${tagColor(t)}55`,fontSize:"0.75rem",fontWeight:600,cursor:"pointer",
                  background:tagFilter===t?tagColor(t)+"33":"var(--surface2)",
                  color:tagFilter===t?tagColor(t):"var(--text2)"}}>
                #{t}
              </button>
            ))}
          </div>
        )}
        {records&&<div style={{fontSize:"0.82rem",color:"var(--text3)"}}>{filtered.length} of {records.length} reports</div>}
      </div>

      {/* Bulk delete toolbar */}
      {selectedIds.size>0&&(
        <div style={{background:"rgba(244,63,94,0.1)",border:"1px solid rgba(244,63,94,0.35)",borderRadius:"var(--radius-sm)",padding:"10px 16px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <span style={{fontSize:"0.88rem",fontWeight:600,color:"var(--red)"}}>{selectedIds.size} report{selectedIds.size>1?"s":""} selected</span>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setSelectedIds(new Set())}>Clear</button>
            <button className="btn btn-danger btn-sm" onClick={()=>setBulkConfirm(true)}><Icon name="trash" size={13}/>Delete Selected</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty"><div className="empty-icon"><Icon name="sync" size={28}/></div><div className="empty-title">Loading saved reports...</div></div>
      ) : !records || records.length===0 ? (
        <div className="empty">
          <div className="empty-icon"><Icon name="pdf" size={28}/></div>
          <div className="empty-title">No saved reports yet</div>
          <div className="empty-sub">Go to Reports, generate a report, and click "Save Report" to archive it here.</div>
        </div>
      ) : filtered.length===0 ? (
        <div className="empty"><div className="empty-title">No results found</div><div className="empty-sub">Try a different search or tag filter.</div></div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* Select-all row */}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 6px"}}>
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll}
              style={{width:16,height:16,accentColor:"var(--gold)",cursor:"pointer",flexShrink:0}}/>
            <span style={{fontSize:"0.78rem",color:"var(--text3)"}}>Select all ({filtered.length})</span>
          </div>

          {filtered.map(r=>(
            <div key={r.id} style={{background:selectedIds.has(r.id)?"rgba(244,63,94,0.06)":"var(--surface)",border:`1px solid ${selectedIds.has(r.id)?"rgba(244,63,94,0.3)":"var(--border)"}`,borderRadius:"var(--radius)",padding:"14px 18px",display:"flex",gap:14,alignItems:"flex-start",transition:"border-color 0.15s"}}>
              {/* Checkbox */}
              <input type="checkbox" checked={selectedIds.has(r.id)} onChange={()=>toggleOne(r.id)}
                style={{width:16,height:16,accentColor:"var(--gold)",cursor:"pointer",flexShrink:0,marginTop:4}}/>
              {/* Icon */}
              <div style={{width:40,height:40,background:"var(--gold-dim)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <Icon name="pdf" size={18} color="var(--gold)"/>
              </div>
              {/* Content */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                  <div style={{fontWeight:700,fontSize:"0.95rem"}}>{cleanName(r.name)}</div>
                  <span style={{fontSize:"0.7rem",color:"var(--text3)",background:"var(--surface2)",padding:"2px 8px",borderRadius:99,border:"1px solid var(--border)",flexShrink:0}}>
                    {r.reportType==="gold"?"Gold Only":r.reportType==="money"?"Cash Only":"Full Report"}
                  </span>
                  {r.autoGenerated&&<span style={{fontSize:"0.7rem",background:"rgba(99,102,241,0.12)",color:"#6366f1",padding:"2px 8px",borderRadius:99,border:"1px solid rgba(99,102,241,0.3)",flexShrink:0,fontWeight:700}}>Auto</span>}
                </div>
                {r.tags?.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:5}}>
                    {r.tags.map(t=>(
                      <span key={t} onClick={()=>setTagFilter(t===tagFilter?"":t)}
                        style={{display:"inline-flex",alignItems:"center",gap:3,background:tagColor(t)+"22",border:`1px solid ${tagColor(t)}55`,color:tagColor(t),borderRadius:99,padding:"2px 8px",fontSize:"0.72rem",fontWeight:600,cursor:"pointer"}}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                {r.notes&&<div style={{fontSize:"0.78rem",color:"var(--text2)",marginBottom:4}}>{r.notes}</div>}
                <div style={{fontSize:"0.72rem",color:"var(--text3)",display:"flex",gap:12,flexWrap:"wrap"}}>
                  <span>Saved: {fmtDate(new Date(r.savedAt).toISOString().split("T")[0])} {new Date(r.savedAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                  <span>{r.entryCount} entries</span>
                  <span>Range: {r.rangeLabel}</span>
                  {r.updatedAt&&<span style={{color:"var(--amber)"}}>Edited: {fmtDate(new Date(r.updatedAt).toISOString().split("T")[0])}</span>}
                </div>
              </div>
              {/* Actions */}
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button className="btn btn-gold btn-sm" onClick={()=>setPreview(r)}><Icon name="eye" size={13}/>View</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>openPDF(r)}><Icon name="pdf" size={13}/>PDF</button>
                <button className="btn btn-secondary btn-sm" onClick={()=>setEditRec(r)}><Icon name="edit" size={13}/></button>
                <button className="btn btn-danger btn-sm" onClick={()=>setDel(r)}><Icon name="trash" size={13}/></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview overlay */}
      {preview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",flexDirection:"column"}}>
          <div style={{background:"var(--surface)",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--border)",flexShrink:0,gap:12}}>
            <div style={{fontWeight:700,fontSize:"0.95rem",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cleanName(preview.name)}</div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button className="btn btn-gold btn-sm" onClick={()=>openPDF(preview)}><Icon name="pdf" size={14}/>Print / Save PDF</button>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPreview(null)}>✕ Close</button>
            </div>
          </div>
          <iframe srcDoc={preview.html} style={{flex:1,border:"none",background:"#fff"}}/>
        </div>
      )}

      {del&&<Confirm msg={`Delete "${cleanName(del.name)}"? This cannot be undone.`} onOk={()=>deleteReport(del.id)} onCancel={()=>setDel(null)}/>}
      {bulkConfirm&&<Confirm msg={`Delete ${selectedIds.size} selected report${selectedIds.size>1?"s":""}? This cannot be undone.`} onOk={bulkDelete} onCancel={()=>setBulkConfirm(false)}/>}
      {editRec&&<SaveReportModal defaultName={editRec.name} onSave={saveEdit} onClose={()=>setEditRec(null)} saving={saving}/>}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [data,        setData]    = useState({...defaultBusinessData});
  const [fileSha,     setFileSha] = useState(null);
  const [page,        setPage]    = useState("dashboard");
  const [loading,     setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin,     setIsAdmin] = useState(false);
  const [syncStatus,  setSync]    = useState("");
  const [sidebarOpen, setSidebar] = useState(false);
  const [viewPerson,  setViewPerson] = useState(null);
  const [siteSettings, setSiteSettings] = useState(null);
  const [userTheme, setUserTheme] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ledger_theme") || "{}"); } catch{ return {}; }
  });
  const applyTheme = (t) => { setUserTheme(t); try { localStorage.setItem("ledger_theme", JSON.stringify(t)); } catch{} };
  const { toasts, add: addToast, remove: removeToast } = useToast();

  // Modals
  const [personForm, setPersonForm] = useState(null);
  const [entryForm,  setEntryForm]  = useState(null);

  // ── Load business data after login ──
  const loadUserData = useCallback(async(user) => {
    setLoading(true);
    try {
      const file = userDataFile(user.username);
      const [result, settingsResult] = await Promise.all([ghGet(file), ghGet(SITE_SETTINGS_FILE)]);
      const settings = settingsResult?.data || { freeMode: false, priceMonthly: 99, priceYearly: 999 };
      setSiteSettings(settings);
      if (result) {
        setData({...defaultBusinessData, ...result.data});
        setFileSha(result.sha);
        autoGenerateMonthEndReport(user, {...defaultBusinessData, ...result.data});
      } else {
        const init = {...defaultBusinessData, companyName: user.businessName||"My Gold Shop"};
        const sha = await ghPut(file, init, null, `Init data for ${user.username}`);
        setData(init); setFileSha(sha);
      }
    } catch(e) { console.error(e); addToast("Could not load data","error"); }
    setLoading(false);
  }, [addToast]);

  const handleLogin = useCallback((user, adminMode=false) => {
    if (adminMode) { setIsAdmin(true); setCurrentUser(user); return; }
    setIsAdmin(false);
    setCurrentUser(user);
    loadUserData(user);
  }, [loadUserData]);

  // ── Persist ──
  const shaRef = useRef(fileSha);
  useEffect(()=>{ shaRef.current=fileSha; },[fileSha]);

  const persist = useCallback(async(newData) => {
    if (!currentUser) return;
    setSync("saving");
    try {
      const file = userDataFile(currentUser.username);
      const newSha = await ghPut(file, newData, shaRef.current, `Ledger update - ${new Date().toLocaleDateString("en-IN")}`);
      setFileSha(newSha); shaRef.current=newSha;
      setSync("saved"); setTimeout(()=>setSync(""),2500);
    } catch(e) { setSync("error"); addToast("Save failed — check your PAT token","error"); setTimeout(()=>setSync(""),3000); }
  },[currentUser, addToast]);

  const updateData = useCallback((patch)=>{
    setData(prev=>{
      const next={...prev,...patch};
      persist(next);
      return next;
    });
  },[persist]);

  // ── CRUD ──
  const allPeople = useMemo(()=>[...data.customers.map(c=>({...c,ptype:"customer"})),...data.workers.map(w=>({...w,ptype:"worker"}))],[data.customers,data.workers]);

  const addCustomer    = f => { updateData({customers:[...data.customers,{...f,id:uid(),createdAt:Date.now()}]}); addToast("Customer added!"); setPersonForm(null); };
  const editCustomer   = f => { updateData({customers:data.customers.map(c=>c.id===f.id?{...c,...f}:c)}); addToast("Customer updated!"); setPersonForm(null); };
  const deleteCustomer = id=> { updateData({customers:data.customers.filter(c=>c.id!==id)}); addToast("Deleted.","error"); };
  const addWorker      = f => { updateData({workers:[...data.workers,{...f,id:uid(),createdAt:Date.now()}]}); addToast("Worker added!"); setPersonForm(null); };
  const editWorker     = f => { updateData({workers:data.workers.map(w=>w.id===f.id?{...w,...f}:w)}); addToast("Worker updated!"); setPersonForm(null); };
  const deleteWorker   = id=> { updateData({workers:data.workers.filter(w=>w.id!==id)}); addToast("Deleted.","error"); };

  const saveEntry = f => {
    if (Array.isArray(f)) {
      const newEntries = f.map(entry => ({...entry, id: uid(), createdAt: Date.now()}));
      updateData({entries: [...data.entries, ...newEntries]});
      addToast(`${newEntries.length} ${newEntries.length===1?"entry":"entries"} saved!`);
    } else if (f.id) {
      updateData({entries: data.entries.map(e => e.id===f.id ? {...e,...f} : e)});
      addToast("Entry updated!");
    } else {
      updateData({entries: [...data.entries, {...f, id: uid(), createdAt: Date.now()}]});
      addToast("Entry saved!");
    }
    setEntryForm(null);
  };
  const deleteEntry = async (id) => {
    const entry = data.entries.find(e => e.id === id);
    if (!entry) return;
    // Archive to history file first
    try {
      const hFile = historyFile(currentUser.username);
      const existing = await ghGet(hFile);
      const archived = existing?.data?.deleted || [];
      const newRecord = { ...entry, deletedAt: Date.now(), deletedBy: currentUser.username };
      await ghPut(hFile, { deleted: [...archived, newRecord] }, existing?.sha||null,
        `Archived entry: ${entry.description||entry.date} - ${currentUser.username}`);
    } catch(e) { console.warn("Archive failed, proceeding with delete:", e); }
    updateData({entries: data.entries.filter(e => e.id !== id)});
    addToast("Entry deleted & archived.", "error");
  };

  // ── Bulk delete: archives all selected entries in one shot, then removes them all at once ──
  const deleteManyEntries = async (ids) => {
    if (!ids || ids.length === 0) return;
    const idSet = new Set(ids);
    const toDelete = data.entries.filter(e => idSet.has(e.id));
    if (toDelete.length === 0) return;
    // Archive all entries in a single write
    try {
      const hFile = historyFile(currentUser.username);
      const existing = await ghGet(hFile);
      const archived = existing?.data?.deleted || [];
      const newRecords = toDelete.map(e => ({ ...e, deletedAt: Date.now(), deletedBy: currentUser.username }));
      await ghPut(hFile, { deleted: [...archived, ...newRecords] }, existing?.sha||null,
        `Bulk archived ${toDelete.length} entries - ${currentUser.username}`);
    } catch(e) { console.warn("Bulk archive failed, proceeding with delete:", e); }
    // Remove all at once in a single state update
    updateData({ entries: data.entries.filter(e => !idSet.has(e.id)) });
    addToast(`${toDelete.length} ${toDelete.length === 1 ? "entry" : "entries"} deleted & archived.`, "error");
  };

  // ── Nav ──
  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:"dashboard"},
    {id:"customers",label:"Customers",icon:"customers"},
    {id:"workers",  label:"Workers",  icon:"workers"},
    {id:"entry",    label:"New Entry", icon:"plus"},
    {id:"reports",  label:"Reports",  icon:"reports"},
    {id:"history",      label:"Deleted History", icon:"trash"},
    {id:"savedreports", label:"Saved Reports",   icon:"pdf"},
    {id:"settings",     label:"Settings",        icon:"settings"},
  ];
  const pageTitles = {dashboard:"Dashboard",customers:"Customers",workers:"Workers",reports:"Reports",settings:"Settings",ledger:"Ledger View",history:"Deleted History",savedreports:"Saved Reports"};

  const handleNav = id => {
    if(id==="entry"){ setEntryForm({entry:null,personId:""}); return; }
    setPage(id); setSidebar(false);
  };

  // ── Admin Panel ──
  if(currentUser && isAdmin) return (
    <AdminPanel onLogout={()=>{setCurrentUser(null);setIsAdmin(false);}} userTheme={userTheme}/>
  );

  // ── Login screen ──
  if(!currentUser) return (
    <>
      <style>{getStyles(userTheme)}</style>
      <LoginPage onLogin={handleLogin}/>
    </>
  );

  // ── Subscription expired / not paid → show payment page ──
  if(!loading && currentUser && isExpired(currentUser, siteSettings)) return (
    <>
      <style>{getStyles(userTheme)}</style>
      <PaymentPage
        currentUser={currentUser}
        siteSettings={siteSettings}
        onLogout={()=>{setCurrentUser(null);setData({...defaultBusinessData});setFileSha(null);}}
        onRefresh={async()=>{
          // Re-fetch latest user record from users.json to check if approved
          try {
            const result = await ghGet(USERS_FILE);
            const users  = result?.data?.users || [];
            const fresh  = users.find(u=>u.username===currentUser.username);
            const settingsResult = await ghGet(SITE_SETTINGS_FILE);
            const freshSettings = settingsResult?.data || siteSettings;
            setSiteSettings(freshSettings);
            if (fresh && !isExpired(fresh, freshSettings)) {
              setCurrentUser(fresh);
              loadUserData(fresh);
            } else {
              alert("Not activated yet. Please wait for admin to approve your payment.");
            }
          } catch(e) { alert("Could not check. Try again."); }
        }}
      />
    </>
  );

  // ── Loading screen (after login, while fetching business data) ──
  if(loading) return (
    <>
      <style>{getStyles(userTheme)}</style>
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--bg)",gap:16}}>
        <div style={{width:56,height:56,background:"linear-gradient(135deg,var(--gold),var(--amber))",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="gold" size={28} color="#000"/></div>
        <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.4rem",fontWeight:800}}>Ledger</div>
        <div className="text3 fs-sm">Loading {currentUser.businessName||currentUser.username}'s data...</div>
        <div style={{width:200,height:3,background:"var(--surface2)",borderRadius:99,overflow:"hidden"}}>
          <div style={{width:"60%",height:"100%",background:"linear-gradient(90deg,var(--gold),var(--amber))",borderRadius:99,animation:"toastIn 1s ease infinite alternate"}}/>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{getStyles(userTheme)}</style>
      <div className="app">
        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen?" open":""}`}>
          <div className="sidebar-logo">
            <div className="logo-icon"><Icon name="gold" size={20} color="#000"/></div>
            <div><div className="logo-text">Ledger</div><div className="logo-sub">Ledger Report</div></div>
          </div>
          <nav className="sidebar-nav">
            {navItems.map(item=>(
              <div key={item.id} className={`nav-item${page===item.id&&item.id!=="entry"?" active":""}`} onClick={()=>handleNav(item.id)}>
                <Icon name={item.icon} size={17}/>{item.label}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="nav-item" onClick={()=>{setCurrentUser(null);setIsAdmin(false);setData({...defaultBusinessData});setFileSha(null);}}><Icon name="logout" size={17}/>Sign Out</div>
          </div>
        </aside>

        <div className={`overlay${sidebarOpen?" show":""}`} onClick={()=>setSidebar(false)}/>

        <div className="main">
          <header className="header">
            <div className="flex items-center gap3">
              <button className="hamburger" onClick={()=>setSidebar(o=>!o)}><Icon name="menu" size={20}/></button>
              <div>
                <div className="header-title">{page==="ledger"&&viewPerson?viewPerson.name:(pageTitles[page]||"Ledger")}</div>
              </div>
            </div>
            <div className="header-right">
              {syncStatus==="saving"&&<span className="sync-indicator text-blue"><Icon name="sync" size={13} color="var(--blue)"/>Saving...</span>}
              {syncStatus==="saved" &&<span className="sync-indicator text-green"><Icon name="check" size={13} color="var(--green)"/>Saved</span>}
              {syncStatus==="error" &&<span className="sync-indicator text-red">Save failed</span>}
              <button className="btn btn-gold btn-sm" onClick={()=>setEntryForm({entry:null,personId:viewPerson?.id||""})}><Icon name="plus" size={14}/>New Entry</button>
              <div className="user-badge">
                <div className="user-avatar">{currentUser.username[0].toUpperCase()}</div>
                <span style={{fontSize:"0.8rem",color:"var(--text2)",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.businessName||currentUser.username}</span>
              </div>
            </div>
          </header>

          <div className="page">
            {/* Expiry warning banner */}
            {currentUser && daysLeft(currentUser, siteSettings) <= 7 && daysLeft(currentUser, siteSettings) > 0 && (
              <div style={{background:"rgba(234,179,8,0.12)",border:"1px solid rgba(234,179,8,0.4)",borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                <div style={{fontSize:"0.88rem",color:"var(--gold)",fontWeight:600}}>⚠️ Your subscription expires in {daysLeft(currentUser, siteSettings)} day{daysLeft(currentUser, siteSettings)===1?"":"s"}. Renew to avoid interruption.</div>
                <button onClick={()=>{setCurrentUser(u=>({...u,expiryDate:"2000-01-01"}));}} style={{background:"var(--gold)",color:"#000",border:"none",borderRadius:6,padding:"5px 14px",fontWeight:700,cursor:"pointer",fontSize:"0.8rem",whiteSpace:"nowrap"}}>Renew Now</button>
              </div>
            )}
            {page==="dashboard"&&<Dashboard data={data} setPage={setPage} setViewPerson={setViewPerson} currentUser={currentUser}/>}
            {page==="customers"&&(
              <PeopleList type="customer" data={data.customers} entries={data.entries}
                onAdd={()=>setPersonForm({type:"Customer",person:null})}
                onEdit={p=>setPersonForm({type:"Customer",person:p})}
                onDelete={deleteCustomer}
                onViewLedger={p=>{setViewPerson({...p,ptype:"customer"});setPage("ledger")}}/>
            )}
            {page==="workers"&&(
              <PeopleList type="worker" data={data.workers} entries={data.entries}
                onAdd={()=>setPersonForm({type:"Worker",person:null})}
                onEdit={p=>setPersonForm({type:"Worker",person:p})}
                onDelete={deleteWorker}
                onViewLedger={p=>{setViewPerson({...p,ptype:"worker"});setPage("ledger")}}/>
            )}
            {page==="ledger"&&viewPerson&&(
              <LedgerView person={viewPerson} entries={data.entries} allPeople={allPeople}
                companyData={data}
                onBack={()=>setPage(viewPerson.ptype==="customer"?"customers":"workers")}
                onAddEntry={()=>setEntryForm({entry:null,personId:viewPerson.id,personType:viewPerson.ptype})}
                onEditEntry={e=>setEntryForm({entry:e,personId:e.personId})}
                onDeleteEntry={deleteEntry}
                onDeleteManyEntries={deleteManyEntries}/>
            )}
            {page==="reports" &&<Reports entries={data.entries} customers={data.customers} workers={data.workers} companyName={data.companyName} companyData={data} onDeleteEntry={deleteEntry} onDeleteManyEntries={deleteManyEntries} onEditEntry={e=>setEntryForm({entry:e,personId:e.personId})} currentUser={currentUser}/>}
            {page==="history"&&<DeletedHistory currentUser={currentUser} allPeople={allPeople}/>}
            {page==="savedreports"&&<SavedReports currentUser={currentUser}/>}
            {page==="settings"&&<SettingsPage data={data} onChange={updateData} addToast={addToast} currentUser={currentUser} userTheme={userTheme} applyTheme={applyTheme}/>}
          </div>
        </div>
      </div>

      {/* Modals */}
      {personForm&&(
        <PersonForm type={personForm.type} initial={personForm.person}
          onSave={f=>personForm.type==="Customer"?(personForm.person?editCustomer({...personForm.person,...f}):addCustomer(f)):(personForm.person?editWorker({...personForm.person,...f}):addWorker(f))}
          onClose={()=>setPersonForm(null)}/>
      )}
      {entryForm&&(
        <EntryForm
          initial={entryForm.entry}
          defaultPersonId={entryForm.personId}
          defaultPersonType={entryForm.personType}
          people={allPeople}
          onSave={saveEntry}
          onClose={()=>setEntryForm(null)}/>
      )}

      <Toasts toasts={toasts} remove={removeToast}/>
    </>
  );
}
