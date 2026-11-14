/* Finanças — app do celular (PWA) da planilha GASTOS JOSÉ/MANU.
 * Só desenha as telas. Toda regra de negócio fica no Apps Script da planilha (apps-script/Api.gs). */
'use strict';
const APP_VERSAO = 1;
const SCRIPT_MINIMO = 1;   // versão do Api.gs que este app espera

/* ---------------- guardado no aparelho ---------------- */
const K = { api: 'fin.api', chave: 'fin.chave', usuario: 'fin.usuario', dados: 'fin.dados' };
const guardado = {
  ler(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  apagar(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const st = {
  api: guardado.ler(K.api),
  chave: guardado.ler(K.chave),
  usuario: guardado.ler(K.usuario),
  dados: guardado.ler(K.dados),
  versaoScript: null,
  graficos: null,
  tela: 'mes',
  ocupado: false,
  instalar: null
};

/* ---------------- utilidades ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function brl(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100, neg = v < 0;
  const p = Math.abs(v).toFixed(2).split('.');
  return (neg ? '−' : '') + 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
}
function brlCurto(n) {
  const a = Math.abs(n);
  if (a >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + ' mil';
  return 'R$ ' + Math.round(n);
}
/** "1.234,56" / "105,06" / "1.500" -> número (igual ao script) */
function lerValor(txt) {
  let s = String(txt || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const baseNome = s => String(s).replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, '').trim();
const mesNum = m => { const p = String(m).split('/'); return Number(p[1]) * 12 + Number(p[0]); };
const mesCurto = m => { const p = String(m).split('/'); return p[0] + '/' + p[1].slice(2); };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesNome = m => { const p = String(m).split('/'); return MESES[Number(p[0]) - 1] + ' de ' + p[1]; };
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const vibrar = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
const podeLancar = () => st.usuario && st.usuario.papel === 'admin';
const soma = lista => lista.reduce((s, c) => s + c.valor, 0);

const ICO = {
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  alerta: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3zM12 10v4M12 17h.01"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 12v5M9.5 14.5h5"/></svg>',
  baixar: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  sair: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>'
};

/* ---------------- avisos ---------------- */
let toastTimer;
function toast(msg, erro) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (erro ? ' erro' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, erro ? 5500 : 3200);
  if (erro) vibrar([40, 60, 40]);
}

/* folha de baixo: abre com o HTML e liga os eventos em `ligar(corpo, fechar)`.
 * `aoFechar(valor)` roda uma vez, na hora, quando a folha fecha (botão, fundo ou voltar). */
function abrirFolha(html, ligar, aoFechar) {
  const d = $('#folha');
  if (d.open) d.close();
  d.innerHTML = `<div class="folha-corpo">${html}</div>`;
  let feito = false;
  const fechar = valor => {
    if (feito) return;
    feito = true;
    if (d.open) d.close();
    if (aoFechar) aoFechar(valor);
  };
  d.onclick = e => { if (e.target === d) fechar(false); };
  d.oncancel = e => { e.preventDefault(); fechar(false); };
  d.querySelectorAll('[data-fechar]').forEach(b => { b.onclick = () => fechar(false); });
  if (ligar) ligar(d.firstElementChild, fechar);
  d.showModal();
  return fechar;
}
function confirmar(titulo, texto, botao, classe) {
  return new Promise(resolve => {
    abrirFolha(`<h2>${esc(titulo)}</h2><p class="ctx">${texto}</p>
      <div class="folha-acoes"><button class="btn secundario" data-fechar>Voltar</button>
      <button class="btn ${classe || 'primario'}" id="fSim">${esc(botao)}</button></div>`,
      (c, fechar) => { $('#fSim', c).onclick = () => fechar(true); },
      v => resolve(v === true));
  });
}

/* ---------------- API ---------------- */
async function chamar(acao, dados = {}, tempo = 90000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), tempo);
  let resp;
  try {
    // corpo em texto simples: o Google aceita sem "preflight" de CORS
    resp = await fetch(st.api, { method: 'POST', body: JSON.stringify(Object.assign({ token: st.chave, acao }, dados)), signal: ctl.signal, redirect: 'follow' });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'A planilha demorou demais para responder. Tente de novo.' : 'Sem conexão com a planilha. Confira a internet.');
  } finally { clearTimeout(timer); }
  let j;
  try { j = JSON.parse(await resp.text()); }
  catch (e) { throw new Error('A API respondeu algo inesperado. Confira a URL e se a implantação está como "Qualquer pessoa".'); }
  if (!j.ok) {
    if (j.codigo === 'auth') sair(j.erro);
    throw new Error(j.erro || 'Algo deu errado.');
  }
  if (j.versaoScript) st.versaoScript = j.versaoScript;
  if (j.dados) {
    st.dados = j.dados; guardado.gravar(K.dados, j.dados);
    st.graficos = null;   // números mudaram: gráficos recarregam quando abrir a aba
  }
  return j;
}

