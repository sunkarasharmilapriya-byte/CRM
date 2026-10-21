const entityConfig = {
  contacts: {
    label: "Contacts", singular: "Contact", icon: "♧", description: "The people behind every great customer relationship.",
    columns: [["name", "Contact"], ["company", "Company"], ["email", "Email"], ["phone", "Phone"], ["status", "Status"]],
    fields: [
      ["name", "Full name", "text", true], ["email", "Email address", "email"], ["phone", "Phone number", "tel"],
      ["company", "Company", "text"], ["title", "Job title", "text"], ["status", "Status", "select", false, ["Customer", "Prospect", "Partner"]],
      ["source", "Source", "select", false, ["Website", "Referral", "LinkedIn", "Event", "Other"]], ["notes", "Notes", "textarea", false, null, true],
    ],
  },
  companies: {
    label: "Companies", singular: "Company", icon: "▦", description: "Build a clear picture of every account you work with.",
    columns: [["name", "Company"], ["industry", "Industry"], ["website", "Website"], ["location", "Location"], ["size", "Company size"]],
    fields: [
      ["name", "Company name", "text", true], ["industry", "Industry", "text"], ["website", "Website", "url"],
      ["phone", "Phone number", "tel"], ["location", "Location", "text"], ["size", "Company size", "select", false, ["1–10", "11–50", "51–200", "201–1,000", "1,000+"]],
      ["notes", "Notes", "textarea", false, null, true],
    ],
  },
  leads: {
    label: "Leads", singular: "Lead", icon: "◉", description: "Track prospects and keep the next best action in sight.",
    columns: [["name", "Lead"], ["company", "Company"], ["source", "Source"], ["status", "Status"], ["value", "Value"]],
    fields: [
      ["name", "Lead name", "text", true], ["company", "Company", "text"], ["email", "Email address", "email"], ["phone", "Phone number", "tel"],
      ["source", "Source", "select", false, ["Website", "Referral", "LinkedIn", "Event", "Other"]],
      ["status", "Status", "select", false, ["New", "Contacted", "Qualified", "Unqualified"]],
      ["value", "Estimated value", "number"], ["owner", "Lead owner", "text"], ["notes", "Notes", "textarea", false, null, true],
    ],
  },
  deals: {
    label: "Deals", singular: "Deal", icon: "◇", description: "Know what is moving, what is stuck, and what is next.",
    columns: [["name", "Deal"], ["company", "Company"], ["stage", "Stage"], ["closeDate", "Close date"], ["value", "Value"]],
    fields: [
      ["name", "Deal name", "text", true], ["company", "Company", "text"], ["contact", "Primary contact", "text"],
      ["value", "Deal value", "number"], ["stage", "Stage", "select", false, ["Qualified", "Proposal", "Negotiation", "Won", "Lost"]],
      ["closeDate", "Expected close date", "date"], ["probability", "Win probability (%)", "number"], ["owner", "Deal owner", "text"],
      ["notes", "Notes", "textarea", false, null, true],
    ],
  },
  tasks: {
    label: "Tasks", singular: "Task", icon: "☑", description: "Keep follow-ups on track and make the next step easy.",
    columns: [["title", "Task"], ["dueDate", "Due date"], ["priority", "Priority"], ["relatedTo", "Related to"], ["status", "Status"]],
    fields: [
      ["title", "Task title", "text", true], ["dueDate", "Due date", "date"],
      ["priority", "Priority", "select", false, ["Low", "Normal", "High"]],
      ["status", "Status", "select", false, ["To do", "In progress", "Done"]],
      ["relatedTo", "Related to", "text"], ["assignee", "Assignee", "text"], ["notes", "Notes", "textarea", false, null, true],
    ],
  },
  activities: {
    label: "Activity", singular: "Activity", icon: "◷", description: "A shared timeline of calls, meetings, and customer touchpoints.",
    columns: [["title", "Activity"], ["type", "Type"], ["date", "Date"], ["relatedTo", "Related to"], ["description", "Details"]],
    fields: [
      ["title", "Activity title", "text", true], ["type", "Activity type", "select", false, ["Call", "Meeting", "Email", "Note", "Other"]],
      ["date", "Date", "date"], ["relatedTo", "Related to", "text"], ["description", "Details", "textarea", false, null, true],
    ],
  },
};

