/**********************************************************************
 * Api.gs — porta do APP DO CELULAR (planilha GASTOS JOSÉ/MANU)
 *
 * O app (GitHub Pages) conversa com este script por POST, em JSON:
 *   { token, acao, ...dados }
 * Ações: ping, mes, graficos, pagar, gasto, previaMes, criarMes,
 *        faturas, importarFatura, atualizarLinhaFatura (essas três em Faturas.gs).
 *
 * As contas NÃO são refeitas aqui: os números vêm das mesmas funções do
 * RELATORIO (Dados.gs): obterResumoMes, obterPendencias, obterFluxo...
 * Assim app e RELATORIO batem sempre.
 *
 * Publicar: Implantar → Nova implantação → App da Web
 *   Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 * Quem entra é controlado pela chave de cada pessoa
 * (menu 📊 Financeiro → 📱 App do celular).
 *
 * Usa de outros arquivos: Config.gs (PLANILHA, PREFIXO_FATURA, ABA_ENTRADAS),
 * Dados.gs (listarMeses, obterUltimoMes, somarMeses, mesParaNumero,
 * obterResumoMes, obterPendencias, obterFluxo), Relatorio.gs (atualizarRelatorio),
 * Importar.gs (importarEntradas, ID_FREELANCER, ID_CARTAO), Faturas.gs.
 * Para conferir se está tudo lá: rode a função apiTestar() no editor.
 *
 * Não tem onOpen. Só pode existir UM doGet/doPost no projeto.
 **********************************************************************/

const VERSAO_SCRIPT = 2;

const API_CFG = {
  PESSOAS: ['Manu', 'José'],
  // botões rápidos do "+ Gasto" (gravado em maiúsculas)
  ATALHOS: ['COMBUSTIVEL', 'MERCADO', 'FARMACIA', 'LANCHE', 'IFOOD', 'PADARIA', 'UBER', 'PRESENTE'],
  // contas de boleto/Pix que não devem ir no crédito (pede confirmação)
  FORA_DO_CARTAO: ['CAIXA', 'MRV', 'WEBROPAY', 'UNIAO', 'INTERNET', 'LUZ', 'AGUA', 'SEGURO', 'IPVA'],
  VALOR_MAXIMO: 50000,          // trava contra vírgula errada (10506 em vez de 105,06)
  SINCRONIZAR_ENTRADAS_MIN: 10  // de quanto em quanto tempo, no máximo, puxa as diárias do José
};

const API_PROP_USUARIOS = 'APP_USUARIOS';   // { chave: { nome, papel, criadaEm } }
const API_PROP_URL_PWA = 'APP_URL_PWA';
const API_PROP_URL_API = 'APP_URL_API';
const API_ABA_LOG = 'LOG DO APP';

/* ================= entrada ================= */

function doGet() {
  return apiJson_({ ok: true, app: 'financas', mensagem: 'A API está no ar. Abra o app para usar.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return apiJson_({ ok: false, erro: 'Pedido inválido.' });
  }
  try {
    const u = apiUsuarioDaChave_(req.token);
    if (!u) return apiJson_({ ok: false, codigo: 'auth', erro: 'Chave de acesso inválida ou revogada.' });
    return apiJson_(Object.assign({ ok: true, versaoScript: VERSAO_SCRIPT }, apiRotear_(u, req)));
  } catch (err) {
    return apiJson_({ ok: false, erro: (err && err.message) || String(err) });
  }
}

function apiJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiRotear_(u, req) {
  switch (req.acao) {
    case 'ping':
      apiSincronizarEntradas_(false, u.nome);
      return { usuario: apiPublico_(u), dados: apiDadosMes_(req.mes) };

    case 'mes':
      if (req.sincronizar) apiSincronizarEntradas_(false, u.nome);
      return { dados: apiDadosMes_(req.mes) };

    case 'graficos':
      return { graficos: apiGraficos_(req.mes) };

    case 'pagar':
      apiExigirLancar_(u);
      return apiComGravacao_(req.idEnvio, req.mes, () => apiPagar_(req, u.nome));

    case 'gasto':
      apiExigirLancar_(u);
      return apiComGravacao_(req.idEnvio, req.mes, () => apiNovoGasto_(req, u.nome));

    case 'previaMes':
      apiExigirLancar_(u);
      return { previa: apiPreviaMes_() };

    case 'criarMes':
      apiExigirLancar_(u);
      return apiComGravacao_(req.idEnvio, null, () => apiCriarMes_(req, u.nome));

    case 'faturas':
      return { faturaTela: apiFaturas_(req.pessoa, req.fatura) };

    case 'importarFatura':
      apiExigirLancar_(u);
      return apiComGravacao_(req.idEnvio, req.mesTela, () => {
        const r = apiImportarFatura_(req, u.nome);
        r.faturaTela = apiFaturas_(r.pessoa, r.fatura);
        return r;
      });

    case 'atualizarLinhaFatura':
      apiExigirLancar_(u);
      return apiComGravacao_(req.idEnvio, req.mesTela, () => {
        const r = apiAtualizarLinhaFatura_(req, u.nome);
        r.faturaTela = apiFaturas_(r.pessoa, r.fatura);
        return r;
      });

    default:
      throw new Error('Ação desconhecida. Atualize o app.');
  }
}

function apiExigirLancar_(u) {
  if (u.papel !== 'admin') throw new Error('Seu acesso é só para ver.');
}

/**
 * Gravação segura: uma de cada vez (trava) e cada envio uma vez só (idEnvio).
 * Toque duplo ou rede instável reenviam o mesmo idEnvio: devolve o primeiro resultado.
 * Depois de gravar, atualiza o RELATORIO e devolve a tela do mês já recalculada.
 */
function apiComGravacao_(idEnvio, mes, fn) {
  if (!idEnvio || String(idEnvio).length < 8) throw new Error('Envio sem identificador. Atualize o app.');
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) throw new Error('A planilha está ocupada. Tente de novo em alguns segundos.');
  try {
    const cache = CacheService.getScriptCache();
    const chave = 'envio_' + String(idEnvio).slice(0, 80);
    const ja = cache.get(chave);
    if (ja) {
      const r = JSON.parse(ja);
      r.repetido = true;
      r.dados = apiDadosMes_(r.mesTela || mes);
      return r;
    }
    const r = fn();
    if (r.gravado) {
      SpreadsheetApp.flush();
      try { atualizarRelatorio(); } catch (e) { console.warn('RELATORIO não atualizado: ' + e.message); }
      cache.put(chave, JSON.stringify({ gravado: true, msg: r.msg, mesTela: r.mesTela || mes }), 21600);
    }
    r.dados = apiDadosMes_(r.mesTela || mes);
    return r;
  } finally {
    trava.releaseLock();
  }
}