function ocupado(sim) {
  st.ocupado = sim;
  $('#app').classList.toggle('carregando', sim);
  $('#btnAtualizar').classList.toggle('girando', sim);
}

/* ---------------- início ---------------- */
function lerLinkMagico() {
  if (!location.hash.includes('chave=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('api') && p.get('chave')) {
    st.api = p.get('api'); st.chave = p.get('chave');
    guardado.gravar(K.api, st.api); guardado.gravar(K.chave, st.chave);
    [K.usuario, K.dados].forEach(guardado.apagar);
    st.usuario = null; st.dados = null;
  }
  history.replaceState(null, '', location.pathname + location.search);
}

async function iniciar() {
  lerLinkMagico();
  if (!st.api || !st.chave) return mostrarSetup();
  mostrarApp();
  ocupado(true);
  try {
    const j = await chamar('ping', { mes: '' });
    st.usuario = j.usuario; guardado.gravar(K.usuario, j.usuario);
  } catch (e) {
    toast(e.message, true);
  } finally { ocupado(false); render(); }
}

async function recarregar(mes) {
  if (st.ocupado) return;
  ocupado(true);
  try {
    await chamar('mes', { mes: mes || (st.dados && st.dados.mes) || '', sincronizar: true });
    if (st.tela === 'graficos') await carregarGraficos();
  } catch (e) { toast(e.message, true); }
  finally { ocupado(false); render(); }
}

function mostrarSetup(msg) {
  $('#app').hidden = true;
  $('#setup').hidden = false;
  const m = $('#setupMsg');
  m.hidden = !msg; m.textContent = msg || '';
}
function mostrarApp() {
  $('#setup').hidden = true;
  $('#app').hidden = false;
  render();
}
function sair(msg) {
  [K.chave, K.usuario, K.dados].forEach(guardado.apagar);
  st.chave = null; st.usuario = null; st.dados = null;
  mostrarSetup(msg);
}

$('#formSetup').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  st.api = String(f.get('api')).trim(); st.chave = String(f.get('chave')).trim();
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Conectando…';
  try {
    const j = await chamar('ping', { mes: '' });
    guardado.gravar(K.api, st.api); guardado.gravar(K.chave, st.chave);
    st.usuario = j.usuario; guardado.gravar(K.usuario, j.usuario);
    mostrarApp();
  } catch (err) {
    mostrarSetup(err.message);
  } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
});

/* ---------------- navegação ---------------- */
$('#abas').addEventListener('click', e => {
  const b = e.target.closest('button[data-tela]');
  if (b) irPara(b.dataset.tela);
});
async function irPara(tela) {
  st.tela = tela;
  render();
  window.scrollTo(0, 0);
  if (tela === 'graficos' && !st.graficos && st.dados) {
    ocupado(true);
    try { await carregarGraficos(); } catch (e) { toast(e.message, true); }
    finally { ocupado(false); render(); }
  }
}
$('#btnAtualizar').onclick = () => recarregar();
$('#mes').onchange = e => recarregar(e.target.value);
$('#fab').onclick = () => abrirGasto();

function render() {
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.tela === st.tela));
  const d = st.dados;
  const sel = $('#mes');
  if (d) {
    sel.innerHTML = d.meses.map(m => `<option value="${m}"${m === d.mes ? ' selected' : ''}>${m}</option>`).join('');
    $('#atualizado').textContent = 'Atualizado ' + d.atualizadoEm + (podeLancar() ? '' : ' · só leitura');
  }
  sel.hidden = !d || st.tela === 'mais';
  $('#fab').hidden = !(d && podeLancar() && st.tela === 'mes');
  const tela = $('#tela');
  if (!d) { tela.innerHTML = '<div class="esqueleto"></div><div class="esqueleto"></div>'; return; }
  if (st.tela === 'mes') tela.innerHTML = telaMes(d);
  else if (st.tela === 'graficos') tela.innerHTML = telaGraficos();
  else tela.innerHTML = telaMais();
  ligarTela(tela);
}

function scriptDesatualizado() {
  return st.versaoScript != null && st.versaoScript < SCRIPT_MINIMO;
}

