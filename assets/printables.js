/* GBU Curling – printable PDFs (round sheet, weekly sheet, score sheets).
 * Loaded on demand from the admin panel. Needs jsPDF (window.jspdf) and the WEEKS data from index.html.
 * Pages: round + weekly sheets are 11x17 landscape; score sheets are 8.5x11 portrait.
 */
(function () {
  const C = {
    navy: "#2d3e50", navyDark: "#1d2a36", tan: "#d9c5a0", tanLight: "#f4eee1", red: "#a63a2a",
    rope: "#735338", ink: "#22303d", muted: "#6c5a49", line: "#cbb994", white: "#ffffff",
  };
  const TABLOID = [1224, 792];   // 17 x 11 in, landscape, in points
  const LETTER = [612, 792];     // 8.5 x 11 in, portrait
  const POS = ["skip", "vice", "second", "lead"];
  const POS_LABEL = { skip: "Skip", vice: "Vice", second: "Second", lead: "Lead" };

  let assets = null;
  async function loadAssets() {
    if (assets) return assets;
    const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
    const get = async p => { const r = await fetch(p); if (!r.ok) throw new Error("Couldn't load " + p); return r.arrayBuffer(); };
    const [rye, med, bold, logo] = await Promise.all([
      get("assets/fonts/Rye-Regular.ttf"), get("assets/fonts/BarlowCondensed-Medium.ttf"),
      get("assets/fonts/BarlowCondensed-Bold.ttf"), get("assets/logo.png").catch(() => null),
    ]);
    assets = { rye: toB64(rye), med: toB64(med), bold: toB64(bold), logo: logo ? "data:image/png;base64," + toB64(logo) : null };
    return assets;
  }

  function newDoc(size) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: size, orientation: size[0] > size[1] ? "landscape" : "portrait", compress: true });
    doc.addFileToVFS("Rye.ttf", assets.rye); doc.addFont("Rye.ttf", "Rye", "normal");
    doc.addFileToVFS("BC-M.ttf", assets.med); doc.addFont("BC-M.ttf", "BC", "normal");
    doc.addFileToVFS("BC-B.ttf", assets.bold); doc.addFont("BC-B.ttf", "BC", "bold");
    return doc;
  }

  /* ---------- helpers ---------- */
  const font = (doc, fam, style, size, color) => { doc.setFont(fam, style); doc.setFontSize(size); doc.setTextColor(color || C.ink); };
  function fit(doc, text, maxW, size, min) {           // shrink font until text fits
    let s = size; doc.setFontSize(s);
    while (doc.getTextWidth(text) > maxW && s > (min || 8)) { s -= 0.5; doc.setFontSize(s); }
    return s;
  }
  function text(doc, str, x, y, opts) { doc.text(String(str ?? ""), x, y, opts || {}); }
  const fmtLong = d => d ? d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" }) : "Date to be set";
  const fmtShort = d => d ? d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) : "TBD";

  function seasonLabel(weeks) {
    const d = (weeks.find(w => w.date) || {}).date;
    if (!d) return "";
    const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${y + 1} season`;
  }

  /** Logo, league name and a page title. Returns the y where content can start. */
  function header(doc, W, title, subtitle, right, compact) {
    const M = compact ? 30 : 40, L = compact ? 62 : 92;
    if (assets.logo) doc.addImage(assets.logo, "PNG", M, M - 6, L, L, "logo", "FAST");
    const x = M + L + (compact ? 12 : 18);
    font(doc, "Rye", "normal", compact ? 17 : 27, C.navy);
    fit(doc, "The Good, the Bad & the Ugly Curling League", W - x - M - (right ? 230 : 0), compact ? 17 : 27, 12);
    text(doc, "The Good, the Bad & the Ugly Curling League", x, M + (compact ? 16 : 26));
    font(doc, "BC", "bold", compact ? 15 : 22, C.red);
    text(doc, title, x, M + (compact ? 36 : 56));
    if (subtitle) { font(doc, "BC", "normal", compact ? 12 : 15, C.muted); text(doc, subtitle, x, M + (compact ? 51 : 76)); }
    if (right) {
      font(doc, "BC", "normal", compact ? 11 : 14, C.muted);
      right.forEach((r, i) => text(doc, r, W - M, M + 16 + i * (compact ? 14 : 18), { align: "right" }));
    }
    const y = M + L + (compact ? 6 : 10);
    doc.setDrawColor(C.rope); doc.setLineWidth(2); doc.line(M, y, W - M, y);
    doc.setDrawColor(C.tan); doc.setLineWidth(0.75); doc.line(M, y + 4, W - M, y + 4);
    return y + (compact ? 18 : 26);
  }

  function footer(doc, W, H, left, right) {
    const M = 40;
    font(doc, "BC", "normal", 11, C.muted);
    if (left) text(doc, left, M, H - 22);
    if (right) text(doc, right, W - M, H - 22, { align: "right" });
  }

  function sectionTitle(doc, label, x, y) { font(doc, "Rye", "normal", 18, C.navy); text(doc, label, x, y); }

  /** Teams of a round in sheet order of the round's first game. */
  function roundTeams(weeks, round) {
    const first = weeks.filter(w => w.round === round).sort((a, b) => a.game - b.game)[0];
    return first ? first.games.flatMap(g => g.teams) : [];
  }

  /* ---------- round sheet: teams + 4-game schedule (11x17) ---------- */
  function drawRound(doc, weeks, round) {
    const [W, H] = TABLOID, M = 40;
    const rw = weeks.filter(w => w.round === round).sort((a, b) => a.game - b.game);
    const first = rw[0]?.date, last = rw[rw.length - 1]?.date;
    let y = header(doc, W, `Round ${round} teams & schedule`, `${fmtLong(first)} to ${fmtLong(last)}`,
      [seasonLabel(weeks), "Mondays 4:30 to 6:30 pm", "Whitby Curling Club"]);

    // teams table
    sectionTitle(doc, "Teams", M, y + 4); y += 18;
    const teams = roundTeams(weeks, round);
    const labelW = 74, colW = (W - 2 * M - labelW) / Math.max(teams.length, 1);
    const rows = ["vice", "second", "lead", "Spare", "Spare"];
    const headH = 36, rowH = 28;
    doc.setFillColor(C.tanLight); doc.rect(M, y, W - 2 * M, headH, "F");
    teams.forEach((t, i) => {
      const x = M + labelW + i * colW;
      font(doc, "BC", "bold", 17, C.red); fit(doc, t.skip, colW - 12, 17, 11);
      text(doc, t.skip, x + colW / 2, y + 22, { align: "center" });
    });
    font(doc, "BC", "bold", 13, C.muted); text(doc, "Skip", M + 8, y + 23);
    y += headH;
    rows.forEach((r, ri) => {
      const ry = y + ri * rowH;
      if (ri % 2 === 1) { doc.setFillColor("#faf6ec"); doc.rect(M, ry, W - 2 * M, rowH, "F"); }
      font(doc, "BC", "bold", 13, C.muted); text(doc, POS_LABEL[r] || r, M + 8, ry + 19);
      if (POS.includes(r)) {
        teams.forEach((t, i) => {
          font(doc, "BC", "normal", 15, C.ink); fit(doc, t[r], colW - 12, 15, 10);
          text(doc, t[r], M + labelW + i * colW + colW / 2, ry + 19, { align: "center" });
        });
      }
    });
    const tableBottom = y + rows.length * rowH;
    doc.setDrawColor(C.line); doc.setLineWidth(0.75);
    doc.rect(M, y - headH, W - 2 * M, tableBottom - y + headH);
    for (let i = 0; i <= teams.length; i++) { const x = M + labelW + i * colW; doc.line(x, y - headH, x, tableBottom); }
    for (let ri = 0; ri <= rows.length; ri++) doc.line(M, y + ri * rowH, W - M, y + ri * rowH);
    y = tableBottom + 36;

    // schedule: one column per game
    sectionTitle(doc, "Schedule", M, y); y += 14;
    const gap = 16, cw = (W - 2 * M - gap * 3) / 4, ch = H - y - 56;
    rw.forEach((w, i) => {
      const x = M + i * (cw + gap);
      doc.setDrawColor(C.rope); doc.setLineWidth(1.25); doc.roundedRect(x, y, cw, ch, 6, 6);
      doc.setFillColor(C.navy); doc.roundedRect(x, y, cw, 46, 6, 6, "F"); doc.rect(x, y + 30, cw, 16, "F");
      font(doc, "BC", "bold", 19, C.tan); text(doc, `Game ${w.game}`, x + 14, y + 20);
      font(doc, "BC", "normal", 14, C.white); text(doc, fmtLong(w.date), x + 14, y + 38);
      font(doc, "BC", "normal", 12, C.tan); text(doc, `Week ${w.week}`, x + cw - 14, y + 20, { align: "right" });
      const slotH = (ch - 46) / Math.max(w.games.length, 1);
      w.games.forEach((g, gi) => {
        const gy = y + 46 + gi * slotH;
        if (gi) { doc.setDrawColor(C.tan); doc.setLineWidth(0.5); doc.line(x + 10, gy, x + cw - 10, gy); }
        const [a, b] = g.teams, mid = gy + slotH / 2;
        font(doc, "BC", "bold", 12, C.rope); text(doc, `Sheet ${g.sheet}`, x + 14, mid - 17);
        font(doc, "BC", "bold", 17, C.red); fit(doc, a?.skip || "", cw - 28, 17, 11); text(doc, a?.skip || "", x + 14, mid + 2);
        font(doc, "BC", "normal", 13, C.muted); text(doc, "vs", x + 14, mid + 20);
        font(doc, "BC", "bold", 17, C.red); fit(doc, b?.skip || "Bye", cw - 46, 17, 11); text(doc, b?.skip || "Bye", x + 32, mid + 20);
      });
    });
    footer(doc, W, H, "Missing a game? Text Jeff Sisson as soon as you can with your name and the date.", "gbanducurling.ca");
  }

  /* ---------- weekly sheet: this week's 4 sheets with full lineups (11x17) ---------- */
  function drawWeek(doc, weeks, week) {
    const [W, H] = TABLOID, M = 40;
    const w = weeks.find(x => x.week === week); if (!w) return;
    const next = weeks.find(x => x.week === week + 1);
    let y = header(doc, W, fmtLong(w.date), `Round ${w.round}, Game ${w.game}   |   Week ${w.week} of ${weeks.length}`,
      [seasonLabel(weeks), "Mondays 4:30 to 6:30 pm", "Whitby Curling Club"]);
    const gap = 20, cols = 2, rowsN = Math.ceil(w.games.length / cols);
    const cw = (W - 2 * M - gap) / cols, ch = (H - y - 56 - gap * (rowsN - 1)) / rowsN;
    w.games.forEach((g, i) => {
      const x = M + (i % cols) * (cw + gap), cy = y + Math.floor(i / cols) * (ch + gap);
      doc.setDrawColor(C.rope); doc.setLineWidth(1.5); doc.roundedRect(x, cy, cw, ch, 8, 8);
      doc.setFillColor(C.navy); doc.roundedRect(x, cy, cw, 44, 8, 8, "F"); doc.rect(x, cy + 28, cw, 16, "F");
      font(doc, "Rye", "normal", 22, C.tan); text(doc, `Sheet ${g.sheet}`, x + cw / 2, cy + 30, { align: "center" });
      const half = (cw - 40) / 2;
      g.teams.forEach((t, ti) => {
        const tx = x + 20 + ti * half, ty = cy + 88, step = (cy + ch - 40 - (ty + 22)) / 3;
        const cx = tx + half / 2;
        font(doc, "BC", "bold", 32, C.red); fit(doc, t.skip, half - 48, 32, 16); text(doc, t.skip, cx, ty, { align: "center" });
        font(doc, "BC", "bold", 12, C.muted); text(doc, "Skip", cx, ty + 17, { align: "center" });
        ["vice", "second", "lead"].forEach((p, pi) => {
          const py = ty + 22 + step * pi + 22;
          font(doc, "BC", "normal", 23, C.ink); fit(doc, t[p], half - 20, 23, 12); text(doc, t[p], cx, py, { align: "center" });
          font(doc, "BC", "bold", 11, C.muted); text(doc, POS_LABEL[p], cx, py + 13, { align: "center" });
        });
        const sy = cy + ch - 22;
        font(doc, "BC", "bold", 12, C.muted); text(doc, "Spare", tx + 14, sy);
        doc.setDrawColor(C.line); doc.setLineWidth(0.75); doc.line(tx + 50, sy + 2, tx + half - 14, sy + 2);
      });
      doc.setDrawColor(C.tan); doc.setLineWidth(0.75); doc.line(x + cw / 2, cy + 58, x + cw / 2, cy + ch - 14);
      font(doc, "Rye", "normal", 16, C.rope);
      const vy = cy + 78;
      doc.setFillColor(C.white); doc.circle(x + cw / 2, vy, 15, "F");
      text(doc, "vs", x + cw / 2, vy + 5, { align: "center" });
    });
    footer(doc, W, H, next ? `Next week: ${fmtLong(next.date)}` : "Last game of the regular season", "Missing a game? Text Jeff Sisson as soon as you can.   gbanducurling.ca");
  }

  /* ---------- score sheet: names printed, boxes for score / ends / blanks / initials (8.5x11) ---------- */
  function drawScore(doc, weeks, week) {
    const [W, H] = LETTER, M = 30;
    const w = weeks.find(x => x.week === week); if (!w) return;
    let y = header(doc, W, "Score sheet", `${fmtLong(w.date)}   |   Round ${w.round}, Game ${w.game}   |   Week ${w.week}`, null, true);
    const n = w.games.length || 4, gap = 14;
    const bh = (H - y - 40 - gap * (n - 1)) / n;
    const cols = [  // x offsets inside the block
      { k: "team", label: "Team", w: 0.44 }, { k: "score", label: "Score", w: 0.14 },
      { k: "ends", label: "Ends won", w: 0.14 }, { k: "init", label: "Initials", w: 0.14 }, { k: "res", label: "Result", w: 0.14 },
    ];
    const bw = W - 2 * M;
    w.games.forEach((g, i) => {
      const by = y + i * (bh + gap);
      if (i) { doc.setDrawColor(C.muted); doc.setLineWidth(0.5); doc.setLineDashPattern([3, 3], 0); doc.line(M - 10, by - gap / 2, W - M + 10, by - gap / 2); doc.setLineDashPattern([], 0); }
      doc.setDrawColor(C.rope); doc.setLineWidth(1.25); doc.roundedRect(M, by, bw, bh, 6, 6);
      doc.setFillColor(C.navy); doc.roundedRect(M, by, bw, 24, 6, 6, "F"); doc.rect(M, by + 12, bw, 12, "F");
      font(doc, "BC", "bold", 15, C.tan); text(doc, `Sheet ${g.sheet}`, M + 10, by + 17);
      font(doc, "BC", "normal", 11, C.white); text(doc, `${fmtShort(w.date)}  |  Week ${w.week}`, M + bw - 10, by + 17, { align: "right" });
      // column headings
      let cx = M; const hy = by + 38;
      font(doc, "BC", "bold", 10, C.muted);
      cols.forEach(c => { const cwid = bw * c.w; if (c.k !== "team") text(doc, c.label, cx + cwid / 2, hy, { align: "center" }); else text(doc, "Skip and team", cx + 10, hy); cx += cwid; });
      const rowsTop = hy + 6, rowH = (bh - (rowsTop - by) - 26) / 2;
      g.teams.forEach((t, ti) => {
        const ry = rowsTop + ti * rowH;
        if (ti) { doc.setDrawColor(C.tan); doc.setLineWidth(0.5); doc.line(M + 8, ry, M + bw - 8, ry); }
        let x = M;
        const tw = bw * cols[0].w;
        font(doc, "BC", "bold", 17, C.red); fit(doc, t.skip, tw - 20, 17, 11); text(doc, t.skip, x + 10, ry + rowH / 2 - 1);
        font(doc, "BC", "normal", 9.5, C.muted);
        const crew = [t.vice, t.second, t.lead].filter(Boolean).join(", ");
        fit(doc, crew, tw - 20, 9.5, 7); text(doc, crew, x + 10, ry + rowH / 2 + 12);
        x += tw;
        cols.slice(1).forEach(c => {
          const cwid = bw * c.w, pad = 8, boxH = Math.min(rowH - 12, 34);
          doc.setDrawColor(C.ink); doc.setLineWidth(0.9);
          if (c.k === "res") {
            font(doc, "BC", "bold", 10, C.muted);
            ["W", "L", "T"].forEach((L, li) => {
              const ox = x + cwid / 2 + (li - 1) * 22;
              doc.circle(ox, ry + rowH / 2, 8); text(doc, L, ox, ry + rowH / 2 + 3.5, { align: "center" });
            });
          } else {
            doc.roundedRect(x + pad, ry + (rowH - boxH) / 2, cwid - 2 * pad, boxH, 3, 3);
          }
          x += cwid;
        });
      });
      // blank ends
      const fy = by + bh - 10;
      font(doc, "BC", "bold", 10, C.muted); text(doc, "Blank ends", M + 10, fy);
      doc.setDrawColor(C.ink); doc.setLineWidth(0.6); doc.line(M + 58, fy + 1, M + 120, fy + 1);
      font(doc, "BC", "normal", 9, C.muted); text(doc, "Both skips initial to confirm the result.", M + bw - 10, fy, { align: "right" });
    });
  }

  /* ---------- public API ---------- */
  async function make(kind, weeks, which) {
    await loadAssets();
    const size = kind === "score" ? LETTER : TABLOID;
    const doc = newDoc(size);
    const draw = kind === "round" ? drawRound : kind === "week" ? drawWeek : drawScore;
    const list = which === "all"
      ? (kind === "round" ? [...new Set(weeks.map(w => w.round))].sort((a, b) => a - b) : weeks.map(w => w.week))
      : [which];
    list.forEach((n, i) => { if (i) doc.addPage(size, size[0] > size[1] ? "landscape" : "portrait"); draw(doc, weeks, n); });
    const season = seasonLabel(weeks).replace(" season", "");
    const names = {
      round: which === "all" ? `GBU ${season} round sheets` : `GBU Round ${which} teams and schedule`,
      week: which === "all" ? `GBU ${season} weekly sheets` : `GBU Week ${which} schedule`,
      score: which === "all" ? `GBU ${season} score sheets` : `GBU Week ${which} score sheet`,
    };
    return { doc, filename: names[kind] + ".pdf" };
  }

  window.GBUPrint = {
    async download(kind, weeks, which) {
      const { doc, filename } = await make(kind, weeks, which);
      doc.save(filename);
      return filename;
    },
    make,   // used by tests
  };
})();