/* ================= leitura: tela do mês ================= */

function apiDadosMes_(mes) {
  const meses = listarMeses();
  const ultimo = obterUltimoMes();
  if (!mes || meses.indexOf(mes) === -1) mes = ultimo;

  const r = obterResumoMes(mes);
  const contas = apiLerContas_(mes);
  const entradas = apiLerEntradas_(mes);
  const entrou = entradas.reduce((s, x) => s + x.valor, 0);

  const atrasadas = apiAgruparAtrasadas_(obterPendencias(mes).filter(l => l.mes !== mes));
  const atrasado = atrasadas.reduce((s, a) => s + a.saldo, 0);
  const noCartao = contas.filter(c => c.cartao).reduce((s, c) => s + c.valor, 0);

  const tz = Session.getScriptTimeZone();
  const hoje = Utilities.formatDate(new Date(), tz, 'MM/yyyy');

  return {
    mes: mes,
    ultimo: ultimo,
    proximo: somarMeses(ultimo, 1),
    hoje: hoje,
    diaHoje: Number(Utilities.formatDate(new Date(), tz, 'd')),
    meses: meses.slice().reverse(),
    cards: {
      entrou: apiR2_(entrou),
      pago: apiR2_(r.totalPago),
      aberto: apiR2_(r.emAberto),
      qtdAbertas: r.qtdAbertas,
      total: apiR2_(r.total),
      fixas: apiR2_(r.totalFixo),
      variaveis: apiR2_(r.totalVariavel),
      sobraHoje: apiR2_(entrou - r.totalPago),
      fechaMes: apiR2_(entrou - r.totalPago - r.emAberto),
      atrasado: apiR2_(atrasado),
      noCartao: apiR2_(noCartao)
    },
    contas: contas,
    atrasadas: atrasadas,
    entradas: entradas,
    config: { pessoas: API_CFG.PESSOAS, atalhos: API_CFG.ATALHOS, foraDoCartao: API_CFG.FORA_DO_CARTAO },
    atualizadoEm: Utilities.formatDate(new Date(), tz, "dd/MM 'às' HH:mm")
  };
}