const navItems = [
  { key: "dashboard", label: "Overview", icon: "⌂" },
  { key: "contacts", label: "Contacts" },
  { key: "companies", label: "Companies" },
  { key: "leads", label: "Leads" },
  { key: "deals", label: "Deals" },
  { key: "tasks", label: "Tasks" },
  { key: "activities", label: "Activity" },
  { key: "reports", label: "Reports", icon: "▥" },
];

const app = document.querySelector("#app");
const dialog = document.querySelector("#record-dialog");
const form = document.querySelector("#record-form");
const fieldContainer = document.querySelector("#form-fields");
const toastRegion = document.querySelector("#toast-region");
let currentUser = null;
let currentView = "dashboard";
let currentSearch = "";
let editingRecord = null;
let searchTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function initials(value) {
  return String(value || "?").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function currency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function badge(value) {
  const status = String(value || "—");
  let color = "gray";
  if (["Qualified", "Won", "Customer", "Done", "Contacted"].includes(status)) color = "green";
  if (["Proposal", "Negotiation", "In progress", "High", "New"].includes(status)) color = "orange";
  if (["Lost", "Unqualified"].includes(status)) color = "red";
  return `<span class="status-badge ${color}">${escapeHtml(status)}</span>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3600);
}

function showAuth(mode = "login", errorMessage = "") {
  const registering = mode === "register";
  app.innerHTML = `
    <main class="auth-layout">
      <section class="auth-visual">
        <a class="brand" href="#"><span class="brand-mark">N</span><span>northstar</span></a>
        <div class="auth-visual-content">
          <span class="eyebrow" style="color:#9fb4e4">YOUR CUSTOMER WORKSPACE</span>
          <h1>Make every relationship count.</h1>
          <p>One calm, connected place for the people, conversations, and deals that move your business forward.</p>
        </div>
        <span class="auth-visual-foot">A clearer way to grow, together.</span>
      </section>
      <section class="auth-card-wrap">
        <div class="auth-card">
          <span class="eyebrow">${registering ? "GET STARTED" : "WELCOME BACK"}</span>
          <h2>${registering ? "Create your workspace" : "Sign in to Northstar"}</h2>
          <p>${registering ? "Start organizing your customer relationships today." : "Your team and your next big opportunity are waiting."}</p>
          <div class="auth-error${errorMessage ? " visible" : ""}" role="alert">${escapeHtml(errorMessage)}</div>
          <form id="auth-form">
            ${registering ? '<div class="field" style="margin-bottom:15px"><label for="auth-name">Your name</label><input id="auth-name" name="name" autocomplete="name" placeholder="Alex Morgan" required minlength="2"></div>' : ""}
            <div class="field" style="margin-bottom:15px"><label for="auth-email">Work email</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required></div>
            <div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" placeholder="${registering ? "At least 10 characters" : "Enter your password"}" required ${registering ? "minlength=10" : ""}></div>
            <button class="button button-primary" style="width:100%;margin-top:23px;min-height:42px" type="submit">${registering ? "Create workspace" : "Sign in"} <span aria-hidden="true">→</span></button>
          </form>
          <div class="auth-switch">${registering ? "Already have an account?" : "New to Northstar?"}
            <button class="text-button" type="button" data-auth-switch="${registering ? "login" : "register"}">${registering ? "Sign in" : "Create your workspace"}</button>
          </div>
        </div>
      </section>
    </main>`;
  app.querySelector("[data-auth-switch]").addEventListener("click", (event) => showAuth(event.currentTarget.dataset.authSwitch));
  app.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Please wait…";
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api(`/api/auth/${registering ? "register" : "login"}`, {
        method: "POST", body: JSON.stringify(body),
      });
      currentUser = result.user;
      await renderApp();
    } catch (error) {
      showAuth(mode, error.message);
    }
  });
}

function shell() {
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" data-view="dashboard"><span class="brand-mark">N</span><span>northstar</span></a>
        <div class="brand-caption">WORKSPACE</div>
        <nav class="nav-list" aria-label="Main navigation">
          ${navItems.map((item) => `
            <a class="nav-link${currentView === item.key ? " active" : ""}" href="#${item.key}" data-view="${item.key}">
              <span class="nav-icon">${item.icon || entityConfig[item.key]?.icon || "·"}</span>${item.label}
            </a>`).join("")}
        </nav>
        <div class="sidebar-bottom">
          <div class="help-card"><strong>A little help?</strong><p>Keep your workspace organized with a few simple habits.</p><button type="button" data-help>Quick start guide →</button></div>
          <div class="account-row">
            <div class="avatar">${escapeHtml(initials(currentUser.name))}</div>
            <div class="account-info"><strong>${escapeHtml(currentUser.name)}</strong><span>${escapeHtml(currentUser.email)}</span></div>
            <button class="logout-button" type="button" data-logout aria-label="Sign out" title="Sign out">↪</button>
          </div>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div class="topbar-left"><button class="mobile-menu" type="button" aria-label="Open navigation" data-menu>☰</button><div class="breadcrumb">Workspace <span style="padding:0 7px;color:#c5cbd4">/</span><strong>${escapeHtml(navItems.find((item) => item.key === currentView)?.label || "Overview")}</strong></div></div>
          <div class="topbar-right">
            <label class="search-box"><span aria-hidden="true">⌕</span><input id="global-search" type="search" placeholder="Search this page…" value="${escapeHtml(currentSearch)}" aria-label="Search records"><span class="search-shortcut">⌘ K</span></label>
            <span class="topbar-date">${escapeHtml(date)}</span>
          </div>
        </header>
        <section class="content" id="page-content"><div class="loading-screen" style="min-height:300px">Loading your workspace…</div></section>
      </main>
    </div>`;
  app.querySelectorAll("[data-view]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    currentView = link.dataset.view;
    currentSearch = "";
    renderApp();
  }));
  app.querySelector("[data-menu]").addEventListener("click", () => app.querySelector(".sidebar").classList.toggle("open"));
  app.querySelector("[data-logout]").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      currentUser = null;
      currentView = "dashboard";
      showAuth();
    } catch (error) { showToast(error.message, true); }
  });
  app.querySelector("[data-help]").addEventListener("click", () => showToast("Start with a company or contact, then add leads and deals to your pipeline."));
  const search = app.querySelector("#global-search");
  search.addEventListener("input", () => {
    currentSearch = search.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadCurrentView(), 180);
  });
}

function handleShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#global-search")?.focus();
  }
}

async function renderApp() {
  if (!currentUser) {
    showAuth();
    return;
  }
  shell();
  await loadCurrentView();
}

async function loadCurrentView() {
  const page = document.querySelector("#page-content");
  if (!page) return;
  page.innerHTML = '<div class="loading-screen" style="min-height:300px">Loading your workspace…</div>';
  try {
    if (currentView === "dashboard") return await renderDashboard(page);
    if (currentView === "reports") return await renderReports(page);
    return await renderEntityPage(page, currentView);
  } catch (error) {
    page.innerHTML = `<div class="panel empty-state"><strong>We couldn't load this page.</strong>${escapeHtml(error.message)}<br><button class="button button-quiet" type="button" data-retry>Try again</button></div>`;
    page.querySelector("[data-retry]").addEventListener("click", loadCurrentView);
  }
}

function pageHeading(title, subtitle, actionLabel = "", actionType = currentView) {
  return `<div class="page-heading"><div><span class="eyebrow">YOUR WORKSPACE</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${actionLabel ? `<button class="button button-primary" type="button" data-new-record="${actionType}"><span aria-hidden="true">＋</span>${escapeHtml(actionLabel)}</button>` : ""}</div>`;
}

function emptyState(title, message, actionType, actionLabel) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}<br><button class="button button-primary" type="button" data-new-record="${actionType}">＋ ${escapeHtml(actionLabel)}</button></div>`;
}

function tableCell(key, value) {
  if (key === "status" || key === "stage" || key === "priority") return badge(value);
  if (key === "value") return `<span class="primary-cell">${currency(value)}</span>`;
  if (key === "dueDate" || key === "closeDate" || key === "date") return escapeHtml(dateLabel(value));
  if (key === "email" && value) return `<a href="mailto:${escapeHtml(value)}" style="color:var(--blue)">${escapeHtml(value)}</a>`;
  if (key === "website" && value) {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" style="color:var(--blue)">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(value || "—");
}

function renderTable(entity, records) {
  const config = entityConfig[entity];
  if (!records.length) return emptyState(`No ${config.label.toLowerCase()} yet`, `Add your first ${config.singular.toLowerCase()} to get started.`, entity, `Add ${config.singular.toLowerCase()}`);
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${config.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}<th style="text-align:right">ACTIONS</th></tr></thead><tbody>
    ${records.map((record) => `<tr data-record-id="${record.id}">${config.columns.map(([key], index) => `<td class="${index === 0 ? "primary-cell" : ""}">${key === "name" || key === "title" ? `<span class="primary-cell">${escapeHtml(record[key] || "—")}</span>` : tableCell(key, record[key])}</td>`).join("")}<td><div class="row-actions"><button type="button" title="Edit record" aria-label="Edit record" data-edit="${record.id}">✎</button><button type="button" class="delete-record" title="Delete record" aria-label="Delete record" data-delete="${record.id}">×</button></div></td></tr>`).join("")}
    </tbody></table><div class="table-footer"><span>${records.length} ${records.length === 1 ? config.singular.toLowerCase() : config.label.toLowerCase()}</span><span>All records</span></div></div>`;
}

