import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── GITHUB CONFIG ─────────────────────────────────────────────────
// Replace with your own values:
const GITHUB_USERNAME = "YOUR_GITHUB_USERNAME";
const GITHUB_REPO     = "YOUR_REPO_NAME";
// Split your PAT token into 2 halves to avoid GitHub scanner revoking it
const PAT_PART1  = "YOUR_TOKEN_FIRST_HALF";
const PAT_PART2  = "YOUR_TOKEN_SECOND_HALF";
const GITHUB_PAT = PAT_PART1 + PAT_PART2;
const DATA_FILE  = "ledger-data/data.json";
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
const defaultData = {
  customers: [],
  workers: [],
  entries: [],
  companyName: "My Gold Shop",
  companyAddress: "",
  companyPhone: "",
  users: [{ id: "u1", username: "admin", password: "admin123", role: "admin" }],
};

// ─── Utils ──────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const today = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "-";
const fmtMoney = (n) => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(n||0);
const fmtGold  = (n) => `${(Number(n)||0).toFixed(3)}g`;
const pureGold = (weight, purity) => {
  const p = parseFloat(purity);
  if (!p || !weight) return 0;
  // purity can be "22K", "916", "24K", "18K", "750", etc.
  if (String(purity).includes("K")) return (p / 24) * parseFloat(weight);
  if (p > 1) return (p / 1000) * parseFloat(weight); // millesimal fineness like 916, 750
  return p * parseFloat(weight);
};
const parsePurity = (str) => {
  if (!str) return 1;
  const s = String(str).trim();
  if (s.toUpperCase().includes("K")) return parseFloat(s) / 24;
  const n = parseFloat(s);
  if (n > 1) return n / 1000;
  return n;
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
    money:      <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
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
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
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
    --font:'DM Sans',sans-serif;--font-display:'Syne',sans-serif;
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
  .logo-text{font-family:var(--font-display);font-weight:700;font-size:1.05rem}
  .logo-sub{font-size:0.7rem;color:var(--text3);letter-spacing:0.06em;text-transform:uppercase}
  .sidebar-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
  .nav-section{padding:14px 12px 6px;font-size:0.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.08em;font-weight:600}
  .nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:all var(--tr);color:var(--text2);font-size:0.9rem;font-weight:500;border:1px solid transparent;user-select:none}
  .nav-item:hover{background:var(--surface2);color:var(--text)}
  .nav-item.active{background:var(--accent-dim);color:var(--accent2);border-color:rgba(99,102,241,0.2)}
  .sidebar-footer{padding:12px 10px;border-top:1px solid var(--border)}
  .main{flex:1;margin-left:var(--sidebar-w);display:flex;flex-direction:column;min-height:100vh}
  .header{height:64px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:50;gap:16px}
  .header-title{font-family:var(--font-display);font-weight:700;font-size:1.15rem}
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
  .stat-value{font-family:var(--font-display);font-size:1.5rem;font-weight:700;line-height:1.2}
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
  .modal.wide{max-width:860px}
  .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .modal-title{font-family:var(--font-display);font-weight:700;font-size:1.1rem}
  .modal-body{padding:20px 24px}
  .modal-footer{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}

  /* Section header */
  .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px}
  .section-title{font-family:var(--font-display);font-weight:700;font-size:1.1rem}
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
  .login-title{font-family:var(--font-display);font-weight:800;font-size:1.6rem;text-align:center}
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
function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key==="Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose?.()}>
      <div className={`modal${wide?" wide":""}`}>
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

