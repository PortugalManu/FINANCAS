/**********************************************************************
 * Faturas.gs — tela FATURAS do app do celular (Manu e José)
 *
 * MANU: lê a planilha CARTÃO NUBANK - CONTROLE (abas Lançamentos, Parcelas,
 *   Pagamentos e Resumo) e importa o CSV do Nubank com a MESMA regra do
 *   importador que já existe lá (menu Nubank → Importar fatura):
 *   - ignora o que já está na planilha (pode importar o mesmo arquivo de novo)
 *   - categoria pela aba Regras
 *   - parcelado: só a parcela 1 entra (as próximas já estão na aba Parcelas)
 *   - confere a aba CARTÕES do Freelancer para marcar "Empresa do pai"
 *   - "Pagamento recebido" depois do dia 12 vira pagamento adiantado
 *   As colunas de fatura dessas abas são fórmulas e não são tocadas.
 *
 * JOSÉ: aba "Lançamentos José" na mesma planilha do cartão (criada sozinha).
 *   Cada CSV é UMA fatura (o vencimento vem do nome do arquivo, ex.:
 *   Nubank_2026-12-08.csv = fatura dez./2026). Reimportar a mesma fatura
 *   troca as linhas dela pelas do arquivo novo.
 *
 * Depois de importar, atualiza o valor da linha FATURA MANU / FATURA JOSÉ
 * do mês na planilha GASTOS (só se a linha ainda NÃO estiver paga).
 *
 * Usa: Importar.gs (ID_CARTAO, ID_FREELANCER), Api.gs (ajudantes api*_).
 **********************************************************************/

const FAT = {
  ABA_LANC: 'Lançamentos',
  ABA_PARC: 'Parcelas',
  ABA_PAG: 'Pagamentos',
  ABA_REGRAS: 'Regras',
  ABA_RESUMO: 'Resumo',
  ABA_JOSE: 'Lançamentos José',
  ABA_CARTOES: 'CARTÕES',        // na planilha do Freelancer
  NOME_CARTAO: 'Manu',           // coluna "Cartão" da aba CARTÕES
  PAI: 'Empresa do pai',
  LINHA: { Manu: 'FATURA MANU', 'José': 'FATURA JOSÉ' }
};

const FAT_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ================= leitura: tela Faturas ================= */

/** { pessoa: 'Manu'|'José', fatura: 'MM/AAAA' (vencimento) } */
function apiFaturas_(pessoa, fatura) {
  return pessoa === 'José' ? fatDadosJose_(fatura) : fatDadosManu_(fatura);
}

function fatPlanilhaCartao_() {
  if (typeof ID_CARTAO === 'undefined') throw new Error('ID_CARTAO não encontrado (Importar.gs).');
  return SpreadsheetApp.openById(ID_CARTAO);
}

