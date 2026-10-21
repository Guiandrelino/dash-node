(() => {
  "use strict";

  // O backend serve o dashboard e consulta o Node-RED independentemente da aba.
  const CONFIG = Object.freeze({
    API_URL: "/api/dados",
    REFRESH_INTERVAL: 1000,
    REQUEST_TIMEOUT: 8000,
  });

  const PANELS = Object.freeze([
    { id: "embalagem", name: "Embalagem", icon: "▣" },
    { id: "entrega", name: "Entrega", icon: "⇄" },
    { id: "qualidade", name: "Qualidade", icon: "◎" },
    { id: "usinagem", name: "Usinagem", icon: "⚙" },
    { id: "montagem", name: "Montagem", icon: "◇" },
  ]);

  const MEASUREMENTS = Object.freeze([
    { key: "corrente", label: "Corrente", unit: "A" },
    { key: "tensao", label: "Tensão", unit: "V" },
    { key: "potencia", label: "Potência estimada", unit: "W" },
  ]);

  const numberFormat = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const timeFormat = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const elements = {
    panels: document.getElementById("paineis"),
    template: document.getElementById("painel-template"),
    connection: document.getElementById("conexao"),
    connectionText: document.getElementById("statusTexto"),
    lastUpdate: document.getElementById("ultimaAtualizacao"),
    refresh: document.getElementById("atualizar"),
  };
  // Não publica um IP específico da instalação nem sugere localhost para outro dispositivo.
  const accessLink = document.getElementById("enderecoAcesso");
  if (accessLink && ["http:", "https:"].includes(window.location.protocol)) {
    const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    if (!localOnly) {
      accessLink.href = window.location.origin;
      accessLink.textContent = window.location.origin;
    } else {
      accessLink.removeAttribute("href");
      accessLink.textContent = "Use o IP desta máquina na rede local e a porta do servidor";
    }
  }

  const panelViews = new Map();
  const state = { loading: false, timer: null, lastSuccess: null };

  // A estrutura repetitiva é criada a partir de uma única definição de painel.
  function createPanels() {
    const fragment = document.createDocumentFragment();

    PANELS.forEach((panel, index) => {
      const card = elements.template.content.firstElementChild.cloneNode(true);
      const title = card.querySelector("h3");
      title.id = `titulo-${panel.id}`;
      title.textContent = panel.name;
      card.setAttribute("aria-labelledby", title.id);
      card.querySelector(".panel-icon").textContent = panel.icon;
      card.querySelector(".panel-number").textContent = `PAINEL ${String(index + 1).padStart(2, "0")}`;
      const values = new Map();

      MEASUREMENTS.forEach((measurement) => {
        const row = document.createElement("div");
        row.className = "measurement";
        const label = document.createElement("span");
        label.className = "measurement-label";
        label.textContent = measurement.label;
        row.append(label);

        for (let channel = 1; channel <= 2; channel += 1) {
          const cell = document.createElement("div");
          cell.className = "measurement-value";
          const value = document.createElement("span");
          const key = `${measurement.key}${channel}`;
          value.id = `${panel.id}-${key}`;
          value.className = "value";
          value.textContent = "—";
          const unit = document.createElement("span");
          unit.className = "unit";
          unit.textContent = measurement.unit;
          cell.append(value, unit);
          row.append(cell);
          values.set(key, value);
        }
        card.querySelector(".measurements").append(row);
      });

      panelViews.set(panel.id, {
        card, values,
        status: card.querySelector(".panel-status"),
        update: card.querySelector(".panel-update"),
        hasData: false,
      });
      fragment.append(card);
    });
    elements.panels.append(fragment);
  }

  // Zero é uma leitura válida; null, strings vazias, booleanos e NaN não são.
  function parseValue(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function setPanelStatus(view, status, label, detail) {
    view.card.dataset.state = status;
    view.status.dataset.state = status;
    view.status.textContent = label;
    view.update.textContent = detail;
  }

  function setConnection(status, label) {
    elements.connection.dataset.state = status;
    elements.connectionText.textContent = label;
  }

  function showNotice(message = "") {
    // Detalhes disponíveis no status, sem ocupar espaço com um aviso separado.
    elements.connection.title = message;
  }

  function renderData(panels, timestamp) {
    const now = new Date(timestamp);
    const time = timeFormat.format(now);
    let activeCount = 0;
    let incompleteCount = 0;

    PANELS.forEach(({ id }) => {
      const view = panelViews.get(id);
      const data = panels[id];
      const validObject = data && typeof data === "object" && !Array.isArray(data);
      let validCount = 0;

      view.values.forEach((element, key) => {
        const value = parseValue(validObject ? data[key] : null);
        element.textContent = value === null ? "—" : numberFormat.format(value);
        if (value !== null) {
          validCount += 1;
        }
      });

      view.hasData = validCount > 0;
      if (view.hasData) activeCount += 1;
      if (validCount === 6) {
        setPanelStatus(view, "online", "Com dados", `Leitura recebida às ${time}`);
      } else if (validCount > 0) {
        incompleteCount += 1;
        setPanelStatus(view, "partial", "Parcial", `${validCount} de 6 leituras disponíveis · ${time}`);
      } else {
        setPanelStatus(view, "waiting", "Sem dados", "Nenhuma leitura disponível para este setor");
      }
    });

    elements.lastUpdate.textContent = `${now.toLocaleDateString("pt-BR")} ${time}`;
    elements.lastUpdate.dateTime = now.toISOString();
    elements.lastUpdate.title = now.toLocaleString("pt-BR");
    state.lastSuccess = now;
    setConnection("connected", "Conectado ao Node-RED");
    showNotice(activeCount < PANELS.length || incompleteCount > 0
      ? "Conexão estabelecida, mas há setores com leituras ausentes ou incompletas. Os canais sem dados aparecem como —."
      : "Potência estimada com tensão × corrente, considerando fator de potência 1 e corrente em A.");
  }

  function renderError(error) {
    setConnection("offline", "Sem conexão");
    panelViews.forEach((view) => {
      setPanelStatus(view, view.hasData ? "stale" : "offline",
        view.hasData ? "Desatualizado" : "Sem conexão",
        view.hasData ? "Última leitura mantida · conexão interrompida" : "Aguardando conexão com o Node-RED");
    });
    const reason = error.name === "AbortError"
      ? "O servidor demorou demais para responder."
      : `Não foi possível obter leituras atuais. ${error.message || ""}`;
    showNotice(`${reason} Verifique se o backend e o Node-RED estão em execução. ${state.lastSuccess ? "Os valores exibidos são da última sincronização, não leituras atuais. " : ""}Uma nova tentativa será feita automaticamente.`);
    console.error("Falha ao atualizar o dashboard:", error);
  }

  // Agendar depois da resposta evita requisições sobrepostas em redes lentas.
  function scheduleRefresh() {
    clearTimeout(state.timer);
    if (!document.hidden) state.timer = setTimeout(refreshData, CONFIG.REFRESH_INTERVAL);
  }

  async function refreshData() {
    if (state.loading) return;
    clearTimeout(state.timer);
    state.loading = true;
    elements.refresh.disabled = true;
    elements.refresh.setAttribute("aria-busy", "true");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(CONFIG.API_URL, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) {
        throw new Error("API não encontrada (404). Execute npm start na pasta do projeto e abra http://127.0.0.1:3000. Live Server e outros servidores estáticos não executam o backend SQLite.");
      }
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.coleta?.error || failure?.erro || `HTTP ${response.status}`);
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("O servidor retornou uma página, não a API JSON. Abra o dashboard pelo backend: http://127.0.0.1:3000.");
      }
      const data = await response.json();
      if (!data || !data.paineis || typeof data.paineis !== "object" || Array.isArray(data.paineis)) {
        throw new Error("Resposta inválida: esperado um objeto 'paineis'.");
      }
      renderData(data.paineis, data.coletadoEm);
      const stale = !data.coleta?.connected || Date.now() - Date.parse(data.coletadoEm) > 15000;
      if (stale) renderError(new Error(data.coleta?.error || "Coleta desatualizada"));
    } catch (error) {
      renderError(error);
    } finally {
      clearTimeout(timeout);
      state.loading = false;
      elements.refresh.disabled = false;
      elements.refresh.removeAttribute("aria-busy");
      scheduleRefresh();
    }
  }

  elements.refresh.addEventListener("click", refreshData);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(state.timer);
    else refreshData();
  });

  createPanels();
  if (window.location.protocol === "file:") {
    renderError(new Error("O HTML foi aberto diretamente. Execute npm start e acesse http://127.0.0.1:3000 para usar a API e o banco de dados."));
  } else {
    refreshData();
  }
})();
