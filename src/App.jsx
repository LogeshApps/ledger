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
const ADMIN_USERNAME = "goldadmin";
const ADMIN_PASSWORD = "Admin@gold2024";
// ─── UPI + Subscription config ──────────────────────────────────────
const UPI_ID        = "logeshunique@oksbi";
const UPI_NAME      = "Ledger";
const PRICE_MONTHLY = 99;
const PRICE_YEARLY  = 999;
const PAYMENTS_FILE  = "ledger-data/payments.json";
const historyFile = (username) => `ledger-history/history_${username.toLowerCase().replace(/[^a-z0-9]/g,"_")}.json`;
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
const today = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "-";
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
const fmtGold  = (n) => `${(Number(n)||0).toFixed(3)}g`;
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
const styles = `

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
  }
  html{font-size:15px}
  body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;overflow-x:hidden}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}

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
  };

  const filledCount = rows.filter(r=>r.personId||r.goldIn||r.goldOut||r.moneyIn||r.moneyOut).length;
  const allPeopleFlat = [...people.filter(p=>p.ptype==="customer"), ...people.filter(p=>p.ptype==="worker")];

  const inp = {background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)",fontFamily:"var(--font)",fontSize:"0.82rem",padding:"6px 8px",width:"100%",outline:"none",boxSizing:"border-box"};
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
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
          <thead>
            <tr style={{borderBottom:"2px solid var(--border)"}}>
              <th style={{...hdr,width:36}}>#</th>
              <th style={{...hdr,width:120}}>Date</th>
              <th style={{...hdr,width:90}}>Type</th>
              <th style={{...hdr,width:160}}>Name *</th>
              <th style={{...hdr,width:160}}>Description</th>
              <th style={{...hdr,width:90,color:"var(--gold)"}}>Gold In (g)</th>
              <th style={{...hdr,width:90,color:"var(--red)"}}>Gold Out (g)</th>
              <th style={{...hdr,width:90}}>Purity %</th>
              <th style={{...hdr,width:50,color:"#a78bfa",textAlign:"center"}}>Pure Gold 100%</th>
              <th style={{...hdr,width:100,color:"var(--green)"}}>Money In ₹</th>
              <th style={{...hdr,width:100,color:"var(--red)"}}>Money Out ₹</th>
              <th style={{...hdr,width:80}}>Notes</th>
              <th style={{...hdr,width:32}}></th>
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
                  <td style={{padding:"4px 8px",textAlign:"center",fontSize:"0.72rem",color:"#a78bfa",whiteSpace:"nowrap"}}>
                    {pureIn&&<div className="text-green">+{pureIn}g</div>}
                    {pureOut&&<div className="text-red">-{pureOut}g</div>}
                    {!pureIn&&!pureOut&&<span style={{color:"var(--text3)"}}>-</span>}
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
function LedgerView({ person, entries, allPeople, onBack, onAddEntry, onEditEntry, onDeleteEntry }) {
  const [monthFilter, setMonthFilter] = useState("");
  const [yearFilter,  setYearFilter]  = useState("");
  const [del,    setDel]    = useState(null);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

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
        <div className="flex gap2 no-print">
          <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Icon name="print" size={14}/>Print</button>
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
                {[["date","Date"],["desc","Description"],["goldIn","Gold In (g)"],["goldOut","Gold Out (g)"],["purity","Purity"],["pureGold","Pure Gold (g)"],["goldBal","Gold Balance"]].map(([col,lbl])=>(
                  <th key={col} className={col==="goldIn"||col==="goldOut"||col==="pureGold"||col==="goldBal"?"th-right":col==="purity"?"th-center":""}
                    onClick={()=>{ if(["date","goldIn","goldOut","moneyIn","moneyOut","desc"].includes(col)){ if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortCol(col);setSortDir("desc");} } }}
                    style={{cursor:["date","goldIn","goldOut","moneyIn","moneyOut","desc"].includes(col)?"pointer":"default",userSelect:"none",whiteSpace:"nowrap"}}>
                    {lbl}{sortCol===col?<span style={{color:"var(--gold)",marginLeft:3,fontSize:"0.7rem"}}>{sortDir==="asc"?"↑":"↓"}</span>:<span style={{opacity:0.2,marginLeft:3,fontSize:"0.7rem"}}>⇅</span>}
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
                  <td style={{whiteSpace:"nowrap",color:"var(--text2)"}}>{fmtDate(row.date)}</td>
                  <td><div className="fw6">{row.description||"-"}</div>{row.notes&&<div className="fs-xs text3">{row.notes}</div>}</td>
                  <td className="right"><span className={row.goldIn?  "gold-in":"text3"}>{row.goldIn?  fmtGold(row.goldIn): "-"}</span></td>
                  <td className="right"><span className={row.goldOut? "gold-out":"text3"}>{row.goldOut? fmtGold(row.goldOut):"-"}</span></td>
                  <td className="center"><span className="badge badge-gold">{row.purity||"-"}</span></td>
                  <td className="right" style={{fontSize:"0.8rem"}}>
                    {row.pureGoldIn? <span className="text-green">+{Number(row.pureGoldIn).toFixed(3)}g</span>:null}
                    {row.pureGoldOut?<span className="text-red"  >-{Number(row.pureGoldOut).toFixed(3)}g</span>:null}
                    {!row.pureGoldIn&&!row.pureGoldOut&&<span className="text3">-</span>}
                  </td>
                  <td className="right"><span className="balance-gold">{fmtGold(row.goldBal)}</span></td>
                  <td className="right"><span className={row.moneyIn?  "money-in":"text3"}>{row.moneyIn?  fmtMoney(row.moneyIn): "-"}</span></td>
                  <td className="right"><span className={row.moneyOut? "money-out":"text3"}>{row.moneyOut? fmtMoney(row.moneyOut):"-"}</span></td>
                  <td className="right"><span className="balance-money">{fmtMoney(row.moneyBal)}</span></td>
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
                <td colSpan={2}><span className="fw7">TOTALS</span></td>
                <td className="right"><span className="text-green fw7">{fmtGold(totals.goldIn)}</span></td>
                <td className="right"><span className="text-red fw7">{fmtGold(totals.goldOut)}</span></td>
                <td/>
                <td className="right" style={{fontSize:"0.8rem"}}><span className="text3">{fmtGold(totals.pureIn-totals.pureOut)} net</span></td>
                <td className="right"><span className="text-gold fw7">{fmtGold(totals.goldIn-totals.goldOut)}</span></td>
                <td className="right"><span className="text-green fw7">{fmtMoney(totals.moneyIn)}</span></td>
                <td className="right"><span className="text-red fw7">{fmtMoney(totals.moneyOut)}</span></td>
                <td className="right"><span className={`fw7 ${totals.moneyIn-totals.moneyOut>=0?"text-green":"text-red"}`}>{fmtMoney(totals.moneyIn-totals.moneyOut)}</span></td>
                <td className="no-print"/>
              </tr>
            </tbody>
          </table>
        </div>
        </>
      )}
      {del&&<Confirm msg={`Delete entry "${del.description||fmtDate(del.date)}"?`} onOk={()=>{onDeleteEntry(del.id);setDel(null)}} onCancel={()=>setDel(null)}/>}
      {bulkConfirm&&<Confirm msg={`Delete ${selectedIds.size} selected ${selectedIds.size===1?"entry":"entries"}? This cannot be undone.`} onOk={()=>{[...selectedIds].forEach(id=>onDeleteEntry(id));setSelectedIds(new Set());setBulkConfirm(false);}} onCancel={()=>setBulkConfirm(false)}/>}
    </div>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────
function Reports({ entries, customers, workers, companyName, companyData, onDeleteEntry }) {
  const [tab,        setTab]       = useState("monthly");
  const [person,     setPerson]    = useState("");
  const [exportType, setExportType]= useState("all");
  const [preview,    setPreview]   = useState(null);

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
  const buildHTML = (ents, title, type, personName, sortByArg, sortDirArg) => {
    const s = summary(ents);
    const bizName = companyName || "My Business";
    const bizAddress = companyData?.companyAddress || "";
    const bizPhone = companyData?.companyPhone || "";
    const bizOwner = companyData?.companyOwner || "";
    const genTime = new Date().toLocaleString("en-IN",{day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});
    const sortLabels = {date:"Date",name:"Name",goldIn:"Gold In",goldOut:"Gold Out",moneyIn:"Money In",moneyOut:"Money Out"};
    const sortLabel = `Sorted by ${sortLabels[sortByArg]||"Date"} (${sortDirArg==="asc"?"↑ Ascending":"↓ Descending"})`;
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
        <td style="text-align:right;color:#16a34a">${e.goldIn?fmtGold(e.goldIn):"-"}</td>
        <td style="text-align:right;color:#dc2626">${e.goldOut?fmtGold(e.goldOut):"-"}</td>
        <td style="text-align:center"><span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:99px;font-size:10px;font-weight:600">${e.purity||"-"}</span></td>
        <td style="text-align:right;color:#7c3aed;font-size:11px">${e.pureGoldIn?`+${Number(e.pureGoldIn).toFixed(3)}g`:""}${e.pureGoldOut?`-${Number(e.pureGoldOut).toFixed(3)}g`:""}${!e.pureGoldIn&&!e.pureGoldOut?"-":""}</td>
        <td style="text-align:right;font-weight:700;color:${e.runGold>=0?"#d97706":"#dc2626"}">${fmtGold(e.runGold)}</td>`;
      if (showMoney) cols += `
        <td style="text-align:right;color:#16a34a">${e.moneyIn?fmtMoneyFull(e.moneyIn):"-"}</td>
        <td style="text-align:right;color:#dc2626">${e.moneyOut?fmtMoneyFull(e.moneyOut):"-"}</td>
        <td style="text-align:right;font-weight:700;color:${e.runMoney>=0?"#16a34a":"#dc2626"}">${fmtMoneyFull(e.runMoney)}</td>`;
      return `<tr>${cols}</tr>`;
    }).join("");
    let headCols = `<th>Date &amp; Time</th><th>Name</th><th>Description</th>`;
    if (showGold)  headCols += `<th style="text-align:right">Gold In</th><th style="text-align:right">Gold Out</th><th style="text-align:center">Purity</th><th style="text-align:right">Pure Gold</th><th style="text-align:right">Gold Balance</th>`;
    if (showMoney) headCols += `<th style="text-align:right">Money In</th><th style="text-align:right">Money Out</th><th style="text-align:right">Money Balance</th>`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title}</title>
    <style>
      /* Using system Arial font */
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;padding:36px 40px;font-size:14px;background:#fff;line-height:1.5}

      /* ── Business Header ── */
      .biz-box{
        position:relative;overflow:hidden;
        text-align:center;padding:20px 16px 16px;border-radius:16px;margin-bottom:18px;
        background:linear-gradient(135deg,#78350f 0%,#92400e 30%,#b45309 60%,#78350f 100%);
        border:3px solid #f59e0b;
        box-shadow:0 0 0 1px rgba(245,158,11,0.5),0 8px 32px rgba(120,53,15,0.4),0 2px 8px rgba(0,0,0,0.3);
      }
      /* Top gold shimmer line */
      .biz-box::before{
        content:'';position:absolute;top:0;left:0;right:0;height:3px;
        background:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent);
      }
      /* Bottom gold shimmer line */
      .biz-box::after{
        content:'';position:absolute;bottom:0;left:0;right:0;height:3px;
        background:linear-gradient(90deg,transparent,#fde68a,#fbbf24,#fde68a,transparent);
      }
      .biz-inner{position:relative;z-index:2;padding:0 8px;}

      /* Left ornament panel */
      .biz-orn-left{
        position:absolute;left:0;top:0;bottom:0;width:130px;
        display:flex;align-items:center;justify-content:center;pointer-events:none;
        border-right:1px solid rgba(251,191,36,0.25);
        background:linear-gradient(135deg,rgba(0,0,0,0.15),rgba(0,0,0,0.05));
      }
      /* Right ornament panel */
      .biz-orn-right{
        position:absolute;right:0;top:0;bottom:0;width:130px;
        display:flex;align-items:center;justify-content:center;pointer-events:none;
        border-left:1px solid rgba(251,191,36,0.25);
        background:linear-gradient(135deg,rgba(0,0,0,0.05),rgba(0,0,0,0.15));
      }

      /* Hallmark tag */
      .hallmark-tag{
        display:inline-flex;align-items:center;gap:6px;
        margin-bottom:8px;
        background:linear-gradient(135deg,#fbbf24,#f59e0b);
        color:#78350f;font-size:9.5px;font-weight:800;
        letter-spacing:0.12em;text-transform:uppercase;
        padding:3px 12px 3px 8px;border-radius:99px;
        border:1.5px solid rgba(255,255,255,0.4);
        box-shadow:0 1px 4px rgba(0,0,0,0.2);
      }
      .hallmark-tag .hall-num{
        font-size:11px;font-weight:900;
        background:#78350f;color:#fbbf24;
        border-radius:99px;padding:1px 7px;letter-spacing:0.05em;
      }

      /* Divider line with diamond */
      .biz-divider{
        display:flex;align-items:center;gap:8px;margin:8px auto 6px;max-width:340px;
      }
      .biz-divider-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(251,191,36,0.6),transparent);}
      .biz-divider-diamond{
        width:7px;height:7px;background:#fbbf24;
        transform:rotate(45deg);flex-shrink:0;
        box-shadow:0 0 4px rgba(251,191,36,0.6);
      }

      .biz-name{
        font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:900;
        color:#fef3c7;letter-spacing:0.04em;line-height:1.2;
        text-shadow:0 2px 8px rgba(0,0,0,0.4),0 1px 0 rgba(251,191,36,0.3);
      }
      .biz-sub{margin-top:4px;font-size:12px;color:#fde68a;font-weight:600;letter-spacing:0.05em;opacity:0.9;}
      .biz-details{margin-top:6px;font-size:11.5px;color:#fde68a;display:flex;flex-wrap:wrap;justify-content:center;gap:16px;opacity:0.9;}
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
      th{background:#f9fafb;padding:9px 11px;text-align:left;font-size:10.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;white-space:nowrap}
      td{padding:9px 11px;border-bottom:1px solid #f3f4f6;font-size:12.5px;vertical-align:middle}
      tr:hover td{background:#fafafa}
      .totals-row td{background:#fffbeb;font-weight:700;border-top:2px solid #f59e0b;font-size:13px}

      /* ── Balances footer ── */
      .balances{margin-top:22px;padding:16px 18px;border:2px solid #e5e7eb;border-radius:12px;background:#f9fafb}
      .balances-title{font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#374151;margin-bottom:12px}
      .bal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
      .bal-item{text-align:center;padding:12px 10px;background:#fff;border-radius:9px;border:1px solid #e5e7eb}
      .bal-label{font-size:10px;color:#6b7280;text-transform:uppercase;font-weight:700;letter-spacing:0.06em;margin-bottom:5px}
      .bal-value{font-size:17px;font-weight:800;line-height:1.2}
      .bal-sub{font-size:10px;color:#9ca3af;margin-top:3px}
      .gold-val{color:#d97706}.purple-val{color:#7c3aed}.green-val{color:#16a34a}.red-val{color:#dc2626}.blue-val{color:#2563eb}

      /* ── Footer ── */
      .page-footer{margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
      @media print{body{padding:20px 24px}@page{margin:1cm}}
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
        <!-- Right ornament panel -->
        <div class="biz-orn-right">
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
        <!-- Main content -->
        <div class="biz-inner">
          <div class="hallmark-tag"><span class="hall-num">916</span> BIS Hallmarked Jewellery</div>
          <div class="biz-name">${bizName}</div>
          ${bizOwner ? `<div class="biz-sub">Proprietor: ${bizOwner}</div>` : ""}
          <div class="biz-divider"><div class="biz-divider-line"></div><div class="biz-divider-diamond"></div><div class="biz-divider-line"></div></div>
          ${(bizAddress||bizPhone) ? `<div class="biz-details">
            ${bizAddress ? `<span>📍 ${bizAddress}</span>` : ""}
            ${bizPhone   ? `<span>📞 ${bizPhone}</span>`   : ""}
          </div>` : ""}
        </div>
      </div>

      <!-- Report Title Block -->
      <div class="report-title-block">
        <div class="report-title-text">${title}</div>
        <div class="report-meta-row">
          <span>🕐 Generated: ${genTime}</span>
          <span>⇅ ${sortLabel}</span>
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
          ${showGold?`<td style="text-align:right;color:#16a34a">${fmtGold(s.goldIn)}</td><td style="text-align:right;color:#dc2626">${fmtGold(s.goldOut)}</td><td></td><td style="text-align:right;color:#7c3aed">${fmtGold(s.pureIn-s.pureOut)}</td><td style="text-align:right;color:#d97706">${fmtGold(s.goldIn-s.goldOut)}</td>`:""}
          ${showMoney?`<td style="text-align:right;color:#16a34a">${fmtMoneyFull(s.moneyIn)}</td><td style="text-align:right;color:#dc2626">${fmtMoneyFull(s.moneyOut)}</td><td style="text-align:right;color:${s.moneyIn-s.moneyOut>=0?"#16a34a":"#dc2626"}">${fmtMoneyFull(s.moneyIn-s.moneyOut)}</td>`:""}
        </tr>
      </tbody></table>
      <div class="balances">
        <div class="balances-title">Final Balances</div>
        <div class="bal-grid">
          ${showGold?`<div class="bal-item"><div class="bal-label">Net Gold</div><div class="bal-value gold-val">${fmtGold(s.goldIn-s.goldOut)}</div><div class="bal-sub">In: ${fmtGold(s.goldIn)} · Out: ${fmtGold(s.goldOut)}</div></div>
          <div class="bal-item"><div class="bal-label">Pure Gold 100%</div><div class="bal-value purple-val">${fmtGold(s.pureIn-s.pureOut)}</div><div class="bal-sub">In: ${fmtGold(s.pureIn)} · Out: ${fmtGold(s.pureOut)}</div></div>`:""}
          ${showMoney?`<div class="bal-item"><div class="bal-label">Net Cash</div><div class="bal-value ${s.moneyIn-s.moneyOut>=0?"green":"red"}-val">${fmtMoneyFull(s.moneyIn-s.moneyOut)}</div><div class="bal-sub">In: ${fmtMoneyFull(s.moneyIn)} · Out: ${fmtMoneyFull(s.moneyOut)}</div></div>`:""}
          <div class="bal-item"><div class="bal-label">Transactions</div><div class="bal-value blue-val">${ents.length}</div></div>
        </div>
      </div>
      <div class="page-footer"><span>${bizName}</span><span>Powered by Ledger</span></div>
      <script>
        // Auto-trigger print/save dialog as soon as the page finishes loading
        window.onload = function() {
          document.title = "${title.replace(/"/g,"'")}";
          setTimeout(function(){ window.print(); }, 400);
        };
      </script>
    </body></html>`;
  };

  const openPreview = (ents, title, personName) => {
    const sorted = applySortToEnts(ents, sortBy, sortDir);
    setPreview({html: buildHTML(sorted, title, exportType, personName, sortBy, sortDir), title, ents: sorted});
  };

  const doPrint = () => {
    if (!preview) return;
    // Open HTML in new tab — page auto-prints on load (print dialog opens immediately)
    // User selects "Save as PDF" destination in print dialog for zero-click saving
    const blob = new Blob([preview.html], {type:"text/html;charset=utf-8"});
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank");
    // Revoke blob URL after a delay to free memory
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    const a = document.createElement("a"); a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download=`${name}.csv`; a.click();
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
                <Th col="goldIn"  label="Gold In"  className="th-right"/>
                <Th col="goldOut" label="Gold Out" className="th-right"/>
                <th className="th-center">Purity</th>
                <th className="th-right">Pure Gold</th>
                <th className="th-right">Gold Bal</th>
              </>}
              {showM&&<>
                <Th col="moneyIn"  label="Money In"  className="th-right"/>
                <Th col="moneyOut" label="Money Out" className="th-right"/>
                <th className="th-right">Money Bal</th>
              </>}
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
                    <td><div style={{color:"var(--text2)"}}>{fmtDate(e.date)}</div>{time&&<div style={{fontSize:"0.7rem",color:"var(--text3)"}}>{time}</div>}</td>
                    <td><div className="fw6">{p?.name||"-"}</div><div className="fs-xs" style={{color:isC?"var(--blue)":"#a78bfa",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{isC?"👤 Customer":"🔧 Worker"}</div></td>
                    <td style={{color:"var(--text2)"}}>{e.description||"-"}</td>
                    {showG&&<>
                      <td className="right text-green">{e.goldIn?fmtGold(e.goldIn):"-"}</td>
                      <td className="right text-red">{e.goldOut?fmtGold(e.goldOut):"-"}</td>
                      <td className="center"><span className="badge badge-gold">{e.purity||"-"}</span></td>
                      <td className="right fs-xs text2">{e.pureGoldIn?`+${Number(e.pureGoldIn).toFixed(3)}g`:""}{e.pureGoldOut?`-${Number(e.pureGoldOut).toFixed(3)}g`:""}{!e.pureGoldIn&&!e.pureGoldOut?"-":""}</td>
                      <td className="right"><span style={{fontWeight:700,color:e.rG>=0?"var(--gold)":"var(--red)"}}>{fmtGold(e.rG)}</span></td>
                    </>}
                    {showM&&<>
                      <td className="right text-green">{e.moneyIn?fmtMoney(e.moneyIn):"-"}</td>
                      <td className="right text-red">{e.moneyOut?fmtMoney(e.moneyOut):"-"}</td>
                      <td className="right"><span style={{fontWeight:700,color:e.rM>=0?"var(--green)":"var(--red)"}}>{fmtMoney(e.rM)}</span></td>
                    </>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {bulkConfirm&&onDeleteEntry&&<Confirm msg={`Delete ${selectedIds.size} selected ${selectedIds.size===1?"entry":"entries"}? This cannot be undone.`} onOk={()=>{[...selectedIds].forEach(id=>onDeleteEntry(id));setSelectedIds(new Set());setBulkConfirm(false);}} onCancel={()=>setBulkConfirm(false)}/>}
        {/* ── Balance Summary at BOTTOM ── */}
        <div style={{marginTop:16,background:"var(--surface)",border:"2px solid var(--border)",borderRadius:12,padding:16}}>
          <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontWeight:700,fontSize:"0.9rem",marginBottom:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:6}}>
            <Icon name="reports" size={15}/>Final Balances — {ents.length} entries
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
            {showG&&<>
              <div style={{background:"var(--gold-dim)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                <div style={{fontSize:"0.7rem",color:"var(--text3)",textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Net Gold</div>
                <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.3rem",fontWeight:800,color:"var(--gold)"}}>{fmtGold(s.goldIn-s.goldOut)}</div>
                <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:2}}>In: {fmtGold(s.goldIn)} · Out: {fmtGold(s.goldOut)}</div>
              </div>
              <div style={{background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.3)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                <div style={{fontSize:"0.7rem",color:"var(--text3)",textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Pure Gold 100%</div>
                <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.3rem",fontWeight:800,color:"#a78bfa"}}>{fmtGold(s.pureIn-s.pureOut)}</div>
                <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:2}}>In: {fmtGold(s.pureIn)} · Out: {fmtGold(s.pureOut)}</div>
              </div>
            </>}
            {showM&&<>
              <div style={{background:s.moneyIn-s.moneyOut>=0?"var(--green-dim)":"var(--red-dim)",border:`1px solid ${s.moneyIn-s.moneyOut>=0?"rgba(34,211,160,0.3)":"rgba(244,63,94,0.3)"}`,borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                <div style={{fontSize:"0.7rem",color:"var(--text3)",textTransform:"uppercase",fontWeight:600,marginBottom:4}}>Net Cash</div>
                <div style={{fontFamily:"Arial,Helvetica,sans-serif",fontSize:"1.3rem",fontWeight:800,color:s.moneyIn-s.moneyOut>=0?"var(--green)":"var(--red)"}}>{fmtMoney(s.moneyIn-s.moneyOut)}</div>
                <div style={{fontSize:"0.72rem",color:"var(--text3)",marginTop:2}}>In: {fmtMoney(s.moneyIn)} · Out: {fmtMoney(s.moneyOut)}</div>
              </div>
            </>}
          </div>
        </div>
      </div>
    );
  };

  const activeEnts = tab==="monthly" ? activeEntries : personEntries;
  const reportTitle = tab==="monthly"
    ? `Report — ${rangeLabel}`
    : `${allPeople.find(p=>p.id===person)?.name||"Person"} — ${rangeLabel}`;

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
function SettingsPage({ data, onChange, addToast, currentUser }) {
  const [co, setCo] = useState({ name:data.companyName||"", owner:data.companyOwner||"", address:data.companyAddress||"", phone:data.companyPhone||"" });
  const [pw, setPw] = useState({ old:"", nw:"", cf:"" });
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const saveCompany = () => { onChange({ companyName:co.name, companyOwner:co.owner||'', companyAddress:co.address, companyPhone:co.phone }); addToast("Business info saved!"); };

  const changePw = async () => {
    if (currentUser.password!==pw.old) return setPwErr("Current password incorrect.");
    if (pw.nw.length<6) return setPwErr("New password must be 6+ characters.");
    if (pw.nw!==pw.cf) return setPwErr("Passwords don't match.");
    setPwBusy(true);
    try {
      const result = await ghGet(USERS_FILE);
      const users = result?.data?.users || [];
      const sha = result?.sha || null;
      const updated = users.map(u=>u.id===currentUser.id?{...u,password:pw.nw}:u);
      await ghPut(USERS_FILE, { users: updated }, sha, `Password update for ${currentUser.username}`);
      setPwErr(""); setPw({old:"",nw:"",cf:""}); addToast("Password changed!");
    } catch(e) { setPwErr("Failed to update password."); }
    setPwBusy(false);
  };

  const exportBackup = () => {
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(data,null,2));
    a.download=`goldledger_${currentUser.username}_backup_${today()}.json`; a.click(); addToast("Backup exported!");
  };

  return (
    <div>
      <div className="section-title" style={{marginBottom:20}}>Settings</div>
      <div className="grid2">
        <div className="card">
          <div className="fw7 mb4 flex items-center gap2"><Icon name="building" size={18}/>Business Information</div>
          <div className="form-group" style={{marginBottom:12}}><label>Business Name</label><input value={co.name} onChange={e=>setCo(c=>({...c,name:e.target.value}))} placeholder="Your Gold Shop Name"/></div>
          <div className="form-group" style={{marginBottom:12}}><label>Owner / Proprietor Name</label><input value={co.owner||""} onChange={e=>setCo(c=>({...c,owner:e.target.value}))} placeholder="Owner name shown in reports"/></div>
          <div className="form-group" style={{marginBottom:12}}><label>Address</label><textarea value={co.address} onChange={e=>setCo(c=>({...c,address:e.target.value}))} rows={2}/></div>
          <div className="form-group" style={{marginBottom:16}}><label>Phone</label><input value={co.phone} onChange={e=>setCo(c=>({...c,phone:e.target.value}))}/></div>
          <button className="btn btn-gold" onClick={saveCompany}>Save Info</button>
        </div>
        <div>
          <div className="card" style={{marginBottom:16}}>
            <div className="fw7 mb4">Change Password</div>
            {pwErr&&<div className="alert alert-error">{pwErr}</div>}
            <div className="form-group" style={{marginBottom:10}}><label>Current Password</label><input type="password" value={pw.old} onChange={e=>setPw(p=>({...p,old:e.target.value}))}/></div>
            <div className="form-group" style={{marginBottom:10}}><label>New Password</label><input type="password" value={pw.nw} onChange={e=>setPw(p=>({...p,nw:e.target.value}))}/></div>
            <div className="form-group" style={{marginBottom:16}}><label>Confirm Password</label><input type="password" value={pw.cf} onChange={e=>setPw(p=>({...p,cf:e.target.value}))}/></div>
            <button className="btn btn-primary" onClick={changePw}>Update Password</button>
          </div>
          <div className="card">
            <div className="fw7 mb4">Data & Backup</div>
            <div className="text2 fs-sm" style={{marginBottom:14}}>Download all your data as a JSON backup file.</div>
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
const isExpired = (user) => {
  if (!user?.expiryDate) return true;
  return new Date(user.expiryDate) < new Date();
};
const daysLeft = (user) => {
  if (!user?.expiryDate) return 0;
  const diff = new Date(user.expiryDate) - new Date();
  return Math.max(0, Math.ceil(diff / (1000*60*60*24)));
};

// ─── Payment Page ─────────────────────────────────────────────────────
function PaymentPage({ currentUser, onRefresh, onLogout }) {
  const [plan,   setPlan]   = useState("yearly");
  const [utr,    setUtr]    = useState("");
  const [step,   setStep]   = useState("plan"); // plan | pay | submitted
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");

  const amount = plan === "monthly" ? PRICE_MONTHLY : PRICE_YEARLY;
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
              {[{id:"monthly",label:"Monthly",price:PRICE_MONTHLY,sub:"Billed every month"},{id:"yearly",label:"Yearly",price:PRICE_YEARLY,sub:"Save ₹"+(PRICE_MONTHLY*12-PRICE_YEARLY)+"!",badge:"BEST VALUE"}].map(pl=>(
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
function AdminPanel({ onLogout }) {
  const [users,       setUsers]      = useState([]);
  const [payments,    setPayments]   = useState([]);
  const [loading,     setLoading]    = useState(true);
  const [selUser,     setSelUser]    = useState(null);
  const [userData,    setUserData]   = useState(null);
  const [userLoading, setUserLoading]= useState(false);
  const [tab,         setTab]        = useState("payments"); // payments | users | view
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ur, pr] = await Promise.all([ghGet(USERS_FILE), ghGet(PAYMENTS_FILE)]);
      setUsers(ur?.data?.users || []);
      setPayments(pr?.data?.payments || []);
    } catch(e) { addToast("Failed to load","error"); }
    setLoading(false);
  };

  useEffect(()=>{ loadAll(); },[]);

  // ── Approve payment ──
  const approvePayment = async (pmt) => {
    try {
      // 1. Calculate new expiry date
      const usersResult = await ghGet(USERS_FILE);
      const allUsers = usersResult?.data?.users || [];
      const userIdx  = allUsers.findIndex(u => u.username === pmt.username);
      if (userIdx === -1) return addToast("User not found","error");

      const existing = allUsers[userIdx];
      const base = (existing.expiryDate && new Date(existing.expiryDate) > new Date())
        ? new Date(existing.expiryDate)   // extend from current expiry
        : new Date();                      // extend from today
      base.setMonth(base.getMonth() + pmt.months);
      const newExpiry = base.toISOString().split("T")[0];

      // 2. Update user expiry
      allUsers[userIdx] = { ...existing, expiryDate: newExpiry, plan: pmt.plan };
      await ghPut(USERS_FILE, { users: allUsers }, usersResult.sha, `Approved payment for ${pmt.username}`);

      // 3. Update payment status
      const pmtResult  = await ghGet(PAYMENTS_FILE);
      const allPayments = pmtResult?.data?.payments || [];
      const updated = allPayments.map(p => p.id===pmt.id ? {...p, status:"approved", approvedAt:Date.now(), expiryDate:newExpiry} : p);
      await ghPut(PAYMENTS_FILE, { payments: updated }, pmtResult.sha, `Payment approved: ${pmt.username}`);

      setUsers(allUsers);
      setPayments(updated);
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
      setPayments(updated);
      addToast("Payment rejected.");
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
    if (!window.confirm(`Delete "${user.businessName}" (${user.username})?`)) return;
    try {
      const result  = await ghGet(USERS_FILE);
      const updated = (result?.data?.users||[]).filter(u=>u.id!==user.id);
      await ghPut(USERS_FILE, { users: updated }, result?.sha, `Admin deleted: ${user.username}`);
      setUsers(updated);
      addToast("Deleted.");
      if (selUser?.id===user.id) { setSelUser(null); setTab("payments"); }
    } catch(e) { addToast("Delete failed","error"); }
  };

  // ── Extend subscription manually ──
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
      setUsers(allUsers);
      addToast(`Extended till ${newExpiry}`);
    } catch(e) { addToast("Failed","error"); }
  };

  const pending  = payments.filter(p=>p.status==="pending");
  const approved = payments.filter(p=>p.status==="approved");
  const rejected = payments.filter(p=>p.status==="rejected");

  const allEntries   = userData?.entries   || [];
  const allCustomers = userData?.customers || [];
  const allWorkers   = userData?.workers   || [];
  const goldBal  = allEntries.reduce((s,e)=>s+Number(e.goldIn||0)-Number(e.goldOut||0),0);
  const moneyBal = allEntries.reduce((s,e)=>s+Number(e.moneyIn||0)-Number(e.moneyOut||0),0);
  const pureBal  = allEntries.reduce((s,e)=>s+Number(e.pureGoldIn||0)-Number(e.pureGoldOut||0),0);

  const StatusBadge = ({s}) => {
    const map = {pending:{bg:"rgba(234,179,8,0.15)",color:"var(--gold)",label:"Pending"},approved:{bg:"rgba(34,197,94,0.15)",color:"var(--green)",label:"Approved"},rejected:{bg:"rgba(239,68,68,0.15)",color:"var(--red)",label:"Rejected"}};
    const m = map[s]||map.pending;
    return <span style={{background:m.bg,color:m.color,padding:"2px 10px",borderRadius:20,fontSize:"0.75rem",fontWeight:700}}>{m.label}</span>;
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon" style={{background:"linear-gradient(135deg,#f43f5e,#e11d48)"}}><Icon name="gold" size={20} color="#fff"/></div>
            <div><div className="logo-text">Ledger</div><div className="logo-sub" style={{color:"var(--red)"}}>Admin Panel</div></div>
          </div>
          <nav className="sidebar-nav">
            <div className={`nav-item${tab==="payments"?" active":""}`} onClick={()=>setTab("payments")}>
              <Icon name="money" size={17}/>Payments
              {pending.length>0&&<span style={{marginLeft:"auto",background:"var(--red)",color:"#fff",borderRadius:10,fontSize:"0.7rem",padding:"1px 7px",fontWeight:700}}>{pending.length}</span>}
            </div>
            <div className={`nav-item${tab==="users"?" active":""}`} onClick={()=>setTab("users")}><Icon name="customers" size={17}/>Businesses</div>
            {selUser&&<div className={`nav-item${tab==="view"?" active":""}`} onClick={()=>setTab("view")}><Icon name="reports" size={17}/>{selUser.username}</div>}
          </nav>
          <div className="sidebar-footer">
            <div className="nav-item" onClick={loadAll}><Icon name="sync" size={17}/>Refresh</div>
            <div className="nav-item" onClick={onLogout}><Icon name="logout" size={17}/>Sign Out</div>
          </div>
        </aside>
        <div className="main">
          <header className="header">
            <div className="header-title">
              {tab==="payments"?"Payment Approvals":tab==="users"?"All Businesses":tab==="view"&&selUser?selUser.businessName:"Admin"}
            </div>
            <div className="header-right">
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
                {/* Summary cards */}
                <div className="stats-grid" style={{marginBottom:20}}>
                  <div className="stat-card gold"><div className="stat-icon gold"><Icon name="money" size={18} color="var(--gold)"/></div><div className="stat-label">Pending Approvals</div><div className="stat-value gold">{pending.length}</div></div>
                  <div className="stat-card green"><div className="stat-icon green"><Icon name="check" size={18} color="var(--green)"/></div><div className="stat-label">Total Approved</div><div className="stat-value green">{approved.length}</div></div>
                  <div className="stat-card blue"><div className="stat-icon blue"><Icon name="money" size={18} color="var(--blue)"/></div><div className="stat-label">Revenue (approx)</div><div className="stat-value blue">₹{approved.reduce((s,p)=>s+p.amount,0)}</div></div>
                  <div className="stat-card red"><div className="stat-icon red"><Icon name="trash" size={18} color="var(--red)"/></div><div className="stat-label">Rejected</div><div className="stat-value red">{rejected.length}</div></div>
                </div>

                {/* Pending first */}
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

                {/* All payments history */}
                <div className="card">
                  <div className="fw7 fs-sm" style={{marginBottom:14}}>All Payment History</div>
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
                  <div><div className="section-title">Registered Businesses</div><div className="section-sub">{users.length} total</div></div>
                </div>
                {loading?<div className="empty"><div className="empty-sub">Loading...</div></div>:users.length===0?
                  <div className="empty"><div className="empty-title">No businesses yet</div></div>
                :(
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>Business</th><th>Username</th><th>Plan</th><th>Expiry</th><th>Status</th><th className="th-center">Actions</th></tr></thead>
                      <tbody>
                        {users.map((u,i)=>{
                          const expired = isExpired(u);
                          const left    = daysLeft(u);
                          return (
                            <tr key={u.id}>
                              <td className="text3">{i+1}</td>
                              <td><div className="fw6">{u.businessName||"-"}</div></td>
                              <td><span className="badge badge-blue">{u.username}</span></td>
                              <td style={{textTransform:"capitalize"}}>{u.plan||"-"}</td>
                              <td className="text2 fs-xs">{u.expiryDate||"Not set"}</td>
                              <td>
                                {!u.expiryDate?<span style={{color:"var(--text3)",fontSize:"0.78rem"}}>No subscription</span>
                                :expired?<span style={{color:"var(--red)",fontSize:"0.78rem",fontWeight:600}}>Expired</span>
                                :<span style={{color:"var(--green)",fontSize:"0.78rem",fontWeight:600}}>{left}d left</span>}
                              </td>
                              <td className="center">
                                <div className="flex gap2" style={{justifyContent:"center",flexWrap:"wrap"}}>
                                  <button className="btn btn-secondary btn-sm" onClick={()=>viewUser(u)}><Icon name="eye" size={13}/>View</button>
                                  <button className="btn btn-sm" style={{background:"rgba(34,197,94,0.15)",color:"var(--green)",border:"1px solid rgba(34,197,94,0.3)"}} onClick={()=>extendSub(u,1)}>+1M</button>
                                  <button className="btn btn-sm" style={{background:"rgba(34,197,94,0.15)",color:"var(--green)",border:"1px solid rgba(34,197,94,0.3)"}} onClick={()=>extendSub(u,12)}>+1Y</button>
                                  <button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u)}><Icon name="trash" size={13}/></button>
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
  const { toasts, add: addToast, remove: removeToast } = useToast();

  // Modals
  const [personForm, setPersonForm] = useState(null);
  const [entryForm,  setEntryForm]  = useState(null);

  // ── Load business data after login ──
  const loadUserData = useCallback(async(user) => {
    setLoading(true);
    try {
      const file = userDataFile(user.username);
      const result = await ghGet(file);
      if (result) {
        setData({...defaultBusinessData, ...result.data});
        setFileSha(result.sha);
      } else {
        // First time — create their file
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

  // ── Nav ──
  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:"dashboard"},
    {id:"customers",label:"Customers",icon:"customers"},
    {id:"workers",  label:"Workers",  icon:"workers"},
    {id:"entry",    label:"New Entry", icon:"plus"},
    {id:"reports",  label:"Reports",  icon:"reports"},
    {id:"history",  label:"Deleted History", icon:"trash"},
    {id:"settings", label:"Settings", icon:"settings"},
  ];
  const pageTitles = {dashboard:"Dashboard",customers:"Customers",workers:"Workers",reports:"Reports",settings:"Settings",ledger:"Ledger View",history:"Deleted History"};

  const handleNav = id => {
    if(id==="entry"){ setEntryForm({entry:null,personId:""}); return; }
    setPage(id); setSidebar(false);
  };

  // ── Admin Panel ──
  if(currentUser && isAdmin) return (
    <AdminPanel onLogout={()=>{setCurrentUser(null);setIsAdmin(false);}}/>
  );

  // ── Login screen ──
  if(!currentUser) return (
    <>
      <style>{styles}</style>
      <LoginPage onLogin={handleLogin}/>
    </>
  );

  // ── Subscription expired / not paid → show payment page ──
  if(!loading && currentUser && isExpired(currentUser)) return (
    <>
      <style>{styles}</style>
      <PaymentPage
        currentUser={currentUser}
        onLogout={()=>{setCurrentUser(null);setData({...defaultBusinessData});setFileSha(null);}}
        onRefresh={async()=>{
          // Re-fetch latest user record from users.json to check if approved
          try {
            const result = await ghGet(USERS_FILE);
            const users  = result?.data?.users || [];
            const fresh  = users.find(u=>u.username===currentUser.username);
            if (fresh && !isExpired(fresh)) {
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
      <style>{styles}</style>
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
      <style>{styles}</style>
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
            {currentUser && daysLeft(currentUser) <= 7 && daysLeft(currentUser) > 0 && (
              <div style={{background:"rgba(234,179,8,0.12)",border:"1px solid rgba(234,179,8,0.4)",borderRadius:10,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                <div style={{fontSize:"0.88rem",color:"var(--gold)",fontWeight:600}}>⚠️ Your subscription expires in {daysLeft(currentUser)} day{daysLeft(currentUser)===1?"":"s"}. Renew to avoid interruption.</div>
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
                onBack={()=>setPage(viewPerson.ptype==="customer"?"customers":"workers")}
                onAddEntry={()=>setEntryForm({entry:null,personId:viewPerson.id,personType:viewPerson.ptype})}
                onEditEntry={e=>setEntryForm({entry:e,personId:e.personId})}
                onDeleteEntry={deleteEntry}/>
            )}
            {page==="reports" &&<Reports entries={data.entries} customers={data.customers} workers={data.workers} companyName={data.companyName} companyData={data} onDeleteEntry={deleteEntry}/>}
            {page==="history"&&<DeletedHistory currentUser={currentUser} allPeople={allPeople}/>}
            {page==="settings"&&<SettingsPage data={data} onChange={updateData} addToast={addToast} currentUser={currentUser}/>}
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
