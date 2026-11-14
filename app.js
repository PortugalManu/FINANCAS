"use strict";

const STORAGE_KEY = "financas:v1";

const CATEGORIES = {
  expense: [
    { id: "moradia", name: "Moradia", icon: "🏠", color: "#5b7cfa" },
    { id: "alimentacao", name: "Alimentação", icon: "🍽️", color: "#f59f00" },
    { id: "transporte", name: "Transporte", icon: "🚗", color: "#12b886" },
    { id: "saude", name: "Saúde", icon: "💊", color: "#e64980" },
    { id: "educacao", name: "Educação", icon: "📚", color: "#7950f2" },
    { id: "lazer", name: "Lazer", icon: "🎉", color: "#fd7e14" },
    { id: "contas", name: "Contas", icon: "💡", color: "#15aabf" },
    { id: "compras", name: "Compras", icon: "🛍️", color: "#be4bdb" },
    { id: "outros-d", name: "Outros", icon: "📦", color: "#868e96" },
  ],
  income: [
    { id: "salario", name: "Salário", icon: "💼", color: "#2f9e44" },
    { id: "freelance", name: "Freelance", icon: "🧑‍💻", color: "#37b24d" },
    { id: "investimentos", name: "Investimentos", icon: "📈", color: "#40c057" },
    { id: "outros-r", name: "Outros", icon: "💵", color: "#69db7c" },
  ],
};
const ALL_CATS = [...CATEGORIES.expense, ...CATEGORIES.income];
const catById = (id) => ALL_CATS.find((c) => c.id === id) || { name: id, icon: "❔", color: "#999" };

// ---------- Estado ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { transactions: s.transactions || [], budgets: s.budgets || {}, theme: s.theme || null };
    }
  } catch (_) { /* armazenamento indisponível */ }
  return { transactions: [], budgets: {}, theme: null };
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

const state = loadState();
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (cents) => fmt.format(cents / 100);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Converte "1.234,56" / "1234.56" / "12" em centavos. Retorna NaN se inválido. */
function parseMoney(str) {
  let s = String(str).trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN;
}
const centsToInput = (c) => (c / 100).toFixed(2).replace(".", ",");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// ---------- Render ----------
function fillCategorySelect(select, type) {
  select.innerHTML = CATEGORIES[type]
    .map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
}

function monthTransactions() {
  const key = monthKey(current);
  return state.transactions.filter((t) => t.date.startsWith(key));
}

function render() {
  const label = current.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("monthLabel").textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const txs = monthTransactions();
  const income = txs.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);
  const balance = income - expense;
  const endKey = monthKey(current);
  const total = state.transactions
    .filter((t) => t.date.slice(0, 7) <= endKey)
    .reduce((a, t) => a + (t.type === "income" ? t.amount : -t.amount), 0);

  $("sumIncome").textContent = money(income);
  $("sumExpense").textContent = money(expense);
  setSigned($("sumBalance"), balance);
  setSigned($("sumTotal"), total);

  renderChart(txs, expense);
  renderBudgets(txs);
  renderList(txs);
}

function setSigned(el, v) {
  el.textContent = money(v);
  el.className = v > 0 ? "pos" : v < 0 ? "neg" : "";
}

function spentByCategory(txs) {
  const map = {};
  txs.filter((t) => t.type === "expense").forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
  return map;
}

