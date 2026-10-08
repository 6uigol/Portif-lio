/*
 * Galáxia de Projetos — mini game em canvas.
 * Cada projeto é um planeta orbitando o "sol" GC. A nave segue o mouse/dedo
 * (ou WASD/setas). Encostar num planeta abre o projeto.
 */
(function () {
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PALETTE = ["#7c5cff", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#a78bfa", "#2dd4bf", "#f97316"];

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* Utilitários visuais compartilhados com os cards/admin */
  window.ProjectVisual = {
    color(project, index) {
      return PALETTE[(index != null ? index : hash(project.id || project.name)) % PALETTE.length];
    },
    initials(name) {
      const all = String(name).trim().split(/\s+/).filter(Boolean);
      const significant = all.filter((w) => !/^(and|of|the|e|de|da|do|das|dos)$/i.test(w));
      const words = significant.length ? significant : all;
      if (!words.length) return "?";
      if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
      return (words[0][0] + words[1][0]).toUpperCase();
    }
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function createGalaxy(canvas, opts) {
    const ctx = canvas.getContext("2d");
    const options = Object.assign({ onLand() {}, onScore() {}, onVisit() {}, onComplete() {}, onFirstMove() {} }, opts);

    let W = 0, H = 0, dpr = 1;
    let projects = [];
    let planets = [];
    let stars = [];
    let bits = [];
    let particles = [];
    let floaters = [];
    let shooting = null;

    const ship = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, r: 13, thrust: 0 };
    const pointer = { x: 0, y: 0, active: false, downX: 0, downY: 0, downAt: 0 };
    const keys = new Set();

    let started = false;
    let paused = false;
    let running = false;
    let visible = false;
    let movedOnce = false;
    // O mouse só passa a pilotar depois de se mover de verdade após "Decolar"
    let mouseArmed = false;
    let armOrigin = null;
    let completed = false;
    let score = 0;
    let t = 0;
    let last = 0;
    let rafId = 0;
    const visited = new Set();

    /* ---------- Layout ---------- */
    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
      layoutPlanets();
      if (!started) placeShip();
      else { ship.x = clamp(ship.x, 0, W); ship.y = clamp(ship.y, 0, H); }
      if (!running) draw();
    }

    function placeShip() {
      // canto inferior esquerdo: fora das órbitas elípticas
      ship.x = Math.min(56, W * 0.12);
      ship.y = H - Math.min(56, H * 0.12);
      ship.vx = ship.vy = 0;
      ship.angle = -Math.PI / 4;
    }

    function sunRadius() { return clamp(Math.min(W, H) * 0.05, 18, 30); }

    function buildStars() {
      const count = Math.round((W * H) / 2600);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        z: Math.random(), // profundidade → parallax e brilho
        tw: Math.random() * TAU
      }));
    }

    function layoutPlanets() {
      const n = projects.length;
      const minSide = Math.min(W, H);
      const baseR = clamp(minSide * 0.052, 17, 32) * (n > 10 ? 0.85 : 1);
      const old = new Map(planets.map((p) => [p.project.id, p]));

      // Distribui em 1 ou 2 anéis elípticos ao redor do sol
      // Em telas estreitas um anel único distribui melhor os planetas
      const singleRing = n <= 5 || (W < 600 && n <= 12);
      const inner = Math.ceil(n * 0.4);
      const rings = singleRing ? [{ f: n <= 5 ? 0.66 : 0.88, count: n }] : [{ f: 0.46, count: inner }, { f: 0.82, count: n - inner }];
      planets = [];
      let idx = 0;
      rings.forEach((ring, ri) => {
        const rx = Math.max(0, (W / 2 - baseR - 18) * ring.f);
        const ry = Math.max(0, (H / 2 - baseR - 40) * ring.f);
        const speed = reduceMotion ? 0 : (ri === 0 ? 0.05 : 0.03) * (ri % 2 ? -1 : 1);
        for (let k = 0; k < ring.count; k++, idx++) {
          const project = projects[idx];
          const prev = old.get(project.id);
          planets.push({
            project,
            index: idx,
            rx, ry,
            a0: (k / ring.count) * TAU + ri * 0.6 - Math.PI / 2,
            speed,
            r: baseR * (0.88 + (hash(project.id) % 25) / 100),
            color: window.ProjectVisual.color(project, idx),
            ringed: idx % 3 === 1,
            x: 0, y: 0,
            hover: prev ? prev.hover : 0,
            cooldown: 0
          });
        }
      });
      updatePlanets(0);
    }

    function updatePlanets(dt) {
      planets.forEach((p) => {
        const a = p.a0 + t * p.speed;
        p.x = W / 2 + Math.cos(a) * p.rx;
        p.y = H / 2 + Math.sin(a) * p.ry;
        if (p.cooldown > 0) p.cooldown -= dt;
      });
    }

    /* ---------- Bits colecionáveis ---------- */
    function spawnBit() {
      for (let tries = 0; tries < 20; tries++) {
        const x = rand(30, W - 30);
        const y = rand(40, H - 30);
        const blocked = planets.some((p) => dist(x, y, p.x, p.y) < p.r + 30) || dist(x, y, W / 2, H / 2) < sunRadius() + 30;
        if (!blocked) {
          bits.push({ x, y, born: t, phase: Math.random() * TAU });
          return;
        }
      }
    }

    function burst(x, y, color, amount, speed) {
      for (let i = 0; i < amount; i++) {
        const a = Math.random() * TAU;
        const s = rand(0.3, 1) * speed;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: rand(0.012, 0.03), size: rand(1.5, 3.5), color });
      }
    }

    function confetti() {
      const colors = PALETTE;
      for (let i = 0; i < 160; i++) {
        particles.push({
          x: W / 2 + rand(-40, 40), y: H / 2,
          vx: rand(-6, 6), vy: rand(-9, -2),
          gravity: 0.12, life: 1, decay: rand(0.006, 0.012),
          size: rand(3, 6), color: colors[i % colors.length], square: true, rot: rand(0, TAU)
        });
      }
    }

    /* ---------- Loop ---------- */
    function frame(now) {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05) || 0.016;
      last = now;
      if (!paused) update(dt);
      draw();
      rafId = requestAnimationFrame(frame);
    }

    function setRunning(on) {
      if (on === running) return;
      running = on;
      if (on) { last = performance.now(); rafId = requestAnimationFrame(frame); }
      else cancelAnimationFrame(rafId);
    }

    function syncRunning() {
      setRunning(visible && !document.hidden);
    }

    function update(dt) {
      t += dt;
      updatePlanets(dt);
      if (started) updateShip(dt);

      // Bits
      if (started && bits.length < 6 && Math.random() < dt * 0.9) spawnBit();
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        if (started && dist(b.x, b.y, ship.x, ship.y) < ship.r + 12) {
          bits.splice(i, 1);
          score += 10;
          burst(b.x, b.y, "#22d3ee", 14, 3);
          floaters.push({ x: b.x, y: b.y, text: "+10", life: 1 });
          options.onScore(score);
        }
      }

      // Partículas
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.gravity) { p.vy += p.gravity; p.rot += 0.15; } else { p.vx *= 0.96; p.vy *= 0.96; }
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        floaters[i].y -= 0.6;
        floaters[i].life -= 0.02;
        if (floaters[i].life <= 0) floaters.splice(i, 1);
      }

      // Estrela cadente ocasional
      if (!reduceMotion && !shooting && Math.random() < dt * 0.08) {
        shooting = { x: rand(0, W), y: rand(0, H * 0.4), vx: rand(5, 9), vy: rand(2, 4), life: 1 };
      }
      if (shooting) {
        shooting.x += shooting.vx; shooting.y += shooting.vy; shooting.life -= 0.02;
        if (shooting.life <= 0) shooting = null;
      }
    }

    function updateShip(dt) {
      const k = dt * 60;
      let ax = 0, ay = 0;
      const accel = 0.55;

      if (keys.size) {
        if (keys.has("left")) ax -= 1;
        if (keys.has("right")) ax += 1;
        if (keys.has("up")) ay -= 1;
        if (keys.has("down")) ay += 1;
        const len = Math.hypot(ax, ay) || 1;
        ship.vx += (ax / len) * accel * k;
        ship.vy += (ay / len) * accel * k;
        ship.thrust = 1;
      } else if (pointer.active) {
        const dx = pointer.x - ship.x;
        const dy = pointer.y - ship.y;
        const d = Math.hypot(dx, dy);
        if (d > 6) {
          const desired = Math.min(d * 0.09, 7.5);
          ship.vx += ((dx / d) * desired - ship.vx) * 0.09 * k;
          ship.vy += ((dy / d) * desired - ship.vy) * 0.09 * k;
          ship.thrust = Math.min(1, d / 120);
        } else {
          ship.thrust = 0;
        }
      } else {
        ship.thrust = 0;
      }

      const damping = Math.pow(0.965, k);
      ship.vx *= damping;
      ship.vy *= damping;
      const speed = Math.hypot(ship.vx, ship.vy);
      const max = 8;
      if (speed > max) { ship.vx = (ship.vx / speed) * max; ship.vy = (ship.vy / speed) * max; }

      ship.x += ship.vx * k;
      ship.y += ship.vy * k;

      // Bordas: rebate suave
      if (ship.x < ship.r) { ship.x = ship.r; ship.vx = Math.abs(ship.vx) * 0.5; }
      if (ship.x > W - ship.r) { ship.x = W - ship.r; ship.vx = -Math.abs(ship.vx) * 0.5; }
      if (ship.y < ship.r) { ship.y = ship.r; ship.vy = Math.abs(ship.vy) * 0.5; }
      if (ship.y > H - ship.r) { ship.y = H - ship.r; ship.vy = -Math.abs(ship.vy) * 0.5; }

      if (speed > 0.25) {
        const target = Math.atan2(ship.vy, ship.vx);
        let diff = target - ship.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        ship.angle += diff * Math.min(1, 0.18 * k);
        if (!movedOnce) { movedOnce = true; options.onFirstMove(); }
      }

      // Rastro do motor
      if (ship.thrust > 0.15 && speed > 1) {
        const bx = ship.x - Math.cos(ship.angle) * ship.r;
        const by = ship.y - Math.sin(ship.angle) * ship.r;
        particles.push({
          x: bx + rand(-2, 2), y: by + rand(-2, 2),
          vx: -Math.cos(ship.angle) * rand(0.5, 1.5) + rand(-0.3, 0.3),
          vy: -Math.sin(ship.angle) * rand(0.5, 1.5) + rand(-0.3, 0.3),
          life: 1, decay: rand(0.03, 0.06), size: rand(1.5, 3), color: Math.random() < 0.5 ? "#7c5cff" : "#22d3ee"
        });
      }

      // Sol: empurra a nave para fora
      const sr = sunRadius();
      const ds = dist(ship.x, ship.y, W / 2, H / 2);
      if (ds < sr + ship.r) {
        const nx = (ship.x - W / 2) / (ds || 1);
        const ny = (ship.y - H / 2) / (ds || 1);
        ship.x = W / 2 + nx * (sr + ship.r);
        ship.y = H / 2 + ny * (sr + ship.r);
        ship.vx += nx * 2; ship.vy += ny * 2;
      }

      // Planetas: aproximação e pouso
      for (const p of planets) {
        const d = dist(ship.x, ship.y, p.x, p.y);
        const near = d < p.r + 70 ? 1 : 0;
        p.hover += (near - p.hover) * 0.12;
        if (d < p.r + ship.r - 2 && p.cooldown <= 0) {
          land(p);
          break;
        }
      }
    }

    function land(p) {
      p.cooldown = 1.2;
      paused = true;
      burst(p.x, p.y, p.color, 30, 4);
      const isNew = !visited.has(p.project.id);
      visited.add(p.project.id);
      if (isNew) {
        score += 50;
        options.onScore(score);
        options.onVisit(visited.size, planets.length);
      }
      keys.clear();
      pointer.active = false;
      options.onLand(p.project, () => resumeFrom(p));
    }

    function resumeFrom(p) {
      // Afasta a nave do planeta antes de continuar
      const nx = (ship.x - p.x) || 1;
      const ny = (ship.y - p.y) || 0;
      const len = Math.hypot(nx, ny);
      ship.x = p.x + (nx / len) * (p.r + ship.r + 28);
      ship.y = p.y + (ny / len) * (p.r + ship.r + 28);
      ship.vx = (nx / len) * 2.5;
      ship.vy = (ny / len) * 2.5;
      paused = false;
      draw();
      if (!completed && planets.length && planets.every((pl) => visited.has(pl.project.id))) {
        completed = true;
        confetti();
        options.onComplete(score);
      }
    }

    /* ---------- Desenho ---------- */
    function draw() {
      if (W < 1 || H < 1) return;
      ctx.clearRect(0, 0, W, H);
      drawStars();
      drawOrbits();
      drawSun();
      drawBits();
      planets.forEach(drawPlanet);
      drawParticles();
      drawShip();
      drawFloaters();
    }

    function drawStars() {
      const ox = (ship.x - W / 2) * 0.04;
      const oy = (ship.y - H / 2) * 0.04;
      for (const s of stars) {
        const tw = reduceMotion ? 0.7 : 0.55 + Math.sin(t * 2 + s.tw) * 0.35;
        let x = s.x - ox * s.z;
        let y = s.y - oy * s.z;
        x = ((x % W) + W) % W;
        y = ((y % H) + H) % H;
        ctx.globalAlpha = (0.25 + s.z * 0.6) * tw;
        ctx.fillStyle = s.z > 0.85 ? "#c4b5fd" : "#ffffff";
        const size = s.z > 0.9 ? 1.8 : s.z > 0.5 ? 1.2 : 0.8;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;

      if (shooting) {
        const g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 12, shooting.y - shooting.vy * 12);
        g.addColorStop(0, `rgba(255,255,255,${shooting.life})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(shooting.x, shooting.y);
        ctx.lineTo(shooting.x - shooting.vx * 12, shooting.y - shooting.vy * 12);
        ctx.stroke();
      }
    }

    function drawOrbits() {
      const seen = new Set();
      ctx.save();
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      planets.forEach((p) => {
        const key = Math.round(p.rx);
        if (seen.has(key)) return;
        seen.add(key);
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2, p.rx, p.ry, 0, 0, TAU);
        ctx.stroke();
      });
      ctx.restore();
    }

    function drawSun() {
      const r = sunRadius();
      const pulse = reduceMotion ? 1 : 1 + Math.sin(t * 1.5) * 0.04;
      const glow = ctx.createRadialGradient(W / 2, H / 2, r * 0.5, W / 2, H / 2, r * 3.2);
      glow.addColorStop(0, "rgba(124,92,255,0.35)");
      glow.addColorStop(1, "rgba(124,92,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r * 3.2, 0, TAU);
      ctx.fill();

      const body = ctx.createRadialGradient(W / 2 - r * 0.3, H / 2 - r * 0.3, r * 0.1, W / 2, H / 2, r * pulse);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.35, "#a78bfa");
      body.addColorStop(1, "#5b3df5");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r * pulse, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(r * 0.7)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GC", W / 2, H / 2 + 1);
    }

    function drawBits() {
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const b of bits) {
        const age = Math.min(1, (t - b.born) * 3);
        const bob = Math.sin(t * 3 + b.phase) * 3;
        ctx.globalAlpha = age;
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "#67e8f9";
        ctx.fillText("{}", b.x, b.y + bob);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    function drawPlanet(p) {
      const r = p.r * (1 + p.hover * 0.12);
      const isVisited = visited.has(p.project.id);

      // Halo de aproximação
      if (p.hover > 0.02) {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = p.hover * (0.5 + Math.sin(t * 6) * 0.2);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 9, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.2);
      glow.addColorStop(0, hexA(p.color, 0.35));
      glow.addColorStop(1, hexA(p.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, TAU);
      ctx.fill();

      if (p.ringed) drawRing(p, r, true);

      const body = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      body.addColorStop(0, mix(p.color, "#ffffff", 0.55));
      body.addColorStop(0.55, p.color);
      body.addColorStop(1, mix(p.color, "#000000", 0.45));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();

      if (p.ringed) drawRing(p, r, false);

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `700 ${Math.round(r * 0.62)}px "Space Grotesk", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(window.ProjectVisual.initials(p.project.name), p.x, p.y + 1);

      // Nome do projeto
      const label = p.project.name.length > 18 ? p.project.name.slice(0, 17) + "…" : p.project.name;
      ctx.font = `600 ${W < 520 ? 11 : 12}px Inter, sans-serif`;
      ctx.fillStyle = `rgba(236,236,244,${0.7 + p.hover * 0.3})`;
      ctx.fillText(label, p.x, p.y + r + 16);

      if (isVisited) {
        const bx = p.x + r * 0.75, by = p.y - r * 0.75;
        ctx.fillStyle = "#34d399";
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = "#07070d";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx - 3.5, by);
        ctx.lineTo(bx - 1, by + 2.5);
        ctx.lineTo(bx + 3.5, by - 2.5);
        ctx.stroke();
      }
    }

    function drawRing(p, r, back) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-0.4);
      ctx.strokeStyle = hexA(mix(p.color, "#ffffff", 0.4), 0.7);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      // metade de trás antes do planeta, metade da frente depois
      ctx.ellipse(0, 0, r * 1.7, r * 0.45, 0, back ? Math.PI : 0, back ? TAU : Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    function drawParticles() {
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.square) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawShip() {
      const bob = started ? 0 : Math.sin(t * 2) * 3;
      ctx.save();
      ctx.translate(ship.x, ship.y + bob);
      ctx.rotate(ship.angle + Math.PI / 2);
      const s = ship.r;

      // Chama do motor
      if (ship.thrust > 0.1) {
        const len = s * (0.8 + ship.thrust * 0.9 + Math.random() * 0.4);
        const flame = ctx.createLinearGradient(0, s * 0.7, 0, s * 0.7 + len);
        flame.addColorStop(0, "rgba(34,211,238,0.95)");
        flame.addColorStop(1, "rgba(124,92,255,0)");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-s * 0.38, s * 0.7);
        ctx.lineTo(0, s * 0.7 + len);
        ctx.lineTo(s * 0.38, s * 0.7);
        ctx.closePath();
        ctx.fill();
      }

      ctx.shadowColor = "rgba(124,92,255,0.8)";
      ctx.shadowBlur = 16;
      const hull = ctx.createLinearGradient(0, -s, 0, s);
      hull.addColorStop(0, "#ffffff");
      hull.addColorStop(1, "#b9b2ff");
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.2);
      ctx.quadraticCurveTo(s * 0.55, -s * 0.2, s * 0.95, s * 0.85);
      ctx.lineTo(s * 0.3, s * 0.62);
      ctx.lineTo(-s * 0.3, s * 0.62);
      ctx.lineTo(-s * 0.95, s * 0.85);
      ctx.quadraticCurveTo(-s * 0.55, -s * 0.2, 0, -s * 1.2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.25, s * 0.22, s * 0.36, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    function drawFloaters() {
      ctx.font = '700 14px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      for (const f of floaters) {
        ctx.globalAlpha = f.life;
        ctx.fillStyle = "#67e8f9";
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }

    /* ---------- Cores ---------- */
    function hexToRgb(hex) {
      const v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    function hexA(hex, a) {
      const [r, g, b] = hexToRgb(hex);
      return `rgba(${r},${g},${b},${a})`;
    }
    function mix(hex, hex2, amount) {
      const a = hexToRgb(hex), b = hexToRgb(hex2);
      const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
      return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
    }

    /* ---------- Entrada ---------- */
    function localPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function planetAt(x, y) {
      return planets.find((p) => dist(x, y, p.x, p.y) < p.r + 10);
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!started || paused) return;
      const pos = localPos(e);
      pointer.downX = pos.x; pointer.downY = pos.y; pointer.downAt = performance.now();
      if (e.pointerType !== "mouse") {
        canvas.setPointerCapture(e.pointerId);
        Object.assign(pointer, pos, { active: true });
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!started || paused) return;
      const pos = localPos(e);
      if (e.pointerType === "mouse") {
        if (!mouseArmed) {
          if (!armOrigin) armOrigin = pos;
          if (dist(pos.x, pos.y, armOrigin.x, armOrigin.y) < 24) return;
          mouseArmed = true;
        }
        Object.assign(pointer, pos, { active: true });
        canvas.style.cursor = planetAt(pos.x, pos.y) ? "pointer" : "crosshair";
      } else if (pointer.active) {
        Object.assign(pointer, pos);
      }
    });

    canvas.addEventListener("pointerup", (e) => {
      if (!started || paused) return;
      const pos = localPos(e);
      const isTap = dist(pos.x, pos.y, pointer.downX, pointer.downY) < 8 && performance.now() - pointer.downAt < 300;
      if (e.pointerType !== "mouse") pointer.active = false;
      if (isTap) {
        const p = planetAt(pos.x, pos.y);
        if (p) land(p);
      }
    });

    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") pointer.active = false;
    });
    canvas.addEventListener("pointercancel", () => { pointer.active = false; });

    const KEYMAP = {
      ArrowLeft: "left", KeyA: "left",
      ArrowRight: "right", KeyD: "right",
      ArrowUp: "up", KeyW: "up",
      ArrowDown: "down", KeyS: "down"
    };
    canvas.addEventListener("keydown", (e) => {
      const dir = KEYMAP[e.code];
      if (!dir || !started || paused) return;
      e.preventDefault();
      keys.add(dir);
    });
    canvas.addEventListener("keyup", (e) => {
      const dir = KEYMAP[e.code];
      if (dir) keys.delete(dir);
    });
    canvas.addEventListener("blur", () => keys.clear());

    /* ---------- Visibilidade ---------- */
    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      syncRunning();
    }, { threshold: 0.05 }).observe(canvas);
    document.addEventListener("visibilitychange", syncRunning);

    resize();

    return {
      setProjects(list) {
        projects = list.slice();
        const ids = new Set(projects.map((p) => p.id));
        [...visited].forEach((id) => { if (!ids.has(id)) visited.delete(id); });
        layoutPlanets();
        if (planets.length && planets.every((p) => visited.has(p.project.id))) completed = true;
        else completed = false;
        options.onVisit(visited.size, planets.length);
        if (!running) draw();
      },
      start() {
        if (!started) { placeShip(); mouseArmed = false; armOrigin = null; }
        started = true;
        canvas.focus({ preventScroll: true });
      },
      isVisited: (id) => visited.has(id),
      land(projectId) {
        const p = planets.find((pl) => pl.project.id === projectId);
        if (p) land(p);
      }
    };
  }

  window.ProjectGalaxy = { create: createGalaxy };
})();
