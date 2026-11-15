# Finanças: app do celular da planilha GASTOS JOSÉ/MANU

Mesmo modelo do app do Freelancer: o app fica no GitHub Pages e conversa com a planilha por uma "porta" (`Api.gs`) publicada como App da Web.

```
/ (raiz)        → o app (index.html, app.js, styles.css, sw.js, manifest, icons/)
apps-script/
├── Api.gs      (script da planilha GASTOS: a porta do app)
└── Faturas.gs  (script da planilha GASTOS: tela Faturas e importação do CSV)
```

> Este repositório é **público**: nenhum ID de planilha, URL da API ou chave fica aqui. Tudo isso fica só na planilha e no celular.

**O que o app faz:**
- **Mês:** quanto entrou, o que já foi pago, o que falta pagar (por vencimento, em vermelho o que venceu), atrasadas de meses anteriores, o que passou no cartão e as entradas do mês.
- **Pagar:** marca a conta como paga e pergunta quem pagou. Antes de gravar, confere o nome e o valor da linha, porque existem 3 linhas "MRV".
- **+ Gasto:** lança na aba do mês. "Como pagou?" é obrigatório. No cartão de crédito, o gasto não soma no total, porque entra pela FATURA. Conta de boleto no crédito pede confirmação, e um gasto igual (mesmo nome e valor) já lançado no mês avisa antes de gravar.
- **Criar o mês novo:** mesma regra do menu (copia as fixas, marca tudo como não pago e avança as parcelas). Antes de criar, mostra a prévia do que vai ser copiado.
- **Gráficos:** quem pagou no mês, gastos por mês (fixas × variáveis) e entrou × saiu.
- **Faturas (Manu / José):** a fatura de cada mês, com compras, parcelas, empresa do pai, meu gasto, teto e o que falta pagar.
  - **Manu:** os dados vêm da planilha CARTÃO NUBANK - CONTROLE. O botão **Importar fatura (CSV)** usa a mesma regra do menu Nubank: o que já está lá é ignorado, parcelado só entra a parcela 1, o que bate com a aba CARTÕES vira "Empresa do pai" e pagamento recebido depois do dia 12 vira pagamento adiantado.
  - **José:** o CSV vai para a aba **Lançamentos José** da planilha do cartão (criada sozinha na primeira importação), com as categorias da aba Regras. Cada arquivo é uma fatura; importar de novo a mesma fatura troca os lançamentos dela.
  - O mês da fatura vem do nome do arquivo (`Nubank_2026-12-08.csv` = dez./2026) e dá para trocar antes de importar.
  - Depois de importar, a linha **FATURA MANU / FATURA JOSÉ** do mês na GASTOS recebe o valor da fatura, desde que ainda não esteja paga. Linha paga nunca é mudada pelo app. Se a aba do mês ainda não existe, o valor entra sozinho quando você criar o mês.
- **Diárias do José:** são puxadas sozinhas da planilha do Freelancer quando o app abre (no máximo a cada 10 minutos, e só se algo mudou).
- Os números saem das mesmas funções do RELATORIO, então app e planilha batem sempre. Depois de cada gravação, o RELATORIO é atualizado.
- Um toque duplo grava uma vez só. Cada ação fica registrada na aba **LOG DO APP** e numa notinha na célula.

---

## Instalação (uns 15 minutos, pelo computador)

### 1. Colocar a porta no script da planilha
1. Abra a planilha **GASTOS JOSÉ/MANU** → **Extensões → Apps Script**.
2. Se na lista de arquivos existirem `App` (script) e `App` (HTML), **apague os dois** (⋮ ao lado do nome → Excluir). Eles têm um `doGet`, e o projeto só pode ter um.
3. Clique em `+` → **Script** → nome **`Api`** → cole o conteúdo de [`apps-script/Api.gs`](apps-script/Api.gs).
   Depois, `+` → **Script** → nome **`Faturas`** → cole o conteúdo de [`apps-script/Faturas.gs`](apps-script/Faturas.gs).
4. Abra o **`Menu.gs`** e, logo antes de `.addToUi()`, cole estas linhas:
   ```javascript
       .addSeparator()
       .addSubMenu(SpreadsheetApp.getUi().createMenu('📱 App do celular')
         .addItem('Criar chave de acesso', 'apiCriarChave')
         .addItem('Quem tem acesso', 'apiListarChaves')
         .addItem('Revogar acesso', 'apiRevogarChave'))
   ```
5. Clique em 💾 **Salvar**.
6. **Conferência:** no topo do editor, escolha a função **`apiTestar`** e clique em **Executar**. No registro deve aparecer `✅ Todas as funções que o app usa existem` e os números do mês. Se aparecer `❌ FALTANDO`, me mande o print.

### 2. Publicar a porta (App da Web)
1. **Implantar → Nova implantação** → engrenagem ⚙️ → **App da Web**.
2. Descrição: `app financas` · Executar como: **Eu** · Quem pode acessar: **Qualquer pessoa**.
3. **Implantar** → **Autorizar acesso**. O Google vai avisar que o app não foi verificado, o que é normal porque o app é seu: clique em **Avançado → Acessar (não seguro) → Permitir**.
4. Copie a **URL do App da Web** (termina em `/exec`).

> "Qualquer pessoa" não quer dizer que qualquer um entra. Sem uma chave válida, a porta recusa tudo.

> **Quando vier uma versão nova do `Api.gs`:** cole o código e vá em **Implantar → Gerenciar implantações → ✏️ editar → Versão: Nova versão → Implantar**. A URL continua a mesma. Se usar "Nova implantação", a URL muda e o app perde a conexão.

### 3. App no ar (GitHub Pages)
No GitHub: **Settings → Pages → Branch: `master` / pasta `/ (root)` → Save**. Em 1 ou 2 minutos o app fica em `https://portugalmanu.github.io/FINANCAS/`.

### 4. Criar a chave e instalar no celular
1. Recarregue a planilha (F5) → **📊 Financeiro → 📱 App do celular → Criar chave de acesso**.
2. Na primeira vez, o script pede os dois endereços: o do app (`https://portugalmanu.github.io/FINANCAS/`) e a URL `/exec` do passo 2.
3. Nome `Manu` → "pode lançar?" **SIM**. Copie o link e mande para você mesma no WhatsApp.
4. No celular, abra o link no **Chrome**. O app já entra configurado. Depois, **⋮ → Instalar app**.

**Para o José:** faça o mesmo com o nome `José`. Responda **SIM** se ele também for lançar, ou **NÃO** se for só para ver. Ele não precisa ter acesso à planilha.
Para cortar o acesso de alguém: **📱 App do celular → Revogar acesso**.

---

## Testes
A porta foi testada com uma cópia dos dados de 05, 06, 07, 10 e 11/2026 e da fatura dez./26, simulando o Google por baixo (48 testes do mês e 46 das faturas, com o CSV real `Nubank_2026-12-08.csv`). O app foi testado no tamanho de um celular contra esse simulador. Os testes não ficam neste repositório porque ele é público e eles contêm os valores.

Com os dados de 11/2026, o app mostra: entrou R$ 6.661,15 − já pago R$ 6.780,98 − falta pagar R$ 2.043,27 (7 contas) = **fecha com −R$ 2.163,10**, e atrasado R$ 1.065,64 (UNIÃO 05 a 07/26).

## Próxima etapa
- Importação do **PDF** da fatura.