/* ---------------- tela: mês ---------------- */
function telaMes(d) {
  const c = d.cards;
  const noMesDeHoje = d.mes === d.hoje;
  const abertas = d.contas.filter(x => !x.cartao && !x.pago && !x.quitacao)
    .sort((a, b) => (a.vence || 99) - (b.vence || 99) || b.valor - a.valor);
  const pagas = d.contas.filter(x => !x.cartao && x.pago);
  const cartao = d.contas.filter(x => x.cartao);
  let h = '';

  if (scriptDesatualizado()) {
    h += `<p class="aviso atencao">${ICO.alerta}<span>O script da planilha está numa versão antiga. Cole o <b>Api.gs</b> novo e implante uma <b>Nova versão</b>.</span></p>`;
  }
  if (podeLancar() && mesNum(d.proximo) <= mesNum(d.hoje)) {
    h += `<div class="novo-mes">${ICO.cal}<p>Já é ${esc(mesNome(d.hoje))}. A aba <b>${esc(d.proximo)}</b> ainda não existe.</p>
      <button class="btn primario" data-acao="criarMes">Criar</button></div>`;
  }
  if (d.mes !== d.ultimo) {
    h += `<p class="aviso info">${ICO.info}<span>Você está vendo <b>${esc(d.mes)}</b>. O mês mais recente é ${esc(d.ultimo)}.</span></p>`;
  }

  h += `<section class="hero">
    <p class="rot">Se pagar tudo o que falta, ${esc(mesCurto(d.mes))} fecha com</p>
    <p class="val num ${c.fechaMes < 0 ? 'neg' : 'pos'}">${brl(c.fechaMes)}</p>
    <dl class="conta num">
      <dt>Entrou</dt><dd>${brl(c.entrou)}</dd>
      <dt>− Já pago</dt><dd>${brl(c.pago)}</dd>
      <dt>− Falta pagar</dt><dd>${brl(c.aberto)}</dd>
      <dt class="igual">= Fecha com</dt><dd class="igual">${brl(c.fechaMes)}</dd>
    </dl>
  </section>
  <div class="kpis">
    <div class="kpi"><p class="rot">Falta pagar</p><p class="val num neg">${brl(c.aberto)}</p><p class="det">${c.qtdAbertas} ${c.qtdAbertas === 1 ? 'conta' : 'contas'}</p></div>
    <div class="kpi"><p class="rot">Já pago</p><p class="val num">${brl(c.pago)}</p><p class="det">sobra hoje ${brl(c.sobraHoje)}</p></div>
    <div class="kpi"><p class="rot">Atrasado</p><p class="val num">${brl(c.atrasado)}</p><p class="det">${d.atrasadas.length ? esc(d.atrasadas.map(a => a.nome).join(', ')) : 'nada de meses antes'}</p></div>
    <div class="kpi"><p class="rot">Passou no cartão</p><p class="val num">${brl(c.noCartao)}</p><p class="det">fora do total, vai na fatura</p></div>
  </div>`;

  // falta pagar
  h += `<h2 class="sec-titulo"><span>Falta pagar</span><span class="num">${brl(soma(abertas))}</span></h2><div class="lista">`;
  h += abertas.length ? abertas.map(x => {
    const venceu = noMesDeHoje && x.vence && x.vence < d.diaHoje;
    const meta = (x.vence ? (venceu ? 'venceu dia ' : 'vence dia ') + x.vence : 'sem vencimento') + ' · ' + x.tipo;
    return `<div class="item"><div class="info"><div class="nome">${esc(x.despesa)}</div>
      <div class="meta${venceu ? ' venceu' : ''}">${esc(meta)}</div></div>
      <div class="v num">${brl(x.valor)}</div>
      ${podeLancar() ? `<button class="btn-pagar" data-pagar="${x.linha}">Pagar</button>` : ''}</div>`;
  }).join('') : '<div class="vazio">Tudo pago neste mês. 🎉</div>';
  h += '</div>';

  // atrasadas
  if (d.atrasadas.length) {
    h += `<h2 class="sec-titulo"><span>Atrasadas (meses antes)</span><span class="num">${brl(c.atrasado)}</span></h2><div class="lista">` +
      d.atrasadas.map(a => `<div class="item"><div class="info"><div class="nome">${esc(a.nome)}</div>
        <div class="meta">${esc(a.meses.join(', '))}</div></div><div class="v num">${brl(a.saldo)}</div></div>`).join('') + '</div>';
  }

  // dobráveis
  h += dobra('Entrou no mês', brl(c.entrou), d.entradas.length ? d.entradas.map(x => `<div class="item"><div class="info">
      <div class="nome">${esc(x.descricao.replace(' (auto)', ''))}</div>
      <div class="meta">${esc(x.quem || '—')}${x.auto ? ' · puxado sozinho da planilha do Freelancer' : ''}</div></div>
      <div class="v num">${brl(x.valor)}</div></div>`).join('') : '<div class="vazio">Nada lançado na aba ENTRADAS para este mês.</div>');

  h += dobra('Passou no cartão', brl(c.noCartao), cartao.length ? cartao.map(x => `<div class="item"><div class="info">
      <div class="nome">${esc(x.despesa)}</div><div class="meta">${esc(x.quem || '—')} · entra na fatura do mês seguinte</div></div>
      <div class="v num">${brl(x.valor)}</div></div>`).join('') : '<div class="vazio">Nada lançado no cartão.</div>');

  h += dobra('Já pagas', brl(soma(pagas)), pagas.length ? pagas.map(x => `<div class="item pago"><div class="info">
      <div class="nome">${esc(x.despesa)}</div><div class="meta">${esc(x.quem || '—')}${x.quitacao ? ' · quita ' + esc(x.quitacao) : ''}</div></div>
      <div class="v num">${brl(x.valor)}</div>
      ${podeLancar() ? `<button class="btn-link" data-desfazer="${x.linha}">desfazer</button>` : ''}</div>`).join('') : '<div class="vazio">Nada pago ainda.</div>');

  return h;
}
function dobra(titulo, total, corpo) {
  return `<details class="dobra"><summary><h2 class="sec-titulo"><span>${esc(titulo)}</span><span class="num">${total}</span></h2></summary>
    <div class="lista">${corpo}</div></details>`;
}

