/*
 * Área restrita: "É você, Guilherme?"
 * Login com a senha do dia e CRUD de projetos (nome, descrição, link opcional, tecnologias).
 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const store = window.ProjectStore;

  const loginModal = $("#loginModal");
  const loginForm = $("#loginForm");
  const loginInput = $("#loginInput");
  const loginError = $("#loginError");
  const adminModal = $("#adminModal");
  const form = $("#projectForm");
  const fId = $("#fId"), fName = $("#fName"), fDesc = $("#fDesc"), fLink = $("#fLink"), fTags = $("#fTags");
  const formTitle = $("#formTitle"), formSubmit = $("#formSubmit"), formCancel = $("#formCancel"), formError = $("#formError");
  const list = $("#adminList");
  const status = $("#storageStatus");

  function toast(msg) { window.PortfolioUI && window.PortfolioUI.toast(msg); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // A senha guardada na sessão é revalidada pelo Firebase a cada salvamento
  function isUnlocked() {
    return store.getMode() === "cloud" && Boolean(store.getAdminKey());
  }

  /* ---------- Login ---------- */
  $("#secretBtn").addEventListener("click", async () => {
    if (isUnlocked()) return openAdmin();
    store.clearAdminKey();
    loginForm.reset();
    loginError.hidden = true;
    loginModal.showModal();
    loginInput.focus();
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = loginInput.value.trim();
    const submit = loginForm.querySelector('[type=submit]');
    let ok = false;
    submit.disabled = true;
    try {
      ok = await store.verifyPassword(value);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
      return;
    } finally {
      submit.disabled = false;
    }
    loginError.textContent = "Senha incorreta.";
    if (ok) {
      store.setAdminKey(value);
      loginModal.close();
      toast("Bem-vindo de volta, Guilherme! 👋");
      openAdmin();
    } else {
      loginError.hidden = false;
      loginForm.classList.remove("shake");
      void loginForm.offsetWidth; // reinicia a animação
      loginForm.classList.add("shake");
      loginInput.select();
    }
  });

  /* ---------- Painel ---------- */
  function openAdmin() {
    resetForm();
    renderStatus();
    renderList(store.get());
    renderCV();
    adminModal.showModal();
  }

  function renderStatus() {
    if (store.getMode() === "cloud") {
      status.className = "storage-status is-cloud";
      status.innerHTML = '<i class="bi bi-cloud-check"></i> Conectado ao Firebase — as alterações aparecem para todos os visitantes.';
    } else {
      status.className = "storage-status is-local";
      status.innerHTML = '<i class="bi bi-wifi-off"></i> Sem conexão com o Firebase — não é possível salvar agora.';
    }
  }

  function renderList(projects) {
    if (!projects.length) {
      list.innerHTML = '<li class="muted small">Nenhum projeto cadastrado.</li>';
      return;
    }
    list.innerHTML = projects.map((p, i) => `
      <li class="admin-item${fId.value === p.id ? " is-editing" : ""}" data-id="${escapeHtml(p.id)}">
        <span class="project-icon" style="--c:${window.ProjectVisual.color(p, i)}">${escapeHtml(window.ProjectVisual.initials(p.name))}</span>
        <div class="admin-item__info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${p.link ? escapeHtml(p.link.replace(/^https?:\/\//, "")) : "sem link"}${p.file ? `<em class="admin-item__badge">${store.isApk(p.file) ? "APK" : "ARQUIVO"}</em>` : ""}</span>
        </div>
        <div class="admin-item__actions">
          <button class="icon-btn" data-action="up" aria-label="Mover para cima" ${i === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button>
          <button class="icon-btn" data-action="down" aria-label="Mover para baixo" ${i === projects.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button>
          <button class="icon-btn" data-action="edit" aria-label="Editar ${escapeHtml(p.name)}"><i class="bi bi-pencil"></i></button>
          <button class="icon-btn icon-btn--danger" data-action="delete" aria-label="Excluir ${escapeHtml(p.name)}"><i class="bi bi-trash3"></i></button>
        </div>
      </li>`).join("");
  }

  store.subscribe((projects) => { if (adminModal.open) renderList(projects); });

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.closest("[data-id]").dataset.id;
    const project = store.get().find((p) => p.id === id);
    if (!project) return;

    try {
      switch (btn.dataset.action) {
        case "edit":
          fillForm(project);
          break;
        case "delete":
          if (confirm(`Excluir o projeto "${project.name}"?`)) {
            startBusy("Excluindo " + project.name + "…", true);
            try {
              await store.remove(id);
              if (project.file) await deleteFileWithProgress(project.file, "Excluindo arquivo " + project.file.name + "…").catch(() => {});
            } finally {
              endBusy();
            }
            if (fId.value === id) resetForm();
            toast("Projeto excluído.");
          }
          break;
        case "up":
          await store.move(id, -1);
          break;
        case "down":
          await store.move(id, 1);
          break;
      }
    } catch (err) {
      handleError(err);
    }
  });

  /* ---------- Arquivo do projeto ---------- */
  const fFile = $("#fFile"), fFileLabel = $("#fFileLabel"), fFileCurrent = $("#fFileCurrent"), fFileRemove = $("#fFileRemove");
  const FILE_TYPES = /\.(apk|pdf|docx?|zip)$/i;

  /* ---------- Barra de progresso + bloqueio do painel ----------
   * Enquanto envia ou exclui: barra visível, painel não fecha (X, Esc ou clique fora)
   * e o navegador pede confirmação se tentar fechar/recarregar a página. */
  const op = $("#opProgress"), opLabel = $("#opProgressLabel"), opInfo = $("#opProgressInfo"), opFill = $("#opProgressFill");
  const lockable = [$(".admin"), $("#cvForm")];
  let busySince = 0;

  function warnUnload(e) {
    e.preventDefault();
    e.returnValue = "";
  }

  function startBusy(label, danger) {
    busySince = Date.now();
    adminModal.dataset.busy = "1";
    adminModal.classList.add("is-busy");
    lockable.forEach((el) => { el.inert = true; });
    op.hidden = false;
    op.classList.toggle("is-danger", Boolean(danger));
    setBusy(label, null);
    window.addEventListener("beforeunload", warnUnload);
  }

  /* ratio null = barra animada sem porcentagem */
  function setBusy(label, ratio, info) {
    if (label) opLabel.textContent = label;
    op.classList.toggle("is-indeterminate", ratio == null);
    opFill.style.width = ratio == null ? "" : Math.round(ratio * 100) + "%";
    opInfo.textContent = info || (ratio == null ? "" : Math.round(ratio * 100) + "%");
  }

  function eta(ratio) {
    if (ratio <= 0 || ratio >= 1) return "";
    const left = ((Date.now() - busySince) / ratio) * (1 - ratio) / 1000;
    return " · falta " + (left > 90 ? "~" + Math.ceil(left / 60) + " min" : "~" + Math.max(1, Math.round(left)) + " s");
  }

  function endBusy() {
    delete adminModal.dataset.busy;
    adminModal.classList.remove("is-busy");
    lockable.forEach((el) => { el.inert = false; });
    op.hidden = true;
    window.removeEventListener("beforeunload", warnUnload);
  }

  // Esc não fecha o painel durante uma operação
  adminModal.addEventListener("cancel", (e) => { if (adminModal.dataset.busy) e.preventDefault(); });

  async function deleteFileWithProgress(file, label) {
    setBusy(label, 0);
    await store.deleteFile(file.id, (done, total) => setBusy(null, done / total));
  }
  let currentFile = null; // arquivo já salvo no projeto em edição
  let removeFile = false;

  function renderFileField() {
    const chosen = fFile.files[0];
    fFileLabel.textContent = chosen ? chosen.name : currentFile && !removeFile ? "Trocar arquivo" : "Escolher arquivo";
    const showCurrent = Boolean(currentFile && !removeFile && !chosen);
    fFileCurrent.hidden = !showCurrent;
    fFileCurrent.textContent = showCurrent ? "Atual: " + currentFile.name : "";
    fFileRemove.hidden = !(chosen || showCurrent);
  }

  fFile.addEventListener("change", renderFileField);
  fFileRemove.addEventListener("click", () => {
    if (fFile.files[0]) fFile.value = "";
    else removeFile = true;
    renderFileField();
  });

  /* ---------- Formulário ---------- */
  function fillForm(p) {
    fId.value = p.id;
    fName.value = p.name;
    fDesc.value = p.description;
    fLink.value = p.link || "";
    fTags.value = (p.tags || []).join(", ");
    fFile.value = "";
    currentFile = p.file || null;
    removeFile = false;
    renderFileField();
    formTitle.textContent = "Editar projeto";
    formSubmit.innerHTML = '<i class="bi bi-check-lg"></i> Salvar alterações';
    formCancel.hidden = false;
    formError.hidden = true;
    renderList(store.get());
    fName.focus();
  }

  function resetForm() {
    form.reset();
    fId.value = "";
    currentFile = null;
    removeFile = false;
    renderFileField();
    formTitle.textContent = "Novo projeto";
    formSubmit.innerHTML = '<i class="bi bi-plus-lg"></i> Adicionar';
    formCancel.hidden = true;
    formError.hidden = true;
    renderList(store.get());
  }

  formCancel.addEventListener("click", resetForm);

  function showFormError(msg, field) {
    formError.textContent = msg;
    formError.hidden = false;
    if (field) field.focus();
  }

  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
    } catch (e) {
      return false;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = fName.value.trim();
    const description = fDesc.value.trim();
    const link = store.normalizeLink(fLink.value);
    const tags = fTags.value.split(",").map((t) => t.trim()).filter(Boolean);

    if (!name) return showFormError("Informe o nome do projeto.", fName);
    if (!description) return showFormError("Escreva uma descrição.", fDesc);
    if (link && !isValidUrl(link)) return showFormError("Link inválido. Ex.: https://meu-projeto.vercel.app", fLink);
    const chosen = fFile.files[0];
    if (chosen && !FILE_TYPES.test(chosen.name)) return showFormError("Arquivo não suportado. Use APK, PDF, Word ou ZIP.");

    const editing = Boolean(fId.value);
    startBusy(chosen ? "Enviando " + chosen.name + "…" : "Salvando projeto…");
    try {
      let file = removeFile ? null : currentFile;
      if (chosen) {
        const totalMB = chosen.size / 1048576;
        const mb = (v) => v.toFixed(1).replace(".", ",");
        setBusy(null, null, "iniciando envio…");
        file = await store.uploadProjectFile(chosen, (done, total) => {
          const ratio = done / total;
          setBusy(null, ratio, `${mb(totalMB * ratio)} de ${mb(totalMB)} MB · ${Math.round(ratio * 100)}%${eta(ratio)}`);
        });
        setBusy("Salvando projeto…", null);
      }
      const data = { name, description, link, tags, file };
      if (editing) await store.update(fId.value, data);
      else await store.add(data);
      // apaga do Firebase o arquivo antigo que foi trocado ou removido
      if (currentFile && (chosen || removeFile)) {
        op.classList.add("is-danger");
        await deleteFileWithProgress(currentFile, "Removendo arquivo antigo…").catch(() => {});
      }
    } catch (err) {
      endBusy();
      return handleError(err);
    }
    endBusy();
    toast(editing ? "Projeto atualizado!" : "Projeto adicionado! 🚀");
    resetForm();
  });

  /* ---------- Ferramentas ---------- */
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "projetos.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#logoutBtn").addEventListener("click", () => {
    store.clearAdminKey();
    adminModal.close();
    toast("Sessão encerrada.");
  });

  /* ---------- Currículo ---------- */
  const cvForm = $("#cvForm");
  const cvFile = $("#cvFile");
  const cvCurrent = $("#cvCurrent");
  const cvPickLabel = $("#cvPickLabel");
  const cvSubmit = $("#cvSubmit");
  const cvError = $("#cvError");

  function formatSize(bytes) {
    return bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  async function renderCV() {
    cvForm.reset();
    cvPickLabel.textContent = "Escolher arquivo";
    cvSubmit.disabled = true;
    cvError.hidden = true;
    cvCurrent.textContent = "Carregando…";
    try {
      const info = await store.getCVInfo();
      if (info) {
        const date = info.updatedAt && info.updatedAt.toDate ? info.updatedAt.toDate().toLocaleDateString("pt-BR") : "";
        cvCurrent.textContent = "Atual: " + info.name + " (" + formatSize(info.size) + (date ? ", enviado em " + date : "") + ")";
      } else {
        cvCurrent.textContent = "Atual: arquivo padrão do site. Envie um PDF ou Word para substituir.";
      }
    } catch (err) {
      cvCurrent.textContent = "Não foi possível consultar o currículo atual.";
    }
  }

  cvFile.addEventListener("change", () => {
    const file = cvFile.files[0];
    cvPickLabel.textContent = file ? file.name : "Escolher arquivo";
    cvSubmit.disabled = !file;
    cvError.hidden = true;
  });

  cvForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    cvSubmit.disabled = true;
    startBusy("Enviando currículo…");
    try {
      await store.uploadCV(cvFile.files[0]);
      endBusy();
      toast("Currículo atualizado! 📄");
      await renderCV();
    } catch (err) {
      endBusy();
      cvError.textContent = err.message;
      cvError.hidden = false;
      cvSubmit.disabled = false;
      if (/expirada/i.test(err.message)) handleError(err);
    }
  });

  function handleError(err) {
    showFormError(err.message || "Algo deu errado.");
    if (/expirada/i.test(err.message)) {
      store.clearAdminKey();
      setTimeout(() => adminModal.close(), 1500);
    }
  }
})();
