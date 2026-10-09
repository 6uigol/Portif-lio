/*
 * Interações gerais do portfólio: navegação, animações, cards de projetos,
 * modal de detalhes e integração com o jogo.
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const store = window.ProjectStore;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- Toast ---------- */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }
  window.PortfolioUI = { toast };

  /* ---------- Navegação ---------- */
  const nav = $("#nav");
  const navToggle = $("#navToggle");
  const navLinks = $("#navLinks");

  function onScroll() { nav.classList.toggle("is-scrolled", window.scrollY > 10); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  function setMenu(open) {
    navLinks.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
  }
  navToggle.addEventListener("click", () => setMenu(!navLinks.classList.contains("is-open")));
  navLinks.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("click", (e) => { if (!nav.contains(e.target)) setMenu(false); });

  // Destaca a seção atual no menu
  const sectionLinks = $$('.nav__links a[href^="#"]');
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      sectionLinks.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + entry.target.id));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  sectionLinks.forEach((a) => { const s = $(a.getAttribute("href")); if (s) spy.observe(s); });

  /* ---------- Animação de entrada ---------- */
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); revealer.unobserve(entry.target); }
    });
  }, { threshold: 0.12 });
  $$(".reveal").forEach((el) => revealer.observe(el));

  /* ---------- Formação: troca sozinha após a formatura ---------- */
  // A partir de 01/01/2028 (formatura em dez/2027) o site passa a dizer "Engenheiro de Computação".
  const GRADUATION = new Date(2028, 0, 1);
  const graduated = new Date() >= GRADUATION;
  if (graduated) {
    const EDU_AFTER = {
      chip: "<strong>Engenheiro de Computação</strong> · FSA",
      summary: "e sou <strong>Engenheiro de Computação</strong> formado pela Fundação Santo André",
      about: "Sou Engenheiro de Computação e desenvolvedor de software desde 2023,",
      date: "concluído em dez/2027"
    };
    $$("[data-edu]").forEach((el) => { el.innerHTML = EDU_AFTER[el.dataset.edu]; });
  }

  /* ---------- Efeito de digitação ---------- */
  const roles = [
    "Desenvolvedor de Software",
    "Programador desde 2023",
    graduated ? "Engenheiro de Computação" : "Cursando Engenharia de Computação",
    "C# · .NET · SQL Server",
    "Java · Spring Boot · JavaScript"
  ];
  const typed = $("#typed");
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let r = 0, c = roles[0].length, deleting = true;
    setTimeout(function tick() {
      const word = roles[r];
      c += deleting ? -1 : 1;
      typed.textContent = word.slice(0, c);
      let delay = deleting ? 35 : 70;
      if (!deleting && c === word.length) { deleting = true; delay = 2200; }
      else if (deleting && c === 0) { deleting = false; r = (r + 1) % roles.length; delay = 300; }
      setTimeout(tick, delay);
    }, 2500);
  }

  /* ---------- Download do currículo (Firebase, com o arquivo do site como reserva) ---------- */
  $$("[data-cv]").forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        if (await store.downloadCV()) return;
      } catch (err) { /* usa o arquivo padrão */ }
      const a = document.createElement("a");
      a.href = link.getAttribute("href");
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  /* ---------- Copiar contato ---------- */
  $$("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        toast("Copiado: " + btn.dataset.copy);
      } catch (e) {
        toast(btn.dataset.copy);
      }
    });
  });

  /* ---------- Dados fixos ---------- */
  $("#year").textContent = new Date().getFullYear();
  const start = new Date(2023, 7, 1); // agosto/2023
  const years = Math.floor((Date.now() - start) / (365.25 * 24 * 3600 * 1000));
  $("#statYears").textContent = Math.max(1, years) + "+";

  /* ---------- Modais: fechar por botão ou clique fora ---------- */
  $$("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
    });
  });

  /* ---------- Modal de projeto ---------- */
  const pm = $("#projectModal");
  let onProjectClose = null;

  function formatSize(bytes) {
    return bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function fileLabel(file) {
    return (store.isApk(file) ? "Baixar APK" : "Baixar arquivo") + " (" + formatSize(file.size) + ")";
  }

  /* Baixa o arquivo anexado ao projeto, mostrando "Baixando…" no botão clicado */
  async function downloadProjectFile(project, button) {
    if (!project.file) return;
    const html = button ? button.innerHTML : "";
    if (button) { button.disabled = true; button.innerHTML = '<i class="bi bi-hourglass-split"></i> Baixando…'; }
    try {
      if (!(await store.downloadFileById(project.file.id))) toast("Arquivo indisponível no momento.");
    } catch (e) {
      toast("Não foi possível baixar o arquivo.");
    } finally {
      if (button) { button.disabled = false; button.innerHTML = html; }
    }
  }

  let modalProject = null;
  $("#pmFile").addEventListener("click", (e) => downloadProjectFile(modalProject, e.currentTarget));

  function openProject(project) {
    const list = store.get();
    const index = list.findIndex((p) => p.id === project.id);
    const color = window.ProjectVisual.color(project, index);

    $("#pmIcon").innerHTML = `<span class="project-icon" style="--c:${color}">${escapeHtml(window.ProjectVisual.initials(project.name))}</span>`;
    $("#pmTitle").textContent = project.name;
    $("#pmTags").innerHTML = (project.tags || []).map((t) => `<span>${escapeHtml(t)}</span>`).join("");
    $("#pmDesc").textContent = project.description || "Sem descrição.";

    modalProject = project;
    const link = $("#pmLink");
    link.hidden = !project.link;
    if (project.link) link.href = project.link;
    const fileBtn = $("#pmFile");
    fileBtn.hidden = !project.file;
    if (project.file) $("#pmFileLabel").textContent = fileLabel(project.file);
    $("#pmNoLink").hidden = Boolean(project.link || project.file);
    pm.showModal();
    (project.link ? link : project.file ? fileBtn : pm.querySelector("[data-close].btn")).focus();
  }

  pm.addEventListener("close", () => {
    const cb = onProjectClose;
    onProjectClose = null;
    if (cb) cb();
  });

  /* ---------- Grade de projetos ---------- */
  const grid = $("#projectsGrid");
  const filtersEl = $("#filters");
  const emptyEl = $("#projectsEmpty");
  let activeFilter = "Todos";

  function renderFilters(projects) {
    const counts = {};
    projects.forEach((p) => (p.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    // só mostra tecnologias que aparecem em mais de um projeto
    const tags = Object.keys(counts).filter((t) => counts[t] > 1).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
    if (activeFilter !== "Todos" && !tags.includes(activeFilter)) activeFilter = "Todos";
    filtersEl.innerHTML = ["Todos", ...tags].map((t) =>
      `<button class="filter${t === activeFilter ? " is-active" : ""}" data-filter="${escapeHtml(t)}" aria-pressed="${t === activeFilter}">${escapeHtml(t)}</button>`
    ).join("");
    filtersEl.hidden = tags.length === 0;
  }

  function renderGrid(projects) {
    const filtered = activeFilter === "Todos" ? projects : projects.filter((p) => (p.tags || []).includes(activeFilter));
    emptyEl.hidden = filtered.length > 0;
    grid.innerHTML = filtered.map((p) => {
      const index = projects.indexOf(p);
      const color = window.ProjectVisual.color(p, index);
      const name = escapeHtml(p.name);
      return `
        <article class="project-card" style="--c:${color}; animation-delay:${Math.min(index, 8) * 40}ms" data-id="${escapeHtml(p.id)}">
          <div class="project-card__top">
            <button class="project-icon" data-open aria-label="Ver detalhes de ${name}">${escapeHtml(window.ProjectVisual.initials(p.name))}</button>
            <div class="project-card__actions">
              ${p.file ? `<button class="project-card__open" data-download aria-label="${escapeHtml(fileLabel(p.file))} de ${name}" title="${escapeHtml(fileLabel(p.file))}"><i class="bi bi-${store.isApk(p.file) ? "android2" : "download"}"></i></button>` : ""}
              ${p.link ? `<a class="project-card__open" href="${escapeHtml(p.link)}" target="_blank" rel="noopener" aria-label="Abrir ${name} em nova aba"><i class="bi bi-arrow-up-right"></i></a>` : ""}
              ${!p.link && !p.file ? `<span class="project-card__private"><i class="bi bi-link-45deg"></i> sem link</span>` : ""}
            </div>
          </div>
          <h3><button data-open>${name}</button></h3>
          <p>${escapeHtml(p.description)}</p>
          <div class="tags">${(p.tags || []).map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>
        </article>`;
    }).join("");
  }

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    const projects = store.get();
    renderFilters(projects);
    renderGrid(projects);
  });

  grid.addEventListener("click", (e) => {
    const action = e.target.closest("[data-open], [data-download]");
    if (!action) return;
    const id = e.target.closest("[data-id]").dataset.id;
    const project = store.get().find((p) => p.id === id);
    if (!project) return;
    if (action.hasAttribute("data-download")) downloadProjectFile(project, action);
    else openProject(project);
  });

  /* ---------- Downloads (somente APKs) ---------- */
  const downloadsSection = $("#downloads");
  const downloadsGrid = $("#downloadsGrid");

  function renderDownloads(projects) {
    const apps = projects.filter((p) => store.isApk(p.file));
    downloadsSection.hidden = apps.length === 0;
    $("#navDownloads").hidden = apps.length === 0;
    downloadsGrid.innerHTML = apps.map((p) => `
      <article class="download-card" data-id="${escapeHtml(p.id)}">
        <span class="download-card__icon"><i class="bi bi-android2"></i></span>
        <div class="download-card__info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.file.name)} · ${formatSize(p.file.size)}</span>
        </div>
        <button class="btn btn--sm btn--primary" data-download><i class="bi bi-download"></i> Baixar</button>
      </article>`).join("");
  }

  downloadsGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-download]");
    if (!btn) return;
    const project = store.get().find((p) => p.id === btn.closest("[data-id]").dataset.id);
    if (project) downloadProjectFile(project, btn);
  });

  /* ---------- Jogo ---------- */
  const overlay = $("#gameOverlay");
  const hint = $("#gameHint");
  const hudScore = $("#hudScore");
  const hudVisited = $("#hudVisited");
  const hudTotal = $("#hudTotal");
  const planetList = $("#planetList");

  function bump(el) {
    const chip = el.closest(".hud-chip");
    chip.classList.remove("bump");
    void chip.offsetWidth;
    chip.classList.add("bump");
  }

  const galaxy = window.ProjectGalaxy.create($("#gameCanvas"), {
    onLand(project, resume) {
      onProjectClose = resume;
      openProject(project);
    },
    onScore(score) { hudScore.textContent = score; bump(hudScore); },
    onVisit(count, total) {
      if (hudVisited.textContent !== String(count)) bump(hudVisited);
      hudVisited.textContent = count;
      hudTotal.textContent = total;
    },
    onComplete(score) {
      setTimeout(() => toast(`🏆 Galáxia completa! Você visitou todos os planetas e fez ${score} bits.`), 400);
    },
    onFirstMove() {
      setTimeout(() => hint.classList.add("is-hidden"), 2500);
    }
  });

  $("#gameStart").addEventListener("click", () => {
    overlay.classList.add("is-hidden");
    galaxy.start();
  });

  // Lista acessível: permite abrir projetos pelo teclado/leitor de tela sem jogar
  function renderPlanetList(projects) {
    planetList.innerHTML = projects.map((p) =>
      `<button role="listitem" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join("");
  }
  planetList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-id]");
    if (btn) { overlay.classList.add("is-hidden"); galaxy.start(); galaxy.land(btn.dataset.id); }
  });

  /* ---------- Sincronização ---------- */
  // O jogo mostra no máximo 7 planetas, sorteados a cada visita
  const MAX_PLANETS = 7;
  function pickPlanets(projects) {
    const list = projects.slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.slice(0, MAX_PLANETS);
  }

  store.subscribe((projects) => {
    renderFilters(projects);
    renderGrid(projects);
    renderDownloads(projects);
    const planets = pickPlanets(projects);
    renderPlanetList(planets);
    galaxy.setProjects(planets);
    $("#statProjects").textContent = projects.length;
  });

  store.load();
})();