function fatDadosManu_(fatura) {
  const ss = fatPlanilhaCartao_();
  const lanc = fatLinhas_(ss.getSheetByName(FAT.ABA_LANC), 6);
  const parc = fatLinhas_(ss.getSheetByName(FAT.ABA_PARC), 7);
  const pag = fatLinhas_(ss.getSheetByName(FAT.ABA_PAG), 4);

  // faturas que existem: as da tabela do Resumo + as que têm compra lançada
  const tetos = fatTetos_(ss);
  const conjunto = {};
  Object.keys(tetos).forEach(f => { conjunto[f] = 1; });
  lanc.forEach(r => { const f = fatMes_(r[4]); if (f) conjunto[f] = 1; });
  const faturas = Object.keys(conjunto).sort((a, b) => mesParaNumero(b) - mesParaNumero(a));

  const atual = fatAtual_();
  if (!fatura || !conjunto[fatura]) fatura = conjunto[atual] ? atual : (faturas[0] || atual);
  const nF = mesParaNumero(fatura);

  const compras = lanc.filter(r => fatMes_(r[4]) === fatura && r[1] !== '')
    .map(r => ({ data: fatDataBR_(r[0]), dataISO: fatISO_(r[0]), descricao: String(r[1]), categoria: String(r[2] || 'Outros'),
                 valor: apiR2_(Number(r[3]) || 0), pai: String(r[5]).trim() === FAT.PAI }))
    .sort((a, b) => a.dataISO < b.dataISO ? 1 : -1);

  const parcelas = parc.filter(r => {
    const ini = fatMes_(r[3]); const n = Number(r[4]) || 0;
    if (!ini || !n || r[0] === '') return false;
    const i = mesParaNumero(ini);
    return nF >= i && nF <= i + n - 1;
  }).map(r => {
    const i = mesParaNumero(fatMes_(r[3]));
    return { descricao: String(r[0]), categoria: String(r[1] || 'Outros'), valor: apiR2_(Number(r[2]) || 0),
             parcela: (nF - i + 1) + '/' + Number(r[4]), pai: String(r[6]).trim() === FAT.PAI };
  });

  const jaPago = pag.filter(r => fatMes_(r[2]) === fatura).reduce((s, r) => s + (Number(r[1]) || 0), 0);
  const tComp = compras.reduce((s, x) => s + x.valor, 0);
  const tParc = parcelas.reduce((s, x) => s + x.valor, 0);
  const pai = compras.concat(parcelas).filter(x => x.pai).reduce((s, x) => s + x.valor, 0);
  const total = tComp + tParc;
  const meuGasto = total - pai;
  const teto = tetos[fatura] != null ? tetos[fatura] : null;

  return Object.assign({
    pessoa: 'Manu',
    fatura: fatura,
    atual: atual,
    faturas: faturas,
    totais: {
      compras: apiR2_(tComp), parcelas: apiR2_(tParc), total: apiR2_(total),
      pai: apiR2_(pai), meuGasto: apiR2_(meuGasto), jaPago: apiR2_(jaPago),
      falta: apiR2_(total - jaPago), teto: teto == null ? null : apiR2_(teto),
      disponivel: teto == null ? null : apiR2_(teto - meuGasto)
    },
    categorias: fatPorCategoria_(compras.concat(parcelas)),
    compras: compras,
    parcelas: parcelas
  }, fatLinhaGastos_(fatura, 'Manu', meuGasto));
}

function fatDadosJose_(fatura) {
  const aba = fatPlanilhaCartao_().getSheetByName(FAT.ABA_JOSE);
  const linhas = aba ? fatLinhas_(aba, 6) : [];
  const conjunto = {};
  linhas.forEach(r => { const f = fatMes_(r[4]); if (f) conjunto[f] = 1; });
  const faturas = Object.keys(conjunto).sort((a, b) => mesParaNumero(b) - mesParaNumero(a));
  if (!fatura) fatura = faturas[0] || fatAtual_();

  const compras = linhas.filter(r => fatMes_(r[4]) === fatura && r[1] !== '')
    .map(r => ({ data: fatDataBR_(r[0]), dataISO: fatISO_(r[0]), descricao: String(r[1]), categoria: String(r[2] || 'Outros'),
                 valor: apiR2_(Number(r[3]) || 0), pai: false }))
    .sort((a, b) => a.dataISO < b.dataISO ? 1 : -1);
  const total = compras.reduce((s, x) => s + x.valor, 0);
  const importadoEm = linhas.filter(r => fatMes_(r[4]) === fatura).map(r => String(r[5] || ''))[0] || '';

  return Object.assign({
    pessoa: 'José',
    fatura: fatura,
    atual: fatAtual_(),
    faturas: faturas,
    temAba: !!aba,
    importadoEm: importadoEm,
    totais: { compras: apiR2_(total), parcelas: 0, total: apiR2_(total), pai: 0, meuGasto: apiR2_(total),
              jaPago: 0, falta: apiR2_(total), teto: null, disponivel: null },
    categorias: fatPorCategoria_(compras),
    compras: compras,
    parcelas: []
  }, fatLinhaGastos_(fatura, 'José', total));
}

/** Como está a linha FATURA MANU/JOSÉ do mês na planilha GASTOS. */
function fatLinhaGastos_(fatura, pessoa, valorFatura) {
  const nome = FAT.LINHA[pessoa];
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(fatura);
  if (!aba) return { gastos: { mes: fatura, existeMes: false, nome: nome } };
  const l = fatAcharLinha_(aba, nome);
  return { gastos: {
    mes: fatura, existeMes: true, nome: nome,
    existeLinha: !!l, valor: l ? l.valor : null, pago: l ? l.pago : false,
    difere: !l || Math.abs(l.valor - apiR2_(valorFatura)) > 0.004,
    valorFatura: apiR2_(valorFatura)
  } };
}

