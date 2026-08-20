/* 화면. transform.js 가 만든 구조를 그대로 그린다. */

let D = null;                 // buildData 결과
let BASE = new Date();        // 기준일
let fileHandle = null;        // 다시 읽기용 (지원하는 브라우저에서만)
let fileLabel = "";

const $ = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const el = (id) => document.getElementById(id);
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
const n = (v) => (v == null ? "" : Number(v).toLocaleString("ko-KR"));

const STAGE_VAR = {
  "접수": "--stage-1", "가배정": "--stage-2", "참가신청서 제출": "--stage-3",
  "최종배정": "--stage-4", "유학중": "--stage-live", "유학종료": "--stage-done",
  "중도복귀": "--stage-drop", "미선정·미전학": "--stage-out",
};
const stageChip = (s) =>
  `<span class="chip"><i class="dot" style="background:var(${STAGE_VAR[s] || "--muted"})"></i>${esc(s)}</span>`;

/* 도교육청 발표 자료 '연도별 시·군 유학생 수' ('26. 1학기 모집 기준) */
const OFFICIAL = { 2022: 27, 2023: 85, 2024: 165, 2025: 269, 2026: 333 };

/* ── 거들개 ─────────────────────────────────────────── */

const tip = () => el("tip");
function showTip(e, html) {
  const t = tip();
  t.innerHTML = html;
  t.style.opacity = 1;
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = t.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  t.style.left = x + "px"; t.style.top = y + "px";
}
const hideTip = () => { tip().style.opacity = 0; };

function putSvg(host, markup) {
  host.innerHTML = markup;
  host.querySelectorAll("[data-tip]").forEach((x) => {
    x.addEventListener("mousemove", (e) => showTip(e, x.getAttribute("data-tip")));
    x.addEventListener("mouseleave", hideTip);
  });
}

let toastTimer = null;
function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
}

/* ── 파일 열기 ──────────────────────────────────────── */

async function loadFile(file) {
  const err = el("loaderr");
  err.textContent = "";
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    D = buildData(wb);
    fileLabel = file.name;
    el("landing").hidden = true;
    el("main").hidden = false;
    renderAll();
    toast(`${file.name} 을(를) 읽었습니다`);
  } catch (e) {
    err.textContent = `읽지 못했습니다: ${e.message}`;
    console.error(e);
  }
}

async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: "엑셀 파일", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"] } }],
      });
      fileHandle = h;
      await loadFile(await h.getFile());
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  el("fileinput").click();
}

async function reload() {
  if (fileHandle) {
    await loadFile(await fileHandle.getFile());
  } else {
    el("fileinput").click();
  }
}

function setupLanding() {
  const drop = el("drop");
  ["dragenter", "dragover"].forEach((t) =>
    drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) =>
    drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.body.addEventListener("dragover", (e) => e.preventDefault());
  document.body.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  el("openbtn").addEventListener("click", pickFile);
  el("fileinput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadFile(f);
  });
}

/* ── 파생 계산 ──────────────────────────────────────── */

function semRows() {
  return D.semesters.map(([y, t]) => {
    const lab = semLabel(y, t);
    const sel = D.enrollments.filter((e) => e.year === y && e.term === t);
    const stay = sel.filter((e) => !e.endDate || cmp(e.endDate, e.termEnd) >= 0);
    const apps = D.applications.filter((a) => a.intakeYear === y && a.intakeTerm === t);
    return {
      sem: lab, y, t,
      official: sel.length,
      stay: stay.length,
      out: sel.length - stay.length,
      neu: sel.filter((e) => e.kind === "신규").length,
      apply: apps.length,
      pre: apps.filter((a) => txt(a.raw.배정희망서) === "선정").length,
      submit: apps.filter((a) => txt(a.raw.참가신청서) === "제출").length,
      final: apps.filter((a) => a.decision === "배정").length,
      reject: apps.filter((a) => a.decision === "미배정").length,
      check: apps.filter((a) => a.decision === "확인필요").length,
      recorded: semIndex(y, t) >= semIndex(...STAGE_RECORDED_FROM),
    };
  });
}

function stageCounts() {
  const m = new Map(STAGES.map((s) => [s, 0]));
  for (const st of D.students) {
    const s = studentStage(D.profiles.get(st.studentId), BASE);
    m.set(s, (m.get(s) || 0) + 1);
  }
  return m;
}

function studentRow(st) {
  const p = D.profiles.get(st.studentId);
  const lst = D.byStudent.get(st.studentId) || [];
  const expire = lst.length
    ? semEnd(...semFromIndex(semIndex(lst[0].year, lst[0].term) + 5)) : null;
  return {
    st, p, lst, expire,
    stage: studentStage(p, BASE),
    terms: lst.length,
    left: lst.length ? Math.max(0, 6 - lst.length) : null,
  };
}

/* ── 그리기 ─────────────────────────────────────────── */

function renderAll() {
  el("filebar").innerHTML =
    `<span class="name">${esc(fileLabel)}</span>
     <span class="k">시트 '${esc(D.sheetName)}' · 학생 ${n(D.students.length)}명 ·
       신청 ${n(D.applications.length)}건 · 유학이력 ${n(D.enrollments.length)}행 ·
       기준 학기 ${semLabel(CURRENT_YEAR, CURRENT_TERM)} · 기준일 ${isoDate(BASE)}</span>
     <span style="flex:1"></span>
     <button class="ghost" id="reloadbtn">${fileHandle ? "다시 읽기" : "다른 파일 열기"}</button>`;
  el("reloadbtn").addEventListener("click", reload);

  renderSummary();
  renderPivot();
  renderStudents();
  renderEntry();
  renderIssues();
}

