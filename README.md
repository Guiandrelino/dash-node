# Volt · Monitoramento de energia

[![Testes](https://github.com/Guiandrelino/dash-node/actions/workflows/tests.yml/badge.svg)](https://github.com/Guiandrelino/dash-node/actions/workflows/tests.yml)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-persistência_local-003B57?logo=sqlite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-sem_frameworks-F7DF1E?logo=javascript&logoColor=black)

**Dashboard web para acompanhar indicadores elétricos de cinco setores, com coleta automática via Node-RED e histórico em SQLite.**

O Volt centraliza corrente, tensão e potência estimada em uma interface responsiva. O backend coleta e persiste as leituras independentemente do navegador, mantendo o último snapshot disponível quando a fonte de dados fica indisponível.

[Início rápido](#início-rápido) · [Configuração](#configuração) · [Integração](#integração-com-node-red) · [API](#api-http) · [Testes](#testes)

## Funcionalidades

- **Cinco setores:** Embalagem, Entrega, Qualidade, Usinagem e Montagem, com dois canais de medição por setor.
- **Atualização automática:** consulta periódica, timeout e novas tentativas sem requisições sobrepostas.
- **Estado das leituras:** indicação de dados completos, parciais, ausentes ou desatualizados.
- **Persistência local:** transações SQLite e retenção em lotes de 100 coletas.
- **Histórico por API:** filtros por setor e período, com paginação.
- **Interface responsiva:** HTML, CSS e JavaScript, sem frameworks ou recursos externos obrigatórios.
- **Testes automatizados:** runner nativo do Node.js e integração contínua com GitHub Actions.

> **Escopo:** a interface apresenta o último snapshot; o histórico é consultado pela API, sem gráficos na versão atual. O aplicativo não possui autenticação e deve operar em rede confiável.

## Arquitetura

```text
Medidores elétricos
        │ Modbus TCP
        ▼
     Node-RED
        │ HTTP / JSON
        ▼
 Backend Node.js ─────► SQLite
        ▲
        │ HTTP · interface e API na mesma origem
        ▼
 Navegador desktop / celular
```

| Camada | Tecnologia | Responsabilidade |
| --- | --- | --- |
| Interface | HTML5, CSS3 e JavaScript | Exibição dos indicadores e estado da conexão |
| Servidor | Node.js 24+ · `node:http` | Arquivos estáticos, API e coleta periódica |
| Armazenamento | SQLite · `node:sqlite` | Snapshots, cálculo de potência e consultas históricas |
| Integração externa | Node-RED e Modbus TCP | Aquisição e disponibilização das leituras |
| Qualidade | `node:test` e GitHub Actions | Testes de persistência e integração HTTP |

O aplicativo e os testes usam apenas módulos nativos do Node.js. O Node-RED é um serviço separado; para comunicação Modbus, a integração utilizada requer `node-red-contrib-modbus`.

## Início rápido

### Requisitos

- **Node.js 24 ou superior**, com npm disponível.
- Git para clonar o projeto.
- Para leituras reais: endpoint Node-RED acessível pelo servidor e configurado conforme o [contrato de dados](#contrato-de-dados).

```sh
git clone https://github.com/Guiandrelino/dash-node.git
cd dash-node
npm start
```

Acesse **http://127.0.0.1:3000**. Não é necessário executar `npm install`.

O banco `data/energia.sqlite` é criado automaticamente. A coleta começa com o servidor e continua mesmo sem abas abertas. Para encerrar, pressione **Ctrl+C**.

> Sem uma fonte Node-RED válida, o dashboard abre, mas permanece sem leituras. Os testes podem ser executados sem Node-RED e sem medidores. Abrir `index.html` diretamente, usar Live Server ou publicar apenas os arquivos estáticos não executa o backend.

## Configuração

As configurações são opcionais. Para personalizar o ambiente, copie `.env.example` para `.env` na raiz do projeto.

**PowerShell:**

```powershell
Copy-Item .env.example .env
```

**Linux, macOS ou Git Bash:**

```sh
cp .env.example .env
```

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Endereço de escuta do servidor |
| `PORT` | `3000` | Porta HTTP |
| `NODE_RED_URL` | `http://127.0.0.1:1880/api/dados` | Endpoint consultado pelo backend |
| `POLL_INTERVAL_MS` | `1000` | Espera entre o término de uma coleta e a próxima |
| `REQUEST_TIMEOUT_MS` | `8000` | Tempo limite de cada consulta à fonte |
| `DB_PATH` | `data/energia.sqlite` | Caminho do banco; se relativo, usa a raiz do projeto |

Reinicie o servidor após alterar a configuração. O endereço do Node-RED é acessado pelo **backend**, não pelo navegador; interface e API utilizam a mesma origem.

### Acesso pela rede local

1. Configure `HOST=0.0.0.0` no `.env` e reinicie o servidor.
2. Identifique o IP local da máquina que executa o aplicativo.
3. Libere a porta configurada no firewall somente para a rede confiável.
4. Em um dispositivo da mesma rede, abra `http://<IP-da-maquina>:3000`.

`0.0.0.0` é um endereço de escuta, não um endereço para abrir no celular. O painel de acesso móvel apresenta a origem usada no navegador; abra o dashboard pelo IP da rede antes de compartilhar o link. `localhost` e `127.0.0.1` referem-se ao próprio dispositivo.

## Integração com Node-RED

**Os arquivos `fluxo.json` e `fluxo.original.json` não são distribuídos neste repositório.** Eles representam configurações locais do ambiente e estão excluídos pelo `.gitignore`.

Você pode configurar seu próprio endpoint com o contrato abaixo ou obter os fluxos com o responsável pelo ambiente por um canal privado. Nunca publique credenciais ou endereços de dispositivos industriais para disponibilizar uma demonstração.

### Contrato de dados

A fonte deve responder à consulta HTTP com um objeto JSON contendo `paineis`:

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

- Setores aceitos: `embalagem`, `entrega`, `qualidade`, `usinagem` e `montagem`.
- Correntes devem ser fornecidas em **amperes (A)**; tensões, em **volts (V)**.
- Números finitos, zero e strings numéricas são aceitos. Campos inválidos ou ausentes tornam-se `NULL`.
- Setores sem corrente ou tensão válida são omitidos. Respostas sem qualquer medição válida não são gravadas.
- Potências enviadas pela fonte são ignoradas; o backend calcula os resultados no banco.

### Cálculo de potência

Após persistir corrente e tensão, o SQLite calcula os pares da mesma linha, setor, canal e coleta:

```text
potencia1 = tensao1 × corrente1
potencia2 = tensao2 × corrente2
```

No exemplo, os resultados são `26510` e `26122`. Se faltar corrente ou tensão em um canal, sua potência permanece `NULL`, exibida como `—`.

> **Interpretação elétrica:** a interface usa o rótulo “Potência estimada” e a unidade W, assumindo fator de potência 1. Em corrente alternada, o produto V × A representa potência aparente (VA); sem fator de potência, não constitui medição de potência ativa. Não é aplicado fator trifásico.

### Utilização dos fluxos locais existentes

1. Faça backup do fluxo implantado no Node-RED.
2. Importe o `fluxo.json` local, substituindo a aba anterior. Não mantenha rotas `/api/dados` nem consultas Modbus duplicadas.
3. Instale `node-red-contrib-modbus`, se necessário, e revise endereços, portas e IDs dos dispositivos.
4. Faça **Deploy** e consulte `http://127.0.0.1:1880/api/dados`.
5. Inicie o Volt e utilize `/api/status` na porta 3000 para diagnóstico.

O fluxo local corrigido salva valores em `flow.paineis` e mantém um horário por campo. Leituras sem atualização há mais de 15 segundos são retornadas como `null`; quando não há leituras recentes, a fonte responde HTTP 503. O limite pode ser ajustado em `MAX_AGE_MS`, conforme o ciclo Modbus. Essa validade depende da implementação da fonte: o backend não valida os horários individuais recebidos.

**Parâmetros preservados do mapa local:** Tensão 2 de Entrega utiliza endereço 3023, enquanto os demais setores usam 3021; `SCALE=1` e `WORD_SWAP=false`. Confirme registradores, unidades e ordem de palavras no manual antes de alterar.

O comando abaixo regenera o fluxo corrigido a partir do backup local:

```sh
node scripts/corrigir-fluxo.js
```

Ele exige `fluxo.original.json` e sobrescreve `fluxo.json`. Salve suas personalizações antes de executá-lo.

## Coleta e persistência

| Comportamento | Regra |
| --- | --- |
| Agendamento | Consulta inicial ao iniciar o servidor; próximas consultas após o intervalo configurado, sem sobreposição |
| Falhas | Novas tentativas automáticas; nenhuma medição fictícia é inserida |
| Transação | Uma linha em `coletas` e até cinco linhas em `leituras` por resposta válida |
| Retenção | Lotes de 100 coletas; a coleta 101 apaga o lote anterior e inicia outro |
| Horário | `coletado_em` em UTC, no recebimento pelo backend, não no instante de medição do dispositivo |
| Repetições | Valores iguais são persistidos novamente; o histórico representa consultas, não eventos únicos |
| Indisponibilidade | Último snapshot preservado, com `coleta.connected=false` e indicação de dados desatualizados |

A retenção **não é uma janela deslizante**. São mantidas até 100 linhas por setor e 500 linhas de leitura no total. A contagem permanece após reiniciar; consultas com falha não contam. Não há garantia de sincronismo entre medições dos dispositivos apenas por estarem na mesma resposta.

“Com dados” indica que a fonte forneceu valores válidos, não comprova que cada medidor esteja online.

## API HTTP

As rotas aceitam `GET` e retornam JSON. Outros métodos retornam HTTP 405.

| Endpoint | Descrição | Resposta |
| --- | --- | --- |
| `/api/dados` | Último snapshot persistido e estado da coleta | `{ coletadoEm, paineis, coleta }`; HTTP 503 sem leituras armazenadas |
| `/api/status` | Estado do coletor | `{ connected, lastAttempt, lastSuccess, error }` |
| `/api/historico` | Leituras ordenadas da mais recente para a mais antiga | `{ limite, offset, leituras: [...] }` |

Uma coleta bem-sucedida significa que a resposta da fonte foi validada e persistida. Durante falhas, `/api/dados` continua retornando o último snapshot, quando disponível, com o estado de desconexão.

### Filtros de histórico

| Parâmetro | Formato | Padrão |
| --- | --- | --- |
| `setor` | Um dos cinco identificadores aceitos | Todos |
| `inicio` | ISO 8601 com timezone; limite inclusivo | Sem limite inicial |
| `fim` | ISO 8601 com timezone; limite inclusivo | Sem limite final |
| `limite` | Inteiro de 1 a 1000 | `100` |
| `offset` | Inteiro não negativo | `0` |

```sh
curl "http://127.0.0.1:3000/api/historico?setor=embalagem&limite=10&offset=0"
```

Exemplo com período:

```text
/api/historico?setor=embalagem&inicio=2026-01-01T00:00:00Z&fim=2026-01-31T23:59:59Z&limite=100
```

Cada item do histórico representa um setor em uma coleta. Filtros inválidos retornam HTTP 400. Para offsets de timezone positivos em URLs, codifique o sinal `+` como `%2B`.

## Estrutura do projeto

```text
dash-node/
├── .github/workflows/tests.yml  # Integração contínua
├── .env.example                # Modelo público de configuração
├── .gitignore                  # Exclusões de dados e configurações locais
├── README.md
├── package.json                # Comandos e versão mínima do Node.js
├── index.html                  # Estrutura e template dos painéis
├── css/styles.css              # Estilos e layout responsivo
├── js/app.js                   # Renderização e consulta ao backend
├── server/
│   ├── index.js                # Servidor HTTP, rotas e coletor
│   └── database.js             # Schema, normalização e consultas SQLite
├── scripts/corrigir-fluxo.js    # Gerador opcional de fluxo local
├── test/                       # Testes automatizados
└── data/                       # Criado em execução; não versionado
```

## Testes

```sh
npm test
```

A suíte verifica normalização, transações, cálculo de potência, retenção em lotes, reabertura do banco, histórico e filtros, coleta HTTP simulada e preservação das leituras durante falhas.

- **Clone público:** seis testes executados e três testes de fluxo ignorados intencionalmente, pois `fluxo.json` não acompanha o repositório.
- **Com fluxo local disponível:** nove testes executados.
- **GitHub Actions:** executa `npm test` com Node.js 24 em pushes e pull requests.

Os testes não validam a rede industrial nem substituem a conferência do mapa de registradores e das unidades nos equipamentos reais. O módulo SQLite nativo pode emitir um aviso experimental em versões do Node.js 24; isso, isoladamente, não indica falha.

## Operação e segurança

### Backup e atualização

Pare o servidor antes de copiar a pasta `data/` inteira, incluindo arquivos WAL/SHM, se existirem. Não copie apenas o arquivo principal durante gravações. Se `DB_PATH` foi personalizado, faça backup do banco configurado e de seus arquivos auxiliares.

Ao abrir bancos antigos com mais de 100 coletas, o aplicativo mantém apenas as 100 mais recentes e recalcula as potências. Faça backup antes de atualizar caso precise preservar o histórico anterior. A remoção de registros não necessariamente reduz o tamanho físico do arquivo SQLite.

### Publicação

- `.env`, bancos, logs, dependências e fluxos locais são excluídos pelo `.gitignore`; `.env.example` pode ser versionado.
- Revise `git diff` e `git diff --cached` antes de cada commit. Arquivos já rastreados não são protegidos retroativamente pelo `.gitignore`.
- Nunca inclua senhas de Wi-Fi, tokens ou credenciais na interface ou no histórico. Se houver exposição, revogue ou troque a credencial imediatamente.
- Para acesso externo, utilize autenticação, HTTPS e controles de rede em uma infraestrutura apropriada. O aplicativo não fornece esses controles.
- **GitHub Pages não executa Node.js nem SQLite.** Uma demonstração funcional exige hospedar o backend e disponibilizar uma fonte de dados acessível, sem expor a rede industrial.

## Solução de problemas

| Sintoma | Verificação |
| --- | --- |
| Dashboard sem leituras | Consulte `/api/status` e confirme que `NODE_RED_URL` responde com o contrato esperado |
| HTTP 503 em `/api/dados` | Ainda não houve coleta válida; verifique a fonte e os registros do servidor |
| Valores desatualizados | Verifique a conexão com o Node-RED, o timeout e a validade dos dados na origem |
| API não encontrada | Abra o endereço servido por `npm start`, não o HTML diretamente ou pelo Live Server |
| Celular não acessa | Confira `HOST`, IP local, porta, firewall e se os dispositivos estão na mesma rede |
| Gerador sem arquivo de entrada | Disponibilize o backup local `fluxo.original.json`; ele não está no Git |

## Licença

Este repositório ainda não declara uma licença de uso. A disponibilidade pública do código não equivale à concessão de uma licença aberta para redistribuição ou modificação.