function fatPorCategoria_(itens) {
  const m = {};
  itens.forEach(x => { m[x.categoria] = (m[x.categoria] || 0) + x.valor; });
  return Object.keys(m).map(k => ({ categoria: k, total: apiR2_(m[k]) })).sort((a, b) => b.total - a.total);
}

/** Teto por fatura, da tabela "Dados do gráfico" do Resumo (K15:N40). */
function fatTetos_(ss) {
  const aba = ss.getSheetByName(FAT.ABA_RESUMO);
  const t = {};
  if (!aba) return t;
  aba.getRange('K16:N40').getValues().forEach(r => {
    const f = fatMes_(r[0]);
    if (f) t[f] = Number(r[3]) || 0;
  });
  return t;
}

/* ================= escrita: importar CSV ================= */

/**
 * req = { pessoa, fatura ('MM/AAAA' do vencimento), csv (texto), arquivo }
 * Devolve o resumo da importação e já atualiza a linha FATURA do mês na GASTOS.
 */
function apiImportarFatura_(req, autor) {
  const pessoa = req.pessoa === 'José' ? 'José' : 'Manu';
  if (!/^\d{2}\/\d{4}$/.test(String(req.fatura || ''))) throw new Error('Escolha de qual fatura (mês do vencimento) é o arquivo.');
  const itens = fatLerCsv_(String(req.csv || ''));
  if (!itens.length) throw new Error('Não encontrei lançamentos no arquivo. Confira se é o CSV da fatura do Nubank.');

  const r = pessoa === 'José' ? fatImportarJose_(itens, req.fatura) : fatImportarManu_(itens);
  SpreadsheetApp.flush();

  // valor da fatura já recalculado → linha FATURA do mês na GASTOS
  const dados = apiFaturas_(pessoa, req.fatura);
  r.linha = fatAtualizarLinha_(req.fatura, pessoa, dados.totais.meuGasto, autor);

  apiLog_(autor, 'Importou fatura ' + pessoa, req.fatura + ' · ' + (req.arquivo || 'CSV') + ' · ' +
    (pessoa === 'José' ? r.compras + ' lançamentos' : r.compras + ' compras novas, ' + r.parcelados + ' parcelamentos novos, ' + r.repetidos + ' repetidos') +
    ' · ' + r.linha.msg);

  r.gravado = true;
  r.pessoa = pessoa;
  r.fatura = req.fatura;
  r.msg = 'Fatura ' + fatRotulo_(req.fatura) + ' de ' + pessoa + ' importada.';
  return r;
}

