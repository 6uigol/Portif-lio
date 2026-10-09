/*
 * Camada de dados dos projetos — Firebase Firestore.
 * - Leitura: documento portfolio/projects (público). Se não existir ou o Firebase
 *   não estiver configurado, usa DEFAULT_PROJECTS.
 * - Escrita: batch validado pelas regras do Firestore com a senha do dia
 *   (veja firebase/firestore.rules). A fórmula da senha fica só no servidor.
 */
(function () {
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const SESSION_KEY = "glc-portfolio:admin-key";
  const listeners = new Set();

  let projects = [];
  let mode = "offline"; // "cloud" | "offline"
  let fb = null; // { db, doc, getDoc, writeBatch, collection, serverTimestamp }

  function safeGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignora */ }
  }
  function safeRemove(key) {
    try { sessionStorage.removeItem(key); } catch (e) { /* ignora */ }
  }

  function clone(list) {
    return JSON.parse(JSON.stringify(list));
  }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "projeto";
  }

  function normalizeLink(link) {
    const value = String(link || "").trim();
    if (!value) return "";
    return /^https?:\/\//i.test(value) ? value : "https://" + value;
  }

  function sanitize(list) {
    if (!Array.isArray(list)) return null;
    return list
      .filter((p) => p && typeof p.name === "string" && p.name.trim())
      .map((p) => ({
        id: String(p.id || slugify(p.name)),
        name: String(p.name).trim().slice(0, 60),
        description: String(p.description || "").trim().slice(0, 600),
        link: normalizeLink(p.link),
        tags: Array.isArray(p.tags)
          ? p.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
          : [],
        file: sanitizeFile(p.file)
      }));
  }

  /* Arquivo anexado ao projeto (APK, PDF...): só os metadados; o conteúdo fica em files/{id} */
  function sanitizeFile(f) {
    if (!f || typeof f.id !== "string" || typeof f.name !== "string") return null;
    return {
      id: f.id.slice(0, 40),
      name: f.name.slice(0, 120),
      size: Number(f.size) || 0,
      type: String(f.type || "application/octet-stream").slice(0, 100)
    };
  }

  function isApk(file) {
    return Boolean(file && /\.apk$/i.test(file.name));
  }

  function emit() {
    listeners.forEach((fn) => fn(clone(projects), mode));
  }

  // Teste local com o emulador do Firestore: http://localhost:PORTA/?emulador
  const useEmulator = location.hostname === "localhost" && new URLSearchParams(location.search).has("emulador");

  function isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return useEmulator || Boolean(c && c.apiKey && c.projectId);
  }

  async function connect() {
    if (fb) return fb;
    const [{ initializeApp }, firestore] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    const config = useEmulator ? { apiKey: "demo", projectId: "demo-portfolio" } : window.FIREBASE_CONFIG;
    const db = firestore.getFirestore(initializeApp(config));
    if (useEmulator) firestore.connectFirestoreEmulator(db, location.hostname, 8080);
    fb = { db, ...firestore };
    return fb;
  }

  async function load() {
    projects = clone(window.DEFAULT_PROJECTS);
    if (isConfigured()) {
      try {
        const { db, doc, getDoc } = await connect();
        const snap = await getDoc(doc(db, "portfolio", "projects"));
        mode = "cloud";
        const saved = snap.exists() ? sanitize(snap.data().items) : null;
        if (saved) projects = saved;
      } catch (e) {
        console.warn("Firebase indisponível, usando projetos padrão.", e);
        mode = "offline";
      }
    }
    emit();
    return clone(projects);
  }

  function denied(err) {
    return err && (err.code === "permission-denied" || /permission/i.test(err.message || ""));
  }

  /* Cria o comprovante adminWrites/{id} com a senha; as regras só aceitam a senha do dia. */
  function addProof(batch, key) {
    const { db, doc, collection, serverTimestamp } = fb;
    const ref = doc(collection(db, "adminWrites"));
    batch.set(ref, { key: Number(key), at: serverTimestamp() });
    return ref.id;
  }

  /* Aplica a alteração sobre a lista MAIS RECENTE do Firebase, numa transação.
     Assim duas abas/aparelhos abertos ao mesmo tempo não apagam o trabalho um do outro. */
  async function persist(mutate) {
    if (mode !== "cloud") throw new Error("Firebase não configurado — veja o README.");
    const { db, doc, collection, runTransaction, serverTimestamp } = fb;
    const ref = doc(db, "portfolio", "projects");
    let clean;
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const latest = (snap.exists() && sanitize(snap.data().items)) || clone(window.DEFAULT_PROJECTS);
        clean = sanitize(mutate(latest)) || [];
        const proofRef = doc(collection(db, "adminWrites"));
        tx.set(proofRef, { key: Number(getAdminKey()), at: serverTimestamp() });
        tx.set(ref, { items: clean, writeId: proofRef.id, updatedAt: serverTimestamp() });
      });
    } catch (err) {
      throw new Error(denied(err) ? "Senha expirada. Entre novamente." : "Não foi possível salvar no Firebase.");
    }
    projects = clean;
    emit();
  }

  async function verifyPassword(input) {
    const value = String(input || "").trim();
    if (!/^\d{1,5}$/.test(value)) return false;
    if (!isConfigured()) throw new Error("Firebase não configurado — veja o README.");
    await connect();
    const batch = fb.writeBatch(fb.db);
    addProof(batch, value);
    try {
      await batch.commit();
      return true;
    } catch (err) {
      if (denied(err)) return false;
      throw new Error("Sem conexão com o Firebase.");
    }
  }

  /* ---------- Currículo ----------
   * Guardado no Firestore (sem Firebase Storage, que exige plano pago):
   *   files/cv            → { name, type, size, chunks, version, writeId, updatedAt }
   *   files/cv/chunks/{n} → { data (base64), version, writeId }
   */
  const CV_MAX_BYTES = 5 * 1024 * 1024;
  const CV_CHUNK = 900000; // caracteres base64 por documento (limite do Firestore: 1 MiB)
  const CV_TYPES = /\.(pdf|docx?|odt)$/i;

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
      reader.readAsDataURL(file);
    });
  }

  async function getCVInfo() {
    if (mode !== "cloud") return null;
    const { db, doc, getDoc } = fb;
    const snap = await getDoc(doc(db, "files", "cv"));
    return snap.exists() ? snap.data() : null;
  }

  /* ---------- Arquivos genéricos (files/{id} + files/{id}/chunks/{n}) ---------- */
  const FILE_MAX_BYTES = 100 * 1024 * 1024;
  const CHUNKS_PER_BATCH = 5; // ~4,5 MB por envio: mais estável em conexões lentas (limite do Firestore: 10 MB)

  function formatMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  }

  function transient(err) {
    return err && /unavailable|deadline-exceeded|internal|aborted|resource-exhausted/.test(err.code || "");
  }

  /* Envia um lote, repetindo até 3 vezes em falhas de rede */
  async function commitWithRetry(build) {
    for (let attempt = 1; ; attempt++) {
      const batch = fb.writeBatch(fb.db);
      build(batch);
      try {
        return await batch.commit();
      } catch (err) {
        if (!transient(err) || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  /* Traduz o erro do Firebase numa mensagem que diz o motivo real */
  async function explainUploadError(err) {
    if (denied(err)) {
      const keyStillValid = await verifyPassword(getAdminKey()).catch(() => false);
      return keyStillValid
        ? "O Firebase recusou o arquivo. Publique de novo as regras de firebase/firestore.rules no console do Firebase."
        : "Senha expirada (o dia virou). Entre novamente.";
    }
    if (transient(err)) return "Conexão instável: o envio foi interrompido. Tente de novo numa rede melhor.";
    return "Não foi possível enviar o arquivo (" + (err.code || err.message || "erro desconhecido") + ").";
  }

  /* Apaga partes enviadas de um upload que falhou no meio */
  async function cleanupChunks(fileId, version, count, onProgress) {
    const { db, doc, serverTimestamp } = fb;
    for (let start = 0; start < count; start += CHUNKS_PER_BATCH) {
      await commitWithRetry((batch) => {
        if (start === 0) batch.set(doc(db, "adminWrites", "del_" + fileId + "_" + version), { key: Number(getAdminKey()), at: serverTimestamp() });
        for (let n = start; n < Math.min(start + CHUNKS_PER_BATCH, count); n++) batch.delete(doc(db, "files", fileId, "chunks", String(n)));
      });
      if (onProgress) onProgress(Math.min(start + CHUNKS_PER_BATCH, count), count);
    }
  }

  async function uploadFileTo(fileId, file, onProgress) {
    const base64 = await readAsBase64(file);
    const parts = [];
    for (let i = 0; i < base64.length; i += CV_CHUNK) parts.push(base64.slice(i, i + CV_CHUNK));

    const { db, doc, serverTimestamp } = fb;
    const version = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const meta = { name: file.name.slice(0, 120), type: file.type || guessType(file.name), size: file.size };
    let sent = 0;
    try {
      // partes em lotes; os metadados vão por último para o download nunca ver um arquivo incompleto
      for (let start = 0; start < parts.length; start += CHUNKS_PER_BATCH) {
        await commitWithRetry((batch) => {
          const writeId = addProof(batch, getAdminKey());
          parts.slice(start, start + CHUNKS_PER_BATCH).forEach((data, k) =>
            batch.set(doc(db, "files", fileId, "chunks", String(start + k)), { data, version, writeId }));
        });
        sent = Math.min(start + CHUNKS_PER_BATCH, parts.length);
        if (onProgress) onProgress(sent, parts.length);
      }
      await commitWithRetry((batch) => {
        const writeId = addProof(batch, getAdminKey());
        batch.set(doc(db, "files", fileId), { ...meta, chunks: parts.length, version, writeId, updatedAt: serverTimestamp() });
      });
    } catch (err) {
      console.error("Falha no envio do arquivo:", err);
      const message = await explainUploadError(err);
      if (sent && fileId !== "cv") cleanupChunks(fileId, version, sent).catch(() => {});
      throw new Error(message);
    }
    return { id: fileId, ...meta };
  }

  function guessType(name) {
    if (/\.apk$/i.test(name)) return "application/vnd.android.package-archive";
    if (/\.pdf$/i.test(name)) return "application/pdf";
    if (/\.zip$/i.test(name)) return "application/zip";
    return "application/octet-stream";
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* Baixa files/{id}. Retorna false se o arquivo não existir ou estiver incompleto.
     Decodifica parte a parte (economiza memória em celulares) e informa o progresso. */
  async function downloadFileById(fileId, onProgress) {
    if (mode !== "cloud") return false;
    const { db, doc, getDoc } = fb;
    const metaSnap = await getDoc(doc(db, "files", fileId));
    if (!metaSnap.exists()) return false;
    const info = metaSnap.data();
    const pieces = new Array(info.chunks);
    let done = 0;
    let next = 0;
    let broken = false;
    async function worker() {
      while (next < info.chunks && !broken) {
        const n = next++;
        const snap = await getDoc(doc(db, "files", fileId, "chunks", String(n)));
        if (!snap.exists() || snap.data().version !== info.version) { broken = true; return; }
        pieces[n] = base64ToBytes(snap.data().data);
        done++;
        if (onProgress) onProgress(done, info.chunks);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, info.chunks) }, worker));
    if (broken) return false;
    const url = URL.createObjectURL(new Blob(pieces, { type: info.type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = info.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  /* Exclui files/{id} e suas partes. O comprovante adminWrites/del_{id}_{versão} autoriza a exclusão. */
  async function deleteFile(fileId, onProgress) {
    if (mode !== "cloud" || !fileId) return;
    const { db, doc, getDoc } = fb;
    const snap = await getDoc(doc(db, "files", fileId));
    if (!snap.exists()) return;
    const { version, chunks } = snap.data();
    await cleanupChunks(fileId, version, Math.max(chunks, 1), onProgress);
    await commitWithRetry((batch) => batch.delete(doc(db, "files", fileId)));
  }

  async function uploadProjectFile(file, onProgress) {
    if (mode !== "cloud") throw new Error("Sem conexão com o Firebase.");
    if (file.size > FILE_MAX_BYTES) throw new Error("O arquivo tem " + formatMB(file.size) + " e o máximo é 100 MB.");
    if (!file.size) throw new Error("O arquivo está vazio.");
    const id = "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return uploadFileTo(id, file, onProgress);
  }

  async function uploadCV(file) {
    if (mode !== "cloud") throw new Error("Sem conexão com o Firebase.");
    if (!file) throw new Error("Escolha um arquivo.");
    if (!CV_TYPES.test(file.name)) throw new Error("Use um arquivo PDF ou Word (.pdf, .docx).");
    if (file.size > CV_MAX_BYTES) throw new Error("Arquivo muito grande (máximo 5 MB).");
    await uploadFileTo("cv", file);
  }

  /* Baixa o currículo do Firebase. Retorna false se não houver nenhum enviado. */
  function downloadCV() {
    return downloadFileById("cv");
  }

  function uniqueId(name, list) {
    const base = slugify(name);
    let id = base;
    let n = 2;
    while (list.some((p) => p.id === id)) id = base + "-" + n++;
    return id;
  }

  function setAdminKey(key) { safeSet(SESSION_KEY, key); }
  function getAdminKey() { return safeGet(SESSION_KEY); }
  function clearAdminKey() { safeRemove(SESSION_KEY); }

  window.ProjectStore = {
    load,
    get: () => clone(projects),
    getMode: () => mode,
    isConfigured,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async add(data) {
      let project;
      await persist((list) => {
        project = { ...data, id: uniqueId(data.name, list) };
        return [...list, project];
      });
      return project;
    },
    async update(id, data) {
      await persist((list) => list.map((p) => (p.id === id ? { ...p, ...data, id } : p)));
    },
    async remove(id) {
      await persist((list) => list.filter((p) => p.id !== id));
    },
    async move(id, dir) {
      await persist((list) => {
        const i = list.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = clone(list);
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
    },
    exportJSON() {
      return JSON.stringify(projects, null, 2);
    },

    getCVInfo,
    uploadCV,
    downloadCV,
    uploadProjectFile,
    downloadFileById,
    deleteFile,
    isApk,

    verifyPassword,
    setAdminKey,
    getAdminKey,
    clearAdminKey,
    normalizeLink
  };
})();