/* 요약 탭 */
function renderSummary() {
  const host = el("tab-summary");
  const sc = stageCounts();
  const rows = semRows();
  const cur = rows.find((r) => r.sem === semLabel(CURRENT_YEAR, CURRENT_TERM));
  const expiring = D.students.map(studentRow)
    .filter((r) => r.left != null && r.left <= 2 && !r.p["유학 종료"]).length;

  host.innerHTML = `
    <div class="tiles">
      ${[["현재 유학중", sc.get("유학중"), "전학을 마치고 재학 중"],
         ["최종배정 (전학 전)", sc.get("최종배정"), "시작일이 아직 오지 않음"],
         ["심사 진행 중", sc.get("가배정") + sc.get("참가신청서 제출"), "가배정 · 참가신청서"],
         [`${semLabel(CURRENT_YEAR, CURRENT_TERM)} 유학생`, cur ? cur.official : 0, "발표 자료와 같은 기준"],
         ["체제비 만료 임박", expiring, "도청 지원 잔여 2학기 이하"]]
        .map(([l, v, f]) => `<div class="tile"><div class="label">${esc(l)}</div>
          <div class="value">${n(v)}</div><div class="foot">${esc(f)}</div></div>`).join("")}
    </div>
    <section class="card"><h2>학생 현재 단계</h2>
      <p class="note">학생 한 명이 한 번만 세어집니다. 접수부터 최종배정까지는 진행 중인 단계이고,
        유학종료·중도복귀·미선정은 끝난 상태입니다.</p>
      <div id="stagechart"></div></section>
    <section class="card"><h2>학기별 유학생 수</h2>
      <p class="note">'유학생 수'는 그 학기에 한 번이라도 유학한 인원으로, 도교육청 발표 자료와 같은 기준입니다.
        '학기말 재적'은 그 학기 끝까지 남은 인원이며, 둘의 차이가 학기 중에 그만둔 인원입니다.</p>
      <div class="legend">
        <span><i style="background:var(--series-1)"></i>유학생 수(공식 기준)</span>
        <span><i style="background:var(--series-2)"></i>학기말 재적</span></div>
      <div id="trend"></div></section>
    <section class="card"><h2>모집 단계</h2>
      <p class="note">접수한 학생이 단계마다 얼마나 남는지. 학교 배정희망서와 학부모 참가신청서 칸은
        ${semLabel(...STAGE_RECORDED_FROM)} 모집부터 기록되기 시작해, 그 전 학기는 가운데 두 단계가 비어 있습니다.</p>
      <div class="filters"><label class="f">학기
        <select id="funnelsem">${rows.slice().reverse().map((r) =>
          `<option value="${esc(r.sem)}"${r.sem === (cur ? cur.sem : rows[rows.length - 1].sem) ? " selected" : ""}>${esc(r.sem)}</option>`).join("")}</select></label>
        <span class="k" id="semnote"></span></div>
      <div id="funnel"></div></section>
    <section class="card"><h2>발표 자료 대조</h2>
      <p class="note">도교육청 '연도별 시·군 유학생 수'와 맞춰 본 결과입니다. 2026학년도는 1학기 모집 기준입니다.</p>
      <div class="scroll" id="official"></div></section>`;

  drawStages(sc);
  drawTrend(rows);
  el("funnelsem").addEventListener("change", () => drawFunnel(rows));
  drawFunnel(rows);
  drawOfficial();
}

function drawStages(sc) {
  const rows = STAGES.map((s) => [s, sc.get(s) || 0]);
  const max = Math.max(...rows.map((r) => r[1]), 1);
  const H = 34, W = 760, LEFT = 138, RIGHT = 62, PLOT = W - LEFT - RIGHT;
  const g = rows.map(([name, v], i) => {
    const y = i * H + 6, w = Math.max((v / max) * PLOT, v ? 3 : 0);
    const pct = (v / D.students.length * 100).toFixed(1);
    return `<text class="axis-label" x="${LEFT - 10}" y="${y + 14}" text-anchor="end">${esc(name)}</text>
      <rect class="bar" x="${LEFT}" y="${y}" width="${w}" height="20" fill="var(${STAGE_VAR[name]})"
        data-tip="&lt;b&gt;${esc(name)}&lt;/b&gt;&lt;br&gt;${n(v)}명 · 전체의 ${pct}%"></rect>
      <text class="val-label" x="${LEFT + w + 8}" y="${y + 14}">${n(v)}</text>`;
  }).join("");
  putSvg(el("stagechart"),
    `<svg viewBox="0 0 ${W} ${rows.length * H}" style="height:${rows.length * H}px" role="img"
      aria-label="학생 현재 단계별 인원">${g}</svg>`);
}

function drawTrend(rows) {
  const W = 760, H = 280, L = 46, R = 16, TP = 16, B = 40;
  const max = Math.ceil(Math.max(...rows.map((r) => r.official), 1) / 50) * 50 || 50;
  const x = (i) => L + (i * (W - L - R)) / Math.max(rows.length - 1, 1);
  const y = (v) => TP + (1 - v / max) * (H - TP - B);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"></line>
      <text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${n(v)}</text>`;
  }
  const path = (key) => rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[key])}`).join(" ");
  g += `<path d="${path("official")}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"></path>`;
  g += `<path d="${path("stay")}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"></path>`;
  rows.forEach((r, i) => {
    g += `<text class="axis-label" x="${x(i)}" y="${H - 14}" text-anchor="middle">${esc(r.sem.replace("학기", ""))}</text>
      <circle cx="${x(i)}" cy="${y(r.official)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"></circle>
      <circle cx="${x(i)}" cy="${y(r.stay)}" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"></circle>
      <rect x="${x(i) - 22}" y="${TP}" width="44" height="${H - TP - B}" fill="transparent"
        data-tip="&lt;b&gt;${esc(r.sem)}&lt;/b&gt;&lt;br&gt;유학생 수 ${n(r.official)}명&lt;br&gt;학기말 재적 ${n(r.stay)}명&lt;br&gt;학기 중 종료 ${n(r.out)}명&lt;br&gt;신규 ${n(r.neu)}명"></rect>`;
  });
  const peak = rows.reduce((a, b, i) => (b.official > rows[a].official ? i : a), 0);
  g += `<text class="val-label" x="${x(peak)}" y="${y(rows[peak].official) - 11}" text-anchor="middle">${n(rows[peak].official)}명</text>`;
  const last = rows.length - 1;
  if (rows[last] && rows[last].sem !== semLabel(CURRENT_YEAR, CURRENT_TERM)) {
    g += `<line x1="${x(last)}" x2="${x(last)}" y1="${TP}" y2="${H - B}" stroke="var(--axis)"
      stroke-width="1" stroke-dasharray="3 3"></line>
      <text class="axis-label" x="${x(last) - 6}" y="${TP + 12}" text-anchor="end">모집 중</text>`;
  }
  putSvg(el("trend"), `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img"
    aria-label="학기별 유학생 수 추이">${g}</svg>`);
}