/** Mesma regra do importador da planilha do cartão (Codigo.gs → importarCsv). */
function fatImportarManu_(itens) {
  const ss = fatPlanilhaCartao_();
  const abaL = ss.getSheetByName(FAT.ABA_LANC);
  const abaP = ss.getSheetByName(FAT.ABA_PARC);
  const abaG = ss.getSheetByName(FAT.ABA_PAG);
  if (!abaL || !abaP || !abaG) throw new Error('Não encontrei as abas Lançamentos, Parcelas e Pagamentos na planilha do cartão.');
  const regras = fatRegras_(ss);

  const nL = fatUltimaLinha_(abaL, 1);
  const lanc = nL > 1 ? abaL.getRange(2, 1, nL - 1, 6).getValues() : [];
  const existentes = lanc.map(r => ({ data: r[0], k: fatChave_(r[1]), valor: Number(r[3]), pai: r[5] === FAT.PAI, usado: false }));

  const nP = fatUltimaLinha_(abaP, 1);
  const parc = nP > 1 ? abaP.getRange(2, 1, nP - 1, 7).getValues() : [];
  const parcelas = parc.map(r => ({ valor: Number(r[2]), primeira: r[3], pai: r[6] === FAT.PAI }));

  const nG = fatUltimaLinha_(abaG, 1);
  const pag = nG > 1 ? abaG.getRange(2, 1, nG - 1, 2).getValues() : [];

  // o que já foi marcado como da empresa do pai consome as linhas da CARTÕES
  const cartoes = fatLerCartoes_();
  existentes.forEach(e => { if (e.pai && e.data instanceof Date) fatAcharNoCartoes_(cartoes, e.data, e.valor); });
  parcelas.forEach(p => {
    if (p.pai && p.primeira instanceof Date) {
      fatAcharNoCartoes_(cartoes, new Date(p.primeira.getFullYear(), p.primeira.getMonth() - 1, 15), p.valor);
    }
  });

  const novosL = [], novosP = [], novosG = [], outros = [], doPai = [];
  let repetidos = 0;

  itens.forEach(it => {
    // pagamentos
    if (/^pagamento recebido/i.test(it.desc)) {
      const v = Math.abs(it.valor);
      // até o dia 12 é pagamento da fatura que acabou de fechar
      if (it.data.getDate() <= 12) return;
      const ja = pag.some(p => p[0] instanceof Date && fatDifDias_(p[0], it.data) < 1 && Math.abs(Number(p[1]) - v) < 0.01);
      if (!ja) novosG.push([it.data, v, '', 'Pagamento adiantado (importado pelo app)']);
      else repetidos++;
      return;
    }

    // compras parceladas
    const mp = it.desc.match(/\s*-\s*Parcela\s+(\d+)\/(\d+)/i);
    if (mp) {
      if (Number(mp[1]) !== 1) return; // parcelas seguintes já estão projetadas na aba Parcelas
      const primeira = fatFaturaDe_(it.data);
      const jaP = parcelas.some(p => p.primeira instanceof Date && fatMesmoMes_(p.primeira, primeira) && Math.abs(p.valor - it.valor) <= 0.10);
      if (jaP) { repetidos++; return; }
      const base = it.desc.replace(mp[0], '').trim();
      const catP = fatCategoria_(base, regras);
      const paiP = fatAcharNoCartoes_(cartoes, it.data, it.valor);
      novosP.push([base, catP, it.valor, primeira, Number(mp[2]), paiP ? FAT.PAI : 'Eu']);
      parcelas.push({ valor: it.valor, primeira: primeira, pai: paiP });
      if (paiP) doPai.push(base + ' (' + mp[2] + 'x de ' + apiMoeda_(it.valor) + ')');
      if (catP === 'Outros') outros.push(base);
      return;
    }

    // compras à vista e estornos
    const k = fatChave_(it.desc);
    let achou = null;
    for (let i = 0; i < existentes.length; i++) {
      const e = existentes[i];
      if (!e.usado && e.data instanceof Date && e.k === k &&
          Math.abs(e.valor - it.valor) < 0.01 && fatDifDias_(e.data, it.data) <= 3) { achou = e; break; }
    }
    if (achou) { achou.usado = true; repetidos++; return; }

    const cat = fatCategoria_(it.desc, regras);
    const pai = it.valor > 0 && fatAcharNoCartoes_(cartoes, it.data, it.valor);
    novosL.push([it.data, it.desc, cat, it.valor, pai ? FAT.PAI : 'Eu']);
    if (pai) doPai.push(it.desc + ' (' + apiMoeda_(it.valor) + ')');
    if (cat === 'Outros') outros.push(it.desc);
  });

  // gravação (as colunas de fatura são fórmulas e não são tocadas)
  if (novosL.length) {
    novosL.sort((a, b) => a[0] - b[0]);
    const ini = fatUltimaLinha_(abaL, 1) + 1;
    fatGarantirLinhas_(abaL, ini + novosL.length - 1);
    abaL.getRange(ini, 1, novosL.length, 4).setValues(novosL.map(r => r.slice(0, 4)));
    abaL.getRange(ini, 6, novosL.length, 1).setValues(novosL.map(r => [r[4]]));
  }
  if (novosP.length) {
    const iniP = fatUltimaLinha_(abaP, 1) + 1;
    fatGarantirLinhas_(abaP, iniP + novosP.length - 1);
    abaP.getRange(iniP, 1, novosP.length, 5).setValues(novosP.map(r => r.slice(0, 5)));
    abaP.getRange(iniP, 7, novosP.length, 1).setValues(novosP.map(r => [r[5]]));
  }
  if (novosG.length) {
    const iniG = fatUltimaLinha_(abaG, 1) + 1;
    fatGarantirLinhas_(abaG, iniG + novosG.length - 1);
    abaG.getRange(iniG, 1, novosG.length, 2).setValues(novosG.map(r => r.slice(0, 2)));
    abaG.getRange(iniG, 4, novosG.length, 1).setValues(novosG.map(r => [r[3]]));
  }

  return { compras: novosL.length, parcelados: novosP.length, pagamentos: novosG.length,
           repetidos: repetidos, doPai: doPai, outros: outros };
}