/** Linhas da aba do mês, com o número da linha (para marcar pago na linha certa). */
function apiLerContas_(mes) {
  const aba = apiAbaMes_(mes);
  const ultima = aba.getLastRow();
  if (ultima < PLANILHA.PRIMEIRA_LINHA) return [];

  const dados = aba.getRange(PLANILHA.PRIMEIRA_LINHA, 1,
    ultima - PLANILHA.PRIMEIRA_LINHA + 1, PLANILHA.TOTAL_COLUNAS).getValues();

  const lista = [];
  dados.forEach((l, i) => {
    const despesa = String(l[PLANILHA.COL_DESPESA - 1]).trim();
    if (!despesa) return;
    const base = apiBase_(despesa);
    const forma = apiNorm_(l[PLANILHA.COL_FORMA - 1]);
    const ehFatura = apiNorm_(base).indexOf(PREFIXO_FATURA) === 0;
    const ref = apiRef_(l[PLANILHA.COL_REF - 1]);
    lista.push({
      linha: PLANILHA.PRIMEIRA_LINHA + i,
      despesa: despesa,
      valor: apiR2_(Number(l[PLANILHA.COL_VALOR - 1]) || 0),
      pago: apiNorm_(l[PLANILHA.COL_PAGO - 1]) === 'SIM',
      quem: String(l[PLANILHA.COL_PESSOA - 1] || '').trim(),
      tipo: apiNorm_(l[PLANILHA.COL_TIPO - 1]).indexOf('FIX') === 0 ? 'Fixo' : 'Variável',
      vence: apiVence_(l[PLANILHA.COL_VENCE - 1]),
      cartao: !ehFatura && (forma.indexOf('CART') === 0 || forma.indexOf('CRED') === 0),
      fatura: ehFatura,
      quitacao: ref !== '' && ref !== mes ? ref : ''
    });
  });
  return lista;
}

/** O que entrou no mês (aba ENTRADAS): salário, diárias do José etc. */
function apiLerEntradas_(mes) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ENTRADAS);
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 4).getValues()
    .filter(l => apiRef_(l[0]) === mes && Number(l[2]))
    .map(l => ({
      descricao: String(l[1] || '').trim(),
      valor: apiR2_(Number(l[2])),
      quem: String(l[3] || '').trim(),
      auto: String(l[1] || '').indexOf('(auto)') !== -1
    }));
}

/** UNIÃO de 05, 06 e 07 vira uma linha só. */
function apiAgruparAtrasadas_(pendencias) {
  const mapa = {};
  pendencias.forEach(l => {
    const k = apiNorm_(apiBase_(l.despesa));
    if (!mapa[k]) mapa[k] = { nome: apiBase_(l.despesa), saldo: 0, meses: [] };
    mapa[k].saldo += l.saldo;
    mapa[k].meses.push(l.mes);
  });
  return Object.keys(mapa).map(k => ({
    nome: mapa[k].nome,
    saldo: apiR2_(mapa[k].saldo),
    meses: mapa[k].meses.sort((a, b) => mesParaNumero(a) - mesParaNumero(b))
  })).sort((a, b) => b.saldo - a.saldo);
}

/* ================= leitura: gráficos ================= */

function apiGraficos_(mes) {
  const meses = listarMeses();
  if (!mes || meses.indexOf(mes) === -1) mes = obterUltimoMes();
  const r = obterResumoMes(mes);

  const historico = meses.map(m => {
    const x = obterResumoMes(m);
    return { mes: m, total: apiR2_(x.total), fixas: apiR2_(x.totalFixo),
             variaveis: apiR2_(x.totalVariavel), aberto: apiR2_(x.emAberto) };
  });

  const fluxo = obterFluxo(8).map(f => ({
    mes: f.mes, entrou: apiR2_(f.entrou), saiu: apiR2_(f.saiu), sobra: apiR2_(f.sobra)
  }));

  return {
    mes: mes,
    pessoas: r.pessoas.map(p => ({ pessoa: p.pessoa, total: apiR2_(p.total), percentual: p.percentual })),
    totalPago: apiR2_(r.totalPago),
    historico: historico,
    fluxo: fluxo
  };
}

/* ================= escrita: marcar pago ================= */

/** req = { mes, linha, despesa, valor, pago (bool), quem } */
function apiPagar_(req, autor) {
  const aba = apiAbaMes_(req.mes);
  const linha = Number(req.linha);
  if (!(linha >= PLANILHA.PRIMEIRA_LINHA && linha <= aba.getLastRow())) {
    throw new Error('Linha inválida. Atualize o app.');
  }

  const row = aba.getRange(linha, 1, 1, PLANILHA.TOTAL_COLUNAS).getValues()[0];
  const nomeAgora = String(row[PLANILHA.COL_DESPESA - 1]).trim();
  const valorAgora = Number(row[PLANILHA.COL_VALOR - 1]) || 0;
  // há 3 linhas "MRV": confere nome E valor antes de mexer
  if (apiNorm_(nomeAgora) !== apiNorm_(req.despesa) || Math.abs(valorAgora - Number(req.valor)) > 0.004) {
    throw new Error('Essa conta mudou na planilha. Atualize o app e tente de novo.');
  }

  const pagar = req.pago !== false;
  let quem = '';
  if (pagar) {
    quem = apiValidarQuem_(req.quem);
    if (!quem) throw new Error('Diga quem pagou.');
  }

  aba.getRange(linha, PLANILHA.COL_PAGO).setValue(pagar ? 'SIM' : 'NÃO');
  aba.getRange(linha, PLANILHA.COL_PESSOA).setValue(quem);
  apiNota_(aba.getRange(linha, PLANILHA.COL_PAGO),
    (pagar ? 'Marcado pago (' + quem + ')' : 'Voltou para não pago') + ' pelo app em ' + apiAgora_() + ' — ' + autor + '.');

  const detalhe = req.mes + ' · ' + nomeAgora + ' · ' + apiMoeda_(valorAgora) + (pagar ? ' · ' + quem : '');
  apiLog_(autor, pagar ? 'Marcou pago' : 'Desfez pago', detalhe);

  return {
    gravado: true,
    msg: pagar ? nomeAgora + ' marcado como pago (' + quem + ').' : nomeAgora + ' voltou para "não pago".'
  };
}