function drawFunnel(rows) {
  const sem = el("funnelsem").value;
  const r = rows.find((x) => x.sem === sem);
  const host = el("funnel");
  host.innerHTML = "";
  let steps = [["접수", r.apply, "--stage-1"], ["가배정", r.pre, "--stage-2"],
               ["참가신청서 제출", r.submit, "--stage-3"], ["최종배정", r.final, "--stage-4"]];
  if (!r.recorded) steps = [steps[0], steps[3]];
  const max = Math.max(...steps.map((s) => s[1]), 1);
  const H = 40, W = 760, LEFT = 138, RIGHT = 130;
  const g = steps.map(([name, v, color], i) => {
    const y = i * H + 8, w = Math.max((v / max) * (W - LEFT - RIGHT), v ? 3 : 0);
    const pct = steps[0][1] ? (v / steps[0][1] * 100).toFixed(1) : "0.0";
    return `<text class="axis-label" x="${LEFT - 10}" y="${y + 17}" text-anchor="end">${esc(name)}</text>
      <rect class="bar" x="${LEFT}" y="${y}" width="${w}" height="24" fill="var(${color})"
        data-tip="&lt;b&gt;${esc(name)}&lt;/b&gt;&lt;br&gt;${n(v)}명 · 접수 대비 ${pct}%"></rect>
      <text class="val-label" x="${LEFT + w + 8}" y="${y + 17}">${n(v)}명 · ${pct}%</text>`;
  }).join("");
  const box = document.createElement("div");
  putSvg(box, `<svg viewBox="0 0 ${W} ${steps.length * H}" style="height:${steps.length * H}px"
    role="img" aria-label="${esc(sem)} 모집 단계별 인원">${g}</svg>`);
  host.appendChild(box);

  const rs = {};
  for (const a of D.applications) {
    if (a.rejectClass && a.intakeYear && semLabel(a.intakeYear, a.intakeTerm) === sem) {
      rs[a.rejectClass] = (rs[a.rejectClass] || 0) + 1;
    }
  }
  const keys = Object.keys(rs).sort((a, b) => rs[b] - rs[a]);
  if (keys.length) {
    host.appendChild($(`<div class="scroll"><table><thead><tr><th>미선정 사유</th><th class="num">인원</th></tr></thead>
      <tbody>${keys.map((k) => `<tr><td>${esc(k)}</td><td class="num">${n(rs[k])}</td></tr>`).join("")}</tbody></table></div>`));
  }
  el("semnote").textContent = r.recorded ? "" : `${sem}는 단계 기록 전이라 접수와 결과만 남아 있습니다.`;
}

function drawOfficial() {
  const byYear = new Map();
  for (const e of D.enrollments) {
    if (e.year === 2026 && e.term !== 1) continue;
    if (!byYear.has(e.year)) byYear.set(e.year, new Set());
    byYear.get(e.year).add(e.studentId);
  }
  const years = Object.keys(OFFICIAL).map(Number).sort();
  el("official").innerHTML = `<table><thead><tr><th>학년도</th><th class="num">발표 자료</th>
    <th class="num">이 데이터</th><th>비고</th></tr></thead><tbody>${
    years.map((y) => {
      const got = byYear.has(y) ? byYear.get(y).size : 0;
      const want = OFFICIAL[y];
      return `<tr><td>${y}학년도${y === 2026 ? " 1학기" : ""}</td><td class="num">${n(want)}</td>
        <td class="num">${n(got)}</td><td>${got === want
          ? "<span style='color:var(--good)'>일치</span>"
          : `고창 1명 차이 — 학교 오보고분, 실제 ${n(got)}명`}</td></tr>`;
    }).join("")}</tbody></table>`;
}

/* ── 교차표 ─────────────────────────────────────────── */

/* 유학이력에서 뽑을 수 있는 행 기준 */
const ROW_DIMS = {
  "유학 지역": (e) => e.region,
  "유학 학교": (e) => e.school,
  "거주 유형": (e) => e.residence,
  "학년": (e) => e.grade,
  "성별": (e) => e.gender,
  "원 지역": (e) => e.homeRegion,
  "원 소속교": (e) => e.homeSchool,
  "신규·계속": (e) => e.kind,
  "(구분 없음)": () => "전체",
};
const COL_DIMS = {
  "학년도": (e) => String(e.year),
  "학기": (e) => semLabel(e.year, e.term),
  "(구분 없음)": () => "전체",
};
/* 무엇을 셀지. 유학이력 한 줄이 조건에 맞으면 그 학생을 센다. */
const MEASURES = {
  "유학생 수": () => true,
  "학기말 재적": (e) => !e.endDate || cmp(e.endDate, e.termEnd) >= 0,
  "신규 유학생": (e) => e.kind === "신규",
  "남": (e) => e.gender === "남",
  "여": (e) => e.gender === "여",
  "가족체류형": (e) => e.residence === "가족체류형",
  "홈스테이형": (e) => e.residence === "홈스테이형",
  "유학센터형": (e) => e.residence === "유학센터형",
};

/* 발표 자료 '연도별 시·군 유학생 수' 의 시군 차례 */
const REGION_ORDER = ["군산", "익산", "정읍", "남원", "김제", "완주", "진안",
                      "무주", "장수", "임실", "순창", "고창", "부안"];