async function renderEntityPage(page, entity) {
  const config = entityConfig[entity];
  if (!config) throw new Error("That workspace page does not exist.");
  const result = await api(`/api/${entity}?search=${encodeURIComponent(currentSearch)}`);
  const records = result.records;
  if (entity === "deals") {
    const stages = ["Qualified", "Proposal", "Negotiation", "Won", "Lost"];
    const board = `<div class="pipeline-board">${stages.map((stage) => {
      const deals = records.filter((deal) => deal.stage === stage);
      return `<div class="pipeline-column"><div class="column-title"><span>${stage}</span><span>${deals.length} · ${currency(deals.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0))}</span></div>${deals.map((deal) => `<article class="deal-card"><strong>${escapeHtml(deal.name)}</strong><p>${escapeHtml(deal.company || "No company linked")}</p><div class="deal-card-bottom"><span>${currency(deal.value)}</span><span>${escapeHtml(dateLabel(deal.closeDate))}</span></div><div class="row-actions" style="justify-content:flex-end;margin-top:6px"><button type="button" title="Edit deal" aria-label="Edit deal" data-edit="${deal.id}">✎</button><button type="button" class="delete-record" title="Delete deal" aria-label="Delete deal" data-delete="${deal.id}">×</button></div></article>`).join("")}${!deals.length ? '<div style="padding:15px 3px;color:#a0a8b4;font-size:9px">No deals here yet</div>' : ""}</div>`;
    }).join("")}</div>`;
    page.innerHTML = `${pageHeading(config.label, config.description, "Add deal")}<div class="panel" style="padding:15px">${records.length ? board : emptyState("Your pipeline is ready", "Add a deal to see it move through your sales stages.", entity, "Add deal")}</div>`;
  } else if (entity === "activities") {
    page.innerHTML = `${pageHeading("Activity", config.description, "Log activity")}<div class="panel">${records.length ? `<div class="activity-list">${records.map((record) => `<article class="activity-row"><div class="activity-icon">${record.type === "Call" ? "☎" : record.type === "Meeting" ? "▣" : record.type === "Email" ? "✉" : "◷"}</div><div class="activity-copy"><strong>${escapeHtml(record.title)}</strong><p>${escapeHtml(record.description || `${record.type || "Activity"}${record.relatedTo ? ` · ${record.relatedTo}` : ""}`)}</p><span>${escapeHtml(record.type || "Activity")} · ${escapeHtml(dateLabel(record.date))}${record.relatedTo ? ` · ${escapeHtml(record.relatedTo)}` : ""}</span></div><div class="row-actions"><button type="button" title="Edit activity" aria-label="Edit activity" data-edit="${record.id}">✎</button><button type="button" class="delete-record" title="Delete activity" aria-label="Delete activity" data-delete="${record.id}">×</button></div></article>`).join("")}</div>` : emptyState("No activity logged", "Keep a record of customer conversations, calls, and meetings.", entity, "Log activity")}</div>`;
  } else {
    page.innerHTML = `${pageHeading(config.label, config.description, `Add ${config.singular.toLowerCase()}`)}<div class="panel">${renderTable(entity, records)}</div>`;
  }
  wireRecordActions(entity, records);
}