/** José: o arquivo inteiro é a fatura `fatura`; troca as linhas dela pelas do arquivo. */
function fatImportarJose_(itens, fatura) {
  const ss = fatPlanilhaCartao_();
  const regras = fatRegras_(ss);
  let aba = ss.getSheetByName(FAT.ABA_JOSE);
  if (!aba) {
    aba = ss.insertSheet(FAT.ABA_JOSE);
    aba.getRange(1, 1, 1, 6).setValues([['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Fatura (vencimento)', 'Importado em']])
       .setFontWeight('bold').setBackground('#820ad1').setFontColor('#ffffff');
    aba.setFrozenRows(1);
    aba.setColumnWidth(1, 100); aba.setColumnWidth(2, 260); aba.setColumnWidth(3, 170);
    aba.setColumnWidth(4, 110); aba.setColumnWidth(5, 150); aba.setColumnWidth(6, 140);
  }

  const venc = fatDataFatura_(fatura);
  const quando = apiAgora_();
  const novas = itens
    .filter(it => !/^pagamento recebido/i.test(it.desc))
    .map(it => [it.data, it.desc, fatCategoria_(it.desc.replace(/\s*-\s*Parcela\s+\d+\/\d+/i, ''), regras), it.valor, venc, quando])
    .sort((a, b) => a[0] - b[0]);

  // tira as linhas antigas dessa fatura (de baixo para cima)
  let removidas = 0;
  const n = fatUltimaLinha_(aba, 1);
  if (n > 1) {
    const vals = aba.getRange(2, 5, n - 1, 1).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (fatMes_(vals[i][0]) === fatura) { aba.deleteRow(i + 2); removidas++; }
    }
  }
  if (novas.length) {
    const ini = fatUltimaLinha_(aba, 1) + 1;
    fatGarantirLinhas_(aba, ini + novas.length - 1);
    aba.getRange(ini, 1, novas.length, 6).setValues(novas);
    aba.getRange(ini, 1, novas.length, 1).setNumberFormat('dd/mm/yyyy');
    aba.getRange(ini, 4, novas.length, 1).setNumberFormat('R$ #,##0.00;-R$ #,##0.00');
    aba.getRange(ini, 5, novas.length, 1).setNumberFormat('mmm/yyyy');
  }
  const outros = novas.filter(r => r[2] === 'Outros').map(r => r[1]);
  return { compras: novas.length, substituidas: removidas, parcelados: 0, pagamentos: 0, repetidos: 0, doPai: [], outros: outros };
}

/* ================= linha FATURA do mês na GASTOS ================= */

/**
 * Põe `valor` na linha FATURA MANU/JOSÉ da aba do mês.
 * Não mexe se a linha já estiver paga. Cria a linha se não existir.
 */
function fatAtualizarLinha_(mes, pessoa, valor, autor) {
  const nome = FAT.LINHA[pessoa];
  valor = apiR2_(valor);
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(mes);
  if (!aba) return { mudou: false, msg: 'A aba ' + mes + ' ainda não existe: o valor entra quando você criar o mês.' };

  const l = fatAcharLinha_(aba, nome);
  if (l && l.pago) {
    return { mudou: false, msg: nome + ' de ' + mes + ' já está paga (' + apiMoeda_(l.valor) + '): não mexi no valor.' };
  }
  if (l && Math.abs(l.valor - valor) < 0.005) {
    return { mudou: false, msg: nome + ' de ' + mes + ' já estava com ' + apiMoeda_(valor) + '.' };
  }
  if (l) {
    aba.getRange(l.linha, PLANILHA.COL_VALOR).setValue(valor);
    apiNota_(aba.getRange(l.linha, PLANILHA.COL_VALOR),
      'Atualizado pelo app em ' + apiAgora_() + ' — ' + autor + '. Antes: ' + apiMoeda_(l.valor) + '.');
    return { mudou: true, antes: l.valor, msg: nome + ' de ' + mes + ': ' + apiMoeda_(l.valor) + ' → ' + apiMoeda_(valor) + '.' };
  }

  // não existe: cria no fim, como conta fixa não paga (vence no mesmo dia da outra FATURA, se houver)
  const outra = fatAcharLinha_(aba, PREFIXO_FATURA);
  const linha = apiProximaLinha_(aba);
  if (linha > aba.getMaxRows()) aba.insertRowsAfter(aba.getMaxRows(), linha - aba.getMaxRows());
  const nova = new Array(PLANILHA.TOTAL_COLUNAS).fill('');
  nova[PLANILHA.COL_DESPESA - 1] = nome;
  nova[PLANILHA.COL_VALOR - 1] = valor;
  nova[PLANILHA.COL_PAGO - 1] = 'NÃO';
  nova[PLANILHA.COL_TIPO - 1] = 'Fixo';
  nova[PLANILHA.COL_VENCE - 1] = outra ? outra.vence : '';
  if (linha > PLANILHA.PRIMEIRA_LINHA) {
    aba.getRange(linha - 1, 1, 1, PLANILHA.TOTAL_COLUNAS).copyFormatToRange(aba, 1, PLANILHA.TOTAL_COLUNAS, linha, linha);
  }
  aba.getRange(linha, 1, 1, PLANILHA.TOTAL_COLUNAS).setValues([nova]);
  apiNota_(aba.getRange(linha, PLANILHA.COL_DESPESA), 'Criado pelo app em ' + apiAgora_() + ' — ' + autor + '.');
  return { mudou: true, antes: null, msg: nome + ' criada em ' + mes + ' com ' + apiMoeda_(valor) + '.' };
}