let pivotResult = null;

function computePivot(rowDim, colDim, measure, opts) {
  const keep = MEASURES[measure];
  const rowFn = ROW_DIMS[rowDim], colFn = COL_DIMS[colDim];
  const cut = semIndex(CURRENT_YEAR, CURRENT_TERM);
  const cells = new Map();       // "row|col" → Set(studentId)
  const rowTotals = new Map();   // row → Set
  const colTotals = new Map();   // col → Set
  const all = new Set();
  const rowKeys = new Set(), colKeys = new Set();

  for (const e of D.enrollments) {
    if (!keep(e)) continue;
    if (opts.hideOpen && semIndex(e.year, e.term) > cut) continue;
    const rk = rowFn(e) ?? "(빈칸)";
    const ck = colFn(e) ?? "(빈칸)";
    rowKeys.add(rk); colKeys.add(ck);
    const k = rk + " " + ck;
    if (!cells.has(k)) cells.set(k, new Set());
    cells.get(k).add(e.studentId);
    if (!rowTotals.has(rk)) rowTotals.set(rk, new Set());
    rowTotals.get(rk).add(e.studentId);
    if (!colTotals.has(ck)) colTotals.set(ck, new Set());
    colTotals.get(ck).add(e.studentId);
    all.add(e.studentId);
  }

  const cols = [...colKeys].sort();
  let rows = [...rowKeys];
  if (opts.sort === "이름순") {
    rows.sort((a, b) => a.localeCompare(b, "ko"));
  } else if (opts.sort === "발표 자료 순서") {
    const at = (k) => { const i = REGION_ORDER.indexOf(k); return i < 0 ? 99 : i; };
    rows.sort((a, b) => at(a) - at(b) || a.localeCompare(b, "ko"));
  } else {
    rows.sort((a, b) => (rowTotals.get(b).size - rowTotals.get(a).size) || a.localeCompare(b, "ko"));
  }

  return {
    rowDim, colDim, measure, cols, rows, hideOpen: opts.hideOpen,
    get: (r, c) => (cells.get(r + " " + c) || { size: 0 }).size,
    rowTotal: (r) => rowTotals.get(r).size,
    colTotal: (c) => colTotals.get(c).size,
    grand: all.size,
  };
}

