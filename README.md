# Volt — Dashboard de monitoramento de energia

[![Testes](https://github.com/Guiandrelino/dash-node/actions/workflows/tests.yml/badge.svg)](https://github.com/Guiandrelino/dash-node/actions/workflows/tests.yml)

Dashboard para acompanhar leituras elétricas de cinco setores, com coleta automática via Node-RED e histórico local em SQLite. Desenvolvido com HTML, CSS, JavaScript e Node.js, sem dependências externas no aplicativo.

## Destaques

- Interface responsiva com corrente, tensão e potência estimada por setor.
- Backend HTTP com coleta periódica, timeout e indicação de dados desatualizados.
- Persistência transacional em SQLite e retenção em lotes de 100 coletas.
- API de histórico com filtros por setor, período e paginação.
- Integração com Node-RED e dispositivos Modbus TCP.
- Testes automatizados com o runner nativo do Node.js e GitHub Actions.

## Arquitetura

```text
Medidores → Modbus TCP → Node-RED → HTTP → Node.js → SQLite
                                           ↑
                                      Dashboard web
```

O aplicativo requer um Node-RED configurado para receber leituras reais. Os testes usam fontes simuladas e podem ser executados sem medidores ou Node-RED.

## Executar

Requer **Node.js 24 ou superior**.

```sh
git clone https://github.com/Guiandrelino/dash-node.git
cd dash-node
npm start
```

Não é necessário executar `npm install`: o aplicativo e os testes usam apenas módulos nativos do Node.js. O Node-RED é um serviço separado e sua integração Modbus requer `node-red-contrib-modbus`.

Abra **http://127.0.0.1:3000**. Não abra mais o HTML diretamente: a API e o dashboard agora são servidos pelo backend.

O banco `data/energia.sqlite` é criado automaticamente na primeira execução. A coleta começa quando o servidor inicia e continua mesmo sem navegador aberto. Para interromper, pressione Ctrl+C.

## Integração com Node-RED (arquivos locais)

> **Os arquivos `fluxo.json` e `fluxo.original.json` não acompanham o clone.** Eles contêm configuração específica do ambiente e são mantidos fora do Git. Para receber dados reais, configure seu próprio endpoint Node-RED com o contrato JSON abaixo ou obtenha os fluxos com o responsável pelo ambiente por um canal privado. Sem essa fonte, a interface abre, mas fica sem leituras; os testes continuam funcionando.

### Importar um fluxo local existente

O `fluxo.json` local salva os valores convertidos no contexto `flow.paineis`, junto com horário por campo. O fluxo original apenas enviava as leituras para debug, enquanto a API consultava um contexto que nunca era preenchido. Backup: `fluxo.original.json`.

1. Faça um backup do fluxo implantado no Node-RED.
2. Substitua a aba antiga pela versão de `fluxo.json` (menu → Importar → selecionar arquivo). Não mantenha duas cópias com a mesma rota `/api/dados` e leituras duplicadas. Se o editor perguntar, substitua os nós existentes.
3. Confirme que `node-red-contrib-modbus` está instalado e configure o endereço, a porta e os IDs dos dispositivos Modbus conforme seu ambiente.
4. Clique em **Deploy** e aguarde as leituras. Teste `http://127.0.0.1:1880/api/dados`: deve devolver valores em `paineis`. HTTP 503 informa ausência de leituras recebidas nos últimos 15 segundos.
5. Execute/reinicie `npm start` e abra `http://127.0.0.1:3000`. Para diagnóstico, consulte `/api/status` na porta 3000.

**Potências calculadas no banco:** após gravar corrente e tensão, o SQLite calcula `potencia1 = tensao1 × corrente1` e `potencia2 = tensao2 × corrente2`, usando os pares da mesma linha/setor/coleta. A corrente recebida já está em amperes (A), sem conversão de escala. A interface exibe esses resultados em W como **potência estimada**, assumindo fator de potência 1; em corrente alternada, sem fator de potência, o produto V × A representa potência aparente (VA), não uma medição de potência ativa. Não é aplicado fator trifásico. Valores de potência enviados pelo Node-RED são ignorados. Se faltar corrente ou tensão do canal, sua potência fica `NULL` (`—`).

**Mapa preservado:** Tensão2 Entrega usa endereço 3023, enquanto os demais setores usam 3021. Confirme essa diferença no manual antes de alterar. As correntes mantêm a escala original `SCALE=1`, pois o medidor entrega amperes; a interface exibe A. Ordem de palavras preservada (`WORD_SWAP=false`).

A validade é individual por campo: valores sem atualização por 15 segundos são retornados como `null`, evitando salvar um cache antigo como se fosse leitura atual. Esse limite pode ser ajustado em `MAX_AGE_MS` na função da API, conforme o tempo real do ciclo Modbus. Ainda podem existir consultas repetidas dentro desse intervalo.

O script `node scripts/corrigir-fluxo.js` regenera `fluxo.json` a partir do backup; não o execute depois de personalizar o fluxo sem salvar suas alterações.

## Configuração

Copie `.env.example` para `.env` se quiser alterar os padrões:

```dotenv
HOST=127.0.0.1
PORT=3000
NODE_RED_URL=http://127.0.0.1:1880/api/dados
POLL_INTERVAL_MS=1000
REQUEST_TIMEOUT_MS=8000
DB_PATH=data/energia.sqlite
```

O endereço do Node-RED é acessado pelo **servidor Node.js**, não pelo navegador. Frontend e API usam a mesma origem, dispensando CORS no dashboard.

Para acesso na rede, configure `HOST=0.0.0.0`, reinicie o servidor e acesse `http://<IP-da-maquina>:3000` em um dispositivo da mesma rede. Libere a porta no firewall somente para a rede confiável. `0.0.0.0` é o endereço de escuta, não o endereço a digitar no celular. A interface apresenta o endereço usado no navegador; se aberta por `localhost` ou `127.0.0.1`, abra novamente pelo IP da rede antes de compartilhar o link.

Não exponha diretamente à internet: não há autenticação; use autenticação e HTTPS em um proxy antes de publicação externa. Nunca inclua senhas de Wi-Fi ou credenciais na interface ou nos commits.

## Estrutura

```text
.env.example         Modelo público de configuração (sem credenciais)
.gitignore           Exclusões de arquivos locais e dados de operação
package.json         Comandos e versão mínima do Node.js
README.md            Documentação do projeto
index.html           Estrutura e template dos painéis
css/styles.css       Estilos responsivos
js/app.js            Interface e consulta ao backend
server/index.js      Servidor HTTP, coletor e rotas
server/database.js   Schema, normalização e consultas SQL
scripts/corrigir-fluxo.js  Gerador opcional; exige fluxo.original.json local
test/                Testes automatizados
.github/workflows/   Testes automáticos no GitHub Actions
data/                Banco criado automaticamente (não versionado)
```

## Dados esperados do Node-RED

```json
{
  "paineis": {
    "embalagem": {
      "corrente1": 120.5,
      "corrente2": 118.2,
      "tensao1": 220,
      "tensao2": 221
    }
  }
}
```

A mesma estrutura é aceita para `entrega`, `qualidade`, `usinagem` e `montagem`. A entrada usa corrente em A e tensão em V. Não é necessário enviar potência: o backend ignora os campos de potência da fonte e calcula os resultados no SQLite. No exemplo, `potencia1 = 26510` e `potencia2 = 26122`, exibidas em W como potência estimada, com a ressalva sobre potência aparente descrita acima.

## Coleta e persistência

- Uma consulta inicial e outra 1 segundo após a anterior terminar; sem sobreposição.
- Timeout padrão de 8 segundos. Falhas geram novas tentativas, não leituras falsas.
- Dados numéricos finitos são aceitos (incluindo zero e strings numéricas); valores inválidos viram `NULL`.
- Setores sem qualquer campo válido são omitidos. Respostas sem nenhuma medição válida não são gravadas.
- Cada resposta válida é salva em uma transação: uma linha em `coletas` e até cinco linhas em `leituras`. As potências são calculadas no SQLite depois da inserção, na mesma transação.
- Retenção em lotes de **100 coletas** (até 100 linhas por setor e 500 linhas no total). A coleta 100 permanece disponível; ao chegar a 101, as 100 anteriores são apagadas e começa um novo lote com uma coleta. Não é uma janela deslizante. A contagem permanece após reiniciar e consultas com falha não contam.
- Corrente 1/tensão 1/potência 1 e corrente 2/tensão 2/potência 2 ficam na mesma linha do respectivo setor, sem misturar coletas ou canais.
- `coletado_em` usa UTC, no horário em que o backend recebeu os dados. Não é o horário de medição do dispositivo.
- Valores iguais são armazenados novamente: este é um histórico de **consultas**, não de eventos únicos. Sem timestamp/ID na origem não é possível distinguir uma leitura nova de uma repetida.
- Em falhas, a API entrega o último snapshot com `coleta.connected=false`. O dashboard marca os valores como desatualizados, inclusive após recarregar a página.
- “Com dados” não comprova que o dispositivo está online; apenas que o Node-RED forneceu valores válidos.

## APIs

### `GET /api/dados`

Retorna `{ coletadoEm, paineis, coleta }` com o último snapshot persistido. HTTP 503 se ainda não houver leituras. `coleta` contém estado da coleta, último sucesso, tentativa e erro.

### `GET /api/status`

Estado do coletor. Uma conexão bem-sucedida significa que a resposta HTTP foi validada e gravada no banco.

### `GET /api/historico`

Histórico paginado, do mais recente para o mais antigo. Uma linha por setor por consulta.

Parâmetros opcionais:

- `setor`: embalagem, entrega, qualidade, usinagem ou montagem.
- `inicio` / `fim`: ISO 8601 com timezone, inclusive nos limites.
- `limite`: 1 a 1000, padrão 100.
- `offset`: inteiro não negativo, padrão 0.

Exemplo:

```text
http://127.0.0.1:3000/api/historico?setor=embalagem&inicio=2026-01-01T00:00:00Z&fim=2026-01-31T23:59:59Z&limite=100&offset=0
```

Resposta: `{ limite, offset, leituras: [...] }`. O histórico está disponível pela API; a interface atual exibe o último snapshot, sem gráficos históricos.

## Operação e backup

O armazenamento limpa automaticamente o lote anterior ao iniciar o próximo, mantendo no máximo 100 coletas. Ao abrir um banco antigo com mais de 100 coletas, mantém somente as 100 mais recentes e recalcula as potências a partir das correntes e tensões existentes. A limpeza remove registros, mas não necessariamente reduz o tamanho físico do arquivo SQLite. Faça backup antes de atualizar se quiser preservar o histórico antigo.

Para um backup simples, **pare o servidor** antes de copiar a pasta `data/` inteira (incluindo arquivos WAL/SHM, se existirem). Não copie apenas o arquivo principal enquanto há gravações. O banco contém seu histórico: não apague a pasta `data/` para atualizar o código.

SQLite nativo pode emitir um aviso de recurso experimental em versões do Node.js 24; não significa falha na gravação.

## Publicação no GitHub

O `.gitignore` exclui configurações locais (`.env`), bancos SQLite, logs e dependências. O arquivo `.env.example` contém apenas exemplos de configuração e pode ser versionado.

Os fluxos Node-RED (`fluxo.json` e `fluxo.original.json`) são arquivos locais, excluídos do versionamento pelo `.gitignore` e não distribuídos neste repositório. As instruções de importação e o script de correção exigem que esses arquivos estejam disponíveis localmente.

Antes de cada envio, revise `git status --short`, `git diff` e `git diff --cached`. O `.gitignore` não protege arquivos já rastreados nem remove informações dos commits antigos. Se uma credencial tiver sido publicada, troque/revogue a credencial imediatamente e avalie a limpeza do histórico com os colaboradores; um novo commit removendo o texto não elimina a exposição anterior.

O repositório ainda não declara uma licença de uso. Repositório público não equivale a software com licença aberta; defina uma licença antes de autorizar redistribuição.

**GitHub Pages não executa este backend Node.js nem o SQLite.** O repositório pode apresentar o código no portfólio; para uma demonstração online funcional, será necessário hospedar o servidor e fornecer uma fonte de dados acessível. Não exponha a rede industrial para criar essa demonstração.

## Testes

```sh
npm test
```

Testes cobrem normalização, transações, histórico e filtros, cálculo de potência, retenção em lotes, coleta HTTP com servidor simulado, proteção do arquivo do banco e manutenção das últimas leituras durante falhas.

O GitHub Actions executa `npm test` com Node.js 24. Em um clone sem fluxos locais, os três testes de `test/flow.test.js` são ignorados intencionalmente; os seis testes restantes devem passar. Com `fluxo.json` local disponível, os nove testes são executados. Isso valida o código e a fonte simulada, não a conectividade com os medidores reais.