/* ================= escrita: novo gasto ================= */

/**
 * req = { mes, despesa, valor, forma ('À vista'|'Cartão'), pago (bool), quem,
 *         tipo ('Variavel'|'Fixo'), vence, confirmarForaDoPlano, confirmarDuplicado }
 * Se for conta de boleto no crédito, ou se já existir o mesmo nome e valor no mês,
 * devolve o aviso SEM gravar; o app pergunta e reenvia com a confirmação.
 */
function apiNovoGasto_(req, autor) {
  const aba = apiAbaMes_(req.mes);

  const despesa = String(req.despesa || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!despesa) throw new Error('Informe o que foi o gasto.');
  if (despesa.length > 60) throw new Error('Nome muito longo (máx. 60 letras).');

  const valor = apiValor_(req.valor);
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero.');
  if (valor > API_CFG.VALOR_MAXIMO) throw new Error('Valor alto demais (' + apiMoeda_(valor) + '). Confira a vírgula.');

  const cartao = req.forma === 'Cartão';
  if (!cartao && req.forma !== 'À vista') throw new Error('Diga como pagou: à vista ou cartão de crédito.');

  if (cartao && apiForaDoCartao_(despesa) && req.confirmarForaDoPlano !== true) {
    return { gravado: false, aviso: 'foraDoPlano', despesa: despesa, valor: valor };
  }

  const existentes = apiLerContas_(req.mes)
    .filter(c => apiNorm_(c.despesa) === apiNorm_(despesa) && Math.abs(c.valor - valor) < 0.005);
  if (existentes.length && req.confirmarDuplicado !== true) {
    return { gravado: false, aviso: 'duplicado', despesa: despesa, valor: valor, qtd: existentes.length };
  }

  const tipo = req.tipo === 'Fixo' ? 'Fixo' : 'Variavel';
  const pago = cartao ? true : req.pago !== false;   // no crédito o dinheiro sai pela fatura
  const quem = apiValidarQuem_(req.quem);
  if (pago && !quem) throw new Error(cartao ? 'Diga de quem é o cartão.' : 'Diga quem pagou.');

  let vence = '';
  if (req.vence !== '' && req.vence != null) {
    vence = Number(req.vence);
    if (!(vence >= 1 && vence <= 31) || Math.floor(vence) !== vence) throw new Error('Vencimento é um dia de 1 a 31.');
  }

  const linha = apiProximaLinha_(aba);
  if (linha > aba.getMaxRows()) aba.insertRowsAfter(aba.getMaxRows(), linha - aba.getMaxRows());

  const nova = new Array(PLANILHA.TOTAL_COLUNAS).fill('');
  nova[PLANILHA.COL_DESPESA - 1] = despesa;
  nova[PLANILHA.COL_VALOR - 1] = valor;
  nova[PLANILHA.COL_PAGO - 1] = pago ? 'SIM' : 'NÃO';
  nova[PLANILHA.COL_PESSOA - 1] = quem;
  nova[PLANILHA.COL_TIPO - 1] = tipo;
  nova[PLANILHA.COL_VENCE - 1] = vence;
  nova[PLANILHA.COL_FORMA - 1] = cartao ? 'Cartão' : '';

  // copia o formato da linha de cima (moeda, alinhamento, listas)
  if (linha > PLANILHA.PRIMEIRA_LINHA) {
    aba.getRange(linha - 1, 1, 1, PLANILHA.TOTAL_COLUNAS)
       .copyFormatToRange(aba, 1, PLANILHA.TOTAL_COLUNAS, linha, linha);
  }
  aba.getRange(linha, 1, 1, PLANILHA.TOTAL_COLUNAS).setValues([nova]);
  apiNota_(aba.getRange(linha, PLANILHA.COL_DESPESA), 'Lançado pelo app em ' + apiAgora_() + ' — ' + autor + '.');

  apiLog_(autor, 'Lançou gasto', req.mes + ' · ' + despesa + ' · ' + apiMoeda_(valor) +
    (cartao ? ' · cartão' : pago ? ' · pago' : ' · a pagar') + (quem ? ' · ' + quem : ''));

  return {
    gravado: true,
    msg: despesa + ' (' + apiMoeda_(valor) + ') lançado em ' + req.mes +
      (cartao ? '. No cartão: fica fora do total, entra pela fatura.' : '.')
  };
}

