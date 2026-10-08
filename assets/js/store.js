/*
 * Camada de dados dos projetos — Firebase Firestore.
 * - Leitura: documento portfolio/projects (público). Se não existir ou o Firebase
 *   não estiver configurado, usa DEFAULT_PROJECTS.
 * - Escrita: batch validado pelas regras do Firestore com a senha do dia
 *   (veja firebase/firestore.rules). A fórmula da senha fica só no servidor.
 */
(function () {
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const SESSION_KEY = "gc-portfolio:admin-key";
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
          : []
      }));
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
    if (useEmulator) firestore.connectFirestoreEmulator(db, "127.0.0.1", 8080);
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

  async function persist(next) {
    if (mode !== "cloud") throw new Error("Firebase não configurado — veja o README.");
    const clean = sanitize(next) || [];
    const { db, doc, writeBatch, serverTimestamp } = fb;
    const batch = writeBatch(db);
    const writeId = addProof(batch, getAdminKey());
    batch.set(doc(db, "portfolio", "projects"), { items: clean, writeId, updatedAt: serverTimestamp() });
    try {
      await batch.commit();
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

  function uniqueId(name) {
    const base = slugify(name);
    let id = base;
    let n = 2;
    while (projects.some((p) => p.id === id)) id = base + "-" + n++;
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
      const project = { ...data, id: uniqueId(data.name) };
      await persist([...projects, project]);
      return project;
    },
    async update(id, data) {
      await persist(projects.map((p) => (p.id === id ? { ...p, ...data, id } : p)));
    },
    async remove(id) {
      await persist(projects.filter((p) => p.id !== id));
    },
    async move(id, dir) {
      const i = projects.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= projects.length) return;
      const next = clone(projects);
      [next[i], next[j]] = [next[j], next[i]];
      await persist(next);
    },
    async reset() {
      await persist(clone(window.DEFAULT_PROJECTS));
    },
    exportJSON() {
      return JSON.stringify(projects, null, 2);
    },

    verifyPassword,
    setAdminKey,
    getAdminKey,
    clearAdminKey,
    normalizeLink
  };
})();