function ligarTela(tela) {
  tela.onclick = e => {
    const b = e.target.closest('[data-pagar],[data-desfazer],[data-acao]');
    if (!b) return;
    if (b.dataset.pagar) abrirPagar(Number(b.dataset.pagar));
    else if (b.dataset.desfazer) desfazer(Number(b.dataset.desfazer));
    else if (b.dataset.acao === 'criarMes') abrirCriarMes();
    else if (b.dataset.acao === 'instalar') instalar();
    else if (b.dataset.acao === 'sair') sairDoAparelho();
  };
  if (st.tela === 'graficos') ligarGraficos(tela);
}

const achar = linha => st.dados.contas.find(x => x.linha === linha);

/* ---------------- gravar (comum) ---------------- */
async function gravar(acao, dados, botao) {
  if (st.ocupado) return null;
  if (botao) botao.disabled = true;
  ocupado(true);
  try {
    const r = await chamar(acao, dados);
    return r;
  } catch (e) {
    toast(e.message, true);
    if (botao) botao.disabled = false;
    return null;
  } finally { ocupado(false); }
}
function depoisDeGravar(r, fechar) {
  if (fechar) fechar();
  toast(r.repetido ? 'Já estava gravado.' : r.msg);
  vibrar(30);
  render();
}

/* chips de pessoa: Manu / José / Os dois */
function chipsPessoas(el, aoMudar) {
  const pessoas = st.dados.config.pessoas;
  const opcoes = pessoas.map(p => ({ rot: p, v: [p] })).concat([{ rot: 'Os dois', v: pessoas.slice() }]);
  let atual = '';
  const desenhar = () => {
    el.innerHTML = opcoes.map((o, i) => `<button type="button" class="chip${o.v.join(', ') === atual ? ' on' : ''}" data-i="${i}">${esc(o.rot)}</button>`).join('');
  };
  el.onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
    atual = opcoes[Number(b.dataset.i)].v.join(', ');
    desenhar(); aoMudar(atual);
  };
  desenhar();
}

/* ---------------- pagar / desfazer ---------------- */
function abrirPagar(linha) {
  const x = achar(linha); if (!x) return;
  const pedido = { idEnvio: novoId(), mes: st.dados.mes, linha: x.linha, despesa: x.despesa, valor: x.valor, pago: true, quem: '' };
  abrirFolha(`<h2>${esc(x.despesa)}</h2>
    <p class="ctx num">${brl(x.valor)} · ${esc(st.dados.mes)}${x.vence ? ' · vence dia ' + x.vence : ''}</p>
    <span class="rot-campo">Quem pagou</span><div class="chips" id="pQuem"></div>
    <div class="folha-acoes"><button class="btn secundario" data-fechar>Cancelar</button>
    <button class="btn primario" id="pOk" disabled>Marcar como pago</button></div>`,
  (c, fechar) => {
    chipsPessoas($('#pQuem', c), v => { pedido.quem = v; $('#pOk', c).disabled = !v; });
    $('#pOk', c).onclick = async e => {
      const r = await gravar('pagar', pedido, e.currentTarget);
      if (r) depoisDeGravar(r, fechar);
    };
  });
}

async function desfazer(linha) {
  const x = achar(linha); if (!x) return;
  const ok = await confirmar('Voltar para não pago?', `<b>${esc(x.despesa)}</b> (${brl(x.valor)}) volta para a lista do que falta pagar.`, 'Voltar para não pago', 'perigo');
  if (!ok) return;
  const r = await gravar('pagar', { idEnvio: novoId(), mes: st.dados.mes, linha: x.linha, despesa: x.despesa, valor: x.valor, pago: false });
  if (r) depoisDeGravar(r);
}