/* ================= escrita: criar o mês novo ================= */

/**
 * Mesma regra do menu "Criar proximo mes" (NovoMes.gs):
 *  - copia só as contas FIXAS do último mês, marca tudo como NÃO pago
 *  - limpa QUEM PAGO, REF e FORMA (mantém VENCE)
 *  - avança as parcelas ("WEBROPAY (5/12)" vira "(6/12)"); parcelamento que acabou não vem
 *  - a aba nova entra logo antes da de origem
 */
function apiPlanoMes_() {
  const base = obterUltimoMes();
  const novo = somarMeses(base, 1);
  const contas = apiLerContas_(base);
  const copiar = [], fora = [], encerradas = [];

  contas.forEach(c => {
    if (c.tipo !== 'Fixo' || c.quitacao) { fora.push(c.despesa); return; }
    const p = apiParcela_(c.despesa);
    if (p.total > 0) {
      if (p.n + 1 > p.total) { encerradas.push(c.despesa); return; }
      copiar.push({ linha: c.linha, de: c.despesa, para: p.base + ' (' + (p.n + 1) + '/' + p.total + ')', valor: c.valor });
      return;
    }
    copiar.push({ linha: c.linha, de: c.despesa, para: c.despesa, valor: c.valor });
  });
  return { base: base, novo: novo, copiar: copiar, fora: fora, encerradas: encerradas };
}

function apiPreviaMes_() {
  const plano = apiPlanoMes_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    base: plano.base,
    novo: plano.novo,
    jaExiste: !!ss.getSheetByName(plano.novo),
    copiar: plano.copiar.map(c => ({ nome: c.para, valor: c.valor })),
    total: apiR2_(plano.copiar.reduce((s, c) => s + c.valor, 0)),
    variaveis: plano.fora.length,
    encerradas: plano.encerradas
  };
}

/** req = { novo } — o app manda o mês que mostrou na prévia (se mudou, recusa). */
function apiCriarMes_(req, autor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const plano = apiPlanoMes_();
  if (req.novo !== plano.novo) throw new Error('A planilha mudou desde a prévia. Atualize o app e tente de novo.');
  if (ss.getSheetByName(plano.novo)) throw new Error('A aba ' + plano.novo + ' já existe.');

  const abaBase = ss.getSheetByName(plano.base);
  const aba = abaBase.copyTo(ss).setName(plano.novo);
  const manter = {};
  plano.copiar.forEach(c => { manter[c.linha] = c; });

  // de baixo para cima, porque apaga linhas
  for (let i = aba.getLastRow(); i >= PLANILHA.PRIMEIRA_LINHA; i--) {
    const c = manter[i];
    if (!c) { aba.deleteRow(i); continue; }
    if (c.para !== c.de) aba.getRange(i, PLANILHA.COL_DESPESA).setValue(c.para);
    aba.getRange(i, PLANILHA.COL_PAGO).setValue('NÃO');
    aba.getRange(i, PLANILHA.COL_PESSOA).clearContent();
    aba.getRange(i, PLANILHA.COL_REF).clearContent();
    aba.getRange(i, PLANILHA.COL_FORMA).clearContent();
  }
  // notinhas do mês anterior ("marcado pago pelo app...") não valem para o mês novo
  if (aba.getLastRow() >= PLANILHA.PRIMEIRA_LINHA) {
    aba.getRange(PLANILHA.PRIMEIRA_LINHA, 1, aba.getLastRow() - PLANILHA.PRIMEIRA_LINHA + 1, PLANILHA.TOTAL_COLUNAS).clearNote();
  }

  // abas em ordem decrescente: o mês novo entra logo ANTES do mês de origem
  ss.setActiveSheet(aba);
  ss.moveActiveSheet(abaBase.getIndex());

  apiLog_(autor, 'Criou mês', plano.novo + ' · ' + plano.copiar.length + ' contas fixas' +
    (plano.encerradas.length ? ' · encerrou ' + plano.encerradas.join(', ') : ''));

  // faturas do cartão que vencem nesse mês e já estão importadas: valor certo na linha FATURA
  const faturas = typeof fatPreencherMesNovo_ === 'function' ? fatPreencherMesNovo_(plano.novo, autor) : [];

  return {
    gravado: true,
    mesTela: plano.novo,
    msg: plano.novo + ' criado com ' + plano.copiar.length + ' contas fixas.' +
      (faturas.length ? ' ' + faturas.join(' ') : '') + ' Confira os valores que mudam todo mês (luz, água).'
  };
}

/* ================= entradas do José (automático) ================= */