/** Botão "Atualizar" da tela Faturas: copia o valor da fatura para a linha da GASTOS. */
function apiAtualizarLinhaFatura_(req, autor) {
  const pessoa = req.pessoa === 'José' ? 'José' : 'Manu';
  const d = apiFaturas_(pessoa, req.fatura);
  if (Math.abs(d.totais.meuGasto - Number(req.valor)) > 0.004) {
    throw new Error('A fatura mudou desde a última atualização. Atualize o app e tente de novo.');
  }
  const r = fatAtualizarLinha_(req.fatura, pessoa, d.totais.meuGasto, autor);
  if (r.mudou) apiLog_(autor, 'Atualizou ' + FAT.LINHA[pessoa], r.msg);
  return { gravado: r.mudou, msg: r.msg, pessoa: pessoa, fatura: req.fatura };
}

/** Ao criar o mês novo: já põe o valor das faturas que existirem para aquele vencimento. */
function fatPreencherMesNovo_(mes, autor) {
  const msgs = [];
  ['Manu', 'José'].forEach(p => {
    try {
      const d = apiFaturas_(p, mes);
      if (d.fatura !== mes || !(d.compras.length || d.parcelas.length)) return;
      const r = fatAtualizarLinha_(mes, p, d.totais.meuGasto, autor);
      if (r.mudou) msgs.push(r.msg);
    } catch (e) { console.warn('Fatura de ' + p + ' não preenchida: ' + e.message); }
  });
  return msgs;
}

function fatAcharLinha_(aba, prefixo) {
  const ultima = aba.getLastRow();
  if (ultima < PLANILHA.PRIMEIRA_LINHA) return null;
  const vals = aba.getRange(PLANILHA.PRIMEIRA_LINHA, 1, ultima - PLANILHA.PRIMEIRA_LINHA + 1, PLANILHA.TOTAL_COLUNAS).getValues();
  const alvo = apiNorm_(prefixo);
  for (let i = 0; i < vals.length; i++) {
    if (apiNorm_(vals[i][PLANILHA.COL_DESPESA - 1]).indexOf(alvo) === 0) {
      return { linha: PLANILHA.PRIMEIRA_LINHA + i, valor: apiR2_(Number(vals[i][PLANILHA.COL_VALOR - 1]) || 0),
               pago: apiNorm_(vals[i][PLANILHA.COL_PAGO - 1]) === 'SIM', vence: apiVence_(vals[i][PLANILHA.COL_VENCE - 1]) };
    }
  }
  return null;
}

/* ================= ajudantes ================= */