/* ---------------- + gasto ---------------- */
function abrirGasto() {
  const d = st.dados;
  const g = { idEnvio: novoId(), forma: '', pago: true, tipo: 'Variavel', quem: '' };
  abrirFolha(`<h2>Novo gasto</h2><p class="ctx">Vai para a aba <b>${esc(d.mes)}</b></p>
    <span class="rot-campo">O que foi</span>
    <div class="chips" id="gAtalhos">${d.config.atalhos.map(a => `<button type="button" class="chip" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    <input class="campo" id="gNome" placeholder="ex.: COMBUSTIVEL" autocomplete="off" style="margin-top:8px;text-transform:uppercase" maxlength="60">
    <span class="rot-campo">Valor</span>
    <input class="campo num" id="gValor" inputmode="decimal" placeholder="0,00" autocomplete="off">
    <span class="rot-campo">Como pagou</span>
    <div class="seg" id="gForma">
      <button type="button" class="chip" data-v="À vista">Pix / débito / dinheiro</button>
      <button type="button" class="chip" data-v="Cartão">Cartão de crédito</button>
    </div>
    <div id="gBlocoPago"><span class="rot-campo">Já foi pago?</span>
      <div class="seg" id="gPago"><button type="button" class="chip on" data-v="sim">Sim</button><button type="button" class="chip" data-v="nao">Ainda não</button></div>
    </div>
    <span class="rot-campo" id="gQuemRot">Quem pagou</span><div class="chips" id="gQuem"></div>
    <span class="rot-campo">Tipo</span>
    <div class="seg" id="gTipo"><button type="button" class="chip on" data-v="Variavel">Variável</button><button type="button" class="chip" data-v="Fixo">Fixo (todo mês)</button></div>
    <div id="gBlocoVence" hidden><span class="rot-campo">Vence dia (opcional)</span><input class="campo" id="gVence" inputmode="numeric" placeholder="1 a 31" maxlength="2"></div>
    <p class="aviso info" id="avCartao" hidden style="margin-top:14px">${ICO.info}<span>No cartão não entra no total do mês: o dinheiro sai pela FATURA.</span></p>
    <p class="aviso ruim" id="avPlano" hidden style="margin-top:14px"></p>
    <div class="folha-acoes"><button class="btn secundario" data-fechar>Cancelar</button><button class="btn primario" id="gOk" disabled>Lançar</button></div>`,
  (c, fechar) => {
    const nome = $('#gNome', c), valor = $('#gValor', c), vence = $('#gVence', c), ok = $('#gOk', c);
    const marcar = (id, v) => c.querySelectorAll('#' + id + ' .chip').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    const foraDoPlano = n => d.config.foraDoCartao.some(x => norm(baseNome(n)) === norm(x));

    function validar() {
      const cartao = g.forma === 'Cartão';
      const pago = cartao || g.pago;
      const v = lerValor(valor.value);
      $('#gBlocoPago', c).hidden = cartao;
      $('#gBlocoVence', c).hidden = cartao || g.pago;
      $('#gQuemRot', c).textContent = cartao ? 'Cartão de quem' : (g.pago ? 'Quem pagou' : 'Quem vai pagar (opcional)');
      $('#avCartao', c).hidden = !cartao;
      const plano = cartao && nome.value.trim() && foraDoPlano(nome.value);
      const av = $('#avPlano', c);
      av.hidden = !plano;
      if (plano) av.innerHTML = `${ICO.alerta}<span>${esc(nome.value.trim().toUpperCase())} é conta de boleto/Pix e não deveria ir no crédito. Vai somar na próxima fatura.</span>`;
      const vOk = !vence.value.trim() || (/^\d{1,2}$/.test(vence.value.trim()) && +vence.value >= 1 && +vence.value <= 31);
      ok.disabled = !nome.value.trim() || !(v > 0) || !g.forma || (pago && !g.quem) || !vOk;
      ok.textContent = v > 0 ? 'Lançar ' + brl(v) : 'Lançar';
    }
    $('#gAtalhos', c).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; nome.value = b.dataset.v; validar(); valor.focus(); };
    $('#gForma', c).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; g.forma = b.dataset.v; marcar('gForma', g.forma); validar(); };
    $('#gPago', c).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; g.pago = b.dataset.v === 'sim'; marcar('gPago', b.dataset.v); validar(); };
    $('#gTipo', c).onclick = e => { const b = e.target.closest('.chip'); if (!b) return; g.tipo = b.dataset.v; marcar('gTipo', g.tipo); validar(); };
    chipsPessoas($('#gQuem', c), v => { g.quem = v; validar(); });
    [nome, valor, vence].forEach(i => { i.oninput = validar; });

    async function enviar(extra) {
      const cartao = g.forma === 'Cartão';
      const pedido = Object.assign({
        idEnvio: g.idEnvio, mes: d.mes, despesa: nome.value.trim(), valor: valor.value, forma: g.forma,
        pago: cartao ? true : g.pago, quem: g.quem, tipo: g.tipo, vence: cartao || g.pago ? '' : vence.value.trim()
      }, extra);
      const r = await gravar('gasto', pedido, ok);
      if (!r) return;
      if (r.aviso === 'foraDoPlano') {
        fechar();
        const sim = await confirmar('Fora do plano', `<b>${esc(r.despesa)}</b> é conta de boleto/Pix e não deveria ir no cartão de crédito. Vai somar ${brl(r.valor)} na próxima fatura. Lançar mesmo assim?`, 'Lançar mesmo assim', 'perigo');
        if (sim) return reenviar(Object.assign({}, pedido, { confirmarForaDoPlano: true }));
        return;
      }
      if (r.aviso === 'duplicado') {
        fechar();
        const sim = await confirmar('Já tem um igual', `Já existe <b>${esc(r.despesa)}</b> de ${brl(r.valor)} em ${esc(d.mes)}. É outro gasto?`, 'É outro, lançar', 'primario');
        if (sim) return reenviar(Object.assign({}, pedido, { confirmarDuplicado: true }));
        return;
      }
      depoisDeGravar(r, fechar);
    }
    ok.onclick = () => enviar({});
    validar();
    setTimeout(() => nome.focus(), 50);
  });
}
async function reenviar(pedido) {
  const r = await gravar('gasto', pedido);
  if (!r) return;
  if (r.aviso === 'duplicado' && !pedido.confirmarDuplicado) {
    const sim = await confirmar('Já tem um igual', `Já existe <b>${esc(r.despesa)}</b> de ${brl(r.valor)} em ${esc(pedido.mes)}. É outro gasto?`, 'É outro, lançar', 'primario');
    if (sim) return reenviar(Object.assign({}, pedido, { confirmarDuplicado: true }));
    return;
  }
  depoisDeGravar(r);
}

/* ---------------- criar mês novo ---------------- */
async function abrirCriarMes() {
  if (st.ocupado) return;
  ocupado(true);
  let p;
  try { p = (await chamar('previaMes')).previa; }
  catch (e) { toast(e.message, true); return; }
  finally { ocupado(false); }
  if (p.jaExiste) { toast('A aba ' + p.novo + ' já existe.', true); return; }

  abrirFolha(`<h2>Criar ${esc(p.novo)}?</h2>
    <p class="ctx">Copia as contas <b>fixas</b> de ${esc(p.base)}, todas como <b>não pagas</b>, e avança as parcelas.
    ${p.variaveis ? `${p.variaveis} gasto(s) variável(is) ficam de fora.` : ''}</p>
    <ul class="lista-previa">${p.copiar.map(x => `<li><span>${esc(x.nome)}</span><span class="num">${brl(x.valor)}</span></li>`).join('')}</ul>
    <p class="ctx num" style="margin-top:8px">Total previsto: <b>${brl(p.total)}</b></p>
    ${p.encerradas.length ? `<p class="aviso ok" style="margin-top:10px"><span>Parcelamento que terminou e não vem: ${esc(p.encerradas.join(', '))}</span></p>` : ''}
    <p class="aviso atencao" style="margin-top:10px">${ICO.alerta}<span>Depois, confira os valores que mudam todo mês (luz, água, faturas).</span></p>
    <div class="folha-acoes"><button class="btn secundario" data-fechar>Cancelar</button><button class="btn primario" id="cOk">Criar ${esc(p.novo)}</button></div>`,
  (c, fechar) => {
    const id = novoId();
    $('#cOk', c).onclick = async e => {
      const r = await gravar('criarMes', { idEnvio: id, novo: p.novo }, e.currentTarget);
      if (r) { st.tela = 'mes'; depoisDeGravar(r, fechar); }
    };
  });
}

/* ---------------- gráficos ---------------- */
async function carregarGraficos() {
  const j = await chamar('graficos', { mes: st.dados.mes });
  st.graficos = j.graficos;
}

const COR_PESSOA = { MANU: 'var(--s1)', JOSE: 'var(--s2)' };
function telaGraficos() {
  const g = st.graficos;
  if (!g) return '<div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div>';
  let h = '';

  // 1) quem pagou no mês
  const maxP = Math.max(1, ...g.pessoas.map(p => p.total));
  h += `<section class="grafico"><h2>Quem pagou em ${esc(mesCurto(g.mes))}</h2>
    <p class="sub">Só o que já foi pago. Conta dividida ("Os dois") entra metade para cada um.</p>
    ${g.pessoas.length ? `<div class="barras-pessoa">${g.pessoas.map(p => `<div class="bp-linha">
      <div class="bp-meta"><span>${esc(p.pessoa)}</span><span class="num">${brl(p.total)} · ${Math.round(p.percentual * 100)}%</span></div>
      <div class="bp-trilho"><div style="width:${(p.total / maxP * 100).toFixed(1)}%;background:${COR_PESSOA[norm(p.pessoa)] || 'var(--s3)'}"></div></div>
    </div>`).join('')}</div>` : '<p class="muted">Nada pago neste mês ainda.</p>'}</section>`;

  // 2) fixas e variáveis por mês (empilhado)
  h += `<section class="grafico"><h2>Gastos por mês</h2><p class="sub">Total do mês (sem o que passou no cartão). Toque numa barra.</p>
    <ul class="legenda"><li><i style="background:var(--s1)"></i>Fixas</li><li><i style="background:var(--s2)"></i>Variáveis</li></ul>
    ${colunas('hist', g.historico.map(x => ({ rot: mesCurto(x.mes), mes: x.mes, partes: [x.fixas, x.variaveis] })), ['var(--s1)', 'var(--s2)'], true, g.mes)}
    ${tabela(['Mês', 'Fixas', 'Variáveis', 'Total'], g.historico.map(x => [x.mes, brl(x.fixas), brl(x.variaveis), brl(x.total)]))}</section>`;

  // 3) entrou x saiu
  h += `<section class="grafico"><h2>Entrou × saiu</h2><p class="sub">Saiu = tudo que foi pago no mês (inclui contas atrasadas quitadas).</p>
    <ul class="legenda"><li><i style="background:var(--s3)"></i>Entrou</li><li><i style="background:var(--s1)"></i>Saiu</li></ul>
    ${colunas('fluxo', g.fluxo.map(x => ({ rot: mesCurto(x.mes), mes: x.mes, partes: [x.entrou, x.saiu], extra: x.sobra })), ['var(--s3)', 'var(--s1)'], false, g.mes)}
    ${tabela(['Mês', 'Entrou', 'Saiu', 'Sobra'], g.fluxo.map(x => [x.mes, brl(x.entrou), brl(x.saiu), brl(x.sobra)]))}</section>`;
  return h;
}

function tabela(cab, linhas) {
  return `<details class="tabela-dados"><summary>Ver em tabela</summary><table>
    <thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

/** escala "redonda" para o eixo: 0, passo, 2·passo… */
function escala(max) {
  if (max <= 0) return { topo: 1000, passo: 500 };
  const bruto = max / 3;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * pot).find(p => p >= bruto);
  return { topo: Math.ceil(max / passo) * passo, passo };
}
/** barra com só o topo arredondado (4px), presa na base */
function barra(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
const GRUPOS = {};
function colunas(id, grupos, cores, empilhado, mesSel) {
  GRUPOS[id] = { grupos, empilhado };
  const W = 340, H = 190, esq = 48, dir = 6, topo = 8, base = 22;
  const larg = W - esq - dir, alt = H - topo - base;
  const max = Math.max(0, ...grupos.map(gp => empilhado ? gp.partes.reduce((a, b) => a + b, 0) : Math.max(...gp.partes)));
  const { topo: vMax, passo } = escala(max);
  const y = v => topo + alt - (v / vMax) * alt;
  const slot = larg / Math.max(grupos.length, 1);
  let s = `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de colunas">`;
  for (let v = 0; v <= vMax + 0.01; v += passo) {
    s += `<line class="gridline" x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}"/><text x="${esq - 6}" y="${y(v) + 3.5}" text-anchor="end">${v === 0 ? '0' : brlCurto(v)}</text>`;
  }
  grupos.forEach((gp, i) => {
    const x0 = esq + i * slot;
    const cls = gp.mes === mesSel ? 'sel' : '';
    if (empilhado) {
      const w = Math.min(28, slot * 0.6), x = x0 + (slot - w) / 2;
      let acum = 0;
      gp.partes.forEach((v, k) => {
        if (v <= 0) return;
        const yTopo = y(acum + v), yBase = y(acum);
        const ehTopo = gp.partes.slice(k + 1).every(z => z <= 0);
        const hh = Math.max(0, yBase - yTopo - (k > 0 ? 2 : 0));   // 2px de respiro entre as partes
        s += `<path class="${cls}" d="${ehTopo ? barra(x, yTopo, w, hh, 4) : `M${x},${yTopo}h${w}v${hh}h${-w}Z`}" fill="${cores[k]}"/>`;
        acum += v;
      });
    } else {
      const n = gp.partes.length, gap = 2;
      const w = Math.min(16, (slot * 0.7 - gap * (n - 1)) / n);
      const total = w * n + gap * (n - 1);
      gp.partes.forEach((v, k) => {
        const x = x0 + (slot - total) / 2 + k * (w + gap);
        s += `<path class="${cls}" d="${barra(x, y(v), w, y(0) - y(v), 4)}" fill="${cores[k]}"/>`;
      });
    }
    s += `<text x="${x0 + slot / 2}" y="${H - 6}" text-anchor="middle"${gp.mes === mesSel ? ' style="font-weight:700;fill:var(--text)"' : ''}>${esc(gp.rot)}</text>`;
    s += `<rect class="alvo" data-graf="${id}" data-i="${i}" x="${x0}" y="${topo}" width="${slot}" height="${alt + base}"/>`;
  });
  return s + '</svg>';
}

function ligarGraficos(tela) {
  const dica = $('#dica');
  const nomes = { hist: ['Fixas', 'Variáveis'], fluxo: ['Entrou', 'Saiu'] };
  const cores = { hist: ['var(--s1)', 'var(--s2)'], fluxo: ['var(--s3)', 'var(--s1)'] };
  const mostrar = (alvo, ev) => {
    const id = alvo.dataset.graf, gp = GRUPOS[id].grupos[Number(alvo.dataset.i)];
    let h = `<b>${esc(gp.mes)}</b>` + gp.partes.map((v, k) => `<div class="lin"><i style="background:${cores[id][k]}"></i>${nomes[id][k]}: ${brl(v)}</div>`).join('');
    if (id === 'hist') h += `<div class="lin">Total: ${brl(gp.partes[0] + gp.partes[1])}</div>`;
    if (id === 'fluxo') h += `<div class="lin">Sobra: ${brl(gp.extra)}</div>`;
    dica.innerHTML = h;
    dica.hidden = false;
    const r = alvo.getBoundingClientRect();
    const dw = dica.offsetWidth, dh = dica.offsetHeight;
    let x = (ev && ev.clientX != null ? ev.clientX : r.left + r.width / 2) - dw / 2;
    x = Math.max(8, Math.min(window.innerWidth - dw - 8, x));
    let yy = r.top - dh - 6;
    if (yy < 8) yy = r.top + 8;
    dica.style.left = x + 'px'; dica.style.top = yy + 'px';
    tela.querySelectorAll(`.alvo[data-graf="${id}"]`).forEach(a => a.classList.toggle('ativo', a === alvo));
  };
  tela.querySelectorAll('.alvo').forEach(a => {
    a.addEventListener('pointerenter', ev => { if (ev.pointerType === 'mouse') mostrar(a, ev); });
    a.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') dica.hidden = true; });
    a.addEventListener('click', ev => { ev.stopPropagation(); mostrar(a, ev); });
  });
}
document.addEventListener('click', e => { if (!e.target.closest('.alvo')) $('#dica').hidden = true; });
window.addEventListener('scroll', () => { $('#dica').hidden = true; }, { passive: true });

/* ---------------- tela: mais ---------------- */
function telaMais() {
  const u = st.usuario;
  let h = `<div class="opcoes">`;
  if (podeLancar() && st.dados) {
    h += `<button class="opcao" data-acao="criarMes">${ICO.cal}<span class="info"><b>Criar o mês novo</b>
      <span>Cria a aba ${esc(st.dados.proximo)} com as contas fixas de ${esc(st.dados.ultimo)}</span></span></button>`;
  }
  if (st.instalar) {
    h += `<button class="opcao" data-acao="instalar">${ICO.baixar}<span class="info"><b>Instalar o app</b><span>Ícone na tela inicial, abre em tela cheia</span></span></button>`;
  }
  h += `<button class="opcao" data-acao="sair">${ICO.sair}<span class="info"><b>Sair deste aparelho</b>
    <span>Apaga a chave deste celular. Para voltar, abra de novo o link da planilha.</span></span></button>`;
  h += `</div><p class="rodape">${u ? esc(u.nome) + ' · ' + (u.papel === 'admin' ? 'pode lançar' : 'só leitura') + '<br>' : ''}
    App versão ${APP_VERSAO} · script da planilha ${st.versaoScript ? 'versão ' + st.versaoScript : '—'}</p>`;
  return h;
}
async function instalar() {
  if (!st.instalar) return;
  st.instalar.prompt();
  try { await st.instalar.userChoice; } catch (e) {}
  st.instalar = null;
  render();
}
async function sairDoAparelho() {
  const ok = await confirmar('Sair deste aparelho?', 'A chave é apagada deste celular. Os dados da planilha não mudam.', 'Sair', 'perigo');
  if (ok) sair();
}

/* ---------------- instalação / atualização ---------------- */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); st.instalar = e; if (st.tela === 'mais') render(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // quando chega versão nova do app, recarrega uma vez sozinho
  const tinhaControle = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControle || recarregou) return;
    recarregou = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    })
    .catch(() => {});
}

iniciar();