/**
 * Puxa as diárias do José da planilha do Freelancer, igual ao menu
 * "Importar fatura e diarias", mas sozinho e só quando algo mudou.
 * Roda no máximo a cada API_CFG.SINCRONIZAR_ENTRADAS_MIN minutos (forcar = ignora o intervalo).
 */
function apiSincronizarEntradas_(forcar, autor) {
  const cache = CacheService.getScriptCache();
  if (!forcar && cache.get('sync_entradas')) return false;
  if (typeof ID_FREELANCER === 'undefined' || typeof importarEntradas !== 'function') return false;

  const trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) return false;
  try {
    cache.put('sync_entradas', '1', API_CFG.SINCRONIZAR_ENTRADAS_MIN * 60);

    const origem = SpreadsheetApp.openById(ID_FREELANCER).getSheetByName('RECEBIMENTOS');
    if (!origem) return false;
    const novas = origem.getRange('G2:I60').getValues()
      .filter(l => /^\d{2}\/\d{4}$/.test(String(l[0]).trim()) && apiValor_(l[2]) > 0)
      .map(l => String(l[0]).trim() + '|' + apiR2_(apiValor_(l[2])) + '|' + String(l[1]).trim())
      .sort();

    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ENTRADAS);
    const atuais = (aba && aba.getLastRow() >= 2)
      ? aba.getRange(2, 1, aba.getLastRow() - 1, 4).getValues()
          .filter(l => String(l[1]).indexOf('(auto)') !== -1)
          .map(l => apiRef_(l[0]) + '|' + apiR2_(Number(l[2]) || 0) + '|' + String(l[3]).trim())
          .sort()
      : [];

    if (novas.join('#') === atuais.join('#')) return false;

    importarEntradas();
    SpreadsheetApp.flush();
    try { atualizarRelatorio(); } catch (e) { console.warn('RELATORIO não atualizado: ' + e.message); }
    apiLog_(autor || 'app', 'Puxou diárias do José', novas.length + ' mês(es) atualizados da planilha do Freelancer');
    return true;
  } catch (e) {
    console.warn('Entradas do José não sincronizadas: ' + e.message);
    return false;
  } finally {
    trava.releaseLock();
  }
}

/* ================= ajudantes ================= */

function apiAbaMes_(mes) {
  if (!/^\d{2}\/\d{4}$/.test(String(mes || ''))) throw new Error('Mês inválido.');
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(mes);
  if (!aba) throw new Error('Aba ' + mes + ' não encontrada.');
  return aba;
}

/** Primeira linha vazia logo depois da última despesa (coluna A). */
function apiProximaLinha_(aba) {
  const ultima = aba.getLastRow();
  if (ultima < PLANILHA.PRIMEIRA_LINHA) return PLANILHA.PRIMEIRA_LINHA;
  const col = aba.getRange(PLANILHA.PRIMEIRA_LINHA, PLANILHA.COL_DESPESA,
    ultima - PLANILHA.PRIMEIRA_LINHA + 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).trim() !== '') return PLANILHA.PRIMEIRA_LINHA + i + 1;
  }
  return PLANILHA.PRIMEIRA_LINHA;
}

/** Só aceita "Manu", "José" ou os dois ("Manu, José"). */
function apiValidarQuem_(txt) {
  const validos = API_CFG.PESSOAS.map(apiNorm_);
  const escolhidos = [];
  String(txt || '').split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    const i = validos.indexOf(apiNorm_(s));
    if (i === -1) throw new Error('Pessoa inválida: ' + s);
    if (escolhidos.indexOf(API_CFG.PESSOAS[i]) === -1) escolhidos.push(API_CFG.PESSOAS[i]);
  });
  return escolhidos.join(', ');
}

/** "MRV", "MRV (2/3)" e "AGUA" contam; "AGUA DE COCO" não. */
function apiForaDoCartao_(despesa) {
  const d = apiNorm_(apiBase_(despesa));
  return API_CFG.FORA_DO_CARTAO.some(c => d === apiNorm_(c));
}

function apiNorm_(txt) {
  return String(txt == null ? '' : txt).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
}

/** "WEBROPAY(5/12)" -> { base: 'WEBROPAY', n: 5, total: 12 } */
function apiParcela_(despesa) {
  const m = String(despesa).match(/^(.*?)\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)\s*$/);
  if (!m) return { base: String(despesa).trim(), n: 0, total: 0 };
  return { base: m[1].trim(), n: Number(m[2]), total: Number(m[3]) };
}
function apiBase_(despesa) { return apiParcela_(despesa).base; }

function apiVence_(v) {
  if (v instanceof Date) return v.getDate();
  const n = Number(String(v == null ? '' : v).trim());
  return (n >= 1 && n <= 31) ? Math.floor(n) : '';
}

function apiRef_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MM/yyyy');
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{4})$/);
  return m ? ('0' + m[1]).slice(-2) + '/' + m[2] : '';
}

