# Finanças

App web de finanças pessoais, em português e em reais (R$). Sem dependências e sem build: é só abrir o `index.html` no navegador.

## Funcionalidades

- Receitas e despesas com descrição, valor, data e categoria
- Editar e excluir transações
- Navegação mês a mês, com saldo do mês e saldo acumulado
- Gráfico de despesas por categoria
- Orçamento mensal por categoria, com alerta quando o limite é passado
- Busca e filtro por tipo
- Exportação para CSV (abre no Excel) e backup/restauração em JSON
- Tema claro/escuro e layout para celular

Os dados ficam salvos no `localStorage` do navegador (não saem do seu aparelho). Faça backups em JSON de vez em quando.

## Como rodar

Abra `index.html` no navegador, ou sirva a pasta:

```bash
python3 -m http.server 8000
```