function renderPivot() {
  const host = el("tab-pivot");
  host.innerHTML = `
    <section class="card">
      <h2>교차표 만들기</h2>
      <p class="note">유학이력(학생 × 학기)을 세로·가로로 갈라 셉니다. 한 칸은 <b>그 조건에 해당하는 학생 수</b>이며,
        같은 학생이 한 칸 안에서 두 번 세어지지 않습니다. 그래서 열을 '학년도'로 두면 1·2학기를 모두 다닌 학생도 한 번만
        세어져 발표 자료와 같은 값이 나옵니다.</p>
      <div class="filters">
        <label class="f">세로(행)
          <select id="pvrow">${Object.keys(ROW_DIMS).map((k) =>
            `<option${k === "유학 지역" ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="f">가로(열)
          <select id="pvcol">${Object.keys(COL_DIMS).map((k) =>
            `<option${k === "학년도" ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
        <label class="f">무엇을 셀까
          <select id="pvval">${Object.keys(MEASURES).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
        <label class="f">차례
          <select id="pvsort"><option>인원순</option><option>이름순</option>
            <option>발표 자료 순서</option></select></label>
        <label class="f" style="flex-direction:row;align-items:center;gap:6px;padding-bottom:8px">
          <input type="checkbox" id="pvopen" checked>
          모집 중인 학기 빼기</label>
        <button class="ghost" id="pvcopy">표 복사</button>
        <button class="ghost" id="pvcsv">CSV 내려받기</button>
      </div>
      <div class="scroll" id="pvtable"></div>
      <p class="k" id="pvnote" style="margin-top:12px"></p>
    </section>`;

  const redraw = () => {
    pivotResult = computePivot(el("pvrow").value, el("pvcol").value, el("pvval").value,
      { sort: el("pvsort").value, hideOpen: el("pvopen").checked });
    drawPivotTable(pivotResult);
  };
  ["pvrow", "pvcol", "pvval", "pvsort", "pvopen"].forEach((id) =>
    el(id).addEventListener("change", redraw));
  el("pvcopy").addEventListener("click", () => {
    navigator.clipboard.writeText(pivotText(pivotResult, "\t"))
      .then(() => toast("표를 복사했습니다. 엑셀에 붙여넣으세요"))
      .catch(() => toast("복사하지 못했습니다"));
  });
  el("pvcsv").addEventListener("click", () => {
    const name = `${pivotResult.rowDim}_${pivotResult.colDim}_${pivotResult.measure}.csv`;
    // 엑셀이 UTF-8 로 열도록 BOM 을 붙인다
    const blob = new Blob(["﻿" + pivotText(pivotResult, ",")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  redraw();
}

function pivotText(p, sep) {
  const q = (v) => (sep === "," && /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [[p.rowDim, ...p.cols, "합계"].map(q).join(sep)];
  for (const r of p.rows) {
    lines.push([r, ...p.cols.map((c) => p.get(r, c)), p.rowTotal(r)].map(q).join(sep));
  }
  lines.push(["합계", ...p.cols.map((c) => p.colTotal(c)), p.grand].map(q).join(sep));
  return lines.join("\n");
}

function drawPivotTable(p) {
  const max = Math.max(1, ...p.rows.flatMap((r) => p.cols.map((c) => p.get(r, c))));
  const body = p.rows.map((r) => `<tr>
    <th class="rowhead">${esc(r)}</th>
    ${p.cols.map((c) => {
      const v = p.get(r, c);
      const a = v ? (0.10 + 0.55 * (v / max)).toFixed(3) : 0;
      return `<td class="num cell" style="background:rgba(var(--heat),${a})">${v ? n(v) : ""}</td>`;
    }).join("")}
    <td class="num"><b>${n(p.rowTotal(r))}</b></td></tr>`).join("");
  el("pvtable").innerHTML = `<table class="pivot"><thead><tr>
    <th class="rowhead">${esc(p.rowDim)}</th>
    ${p.cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}
    <th class="num">합계</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="total"><th class="rowhead">합계</th>
      ${p.cols.map((c) => `<td class="num">${n(p.colTotal(c))}</td>`).join("")}
      <td class="num">${n(p.grand)}</td></tr></tfoot></table>`;
  el("pvnote").textContent =
    `${p.rows.length}행 × ${p.cols.length}열 · 값은 '${p.measure}'. ` +
    (p.hideOpen
      ? `모집이 진행 중인 ${semLabel(CURRENT_YEAR, CURRENT_TERM)} 이후 학기는 빼고 셌습니다. `
      : "모집이 진행 중인 학기까지 포함해 셌습니다. ") +
    "합계는 그 줄·칸에 해당하는 학생을 중복 없이 센 값이라, 한 학생이 학년도 중에 지역이나 학교를 옮긴 경우 " +
    "칸의 단순 합과 다를 수 있습니다.";
}

/* ── 학생 ───────────────────────────────────────────── */

function renderStudents() {
  const host = el("tab-students");
  const sc = stageCounts();
  host.innerHTML = `
    <section class="card"><h2>학생 찾기</h2>
      <p class="note">이름·학교·지역·보호자 이름으로 찾습니다. 줄을 누르면 그 학생의 신청부터 지금까지가 아래에 펼쳐집니다.</p>
      <div class="filters">
        <label class="f">검색<input type="search" id="q" placeholder="이름, 학교, 지역, 보호자" autocomplete="off"></label>
        <label class="f">단계 <select id="stagef"><option value="">전체</option>${
          STAGES.map((s) => `<option value="${esc(s)}">${esc(s)} (${sc.get(s) || 0})</option>`).join("")}</select></label>
        <label class="f">지역 <select id="regionf"><option value="">전체</option>${
          [...new Set(D.enrollments.map((e) => e.region).filter(Boolean))].sort()
            .map((r) => `<option>${esc(r)}</option>`).join("")}</select></label>
        <button class="ghost" id="stcsv">보이는 목록 CSV</button>
        <span class="k" id="hits"></span>
      </div>
      <div class="scroll" id="list"></div>
      <div class="detail" id="detail"><p class="empty">학생을 고르면 이력이 여기에 나옵니다.</p></div>
    </section>
    <section class="card"><h2>체제비 지원 만료 임박</h2>
      <p class="note">전북특별자치도청 지원은 최대 3년(6학기)입니다. 아직 유학 중이면서 잔여 2학기 이하인 학생입니다.</p>
      <div class="scroll" id="expiring"></div></section>`;

  let shown = [];
  const render = () => {
    const q = el("q").value.trim().toLowerCase();
    const sf = el("stagef").value, rf = el("regionf").value;
    let rows = D.students.map(studentRow);
    if (sf) rows = rows.filter((r) => r.stage === sf);
    if (rf) rows = rows.filter((r) => r.p["최근 유학지역"] === rf);
    if (q) rows = rows.filter((r) => [r.st.name, r.p["최근 유학학교"], r.p["최근 유학지역"],
      r.st.guardian, r.st.homeSchool, r.st.homeRegion]
      .some((v) => v && v.toLowerCase().includes(q)));
    el("hits").textContent = `${rows.length.toLocaleString("ko-KR")}명`;
    shown = rows;
    const view = rows.slice(0, 200);
    el("list").innerHTML = `<table><thead><tr>
      <th>성명</th><th>단계</th><th>학년</th><th>유학 지역</th><th>유학 학교</th>
      <th>거주 유형</th><th class="num">학기</th><th>보호자</th></tr></thead><tbody>${
      view.map((r) => `<tr class="pick" data-id="${r.st.studentId}">
        <td>${esc(r.st.name)}</td><td>${stageChip(r.stage)}</td><td>${esc(r.p["현재 학년"])}</td>
        <td>${esc(r.p["최근 유학지역"])}</td><td>${esc(r.p["최근 유학학교"])}</td>
        <td>${esc(r.p["최근 거주유형"])}</td><td class="num">${n(r.terms)}</td>
        <td>${esc(r.st.guardian)}</td></tr>`).join("")}</tbody></table>
      ${rows.length > view.length ? `<p class="k" style="padding:8px 10px">앞 ${view.length}명만 보입니다. 검색어를 좁혀 주세요.</p>` : ""}`;
    el("list").querySelectorAll("tr.pick").forEach((tr) =>
      tr.addEventListener("click", () => openStudent(tr.dataset.id)));
  };

  ["q", "stagef", "regionf"].forEach((id) => {
    el(id).addEventListener(id === "q" ? "input" : "change", render);
  });
  el("stcsv").addEventListener("click", () => {
    const head = ["학생ID", "성명", "성별", "현재 단계", "학년", "유학 지역", "유학 학교",
      "거주 유형", "누적 학기", "유학 학년도", "보호자", "연락처"];
    const body = shown.map((r) => [r.st.studentId, r.st.name, r.st.gender, r.stage,
      r.p["현재 학년"], r.p["최근 유학지역"], r.p["최근 유학학교"], r.p["최근 거주유형"],
      r.terms, r.p["유학 학년도"], r.st.guardian, r.st.guardianPhone]);
    const csv = [head, ...body].map((row) =>
      row.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "학생목록.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  render();

  const exp = D.students.map(studentRow)
    .filter((r) => r.left != null && r.left <= 2 && !r.p["유학 종료"])
    .sort((a, b) => a.left - b.left || cmp(a.expire, b.expire));
  el("expiring").innerHTML = exp.length ? `<table><thead><tr>
    <th>성명</th><th>단계</th><th>유학 지역</th><th>유학 학교</th>
    <th class="num">누적 학기</th><th class="num">잔여</th><th>만료일</th></tr></thead><tbody>${
    exp.map((r) => `<tr class="${r.left === 0 ? "warnrow" : ""}">
      <td>${esc(r.st.name)}</td><td>${stageChip(r.stage)}</td><td>${esc(r.p["최근 유학지역"])}</td>
      <td>${esc(r.p["최근 유학학교"])}</td><td class="num">${n(r.terms)}</td>
      <td class="num">${n(r.left)}</td><td>${isoDate(r.expire)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="empty">해당하는 학생이 없습니다.</p>`;
}

function openStudent(id) {
  const st = D.students.find((x) => x.studentId === id);
  const r = studentRow(st);
  const items = [];
  for (const a of st.apps) {
    const lab = a.intakeYear ? semLabel(a.intakeYear, a.intakeTerm) : "?";
    items.push({
      sem: lab, out: a.decision !== "배정",
      when: `${lab}${a.intakeRound ? ` ${a.intakeRound}차 모집` : ""}`,
      what: `신청 — ${esc(a.stage)}${a.decision === "배정" ? "" : ` (${esc(a.decision)})`}` +
        `${txt(a.raw.유학학교) ? ` · ${esc(txt(a.raw.유학지역) || "")} ${esc(txt(a.raw.유학학교))}` : ""}` +
        `${a.decision !== "배정" && a.rejectReason ? `<br><span class="k">${esc(a.rejectReason)}</span>` : ""}`,
    });
  }
  for (const h of r.lst) {
    const stay = !h.endDate || cmp(h.endDate, h.termEnd) >= 0;
    items.push({
      sem: semLabel(h.year, h.term), out: !stay,
      when: semLabel(h.year, h.term),
      what: `${esc(h.kind)} 유학 — ${esc(h.region || "")} ${esc(h.school || "")} ${esc(h.grade || "")}` +
        `${h.status === "종료" ? ` · 종료 ${h.endDate ? isoDate(h.endDate) : ""}${h.endReason ? ` (${esc(h.endReason)})` : ""}` : ""}` +
        `${h.status === "예정" ? " · 전학 예정" : ""}`,
    });
  }
  items.sort((a, b) => a.sem.localeCompare(b.sem));
  el("detail").innerHTML = `
    <h3>${esc(st.name)} ${stageChip(r.stage)}</h3>
    <p class="k" style="margin:0 0 4px">${esc(st.gender || "")} · 원적 ${esc(st.homeRegion || "")}
      ${esc(st.homeSchool || "")} · 보호자 ${esc(st.guardian || "")} ${esc(st.guardianPhone || "")}
      ${r.p["최근 거주지"] ? ` · 거주 ${esc(r.p["최근 거주지"])}` : ""}</p>
    <p class="k" style="margin:0">유학 ${esc(r.p["유학 학년도"] || "-")} · 누적 ${n(r.terms)}학기
      ${r.expire ? ` · 도청 지원 만료 ${isoDate(r.expire)}` : ""}
      ${r.left != null ? ` · 잔여 ${n(r.left)}학기` : ""}</p>
    <ul class="tl">${items.map((i) =>
      `<li class="${i.out ? "out" : ""}"><span class="when">${esc(i.when)}</span> <span class="what">${i.what}</span></li>`).join("")}</ul>`;
  el("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── 확인 항목 ──────────────────────────────────────── */

function renderIssues() {
  const host = el("tab-issues");
  const order = ["조치 필요", "확인 권장", "참고"];
  const groups = new Map(order.map((k) => [k, []]));
  for (const i of D.issues) groups.get(i.심각도)?.push(i);

  host.innerHTML = `
    <section class="card"><h2>확인 항목</h2>
      <p class="note">'참고'는 집계 숫자에 영향이 없는 항목입니다. 발표 자료와 숫자가 맞는 한 넘어가도 됩니다.</p>
      ${order.map((k) => {
        const rows = groups.get(k);
        if (!rows.length) return "";
        const kinds = {};
        rows.forEach((r) => { kinds[r.유형] = (kinds[r.유형] || 0) + 1; });
        return `<h3 style="margin-top:18px">${esc(k)} <span class="k">${rows.length}건 —
          ${Object.entries(kinds).map(([t, c]) => `${esc(t)} ${c}`).join(" · ")}</span></h3>
          <div class="scroll"><table><thead><tr><th>유형</th><th>성명</th><th>원본 행</th><th>내용</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.유형)}</td><td>${esc(r.성명)}</td>
            <td class="k">${esc(r.원본행)}</td><td>${esc(r.내용)}</td></tr>`).join("")}</tbody></table></div>`;
      }).join("")}
    </section>`;
}

/* ── 입력 도우미 ────────────────────────────────────── */

/* 원본 1번 시트의 열 차례. 붙여넣기용 한 줄을 이 차례로 만든다. */
const RAW_COLS = [
  "순", "예비유학생", "농어촌유학초등학교 졸업 후 전북 관내 중학교 진학",
  "전북 관내/농어촌유학학교 간 전학", "기타", "유학 학년도", "농어촌유학 접수일/시작일",
  "(학교) 배정 희망서", "(학부모) 최종 참가신청서", "(도교육청) 최종배정 여부",
  "중간 종료 사유", "농어촌유학 종료일", "학생 성명", "학생 전화번호", "성별",
  "원 지역", "원 소속청", "원 소속교", "유학 지역", "전입시 학년", "현재 학년",
  "유학 학교명", "이전 농촌유학 지역", "이전 농촌유학 학교명", "거주 유형",
  "거주지 설명", "보호자 성명", "보호자 연락처", "형제자매 여부", "비고",
];

let queue = [];   // 만들어 둔 줄

function distinct(fn) {
  return [...new Set(D.enrollments.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function renderEntry() {
  const host = el("tab-entry");
  const regions = distinct((e) => e.region);
  const places = distinct((e) => e.place);
  const offices = [...new Set(D.students.map((s) => s.homeOffice).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const homeRegions = [...new Set(D.students.map((s) => s.homeRegion).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const nextSem = () => {
    const [y, t] = D.semesters[D.semesters.length - 1];
    return semLabel(y, t);
  };
  const semOptions = [];
  for (let i = semIndex(...D.semesters[0]); i <= semIndex(...D.semesters[D.semesters.length - 1]) + 2; i++) {
    semOptions.push(semLabel(...semFromIndex(i)));
  }

  const field = (id, label, kind, opts) => {
    if (kind === "select") {
      return `<label class="f">${esc(label)}<select id="${id}">
        <option value=""></option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select></label>`;
    }
    return `<label class="f">${esc(label)}<input type="text" id="${id}"${opts ? ` list="${opts}"` : ""}></label>`;
  };

  host.innerHTML = `
    <section class="card">
      <h2>새 학생 줄 만들기</h2>
      <p class="note">원본 명단은 그대로 두고 씁니다. 아래를 채우면 <b>원본 1번 시트의 열 차례 그대로</b> 한 줄을
        만들어 줍니다. 복사해서 원본의 맨 아랫줄에 붙여넣으면 됩니다.
        고르는 값은 지금 열려 있는 파일에 이미 있는 값에서 뽑았습니다.</p>
      <datalist id="dl-region">${regions.map((r) => `<option>${esc(r)}</option>`).join("")}</datalist>
      <datalist id="dl-school"></datalist>
      <datalist id="dl-place">${places.map((r) => `<option>${esc(r)}</option>`).join("")}</datalist>
      <datalist id="dl-office">${offices.map((r) => `<option>${esc(r)}</option>`).join("")}</datalist>
      <datalist id="dl-homeregion">${homeRegions.map((r) => `<option>${esc(r)}</option>`).join("")}</datalist>

      <h3 style="margin-top:14px">접수</h3>
      <div class="filters">
        ${field("f_sem", "접수 학기", "select", semOptions)}
        ${field("f_round", "모집 차수", "select", ["1차", "2차", "3차"])}
        <span class="k" id="f_intake" style="padding-bottom:8px"></span>
      </div>

      <h3>학생</h3>
      <div class="filters">
        ${field("f_name", "성명", "text")}
        ${field("f_gender", "성별", "select", ["남", "여"])}
        ${field("f_grade", "전입시 학년", "select", GRADE_ORDER)}
        ${field("f_homeregion", "원 지역", "text", "dl-homeregion")}
        ${field("f_office", "원 소속청", "text", "dl-office")}
        ${field("f_homeschool", "원 소속교", "text")}
        ${field("f_phone", "학생 전화번호", "text")}
      </div>

      <h3>배정</h3>
      <div class="filters">
        ${field("f_region", "유학 지역", "text", "dl-region")}
        ${field("f_school", "유학 학교명", "text", "dl-school")}
        ${field("f_res", "거주 유형", "select", ["가족체류형", "홈스테이형", "유학센터형"])}
        ${field("f_place", "거주지 설명", "text", "dl-place")}
      </div>
      <div class="filters">
        ${field("f_wish", "(학교) 배정 희망서", "text")}
        ${field("f_submit", "(학부모) 참가신청서", "select", ["제출"])}
        ${field("f_final", "(도교육청) 최종배정", "select", ["최종배정", "미배정", "X"])}
        ${field("f_end", "종료일", "select", ["현재"])}
      </div>

      <h3>보호자</h3>
      <div class="filters">
        ${field("f_guardian", "보호자 성명", "text")}
        ${field("f_gphone", "보호자 연락처", "text")}
        ${field("f_sib", "형제자매 여부", "select", ["형제자매"])}
        ${field("f_note", "비고", "text")}
      </div>

      <div class="filters" style="margin-top:6px">
        <button class="primary" id="e_add">이 줄 담기</button>
        <button class="ghost" id="e_clear">비우기</button>
        <span class="k" id="e_msg"></span>
      </div>

      <div id="e_preview"></div>
    </section>

    <section class="card">
      <h2>담아 둔 줄 <span class="k" id="e_count"></span></h2>
      <p class="note">형제자매처럼 여러 명을 한꺼번에 넣을 때 쓰세요. 복사한 뒤 원본 맨 아랫줄에 붙여넣고,
        위쪽 '다시 읽기'를 누르면 이 화면이 새 내용으로 다시 계산됩니다.</p>
      <div class="filters">
        <button class="ghost" id="e_copy">담은 줄 모두 복사</button>
        <button class="ghost" id="e_drop">담은 줄 비우기</button>
      </div>
      <div class="scroll" id="e_queue"></div>
    </section>`;

  const V = (id) => (el(id).value || "").trim();

  const updateSchools = () => {
    const r = V("f_region");
    const list = [...new Set(D.enrollments
      .filter((e) => !r || e.region === r).map((e) => e.school).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko"));
    el("dl-school").innerHTML = list.map((x) => `<option>${esc(x)}</option>`).join("");
  };
  el("f_region").addEventListener("input", updateSchools);
  updateSchools();

  /* 접수일 칸은 날짜가 아니라 '학기 + 모집 차수' 를 담는 자리다 */
  const intake = () => {
    const sem = V("f_sem"), round = V("f_round") || "1차";
    const m = sem.match(/^(\d{4})-(\d)학기$/);
    if (!m) return null;
    const y = Number(m[1]), t = Number(m[2]);
    const day = Number(round[0]);
    return `${y}-${t === 1 ? "03" : "09"}-${String(day).padStart(2, "0")}`;
  };
  const showIntake = () => {
    const v = intake();
    el("f_intake").textContent = v
      ? `접수일 칸에는 ${v} 로 들어갑니다 (마지막 자리가 모집 차수)` : "";
  };
  ["f_sem", "f_round"].forEach((id) => el(id).addEventListener("change", showIntake));
  el("f_sem").value = nextSem();
  el("f_round").value = "1차";
  showIntake();

  const buildRow = () => {
    const v = {};
    RAW_COLS.forEach((c) => { v[c] = ""; });
    v["농어촌유학 접수일/시작일"] = intake() || "";
    v["학생 성명"] = V("f_name");
    v["성별"] = V("f_gender");
    v["전입시 학년"] = V("f_grade");
    v["현재 학년"] = V("f_grade");
    v["원 지역"] = V("f_homeregion");
    v["원 소속청"] = V("f_office");
    v["원 소속교"] = V("f_homeschool");
    v["학생 전화번호"] = V("f_phone");
    v["유학 지역"] = V("f_region");
    v["유학 학교명"] = V("f_school");
    v["거주 유형"] = V("f_res");
    v["거주지 설명"] = V("f_place");
    v["(학교) 배정 희망서"] = V("f_wish");
    v["(학부모) 최종 참가신청서"] = V("f_submit");
    v["(도교육청) 최종배정 여부"] = V("f_final");
    v["농어촌유학 종료일"] = V("f_end");
    v["보호자 성명"] = V("f_guardian");
    v["보호자 연락처"] = V("f_gphone");
    v["형제자매 여부"] = V("f_sib");
    v["비고"] = V("f_note");
    const sem = V("f_sem").match(/^(\d{4})/);
    if (sem && V("f_final") === "최종배정") v["유학 학년도"] = sem[1];
    return v;
  };

  const problems = (v) => {
    const out = [];
    if (!v["학생 성명"]) out.push("성명이 비어 있습니다");
    if (!v["농어촌유학 접수일/시작일"]) out.push("접수 학기를 고르세요");
    if (!v["보호자 연락처"]) out.push("보호자 연락처가 비어 있으면 같은 사람인지 가리기 어렵습니다");
    if (v["(도교육청) 최종배정 여부"] === "최종배정" && !v["유학 지역"])
      out.push("최종배정인데 유학 지역이 비어 있습니다");
    return out;
  };

  const preview = () => {
    const v = buildRow();
    const probs = problems(v);
    const dup = D.students.find((st) =>
      st.name === v["학생 성명"] && st.guardianPhone === v["보호자 연락처"]);
    const filled = RAW_COLS.filter((c) => v[c] !== "");
    el("e_preview").innerHTML = `
      ${dup ? `<p class="k" style="color:var(--series-1)">이미 있는 학생입니다 —
        ${esc(dup.studentId)} ${esc(dup.name)} (신청 ${dup.apps.length}건). 재신청 건으로 한 줄 더 넣으면 됩니다.</p>` : ""}
      ${probs.length ? `<p class="err">${probs.map(esc).join(" · ")}</p>` : ""}
      <div class="scroll"><table><thead><tr><th>열</th><th>값</th></tr></thead><tbody>${
        filled.map((c) => `<tr><td class="k">${esc(c)}</td><td>${esc(v[c])}</td></tr>`).join("")
      }</tbody></table></div>`;
    return { v, probs };
  };
  host.querySelectorAll("input,select").forEach((x) =>
    x.addEventListener("input", preview));
  preview();

  const drawQueue = () => {
    el("e_count").textContent = queue.length ? `${queue.length}줄` : "";
    el("e_queue").innerHTML = queue.length
      ? `<table><thead><tr><th>성명</th><th>접수</th><th>유학 지역</th><th>유학 학교</th>
          <th>거주 유형</th><th>보호자</th><th></th></tr></thead><tbody>${
        queue.map((v, i) => `<tr><td>${esc(v["학생 성명"])}</td>
          <td>${esc(v["농어촌유학 접수일/시작일"])}</td><td>${esc(v["유학 지역"])}</td>
          <td>${esc(v["유학 학교명"])}</td><td>${esc(v["거주 유형"])}</td>
          <td>${esc(v["보호자 성명"])}</td>
          <td><button class="ghost" data-i="${i}">빼기</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">아직 담은 줄이 없습니다.</p>`;
    el("e_queue").querySelectorAll("button[data-i]").forEach((b) =>
      b.addEventListener("click", () => { queue.splice(Number(b.dataset.i), 1); drawQueue(); }));
  };

  el("e_add").addEventListener("click", () => {
    const { v, probs } = preview();
    if (probs.some((p) => p.includes("성명") || p.includes("접수 학기"))) {
      el("e_msg").textContent = "성명과 접수 학기는 채워야 담깁니다.";
      return;
    }
    queue.push(v);
    el("e_msg").textContent = `${v["학생 성명"]} 담았습니다.`;
    drawQueue();
  });
  el("e_clear").addEventListener("click", () => {
    host.querySelectorAll("input").forEach((x) => { x.value = ""; });
    ["f_gender", "f_grade", "f_res", "f_submit", "f_final", "f_end", "f_sib"]
      .forEach((id) => { el(id).value = ""; });
    el("e_msg").textContent = "";
    preview();
  });
  el("e_copy").addEventListener("click", () => {
    if (!queue.length) { toast("담은 줄이 없습니다"); return; }
    const text = queue.map((v) => RAW_COLS.map((c) => v[c]).join("\t")).join("\n");
    navigator.clipboard.writeText(text)
      .then(() => toast(`${queue.length}줄을 복사했습니다. 원본 맨 아랫줄에 붙여넣으세요`))
      .catch(() => toast("복사하지 못했습니다"));
  });
  el("e_drop").addEventListener("click", () => { queue = []; drawQueue(); });
  drawQueue();
}

/* ── 탭 ─────────────────────────────────────────────── */

function setupTabs() {
  const buttons = [...document.querySelectorAll("nav.tabs button")];
  buttons.forEach((b) => b.addEventListener("click", () => {
    buttons.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    ["summary", "pivot", "students", "entry", "issues"].forEach((t) => {
      el("tab-" + t).hidden = t !== b.dataset.tab;
    });
    scrollTo({ top: 0, behavior: "smooth" });
  }));
}

setupLanding();
setupTabs();