/** "1.234,56" / "105,06" / "1.500" / 105.06 -> número */
function apiValor_(v) {
  if (typeof v === 'number') return apiR2_(v);
  let s = String(v || '').replace(/[^\d,.-]/g, '');
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // "1.500" = mil e quinhentos
  return apiR2_(Number(s));
}

function apiMoeda_(n) {
  const v = apiR2_(n), neg = v < 0;
  const p = Math.abs(v).toFixed(2).split('.');
  return (neg ? '-' : '') + 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
}

function apiR2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function apiAgora_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

/** Acrescenta à nota existente (não apaga notinhas antigas). */
function apiNota_(cel, texto) {
  const atual = cel.getNote();
  cel.setNote(atual ? atual + '\n' + texto : texto);
}

/** Aba "LOG DO APP": quem fez o quê e quando. Nunca atrapalha a gravação. */
function apiLog_(quem, acao, detalhe) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(API_ABA_LOG);
    if (!sh) {
      sh = ss.insertSheet(API_ABA_LOG, ss.getNumSheets());
      sh.getRange(1, 1, 1, 4).setValues([['Quando', 'Quem', 'O quê', 'Detalhe']])
        .setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 90); sh.setColumnWidth(3, 150); sh.setColumnWidth(4, 520);
    }
    sh.appendRow([new Date(), quem, acao, detalhe]);
    sh.getRange(sh.getLastRow(), 1).setNumberFormat('dd/MM/yyyy HH:mm');
  } catch (e) {}
}

/* ================= pessoas e chaves ================= */

function apiUsuarios_() {
  const raw = PropertiesService.getScriptProperties().getProperty(API_PROP_USUARIOS);
  return raw ? JSON.parse(raw) : {};
}

function apiSalvarUsuarios_(obj) {
  PropertiesService.getScriptProperties().setProperty(API_PROP_USUARIOS, JSON.stringify(obj));
}

function apiUsuarioDaChave_(token) {
  if (!token || String(token).length < 20) return null;
  return apiUsuarios_()[String(token)] || null;
}

function apiPublico_(u) {
  return { nome: u.nome, papel: u.papel };
}

/* ---------- menu 📱 App do celular ---------- */

function apiCriarChave() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  // endereços: pergunta só na primeira vez
  let urlPwa = props.getProperty(API_PROP_URL_PWA);
  if (!urlPwa) {
    const r = ui.prompt('App do celular', 'Endereço do app (GitHub Pages), ex.: https://seu-usuario.github.io/FINANCAS/', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    urlPwa = r.getResponseText().trim();
    if (!/^https:\/\//.test(urlPwa)) { ui.alert('O endereço precisa começar com https://'); return; }
    if (!urlPwa.endsWith('/')) urlPwa += '/';
    props.setProperty(API_PROP_URL_PWA, urlPwa);
  }
  let urlApi = props.getProperty(API_PROP_URL_API);
  if (!urlApi) {
    const r = ui.prompt('App do celular',
      'URL do App da Web deste script (Implantar → Gerenciar implantações → copie a URL que termina em /exec):',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    urlApi = r.getResponseText().trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(urlApi)) {
      ui.alert('A URL precisa começar com https://script.google.com/ e terminar em /exec'); return;
    }
    props.setProperty(API_PROP_URL_API, urlApi);
  }

  const rNome = ui.prompt('Criar chave de acesso', 'Nome da pessoa (ex.: Manu, José):', ui.ButtonSet.OK_CANCEL);
  if (rNome.getSelectedButton() !== ui.Button.OK) return;
  const nome = rNome.getResponseText().trim().slice(0, 30);
  if (!nome) { ui.alert('Informe um nome.'); return; }

  const pode = ui.alert('Criar chave de acesso',
    nome + ' pode LANÇAR pelo app?\n\nSIM = lança gastos, marca contas como pagas e cria o mês novo.\nNÃO = só vê.',
    ui.ButtonSet.YES_NO_CANCEL);
  if (pode === ui.Button.CANCEL || pode === ui.Button.CLOSE) return;

  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
  const us = apiUsuarios_();
  us[token] = { nome: nome, papel: pode === ui.Button.YES ? 'admin' : 'leitor', criadaEm: apiAgora_() };
  apiSalvarUsuarios_(us);

  const link = urlPwa + '#api=' + encodeURIComponent(urlApi) + '&chave=' + token;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.45">' +
    '<p><b>Chave criada para ' + esc(nome) + '.</b></p>' +
    '<p>Mande este link para o celular de ' + esc(nome) + ' (pelo WhatsApp, por exemplo) e abra no <b>Chrome</b>. O app já entra configurado.</p>' +
    '<textarea id="l" readonly style="width:100%;height:90px;font-size:12px">' + esc(link) + '</textarea>' +
    '<button onclick="var t=document.getElementById(\'l\');t.select();document.execCommand(\'copy\');this.innerText=\'Copiado!\'" ' +
    'style="margin-top:8px;padding:8px 14px;font-size:14px">Copiar link</button>' +
    '<p style="color:#b00;font-size:12px;margin-top:14px">Quem tiver este link consegue usar o app. Não poste em grupos.</p>' +
    '</div>'
  ).setWidth(520).setHeight(340);
  ui.showModalDialog(html, 'App do celular');
}