function renderChart(txs, totalExpense) {
  const map = spentByCategory(txs);
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    $("chart").innerHTML = `<p class="empty">Sem despesas neste mês.</p>`;
    return;
  }
  $("chart").innerHTML = entries.map(([id, v]) => {
    const c = catById(id);
    const pct = totalExpense ? (v / totalExpense) * 100 : 0;
    return `<div class="bar-row">
      <div class="meta"><span>${c.icon} ${c.name}</span><span>${money(v)} · ${pct.toFixed(0)}%</span></div>
      <div class="bar"><div style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
  }).join("");
}

function renderBudgets(txs) {
  const map = spentByCategory(txs);
  const entries = Object.entries(state.budgets);
  if (!entries.length) {
    $("budgets").innerHTML = `<p class="empty">Defina limites mensais por categoria.</p>`;
    return;
  }
  $("budgets").innerHTML = entries.map(([id, limit]) => {
    const c = catById(id);
    const spent = map[id] || 0;
    const pct = Math.min((spent / limit) * 100, 100);
    const over = spent > limit;
    return `<div class="bar-row">
      <div class="meta">
        <span>${c.icon} ${c.name} <button class="budget-del" data-cat="${id}" title="Remover">✕</button></span>
        <span class="${over ? "neg" : ""}">${money(spent)} / ${money(limit)}</span>
      </div>
      <div class="bar ${over ? "over" : ""}"><div style="width:${pct}%;background:${c.color}"></div></div>
    </div>`;
  }).join("");
}

function renderList(txs) {
  const q = $("search").value.trim().toLowerCase();
  const type = $("filterType").value;
  const list = txs
    .filter((t) => type === "all" || t.type === type)
    .filter((t) => !q || t.desc.toLowerCase().includes(q) || catById(t.category).name.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  $("emptyMsg").classList.toggle("hidden", list.length > 0);
  $("txList").innerHTML = list.map((t) => {
    const c = catById(t.category);
    const [y, m, d] = t.date.split("-");
    const sign = t.type === "income" ? "+" : "−";
    return `<li>
      <span class="tx-icon">${c.icon}</span>
      <div class="tx-info"><span>${escapeHtml(t.desc)}</span><small>${c.name} · ${d}/${m}/${y}</small></div>
      <span class="tx-amount ${t.type === "income" ? "pos" : "neg"}">${sign} ${money(t.amount)}</span>
      <span class="tx-actions">
        <button data-edit="${t.id}" title="Editar">✏️</button>
        <button data-del="${t.id}" title="Excluir">🗑️</button>
      </span>
    </li>`;
  }).join("");
}

// ---------- Formulário ----------
const getType = () => document.querySelector('input[name="type"]:checked').value;

function resetForm() {
  $("txForm").reset();
  $("txId").value = "";
  $("txDate").value = todayISO();
  fillCategorySelect($("txCategory"), getType());
  $("formTitle").textContent = "Nova transação";
  $("submitBtn").textContent = "Adicionar";
  $("cancelEdit").classList.add("hidden");
}

function startEdit(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  document.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
  fillCategorySelect($("txCategory"), t.type);
  $("txId").value = t.id;
  $("txDesc").value = t.desc;
  $("txAmount").value = centsToInput(t.amount);
  $("txDate").value = t.date;
  $("txCategory").value = t.category;
  $("formTitle").textContent = "Editar transação";
  $("submitBtn").textContent = "Salvar";
  $("cancelEdit").classList.remove("hidden");
  $("txDesc").focus();
}

$("txForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parseMoney($("txAmount").value);
  if (Number.isNaN(amount)) {
    $("txAmount").setCustomValidity("Informe um valor válido maior que zero");
    $("txAmount").reportValidity();
    return;
  }
  const data = {
    type: getType(),
    desc: $("txDesc").value.trim(),
    amount,
    date: $("txDate").value,
    category: $("txCategory").value,
  };
  const id = $("txId").value;
  if (id) {
    Object.assign(state.transactions.find((t) => t.id === id), data);
  } else {
    state.transactions.push({ id: uid(), createdAt: Date.now(), ...data });
  }
  // Leva a visualização para o mês da transação
  const [y, m] = data.date.split("-").map(Number);
  current = new Date(y, m - 1, 1);
  saveState();
  resetForm();
  render();
});
$("txAmount").addEventListener("input", (e) => e.target.setCustomValidity(""));
document.querySelectorAll('input[name="type"]').forEach((r) =>
  r.addEventListener("change", () => fillCategorySelect($("txCategory"), getType())));
$("cancelEdit").addEventListener("click", resetForm);

$("txList").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.edit) startEdit(btn.dataset.edit);
  if (btn.dataset.del && confirm("Excluir esta transação?")) {
    state.transactions = state.transactions.filter((t) => t.id !== btn.dataset.del);
    if ($("txId").value === btn.dataset.del) resetForm();
    saveState();
    render();
  }
});

// ---------- Orçamentos ----------
$("budgetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = parseMoney($("budgetAmount").value);
  if (Number.isNaN(v)) return;
  state.budgets[$("budgetCategory").value] = v;
  $("budgetAmount").value = "";
  saveState();
  render();
});
$("budgets").addEventListener("click", (e) => {
  const btn = e.target.closest(".budget-del");
  if (!btn) return;
  delete state.budgets[btn.dataset.cat];
  saveState();
  render();
});

// ---------- Navegação / filtros ----------
$("prevMonth").addEventListener("click", () => { current = new Date(current.getFullYear(), current.getMonth() - 1, 1); render(); });
$("nextMonth").addEventListener("click", () => { current = new Date(current.getFullYear(), current.getMonth() + 1, 1); render(); });
$("search").addEventListener("input", () => renderList(monthTransactions()));
$("filterType").addEventListener("change", () => renderList(monthTransactions()));

// ---------- Tema ----------
function applyTheme() {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
}
$("themeToggle").addEventListener("click", () => {
  const isDark = state.theme
    ? state.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  state.theme = isDark ? "light" : "dark";
  applyTheme();
  saveState();
});

// ---------- Exportar / Importar ----------
function download(name, content, mime) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("exportCsv").addEventListener("click", () => {
  const rows = [["Data", "Tipo", "Categoria", "Descrição", "Valor"]];
  [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
    rows.push([t.date, t.type === "income" ? "Receita" : "Despesa", catById(t.category).name, t.desc,
      ((t.type === "income" ? 1 : -1) * t.amount / 100).toFixed(2).replace(".", ",")]);
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  download("financas.csv", "﻿" + csv, "text/csv;charset=utf-8");
});
$("exportJson").addEventListener("click", () => {
  download(`financas-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
});
$("importJson").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.transactions)) throw new Error("formato inválido");
    if (!confirm(`Restaurar ${data.transactions.length} transações? Os dados atuais serão substituídos.`)) return;
    state.transactions = data.transactions;
    state.budgets = data.budgets || {};
    saveState();
    render();
  } catch (err) {
    alert("Não foi possível ler o arquivo: " + err.message);
  } finally {
    e.target.value = "";
  }
});

// ---------- Início ----------
applyTheme();
fillCategorySelect($("budgetCategory"), "expense");
resetForm();
render();