async function renderDashboard(page) {
  const data = await api("/api/dashboard");
  const stats = [
    { label: "Total contacts", value: data.counts.contacts, icon: "♧", foot: "People in your workspace" },
    { label: "Active pipeline", value: currency(data.pipelineValue), icon: "◇", foot: `${data.counts.deals} deals tracked` },
    { label: "Open leads", value: data.counts.leads, icon: "◉", foot: "Opportunities in progress" },
    { label: "Tasks to do", value: data.openTasks, icon: "☑", foot: "Keep your follow-ups moving" },
  ];
  const maxValue = Math.max(1, ...data.dealsByStage.map((item) => item.value));
  page.innerHTML = `${pageHeading("Good things are in motion.", "Here’s the latest from your customer workspace.", "Add a contact", "contacts")}
    <div class="metric-grid">${stats.map((stat) => `<article class="metric-card"><div class="metric-top">${escapeHtml(stat.label)}<span class="metric-icon">${stat.icon}</span></div><div class="metric-value">${escapeHtml(stat.value)}</div><div class="metric-foot">${escapeHtml(stat.foot)}</div></article>`).join("")}</div>
    <div class="dashboard-grid">
      <div>
        <section class="panel"><div class="panel-heading"><div><h2>Deal pipeline</h2><p>Value across each sales stage</p></div><button class="link-button" type="button" data-go-view="deals">View pipeline →</button></div>
          <div class="pipeline-list">${data.dealsByStage.map((item, index) => `<div class="pipeline-row"><span class="pipeline-label">${escapeHtml(item.stage)}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${Math.round(item.value / maxValue * 100)}%;opacity:${1 - index * .1}"></div></div><span class="pipeline-amount">${currency(item.value)}</span></div>`).join("")}</div>
          <div class="pipeline-summary"><span>Won this month</span><strong>${currency(data.wonThisMonth)}</strong></div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>Recent leads</h2><p>Your newest prospects</p></div><button class="link-button" type="button" data-go-view="leads">All leads →</button></div>
          ${data.recentLeads.length ? `<div class="lead-list">${data.recentLeads.map((lead) => `<div class="lead-row"><div class="mini-avatar">${escapeHtml(initials(lead.name))}</div><div class="lead-meta"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.company || lead.email || "No company added")}</span></div>${badge(lead.status || "New")}</div>`).join("")}</div>` : emptyState("Your next customer starts here", "Add a lead to start building your pipeline.", "leads", "Add a lead")}
        </section>
      </div>
      <div>
        <section class="panel"><div class="panel-heading"><div><h2>Upcoming tasks</h2><p>A little progress goes a long way</p></div><button class="link-button" type="button" data-go-view="tasks">See all →</button></div>
          ${data.upcomingTasks.length ? `<div class="task-list">${data.upcomingTasks.map((task) => `<div class="task-row"><button class="task-check" type="button" data-complete-task="${task.id}" aria-label="Mark ${escapeHtml(task.title)} done"></button><span class="task-title">${escapeHtml(task.title)}</span><span class="task-date">${escapeHtml(dateLabel(task.dueDate))}</span></div>`).join("")}</div>` : emptyState("Nothing on your list", "Create a task to remember the next important follow-up.", "tasks", "Add a task")}
        </section>
        <section class="panel"><div class="panel-heading"><div><h2>Recent activity</h2><p>Customer conversations at a glance</p></div><button class="link-button" type="button" data-go-view="activities">View all →</button></div>
          ${data.recentActivities.length ? `<div class="activity-list">${data.recentActivities.slice(0, 4).map((activity) => `<article class="activity-row"><div class="activity-icon">${activity.type === "Call" ? "☎" : activity.type === "Meeting" ? "▣" : "◷"}</div><div class="activity-copy"><strong>${escapeHtml(activity.title)}</strong><p>${escapeHtml(activity.relatedTo || activity.description || "Activity logged")}</p><span>${escapeHtml(dateLabel(activity.date))}</span></div></article>`).join("")}</div>` : emptyState("A good time to check in", "Log a call, meeting, or customer note.", "activities", "Log activity")}
        </section>
      </div>
    </div>`;
  page.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => {
    currentView = button.dataset.goView;
    currentSearch = "";
    renderApp();
  }));
  page.querySelectorAll("[data-new-record]").forEach((button) => button.addEventListener("click", () => openRecordDialog(button.dataset.newRecord)));
  page.querySelectorAll("[data-complete-task]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const { records } = await api("/api/tasks");
      const task = records.find((record) => record.id === Number(button.dataset.completeTask));
      if (!task) return;
      await api(`/api/tasks/${task.id}`, { method: "PUT", body: JSON.stringify({ ...task, status: "Done" }) });
      showToast("Task marked as done.");
      await renderDashboard(page);
    } catch (error) { showToast(error.message, true); }
  }));
}

async function renderReports(page) {
  const data = await api("/api/dashboard");
  const records = await Promise.all(["leads", "deals", "tasks"].map(async (entity) => [entity, (await api(`/api/${entity}`)).records]));
  const values = Object.fromEntries(records);
  const wonDeals = values.deals.filter((deal) => deal.stage === "Won");
  const openTasks = values.tasks.filter((task) => task.status !== "Done");
  const conversion = values.leads.length ? Math.round(wonDeals.length / values.leads.length * 100) : 0;
  page.innerHTML = `${pageHeading("Reports", "A simple snapshot of your sales and follow-through.")}
    <div class="report-grid">
      <article class="panel report-stat"><span>Active pipeline value</span><strong>${currency(data.pipelineValue)}</strong><p>Across deals that are still in progress</p></article>
      <article class="panel report-stat"><span>Won revenue</span><strong>${currency(wonDeals.reduce((total, deal) => total + (Number(deal.value) || 0), 0))}</strong><p>${wonDeals.length} won ${wonDeals.length === 1 ? "deal" : "deals"} in your workspace</p></article>
      <article class="panel report-stat"><span>Lead-to-win rate</span><strong>${conversion}%</strong><p>${wonDeals.length} won deals from ${values.leads.length} leads</p></article>
      <article class="panel report-stat"><span>Open tasks</span><strong>${openTasks.length}</strong><p>Follow-ups still to do</p></article>
    </div>
    <section class="panel"><div class="panel-heading"><div><h2>Deals by stage</h2><p>Current count and value for each stage</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>STAGE</th><th>DEALS</th><th>TOTAL VALUE</th></tr></thead><tbody>${data.dealsByStage.map((item) => `<tr><td class="primary-cell">${escapeHtml(item.stage)}</td><td>${item.count}</td><td class="primary-cell">${currency(item.value)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function wireRecordActions(entity, records) {
  const page = document.querySelector("#page-content");
  page.querySelectorAll("[data-new-record]").forEach((button) => button.addEventListener("click", () => openRecordDialog(button.dataset.newRecord)));
  page.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => {
    const record = records.find((item) => item.id === Number(button.dataset.edit));
    if (record) openRecordDialog(entity, record);
  }));
  page.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Delete this record? This cannot be undone.")) return;
    try {
      await api(`/api/${entity}/${button.dataset.delete}`, { method: "DELETE" });
      showToast(`${entityConfig[entity].singular} deleted.`);
      await loadCurrentView();
    } catch (error) { showToast(error.message, true); }
  }));
}

function openRecordDialog(entity, record = null) {
  const config = entityConfig[entity];
  if (!config) return;
  editingRecord = { entity, record };
  document.querySelector("#dialog-eyebrow").textContent = record ? "UPDATE RECORD" : "NEW RECORD";
  document.querySelector("#dialog-title").textContent = `${record ? "Edit" : "Add"} ${config.singular.toLowerCase()}`;
  fieldContainer.innerHTML = config.fields.map(([key, label, type, required, options, fullWidth]) => {
    const defaults = { status: entity === "tasks" ? "To do" : entity === "leads" ? "New" : "", stage: "Qualified" };
    const value = record?.[key] ?? defaults[key] ?? "";
    let input;
    if (type === "select") {
      input = `<select id="field-${key}" name="${key}"><option value="">Select…</option>${options.map((option) => `<option value="${escapeHtml(option)}"${value === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    } else if (type === "textarea") {
      input = `<textarea id="field-${key}" name="${key}" placeholder="Add a few details…">${escapeHtml(value)}</textarea>`;
    } else {
      input = `<input id="field-${key}" name="${key}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""} ${type === "number" ? `min="0" ${key === "probability" ? 'max="100"' : ""} step="${key === "probability" ? "1" : "100"}` : ""} placeholder="${type === "number" ? "0" : ""}">`;
    }
    return `<div class="field${fullWidth ? " full-width" : ""}"><label for="field-${key}">${escapeHtml(label)}${required ? " *" : ""}</label>${input}</div>`;
  }).join("");
  dialog.showModal();
  dialog.querySelector("input, select, textarea")?.focus();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingRecord) return;
  const { entity, record } = editingRecord;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form));
    await api(record ? `/api/${entity}/${record.id}` : `/api/${entity}`, {
      method: record ? "PUT" : "POST", body: JSON.stringify(body),
    });
    dialog.close();
    showToast(`${entityConfig[entity].singular} ${record ? "updated" : "added"}.`);
    await loadCurrentView();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => { editingRecord = null; });
document.addEventListener("keydown", handleShortcut);

async function start() {
  try {
    const result = await api("/api/auth/me");
    currentUser = result.user;
    if (currentUser) {
      await renderApp();
    } else {
      showAuth();
    }
  } catch (error) {
    app.innerHTML = `<div class="loading-screen"><div class="panel empty-state"><strong>Northstar could not connect.</strong>${escapeHtml(error.message)}<br>Make sure the CRM server is running and refresh this page.</div></div>`;
  }
}

start();