function apiListarChaves() {
  const us = apiUsuarios_();
  const linhas = Object.keys(us).map(k => {
    const u = us[k];
    return '• ' + u.nome + ' — ' + (u.papel === 'admin' ? 'pode lançar' : 'só vê') +
      ' (criada em ' + (u.criadaEm || '?') + ', chave …' + k.slice(-4) + ')';
  });
  const ui = SpreadsheetApp.getUi();
  ui.alert('Quem tem acesso ao app', linhas.length ? linhas.join('\n') : 'Ninguém ainda.', ui.ButtonSet.OK);
}

function apiRevogarChave() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Revogar acesso', 'Nome da pessoa (todas as chaves dela deixam de funcionar):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const nome = r.getResponseText().trim().toLowerCase();
  const us = apiUsuarios_();
  let n = 0;
  Object.keys(us).forEach(k => { if (String(us[k].nome).toLowerCase() === nome) { delete us[k]; n++; } });
  apiSalvarUsuarios_(us);
  ui.alert(n ? n + ' chave(s) revogada(s).' : 'Não achei ninguém com esse nome.');
}

/* ================= conferência (rode no editor) ================= */

/**
 * Confere se tudo que o app usa existe no projeto e se a leitura funciona.
 * No editor: escolha "apiTestar" e clique em Executar. Veja o resultado no Registro.
 * Não grava nada na planilha.
 */
function apiTestar() {
  const precisa = {
    'PLANILHA (Config.gs)': typeof PLANILHA !== 'undefined',
    'PREFIXO_FATURA (Config.gs)': typeof PREFIXO_FATURA !== 'undefined',
    'ABA_ENTRADAS (Config.gs)': typeof ABA_ENTRADAS !== 'undefined',
    'listarMeses (Dados.gs)': typeof listarMeses === 'function',
    'obterUltimoMes (Dados.gs)': typeof obterUltimoMes === 'function',
    'somarMeses (Dados.gs)': typeof somarMeses === 'function',
    'mesParaNumero (Dados.gs)': typeof mesParaNumero === 'function',
    'obterResumoMes (Dados.gs)': typeof obterResumoMes === 'function',
    'obterPendencias (Dados.gs)': typeof obterPendencias === 'function',
    'obterFluxo (Dados.gs)': typeof obterFluxo === 'function',
    'atualizarRelatorio (Relatorio.gs)': typeof atualizarRelatorio === 'function',
    'importarEntradas (Importar.gs)': typeof importarEntradas === 'function',
    'ID_FREELANCER (Importar.gs)': typeof ID_FREELANCER !== 'undefined',
    'ID_CARTAO (Importar.gs)': typeof ID_CARTAO !== 'undefined',
    'Faturas.gs': typeof apiFaturas_ === 'function'
  };
  const faltando = Object.keys(precisa).filter(k => !precisa[k]);
  console.log(faltando.length ? '❌ FALTANDO: ' + faltando.join(', ') : '✅ Todas as funções que o app usa existem.');

  const d = apiDadosMes_('');
  console.log('Mês ' + d.mes + ': entrou ' + apiMoeda_(d.cards.entrou) + ' · pago ' + apiMoeda_(d.cards.pago) +
    ' · falta ' + apiMoeda_(d.cards.aberto) + ' (' + d.cards.qtdAbertas + ' contas) · fecha com ' +
    apiMoeda_(d.cards.fechaMes) + ' · atrasado ' + apiMoeda_(d.cards.atrasado));
  const g = apiGraficos_('');
  console.log('Gráficos: ' + g.historico.length + ' meses no histórico, ' + g.fluxo.length + ' no fluxo.');
  const p = apiPreviaMes_();
  console.log('Próximo mês: ' + p.novo + (p.jaExiste ? ' (já existe)' : '') + ' · ' + p.copiar.length + ' contas fixas seriam copiadas.');
  if (typeof apiFaturas_ === 'function') {
    const f = apiFaturas_('Manu', '');
    console.log('Fatura Manu ' + f.fatura + ': total ' + apiMoeda_(f.totais.total) + ' · meu gasto ' + apiMoeda_(f.totais.meuGasto) +
      (f.totais.teto != null ? ' · teto ' + apiMoeda_(f.totais.teto) : '') + ' · ' + f.compras.length + ' compras, ' + f.parcelas.length + ' parcelas');
  }
  console.log('Chaves cadastradas: ' + Object.keys(apiUsuarios_()).length);
}