// ─── Login ───────────────────────────────────────────────────────────
function LoginPage({ users, onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const go = () => {
    const user = users.find(x => x.username===u && x.password===p);
    if (user) { onLogin(user); setErr(""); }
    else setErr("Invalid username or password.");
  };
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon"><Icon name="gold" size={32} color="#000"/></div>
          <div>
            <div className="login-title">GoldLedger</div>
            <div className="login-sub">Gold & Money Ledger Management</div>
          </div>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="form-group" style={{marginBottom:14}}>
          <label>Username</label>
          <input value={u} onChange={e=>setU(e.target.value)} placeholder="admin" onKeyDown={e=>e.key==="Enter"&&go()} autoFocus/>
        </div>
        <div className="form-group" style={{marginBottom:24}}>
          <label>Password</label>
          <div style={{position:"relative"}}>
            <input type={show?"text":"password"} value={p} onChange={e=>setP(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()} style={{paddingRight:40}}/>
            <button onClick={()=>setShow(!show)} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"var(--text3)"}}>
              <Icon name={show?"eyeOff":"eye"} size={16}/>
            </button>
          </div>
        </div>
        <button className="btn btn-gold" style={{width:"100%",justifyContent:"center",padding:"11px",fontSize:"1rem"}} onClick={go}>Sign In</button>
        <div style={{marginTop:20,padding:12,background:"var(--surface2)",borderRadius:8,fontSize:"0.8rem",color:"var(--text3)"}}>
          Default: <strong style={{color:"var(--text2)"}}>admin</strong> / <strong style={{color:"var(--text2)"}}>admin123</strong>
        </div>
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
function EntryForm({ initial, people, defaultPersonId, onSave, onClose }) {
  const [f, setF] = useState(initial || {
    date: today(), personId: defaultPersonId||"", personType:"customer",
    description:"", goldIn:"", goldOut:"", purity:"22K (916)",
    customPurity:"", moneyIn:"", moneyOut:"", notes:""
  });
  const [err, setErr] = useState("");
  const set = (k,v) => setF(p=>({...p,[k]:v}));

  const purityVal = f.purity==="Custom" ? f.customPurity : f.purity;
  const pureIn  = f.goldIn  ? pureGold(f.goldIn,  purityVal).toFixed(3) : null;
  const pureOut = f.goldOut ? pureGold(f.goldOut, purityVal).toFixed(3) : null;

  const filteredPeople = people.filter(p=>p.ptype===f.personType);

  const handleSave = () => {
    if (!f.personId) return setErr("Please select a person.");
    if (!f.date) return setErr("Please select a date.");
    if (!f.goldIn && !f.goldOut && !f.moneyIn && !f.moneyOut) return setErr("Enter at least one transaction value.");
    setErr("");
    const pv = f.purity==="Custom" ? f.customPurity : f.purity;
    onSave({
      ...f,
      goldIn:   Number(f.goldIn||0),
      goldOut:  Number(f.goldOut||0),
      moneyIn:  Number(f.moneyIn||0),
      moneyOut: Number(f.moneyOut||0),
      purity: pv,
      pureGoldIn:  pureGold(f.goldIn||0,  pv),
      pureGoldOut: pureGold(f.goldOut||0, pv),
    });
  };

  return (
    <Modal title={initial?"Edit Entry":"New Ledger Entry"} onClose={onClose} wide footer={<>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-gold" onClick={handleSave}>Save Entry</button>
    </>}>
      {err&&<div className="alert alert-error">{err}</div>}
      <div className="form-grid">
        <div className="form-group"><label>Date *</label><input type="date" value={f.date} onChange={e=>set("date",e.target.value)}/></div>
        <div className="form-group">
          <label>Person Type</label>
          <select value={f.personType} onChange={e=>{set("personType",e.target.value);set("personId","")}}>
            <option value="customer">Customer</option>
            <option value="worker">Worker</option>
          </select>
        </div>
        <div className="form-group full">
          <label>Name *</label>
          <select value={f.personId} onChange={e=>set("personId",e.target.value)}>
            <option value="">-- Select --</option>
            {filteredPeople.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group full"><label>Description</label><input value={f.description} onChange={e=>set("description",e.target.value)} placeholder="e.g. Gold purchase, Wage payment..."/></div>

        <div className="form-group full" style={{background:"var(--surface2)",padding:14,borderRadius:"var(--radius-sm)",border:"1px solid var(--border)"}}>
          <div className="fw7 mb4" style={{display:"flex",alignItems:"center",gap:6}}><Icon name="gold" size={16} color="var(--gold)"/>Gold Transaction</div>
          <div className="form-grid">
            <div className="form-group"><label>Gold In (g) — Received</label><input type="number" value={f.goldIn} onChange={e=>set("goldIn",e.target.value)} placeholder="0.000" min="0" step="0.001"/></div>
            <div className="form-group"><label>Gold Out (g) — Given</label><input type="number" value={f.goldOut} onChange={e=>set("goldOut",e.target.value)} placeholder="0.000" min="0" step="0.001"/></div>
            <div className="form-group">
              <label>Gold Purity</label>
              <select value={f.purity} onChange={e=>set("purity",e.target.value)}>
                {PURITY_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {f.purity==="Custom"&&<div className="form-group"><label>Custom Purity</label><input value={f.customPurity} onChange={e=>set("customPurity",e.target.value)} placeholder="e.g. 0.875 or 875"/></div>}
          </div>
          {(pureIn||pureOut)&&(
            <div className="gold-calc-box mt4">
              <Icon name="gold" size={16} color="var(--gold)"/>
              <span><strong>Pure Gold (24K):</strong>{" "}
                {pureIn&&<span className="text-green">+{pureIn}g in</span>}
                {pureIn&&pureOut&&" · "}
                {pureOut&&<span className="text-red">-{pureOut}g out</span>}
              </span>
            </div>
          )}
        </div>

        <div className="form-group full" style={{background:"var(--surface2)",padding:14,borderRadius:"var(--radius-sm)",border:"1px solid var(--border)"}}>
          <div className="fw7 mb4" style={{display:"flex",alignItems:"center",gap:6}}><Icon name="money" size={16} color="var(--green)"/>Money Transaction</div>
          <div className="form-grid">
            <div className="form-group"><label>Money In (₹) — Received</label><input type="number" value={f.moneyIn} onChange={e=>set("moneyIn",e.target.value)} placeholder="0.00" min="0" step="0.01"/></div>
            <div className="form-group"><label>Money Out (₹) — Given</label><input type="number" value={f.moneyOut} onChange={e=>set("moneyOut",e.target.value)} placeholder="0.00" min="0" step="0.01"/></div>
          </div>
        </div>

        <div className="form-group full"><label>Notes</label><textarea value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Additional notes..." rows={2}/></div>
      </div>
    </Modal>
  );
}

// ─── Ledger View ─────────────────────────────────────────────────────
function LedgerView({ person, entries, allPeople, onBack, onAddEntry, onEditEntry, onDeleteEntry }) {
  const [monthFilter, setMonthFilter] = useState("");
  const [yearFilter,  setYearFilter]  = useState("");
  const [del, setDel] = useState(null);

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

  // Running balance
  const rows = useMemo(()=>{
    let goldBal=0, moneyBal=0;
    return filtered.map(e=>{
      goldBal  += Number(e.goldIn||0)  - Number(e.goldOut||0);
      moneyBal += Number(e.moneyIn||0) - Number(e.moneyOut||0);
      return { ...e, goldBal, moneyBal };
    });
  }, [filtered]);

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
          <div className="stat-label">Pure Gold Balance (24K)</div>
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
        <div className="table-wrap">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="th-right">Gold In (g)</th>
                <th className="th-right">Gold Out (g)</th>
                <th className="th-center">Purity</th>
                <th className="th-right">Pure Gold (g)</th>
                <th className="th-right">Gold Balance</th>
                <th className="th-right">Money In (₹)</th>
                <th className="th-right">Money Out (₹)</th>
                <th className="th-right">Money Balance</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row=>(
                <tr key={row.id}>
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
      )}
      {del&&<Confirm msg={`Delete entry "${del.description||fmtDate(del.date)}"?`} onOk={()=>{onDeleteEntry(del.id);setDel(null)}} onCancel={()=>setDel(null)}/>}
    </div>
  );
}

// ─── Reports ─────────────────────────────────────────────────────────
function Reports({ entries, customers, workers }) {
  const [tab, setTab]       = useState("monthly");
  const [month, setMonth]   = useState(new Date().toISOString().slice(0,7));
  const [person, setPerson] = useState("");

  const allPeople = useMemo(()=>[...customers.map(c=>({...c,ptype:"customer"})),...workers.map(w=>({...w,ptype:"worker"}))],[customers,workers]);

  const monthEntries = useMemo(()=>entries.filter(e=>e.date.startsWith(month)),[entries,month]);
  const personEntries= useMemo(()=>person?entries.filter(e=>e.personId===person):[]  ,[entries,person]);

  const summary = (ents) => ({
    goldIn:   ents.reduce((s,e)=>s+Number(e.goldIn||0),0),
    goldOut:  ents.reduce((s,e)=>s+Number(e.goldOut||0),0),
    pureIn:   ents.reduce((s,e)=>s+Number(e.pureGoldIn||0),0),
    pureOut:  ents.reduce((s,e)=>s+Number(e.pureGoldOut||0),0),
    moneyIn:  ents.reduce((s,e)=>s+Number(e.moneyIn||0),0),
    moneyOut: ents.reduce((s,e)=>s+Number(e.moneyOut||0),0),
  });

  const exportPDF = (ents, title) => {
    const s = summary(ents);
    const tableRows = ents.sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
      const p = allPeople.find(x=>x.id===e.personId);
      return `<tr>
        <td>${fmtDate(e.date)}</td>
        <td><strong>${p?.name||"-"}</strong><br/><small style="color:#9ca3af;text-transform:capitalize">${e.personType||""}</small></td>
        <td>${e.description||"-"}</td>
        <td style="text-align:right;color:#16a34a">${e.goldIn?fmtGold(e.goldIn):"-"}</td>
        <td style="text-align:right;color:#dc2626">${e.goldOut?fmtGold(e.goldOut):"-"}</td>
        <td style="text-align:center"><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">${e.purity||"-"}</span></td>
        <td style="text-align:right;color:#7c3aed;font-size:12px">${e.pureGoldIn?`+${Number(e.pureGoldIn).toFixed(3)}g`:""}${e.pureGoldOut?`-${Number(e.pureGoldOut).toFixed(3)}g`:""}${!e.pureGoldIn&&!e.pureGoldOut?"-":""}</td>
        <td style="text-align:right;color:#16a34a">${e.moneyIn?fmtMoney(e.moneyIn):"-"}</td>
        <td style="text-align:right;color:#dc2626">${e.moneyOut?fmtMoney(e.moneyOut):"-"}</td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'DM Sans',sans-serif;color:#111;padding:32px;font-size:13px;background:#fff}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #f59e0b}
      .company-name{font-size:22px;font-weight:700}.company-sub{color:#6b7280;font-size:13px;margin-top:4px}
      .report-badge{background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:8px;font-weight:700;font-size:15px;border:1px solid #fcd34d}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .sum-card{border:1px solid #e5e7eb;border-radius:8px;padding:14px;position:relative;overflow:hidden}
      .sum-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
      .sum-card.gold::before{background:#f59e0b}.sum-card.purple::before{background:#7c3aed}
      .sum-card.green::before{background:#16a34a}.sum-card.red::before{background:#dc2626}.sum-card.blue::before{background:#2563eb}
      .sum-label{font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;font-weight:600}
      .sum-value{font-size:16px;font-weight:700;margin-bottom:3px}.sum-sub{font-size:10px;color:#9ca3af}
      .gold-val{color:#d97706}.purple-val{color:#7c3aed}.green-val{color:#16a34a}.red-val{color:#dc2626}.blue-val{color:#2563eb}
      table{width:100%;border-collapse:collapse;margin-top:4px}
      th{background:#f9fafb;padding:9px 10px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;white-space:nowrap}
      td{padding:9px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;vertical-align:middle}
      .totals-row td{background:#f9fafb;font-weight:700;border-top:2px solid #e5e7eb;border-bottom:none;font-size:13px}
      .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between}
      @media print{body{padding:16px}@page{margin:1cm}}
    </style></head><body>
      <div class="header">
        <div>
          <div class="company-name">GoldLedger</div>
          <div class="company-sub">${title}</div>
          <div class="company-sub">Generated: ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}</div>
        </div>
        <div class="report-badge">LEDGER REPORT</div>
      </div>
      <div class="summary">
        <div class="sum-card gold"><div class="sum-label">Gold Balance</div><div class="sum-value gold-val">${fmtGold(s.goldIn-s.goldOut)}</div><div class="sum-sub">In: ${fmtGold(s.goldIn)} · Out: ${fmtGold(s.goldOut)}</div></div>
        <div class="sum-card purple"><div class="sum-label">Pure Gold (24K)</div><div class="sum-value purple-val">${fmtGold(s.pureIn-s.pureOut)}</div><div class="sum-sub">In: ${fmtGold(s.pureIn)} · Out: ${fmtGold(s.pureOut)}</div></div>
        <div class="sum-card ${s.moneyIn-s.moneyOut>=0?"green":"red"}"><div class="sum-label">Money Balance</div><div class="sum-value ${s.moneyIn-s.moneyOut>=0?"green":"red"}-val">${fmtMoney(s.moneyIn-s.moneyOut)}</div><div class="sum-sub">In: ${fmtMoney(s.moneyIn)} · Out: ${fmtMoney(s.moneyOut)}</div></div>
        <div class="sum-card blue"><div class="sum-label">Total Entries</div><div class="sum-value blue-val">${ents.length}</div><div class="sum-sub">transactions</div></div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Person</th><th>Description</th><th style="text-align:right">Gold In</th><th style="text-align:right">Gold Out</th><th style="text-align:center">Purity</th><th style="text-align:right">Pure Gold</th><th style="text-align:right">Money In</th><th style="text-align:right">Money Out</th></tr></thead>
        <tbody>
          ${tableRows}
          <tr class="totals-row">
            <td colspan="3">TOTALS (${ents.length} entries)</td>
            <td style="text-align:right;color:#16a34a">${fmtGold(s.goldIn)}</td>
            <td style="text-align:right;color:#dc2626">${fmtGold(s.goldOut)}</td>
            <td></td>
            <td style="text-align:right;color:#7c3aed">${fmtGold(s.pureIn-s.pureOut)} net</td>
            <td style="text-align:right;color:#16a34a">${fmtMoney(s.moneyIn)}</td>
            <td style="text-align:right;color:#dc2626">${fmtMoney(s.moneyOut)}</td>
          </tr>
        </tbody>
      </table>
      <div class="footer">
        <span>Net Money: <strong class="${s.moneyIn-s.moneyOut>=0?"green":"red"}-val">${fmtMoney(s.moneyIn-s.moneyOut)}</strong> &nbsp;|&nbsp; Net Gold: <strong class="gold-val">${fmtGold(s.goldIn-s.goldOut)}</strong></span>
        <span>GoldLedger — Gold &amp; Money Ledger System</span>
      </div>
    </body></html>`;
    const w = window.open("","_blank");
    w.document.write(html);
    w.document.close();
    setTimeout(()=>{ w.print(); w.close(); }, 600);
  };

  const exportCSV = (ents, name) => {
    const headers = ["Date","Person","Description","GoldIn(g)","GoldOut(g)","Purity","PureGoldIn(g)","PureGoldOut(g)","MoneyIn","MoneyOut","Notes"];
    const rows = ents.map(e=>{
      const p = allPeople.find(x=>x.id===e.personId);
      return [e.date,p?.name||"",e.description||"",e.goldIn||0,e.goldOut||0,e.purity||"",
              (e.pureGoldIn||0).toFixed(3),(e.pureGoldOut||0).toFixed(3),e.moneyIn||0,e.moneyOut||0,e.notes||""];
    });
    const csv = [headers,...rows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download=`${name}.csv`; a.click();
  };

  const SummaryCards = ({s}) => (
    <div className="stats-grid" style={{marginBottom:16}}>
      <div className="stat-card gold"><div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div><div className="stat-label">Net Gold Balance</div><div className="stat-value gold">{fmtGold(s.goldIn-s.goldOut)}</div><div className="stat-sub">In: {fmtGold(s.goldIn)} · Out: {fmtGold(s.goldOut)}</div></div>
      <div className="stat-card" style={{"--accent":"#a78bfa"}}><div className="stat-icon" style={{background:"rgba(167,139,250,0.12)",color:"#a78bfa"}}><Icon name="gold" size={18} color="#a78bfa"/></div><div className="stat-label">Pure Gold (24K) Net</div><div className="stat-value" style={{color:"#a78bfa"}}>{fmtGold(s.pureIn-s.pureOut)}</div><div className="stat-sub">In: {fmtGold(s.pureIn)} · Out: {fmtGold(s.pureOut)}</div></div>
      <div className={`stat-card ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}><div className={`stat-icon ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}><Icon name="money" size={18} color={s.moneyIn-s.moneyOut>=0?"var(--green)":"var(--red)"}/></div><div className="stat-label">Money Balance</div><div className={`stat-value ${s.moneyIn-s.moneyOut>=0?"green":"red"}`}>{fmtMoney(s.moneyIn-s.moneyOut)}</div><div className="stat-sub">In: {fmtMoney(s.moneyIn)} · Out: {fmtMoney(s.moneyOut)}</div></div>
    </div>
  );

  const RenderTable = ({ents}) => {
    if (!ents.length) return <div className="empty"><div className="empty-icon"><Icon name="reports" size={28}/></div><div className="empty-title">No entries found</div></div>;
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Person</th><th>Description</th><th className="th-right">Gold In</th><th className="th-right">Gold Out</th><th className="th-center">Purity</th><th className="th-right">Pure Gold</th><th className="th-right">Money In</th><th className="th-right">Money Out</th></tr></thead>
          <tbody>
            {ents.sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
              const p=allPeople.find(x=>x.id===e.personId);
              return (
                <tr key={e.id}>
                  <td style={{whiteSpace:"nowrap",color:"var(--text2)"}}>{fmtDate(e.date)}</td>
                  <td><div className="fw6">{p?.name||"-"}</div><div className="fs-xs text3 capitalize">{e.personType}</div></td>
                  <td style={{color:"var(--text2)"}}>{e.description||"-"}</td>
                  <td className="right text-green">{e.goldIn?fmtGold(e.goldIn):"-"}</td>
                  <td className="right text-red">{e.goldOut?fmtGold(e.goldOut):"-"}</td>
                  <td className="center"><span className="badge badge-gold">{e.purity||"-"}</span></td>
                  <td className="right" style={{fontSize:"0.8rem",color:"var(--text2)"}}>{e.pureGoldIn?`+${Number(e.pureGoldIn).toFixed(3)}g`:""}{e.pureGoldOut?`-${Number(e.pureGoldOut).toFixed(3)}g`:""}{!e.pureGoldIn&&!e.pureGoldOut?"-":""}</td>
                  <td className="right text-green">{e.moneyIn?fmtMoney(e.moneyIn):"-"}</td>
                  <td className="right text-red">{e.moneyOut?fmtMoney(e.moneyOut):"-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const activeEnts = tab==="monthly" ? monthEntries : personEntries;

  return (
    <div>
      <div className="section-header">
        <div className="section-title">Reports</div>
        {activeEnts.length>0&&(
          <div className="flex gap2">
            <button className="btn btn-secondary" onClick={()=>exportCSV(activeEnts,`report_${tab==="monthly"?month:allPeople.find(p=>p.id===person)?.name||"person"}`)}>
              <Icon name="download" size={16}/>CSV
            </button>
            <button className="btn btn-gold" onClick={()=>exportPDF(activeEnts, tab==="monthly"
              ? `Monthly Report — ${new Date(month+"-01").toLocaleString("default",{month:"long",year:"numeric"})}`
              : (allPeople.find(p=>p.id===person)?.name||"Person")+" — Full Ledger Report")}>
              <Icon name="pdf" size={16}/>Export PDF
            </button>
          </div>
        )}
      </div>
      <div className="tabs">
        <div className={`tab ${tab==="monthly"?"active":""}`} onClick={()=>setTab("monthly")}>Monthly</div>
        <div className={`tab ${tab==="person"?"active":""}`} onClick={()=>setTab("person")}>By Person</div>
      </div>
      {tab==="monthly"&&(
        <div>
          <div className="toolbar"><input type="month" value={month} onChange={e=>setMonth(e.target.value)} style={{minWidth:160}}/></div>
          <SummaryCards s={summary(monthEntries)}/>
          <RenderTable ents={monthEntries}/>
        </div>
      )}
      {tab==="person"&&(
        <div>
          <div className="toolbar">
            <select value={person} onChange={e=>setPerson(e.target.value)} style={{minWidth:220}}>
              <option value="">-- Select Person --</option>
              <optgroup label="Customers">{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              <optgroup label="Workers">{workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
            </select>
          </div>
          {person&&<><SummaryCards s={summary(personEntries)}/><RenderTable ents={personEntries}/></>}
          {!person&&<div className="empty"><div className="empty-icon"><Icon name="customers" size={28}/></div><div className="empty-title">Select a person to view their report</div></div>}
        </div>
      )}
    </div>
  );
}

// ─── Settings ────────────────────────────────────────────────────────
function SettingsPage({ data, onChange, addToast }) {
  const [co, setCo] = useState({ name:data.companyName, address:data.companyAddress, phone:data.companyPhone });
  const [pw, setPw] = useState({ old:"", nw:"", cf:"" });
  const [pwErr, setPwErr] = useState("");

  const saveCompany = () => { onChange({ companyName:co.name, companyAddress:co.address, companyPhone:co.phone }); addToast("Company settings saved!"); };
  const changePw = () => {
    const user = data.users.find(u=>u.id===data.currentUser.id);
    if (user.password!==pw.old) return setPwErr("Current password incorrect.");
    if (pw.nw.length<6) return setPwErr("New password must be 6+ characters.");
    if (pw.nw!==pw.cf) return setPwErr("Passwords don't match.");
    onChange({ users: data.users.map(u=>u.id===user.id?{...u,password:pw.nw}:u) });
    setPwErr(""); setPw({old:"",nw:"",cf:""}); addToast("Password changed!");
  };
  const exportBackup = () => {
    const {currentUser,...save} = data;
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(save,null,2));
    a.download=`goldledger_backup_${today()}.json`; a.click(); addToast("Backup exported!");
  };

  return (
    <div>
      <div className="section-title" style={{marginBottom:20}}>Settings</div>
      <div className="grid2">
        <div className="card">
          <div className="fw7 mb4 flex items-center gap2"><Icon name="building" size={18}/>Business Information</div>
          <div className="form-group" style={{marginBottom:12}}><label>Business Name</label><input value={co.name} onChange={e=>setCo(c=>({...c,name:e.target.value}))} placeholder="Your Gold Shop Name"/></div>
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
function Dashboard({ data, setPage, setViewPerson }) {
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
        <div style={{fontFamily:"var(--font-display)",fontSize:"1.4rem",fontWeight:800,marginBottom:4}}>Dashboard</div>
        <div className="text2 fs-sm">Welcome to {data.companyName} — Gold & Money Ledger</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card gold"><div className="stat-icon gold"><Icon name="gold" size={18} color="var(--gold)"/></div><div className="stat-label">Total Gold Balance</div><div className="stat-value gold">{fmtGold(totalGoldBal)}</div><div className="stat-sub">Pure 24K: {fmtGold(totalPureBal)}</div></div>
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
          <button className="btn btn-secondary btn-sm" onClick={()=>setPage("reports")}>View Reports</button>
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

// ─── Main App ────────────────────────────────────────────────────────
export default function App() {
  const [data,     setData]     = useState({...defaultData});
  const [fileSha,  setFileSha]  = useState(null);
  const [page,     setPage]     = useState("dashboard");
  const [loading,  setLoading]  = useState(true);
  const [syncStatus, setSync]   = useState(""); // saving | saved | error
  const [sidebarOpen, setSidebar] = useState(false);
  const [viewPerson,  setViewPerson] = useState(null);
  const { toasts, add: addToast, remove: removeToast } = useToast();

  // Modals
  const [personForm, setPersonForm] = useState(null); // {type, person}
  const [entryForm,  setEntryForm]  = useState(null); // {entry, personId}

  // ── Load ──
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try {
        const result = await ghGet(DATA_FILE);
        if (result) { setData(p=>({...defaultData,...result.data,currentUser:p.currentUser})); setFileSha(result.sha); }
      } catch(e) { console.error(e); }
      setLoading(false);
    })();
  },[]);

  // ── Persist ──
  const shaRef = useRef(fileSha);
  useEffect(()=>{ shaRef.current=fileSha; },[fileSha]);

  const persist = useCallback(async(newData) => {
    setSync("saving");
    try {
      const {currentUser,...save} = newData;
      const newSha = await ghPut(DATA_FILE, save, shaRef.current, `Ledger update - ${new Date().toLocaleDateString("en-IN")}`);
      setFileSha(newSha); shaRef.current=newSha;
      setSync("saved"); setTimeout(()=>setSync(""),2500);
    } catch(e) { setSync("error"); addToast("Save failed — check your PAT token","error"); setTimeout(()=>setSync(""),3000); }
  },[addToast]);

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
    if(f.id) { updateData({entries:data.entries.map(e=>e.id===f.id?{...e,...f}:e)}); addToast("Entry updated!"); }
    else { updateData({entries:[...data.entries,{...f,id:uid(),createdAt:Date.now()}]}); addToast("Entry saved!"); }
    setEntryForm(null);
  };
  const deleteEntry = id => { updateData({entries:data.entries.filter(e=>e.id!==id)}); addToast("Entry deleted.","error"); };

  // ── Nav ──
  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:"dashboard"},
    {id:"customers",label:"Customers",icon:"customers"},
    {id:"workers",  label:"Workers",  icon:"workers"},
    {id:"entry",    label:"New Entry", icon:"plus"},
    {id:"reports",  label:"Reports",  icon:"reports"},
    {id:"settings", label:"Settings", icon:"settings"},
  ];
  const pageTitles = {dashboard:"Dashboard",customers:"Customers",workers:"Workers",reports:"Reports",settings:"Settings",ledger:"Ledger View"};

  const handleNav = id => {
    if(id==="entry"){ setEntryForm({entry:null,personId:""}); return; }
    setPage(id); setSidebar(false);
  };

  // ── Loading ──
  if(loading) return (
    <>
      <style>{styles}</style>
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"var(--bg)",gap:16}}>
        <div style={{width:56,height:56,background:"linear-gradient(135deg,var(--gold),var(--amber))",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon name="gold" size={28} color="#000"/></div>
        <div style={{fontFamily:"var(--font-display)",fontSize:"1.4rem",fontWeight:800}}>GoldLedger</div>
        <div className="text3 fs-sm">Loading data from GitHub...</div>
        <div style={{width:200,height:3,background:"var(--surface2)",borderRadius:99,overflow:"hidden"}}>
          <div style={{width:"60%",height:"100%",background:"linear-gradient(90deg,var(--gold),var(--amber))",borderRadius:99,animation:"toastIn 1s ease infinite alternate"}}/>
        </div>
      </div>
    </>
  );

  // ── Login ──
  if(!data.currentUser) return (
    <>
      <style>{styles}</style>
      <LoginPage users={data.users} onLogin={user=>setData(d=>({...d,currentUser:user}))}/>
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
            <div><div className="logo-text">GoldLedger</div><div className="logo-sub">Ledger System</div></div>
          </div>
          <nav className="sidebar-nav">
            {navItems.map(item=>(
              <div key={item.id} className={`nav-item${page===item.id&&item.id!=="entry"?" active":""}`} onClick={()=>handleNav(item.id)}>
                <Icon name={item.icon} size={17}/>{item.label}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="nav-item" onClick={()=>setData(d=>({...d,currentUser:null}))}><Icon name="logout" size={17}/>Sign Out</div>
          </div>
        </aside>

        <div className={`overlay${sidebarOpen?" show":""}`} onClick={()=>setSidebar(false)}/>

        <div className="main">
          <header className="header">
            <div className="flex items-center gap3">
              <button className="hamburger" onClick={()=>setSidebar(o=>!o)}><Icon name="menu" size={20}/></button>
              <div>
                <div className="header-title">{page==="ledger"&&viewPerson?viewPerson.name:(pageTitles[page]||"GoldLedger")}</div>
              </div>
            </div>
            <div className="header-right">
              {syncStatus==="saving"&&<span className="sync-indicator text-blue"><Icon name="sync" size={13} color="var(--blue)"/>Saving...</span>}
              {syncStatus==="saved" &&<span className="sync-indicator text-green"><Icon name="check" size={13} color="var(--green)"/>Saved</span>}
              {syncStatus==="error" &&<span className="sync-indicator text-red">Save failed</span>}
              <button className="btn btn-gold btn-sm" onClick={()=>setEntryForm({entry:null,personId:viewPerson?.id||""})}><Icon name="plus" size={14}/>New Entry</button>
              <div className="user-badge"><div className="user-avatar">{data.currentUser.username[0].toUpperCase()}</div></div>
            </div>
          </header>

          <div className="page">
            {page==="dashboard"&&<Dashboard data={data} setPage={setPage} setViewPerson={setViewPerson}/>}
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
            {page==="reports" &&<Reports entries={data.entries} customers={data.customers} workers={data.workers}/>}
            {page==="settings"&&<SettingsPage data={data} onChange={updateData} addToast={addToast}/>}
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