/** CSV do Nubank: date,title,amount — valor "1.234,56" ou "- 40,00". */
function fatLerCsv_(texto) {
  const linhas = texto.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
  const itens = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (!l) continue;
    const m = l.match(/^(\d{4}-\d{2}-\d{2}),(.*),"([^"]*)"$/) || l.match(/^(\d{4}-\d{2}-\d{2}),(.*),([^,]*)$/);
    if (!m) continue;
    const p = m[1].split('-').map(Number);
    const valor = Number(String(m[3]).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
    if (!isFinite(valor)) continue;
    itens.push({ data: new Date(p[0], p[1] - 1, p[2]), desc: m[2].replace(/^"|"$/g, '').replace(/""/g, '"').trim(), valor: valor });
  }
  return itens;
}

function fatRegras_(ss) {
  const aba = ss.getSheetByName(FAT.ABA_REGRAS);
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, 2).getValues()
    .filter(r => r[0] !== '' && r[1] !== '')
    .map(r => [String(r[0]).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), String(r[1])]);
}

function fatCategoria_(desc, regras) {
  const d = String(desc).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (let i = 0; i < regras.length; i++) if (d.indexOf(regras[i][0]) !== -1) return regras[i][1];
  return 'Outros';
}

/** Igual ao importador: IOF vira "iof"; senão as 6 primeiras letras/números. */
function fatChave_(desc) {
  if (/^iof\b/i.test(String(desc).trim())) return 'iof';
  return String(desc).toLowerCase().replace(/\(.*?\)/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 6);
}

function fatLerCartoes_() {
  try {
    const aba = SpreadsheetApp.openById(ID_FREELANCER).getSheetByName(FAT.ABA_CARTOES);
    if (!aba) return [];
    return aba.getDataRange().getValues()
      .filter(r => r[0] instanceof Date && String(r[2]).trim() === FAT.NOME_CARTAO && typeof r[3] === 'number')
      .map(r => ({ data: r[0], valor: r[3], usado: false }));
  } catch (e) {
    return [];
  }
}

function fatAcharNoCartoes_(cartoes, data, valor) {
  for (let i = 0; i < cartoes.length; i++) {
    const c = cartoes[i];
    if (c.usado) continue;
    if (Math.abs(c.valor - valor) <= 0.05 && fatDifDias_(c.data, data) <= 3) { c.usado = true; return true; }
  }
  return false;
}

/** Compras de um mês caem na fatura que vence dia 08 do mês seguinte. */
function fatFaturaDe_(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 8); }
function fatDataFatura_(mes) { const p = mes.split('/').map(Number); return new Date(p[1], p[0] - 1, 8); }
function fatDifDias_(a, b) { return Math.abs(a.getTime() - b.getTime()) / 86400000; }
function fatMesmoMes_(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }

/** Data, "dez./2026", "dez./26" ou "12/2026" -> "12/2026" ('' se não der). */
function fatMes_(v) {
  if (v instanceof Date) return ('0' + (v.getMonth() + 1)).slice(-2) + '/' + v.getFullYear();
  const s = String(v == null ? '' : v).trim().toLowerCase();
  let m = s.match(/^([a-zç]{3})\.?\/(\d{2}|\d{4})$/);
  if (m) {
    const i = FAT_MESES.indexOf(m[1]);
    if (i === -1) return '';
    return ('0' + (i + 1)).slice(-2) + '/' + (m[2].length === 2 ? '20' + m[2] : m[2]);
  }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  return m ? ('0' + m[1]).slice(-2) + '/' + m[2] : '';
}

function fatRotulo_(mes) { const p = mes.split('/'); return FAT_MESES[Number(p[0]) - 1] + './' + p[1]; }

/** Fatura que vence no mês seguinte ao de hoje (igual ao Resumo: EOMONTH(hoje)+8). */
function fatAtual_() {
  const h = new Date();
  return fatMes_(new Date(h.getFullYear(), h.getMonth() + 1, 8));
}

function fatDataBR_(d) { return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM') : String(d || ''); }
function fatISO_(d) { return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; }

function fatLinhas_(aba, colunas) {
  if (!aba) return [];
  const n = fatUltimaLinha_(aba, 1);
  return n > 1 ? aba.getRange(2, 1, n - 1, colunas).getValues() : [];
}

function fatUltimaLinha_(aba, coluna) {
  const vals = aba.getRange(1, coluna, aba.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '' && vals[i][0] !== null) return i + 1;
  return 1;
}

function fatGarantirLinhas_(aba, ate) {
  if (ate > aba.getMaxRows()) aba.insertRowsAfter(aba.getMaxRows(), ate - aba.getMaxRows());
}
