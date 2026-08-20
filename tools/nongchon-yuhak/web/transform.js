/* 전북 농어촌유학생 명단 원데이터 → 정규화 구조.
   transform.py 와 같은 규칙을 브라우저에서 그대로 돌린다. 두 쪽이 어긋나면
   verify_web.py 가 잡는다. */

const SOURCE_SHEET = "★☆★전북 농어촌 유학생 명단★☆★";
const HEADER_ROW = 8;
const FIRST_DATA_ROW = 9;

/* 기준 학기: 원본 종료일 칸의 '현재' 가 가리키는 학기 */
const CURRENT_YEAR = 2026, CURRENT_TERM = 1;

/* 원본 열 번호(1-based) */
const COL = {
  순: 1, 예비유학생: 2, 중학교진학: 3, 관내전학: 4, 기타: 5,
  유학학년도_원본: 6, 접수일: 7, 배정희망서: 8, 참가신청서: 9, 최종배정: 10,
  중간종료사유: 11, 종료일: 12, 성명: 13, 학생전화: 14, 성별: 15,
  원지역: 16, 원소속청: 17, 원소속교: 18, 유학지역: 19, 전입학년: 20,
  현재학년: 21, 유학학교: 22, 이전유학지역: 23, 이전유학학교: 24,
  거주유형: 25, 거주지: 26, 보호자성명: 27, 보호자연락처: 28,
  형제자매: 29, 비고: 30,
};

const GRADE_ORDER = ["유치원", "초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3"];

const OFFICE_ALIAS = {
  "경기도": "경기", "경상남도": "경남", "경상북도": "경북", "광주광역시": "광주",
  "대구광역시": "대구", "대전광역시": "대전", "부산광역시": "부산", "세종특별시": "세종",
  "울산광역시": "울산", "인천광역시": "인천", "전라남도": "전남",
  "제주특별자치도": "제주", "충청남도": "충남",
};

/* 미선정 사유 원문 → 분류. 위에서부터 먼저 맞는 것으로 분류한다. */
const REASON_RULES = [
  ["거주시설 부족", ["거주시설 부족", "거주시설이 부족", "거주지 부족", "잔여 거주시설"]],
  ["거주시설 부적합·협소", ["협소", "부적합", "인정 불가", "거주공간"]],
  ["거주지 미확보", ["거주지 못", "거주지 미", "거주지를 구하지"]],
  ["거주시설 불만", ["거주시설 불만"]],
  ["면담 불참", ["면담 불참", "면접 불참"]],
  ["면담 결과 미선정", ["면담", "면접"]],
  ["자진 포기·철회", ["자진", "포기", "철회", "미희망"]],
  ["학교 미제출", ["학교 미제출", "미제출"]],
  ["학교생활 적응 우려", ["적응"]],
  ["교육과정 운영 곤란", ["교육과정"]],
  ["중학교 배정 문제", ["중학교"]],
  ["개인 사정", ["개인사", "개인 사정", "공공분양"]],
  ["배정 우선순위 밀림", ["순위", "외동"]],
];

const STAGES = [
  "접수", "가배정", "참가신청서 제출", "최종배정", "유학중",
  "유학종료", "중도복귀", "미선정·미전학",
];
/* 학교 배정희망서·참가신청서 칸은 이 학기 모집부터 기록되기 시작했다. */
const STAGE_RECORDED_FROM = [2025, 2];

const ASSIGNED = new Set(["배정", "최종배정"]);
const UNASSIGNED = new Set(["X", "x", "미배정"]);

/* ── 값 다듬기 ───────────────────────────────────────── */

function txt(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number" && Number.isInteger(v)) v = String(v);
  const t = String(v).trim().replace(/[ \t]+/g, " ");
  return t || null;
}

function asDate(v) {
  return v instanceof Date && !isNaN(v) ? v : null;
}

function isoDate(d) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mkDate(y, m, d) { return new Date(y, m - 1, d); }
function cmp(a, b) { return a.getTime() - b.getTime(); }

/* ── 학기 ────────────────────────────────────────────── */

function semOf(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  if (m >= 9) return [y, 2];
  if (m >= 3) return [y, 1];
  return [y - 1, 2];
}
function semIndex(y, t) { return y * 2 + (t - 1); }
function semFromIndex(i) { return [Math.floor(i / 2), (i % 2) + 1]; }
function semLabel(y, t) { return `${y}-${t}학기`; }
function semStart(y, t) { return t === 1 ? mkDate(y, 3, 1) : mkDate(y, 9, 1); }
function semEnd(y, t) {
  if (t === 1) return mkDate(y, 8, 31);
  return new Date(y + 1, 2, 0); // 다음 해 2월의 마지막 날
}
const CURRENT_INDEX = semIndex(CURRENT_YEAR, CURRENT_TERM);

/* ── 분류 ────────────────────────────────────────────── */

function classifyReason(...parts) {
  const joined = parts.filter(Boolean).join(" ");
  if (!joined) return null;
  for (const [label, keys] of REASON_RULES) {
    if (keys.some((k) => joined.includes(k))) return label;
  }
  return "기타";
}

function normalizeGrade(v) { return v ? v.replace(/ /g, "") : null; }

function gradeAfter(base, years) {
  const i = GRADE_ORDER.indexOf(base);
  if (i < 0) return null;
  const j = i + years;
  return j >= 0 && j < GRADE_ORDER.length ? GRADE_ORDER[j] : null;
}

function normalizeResidence(raw, year) {
  if (!raw) return null;
  if (!raw.includes("→")) return raw;
  const parts = [];
  for (const chunk of raw.split("→")) {
    const m = chunk.match(/^\s*([^(]+)\((\d{4})\)/);
    if (m) parts.push([Number(m[2]), m[1].trim()]);
  }
  if (!parts.length) return raw;
  parts.sort((a, b) => a[0] - b[0]);
  if (year == null) return parts[0][1];
  let chosen = parts[0][1];
  for (const [y, kind] of parts) if (year >= y) chosen = kind;
  return chosen;
}

/* ── 배정 판정 ───────────────────────────────────────── */

function decide(raw) {
  const final = txt(raw.최종배정), end = txt(raw.종료일), wish = txt(raw.배정희망서);
  if (end && end.includes("미전학"))
    return ["미배정", `종료일 칸에 '${end.split("\n")[0]}' — 최종배정 후 전학하지 않음`];
  if (end && ASSIGNED.has(end))
    return ["확인필요",
      `종료일 칸에 '${end}' 라고만 적혀 있어 실제 전학 여부를 알 수 없음 — 공식 시군별 집계에도 빠져 있는 건`];
  if (final && ASSIGNED.has(final)) return ["배정", `최종배정 = ${final}`];
  if (final && UNASSIGNED.has(final)) return ["미배정", `최종배정 = ${final}`];
  if (final) return ["미배정", `최종배정 칸에 사유 기재: ${final.slice(0, 40)}`];
  if (end && (end.startsWith("현재") || asDate(raw.종료일)))
    return ["배정", `최종배정 비어 있으나 종료일(${end.slice(0, 20)}) 기재`];
  if (wish === "선정") return ["확인필요", "학교 배정희망서는 '선정'이나 최종배정 결과 미기재"];
  if (wish) return ["미배정", `학교 단계 미선정: ${wish.slice(0, 40)}`];
  return ["확인필요", "배정 결과 관련 칸이 모두 비어 있음"];
}

function reachedStage(app) {
  if (app.decision === "배정") return "최종배정";
  if (app.decision === "확인필요") return "최종배정 확인 필요";
  if (txt(app.raw.참가신청서) === "제출") return "참가신청서 제출";
  if (txt(app.raw.배정희망서) === "선정") return "가배정";
  return "접수";
}

/* ── 읽기 ────────────────────────────────────────────── */

/* 엑셀 날짜를 Date 로 받아서는 안 된다. 라이브러리가 시간대를 태워 주는데,
   한국(UTC+9)처럼 앞선 시간대에서는 하루가 밀려 3월 1일이 2월 28일이 된다.
   그러면 학기가 통째로 어긋난다. 일련번호에서 연·월·일만 뽑아 쓴다. */
function cellDate(cell) {
  if (!cell) return null;
  if (cell.t === "d" && cell.v instanceof Date) {
    // 그래도 Date 로 온 경우: 시각을 버리고 날짜만 쓴다
    const d = cell.v;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (cell.t !== "n" || typeof cell.v !== "number") return null;
  const looksLikeDate =
    (cell.z && XLSX.SSF && XLSX.SSF.is_date && XLSX.SSF.is_date(String(cell.z))) ||
    (cell.v > 25569 && cell.v < 80000);   // 1970년 이후, 2119년 이전
  if (!looksLikeDate) return null;
  const p = XLSX.SSF.parse_date_code(cell.v);
  if (!p || !p.y) return null;
  return new Date(p.y, p.m - 1, p.d);
}

/* 날짜로 읽어야 하는 원본 열 */
const DATE_KEYS = new Set(["접수일", "종료일"]);

function readRows(workbook) {
  const name = workbook.SheetNames.includes(SOURCE_SHEET)
    ? SOURCE_SHEET
    : workbook.SheetNames.find((s) => s.includes("농어촌 유학생 명단")) || workbook.SheetNames[0];
  const ws = workbook.Sheets[name];
  if (!ws) throw new Error("명단 시트를 찾지 못했습니다.");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];
  for (let r = FIRST_DATA_ROW; r <= range.e.r + 1; r++) {
    const raw = { _row: r };
    for (const [key, c] of Object.entries(COL)) {
      const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
      if (!cell) { raw[key] = null; continue; }
      raw[key] = DATE_KEYS.has(key) ? (cellDate(cell) ?? cell.v) : cell.v;
    }
    if (!txt(raw.성명)) continue;
    rows.push(raw);
  }
  return { rows, sheetName: name };
}

/* ── 만들기 ──────────────────────────────────────────── */

function buildData(workbook) {
  const { rows, sheetName } = readRows(workbook);

  const students = new Map();   // sid → student
  const order = [];
  const keyToId = new Map();
  const apps = [];
  const issues = [];

  const addIssue = (kind, level, app, detail, impact = "있음") => issues.push({
    유형: kind, 심각도: level, "집계 영향": impact,
    원본행: app ? app.row : null, 신청ID: app ? app.appId : null,
    학생ID: app ? app.studentId : null, 성명: app ? txt(app.raw.성명) : null,
    내용: detail,
  });

  for (const raw of rows) {
    const name = txt(raw.성명);
    const gphone = txt(raw.보호자연락처);
    const gname = txt(raw.보호자성명);
    const key = `${name} ${gphone || `${gname}/${txt(raw.원소속교)}`}`;
    if (!keyToId.has(key)) {
      const sid = "S" + String(keyToId.size + 1).padStart(4, "0");
      keyToId.set(key, sid);
      students.set(sid, {
        studentId: sid, name, gender: txt(raw.성별), phone: txt(raw.학생전화),
        homeRegion: txt(raw.원지역),
        homeOffice: OFFICE_ALIAS[txt(raw.원소속청)] ?? txt(raw.원소속청),
        homeSchool: txt(raw.원소속교), guardian: gname, guardianPhone: gphone,
        householdId: null, note: txt(raw.비고), apps: [],
      });
      order.push(sid);
    }
    const sid = keyToId.get(key);

    const app = {
      row: raw._row, raw, appId: "A" + String(apps.length + 1).padStart(4, "0"),
      studentId: sid, intakeDate: null, intakeYear: null, intakeTerm: null,
      intakeRound: null, termStart: null, decision: "", decisionBasis: "",
      rejectStage: null, rejectReason: null, rejectClass: null, stage: "",
    };
    const d = asDate(raw.접수일);
    if (d) {
      app.intakeDate = d;
      [app.intakeYear, app.intakeTerm] = semOf(d);
      // 접수일 칸의 '일' 자리는 날짜가 아니라 모집 차수다 (2025-09-02 = 2학기 2차)
      app.intakeRound = d.getDate() <= 9 ? d.getDate() : 1;
      app.termStart = mkDate(d.getFullYear(), d.getMonth() + 1, 1);
    }
    [app.decision, app.decisionBasis] = decide(raw);

    if (app.decision !== "배정") {
      const endText = txt(raw.종료일) || "";
      if (endText.includes("미전학")) {
        app.rejectStage = "전학";
        app.rejectReason = "최종배정 후 미전학";
        app.rejectClass = "최종배정 후 미전학";
      } else {
        const wish = txt(raw.배정희망서), submit = txt(raw.참가신청서), final = txt(raw.최종배정);
        if (final && !UNASSIGNED.has(final)) { app.rejectStage = "도교육청"; app.rejectReason = final; }
        else if (submit && submit !== "제출") { app.rejectStage = "학부모"; app.rejectReason = submit; }
        else if (wish && wish !== "선정") { app.rejectStage = "학교"; app.rejectReason = wish; }
        else if (final && UNASSIGNED.has(final)) { app.rejectStage = "도교육청"; app.rejectReason = "미배정(사유 미기재)"; }
        app.rejectClass = classifyReason(app.rejectReason);
      }
    }
    app.stage = reachedStage(app);
    apps.push(app);
    students.get(sid).apps.push(app);
  }

  /* 가구: 보호자 연락처 기준 */
  const houseOf = new Map();
  for (const sid of order) {
    const st = students.get(sid);
    const hkey = st.guardianPhone || `${st.guardian}/${st.homeSchool}`;
    if (!houseOf.has(hkey)) houseOf.set(hkey, "H" + String(houseOf.size + 1).padStart(4, "0"));
    st.householdId = houseOf.get(hkey);
  }

  /* 배정 건을 학기 단위로 펼친다 */
  const enrollments = [];
  for (const app of apps) {
    const raw = app.raw;
    if (!app.intakeDate) {
      addIssue("접수일 없음", "조치 필요", app, "접수일(시작일)이 비어 있어 학기를 계산할 수 없음");
      continue;
    }
    if (app.decision === "확인필요") {
      const kind = ASSIGNED.has(txt(raw.종료일) || "")
        ? "최종배정 후 전학 확인 필요" : "배정 결과 미기재";
      addIssue(kind, "조치 필요", app, app.decisionBasis);
      continue;
    }
    if (app.decision !== "배정") continue;

    const startI = semIndex(app.intakeYear, app.intakeTerm);
    const endRaw = txt(raw.종료일);
    const endDate = asDate(raw.종료일);
    let endI, ongoing = false;
    if (endDate) {
      endI = semIndex(...semOf(endDate));
    } else if (endRaw && endRaw.startsWith("현재")) {
      endI = Math.max(startI, CURRENT_INDEX); ongoing = true;
    } else {
      endI = Math.max(startI, CURRENT_INDEX); ongoing = true;
      if (startI < CURRENT_INDEX) {
        addIssue("종료일 미기재", "확인 권장", app,
          `지난 학기에 시작한 배정 건이나 종료일 칸이 '${endRaw || "(비어 있음)"}' — 재학 중으로 간주함`);
      }
    }
    if (endI < startI) {
      addIssue("종료일 역전", "조치 필요", app,
        `종료일(${endRaw})이 시작 학기(${semLabel(app.intakeYear, app.intakeTerm)})보다 이름 — 1개 학기로 처리`);
      endI = startI;
    }

    const baseGrade = normalizeGrade(txt(raw.전입학년));
    if (baseGrade && !GRADE_ORDER.includes(baseGrade)) {
      addIssue("학년 표기 오류", "확인 권장", app,
        `전입시 학년 '${baseGrade}' 은 표준 학년 값이 아님`, "없음");
    }
    const region = (txt(raw.유학지역) || "").trim() || null;
    const school = txt(raw.유학학교);
    const endReason = txt(raw.중간종료사유);

    for (let i = startI; i <= endI; i++) {
      const [y, t] = semFromIndex(i);
      const status = i > CURRENT_INDEX ? "예정" : (i === endI && !ongoing ? "종료" : "재학");
      enrollments.push({
        studentId: app.studentId, name: txt(raw.성명), year: y, term: t, kind: "",
        region, school, grade: gradeAfter(baseGrade, y - app.intakeYear),
        gender: txt(raw.성별), residence: normalizeResidence(txt(raw.거주유형), y),
        place: txt(raw.거주지), householdId: students.get(app.studentId).householdId,
        homeRegion: txt(raw.원지역), homeSchool: txt(raw.원소속교),
        status, endReason: (i === endI && !ongoing) ? endReason : null,
        startDate: i > startI ? semStart(y, t) : app.termStart,
        endDate: i < endI ? semEnd(y, t) : (endDate || null),
        termEnd: semEnd(y, t), appId: app.appId,
      });
    }

    const listed = txt(raw.유학학년도_원본);
    if (listed) {
      const want = new Set((listed.match(/\d{4}/g) || []).map(Number));
      const got = new Set();
      for (let i = startI; i <= endI; i++) got.add(semFromIndex(i)[0]);
      const same = want.size === got.size && [...want].every((v) => got.has(v));
      if (!same) {
        addIssue("유학 학년도 불일치", "확인 권장", app,
          `원본 기재 ${[...want].sort()} ↔ 접수일·종료일로 계산 ${[...got].sort()}`);
      }
    }
  }

  /* 학생별 학기 정렬 → 신규 / 계속 / 재유학 */
  const byStudent = new Map();
  for (const e of enrollments) {
    if (!byStudent.has(e.studentId)) byStudent.set(e.studentId, []);
    byStudent.get(e.studentId).push(e);
  }
  for (const lst of byStudent.values()) {
    lst.sort((a, b) => semIndex(a.year, a.term) - semIndex(b.year, b.term));
    let prev = null;
    for (const e of lst) {
      const idx = semIndex(e.year, e.term);
      e.kind = prev === null ? "신규" : (idx === prev + 1 ? "계속" : "재유학");
      prev = idx;
    }
  }
  enrollments.sort((a, b) =>
    semIndex(a.year, a.term) - semIndex(b.year, b.term) ||
    (a.region || "").localeCompare(b.region || "") ||
    (a.school || "").localeCompare(b.school || "") ||
    a.name.localeCompare(b.name));

  /* 현재 학년 대조 */
  const curGrade = new Map();
  for (const e of enrollments) {
    if (semIndex(e.year, e.term) === CURRENT_INDEX) curGrade.set(e.studentId, e.grade);
  }
  for (const app of apps) {
    if (app.decision !== "배정") continue;
    const listed = normalizeGrade(txt(app.raw.현재학년));
    const got = curGrade.get(app.studentId);
    if (listed && got && listed !== got) {
      issues.push({
        유형: "현재 학년 불일치", 심각도: "참고", "집계 영향": "없음",
        원본행: app.row, 신청ID: app.appId, 학생ID: app.studentId,
        성명: txt(app.raw.성명),
        내용: `원본 '현재 학년' ${listed} ↔ 전입 학년 기준 계산 ${got}`,
      });
    }
  }

  /* 같은 학기에 두 번 잡히는 경우 */
  const seen = new Map();
  for (const e of enrollments) {
    const k = `${e.studentId}|${e.year}|${e.term}`;
    if (seen.has(k)) {
      const o = seen.get(k);
      issues.push({
        유형: "같은 학기 중복 재학", 심각도: "조치 필요", "집계 영향": "있음",
        원본행: null, 신청ID: `${o.appId}, ${e.appId}`, 학생ID: e.studentId, 성명: e.name,
        내용: `${semLabel(e.year, e.term)}에 ${o.region} ${o.school} 과 ${e.region} ${e.school} 두 곳으로 잡힘 — 이전 신청 건의 종료일 기재 필요`,
      });
    } else seen.set(k, e);
  }

  /* 한 사람으로 묶었으나 원 소속교가 다른 경우 */
  for (const sid of order) {
    const st = students.get(sid);
    const schools = [...new Set(st.apps.map((a) => txt(a.raw.원소속교)).filter(Boolean))];
    if (schools.length > 1) {
      issues.push({
        유형: "동일인 여부 확인", 심각도: "참고", "집계 영향": "없음",
        원본행: st.apps.map((a) => a.row).join(", "),
        신청ID: st.apps.map((a) => a.appId).join(", "),
        학생ID: sid, 성명: st.name,
        내용: `이름과 보호자 연락처가 같아 한 사람으로 묶었으나 원 소속교가 다름 (${schools.sort().join(" / ")}) — 이사 후 재신청인지 동명이인인지 확인 필요`,
      });
    }
  }

  /* 동명이인 */
  const nameMap = new Map();
  for (const sid of order) {
    const nm = students.get(sid).name;
    if (!nameMap.has(nm)) nameMap.set(nm, []);
    nameMap.get(nm).push(sid);
  }
  for (const [nm, sids] of [...nameMap].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (sids.length > 1) {
      issues.push({
        유형: "동명이인", 심각도: "참고", "집계 영향": "없음", 원본행: null, 신청ID: null,
        학생ID: sids.slice().sort().join(", "), 성명: nm,
        내용: `같은 이름이 ${sids.length}명 — 보호자 연락처로 구분됨`,
      });
    }
  }

  const rank = { "조치 필요": 0, "확인 권장": 1, "참고": 2 };
  issues.sort((a, b) =>
    rank[a.심각도] - rank[b.심각도] ||
    a.유형.localeCompare(b.유형) ||
    String(a.원본행 || "").localeCompare(String(b.원본행 || "")));

  /* 학생별 단계 요약 */
  const profiles = new Map();
  for (const sid of order) {
    const st = students.get(sid);
    st.apps.sort((a, b) =>
      semIndex(a.intakeYear || 0, a.intakeTerm || 1) - semIndex(b.intakeYear || 0, b.intakeTerm || 1) ||
      a.row - b.row);
    const latest = st.apps[st.apps.length - 1];
    const lst = byStudent.get(sid) || [];
    const first = lst[0] || null, last = lst[lst.length - 1] || null;
    const ended = last && last.status === "종료" ? last.endDate : null;
    const lab = latest.intakeYear ? semLabel(latest.intakeYear, latest.intakeTerm) : null;
    profiles.set(sid, {
      접수: lab,
      "모집 차수": latest.intakeRound ? `${latest.intakeRound}차` : null,
      가배정: txt(latest.raw.배정희망서) === "선정" ? lab : null,
      참가신청서: txt(latest.raw.참가신청서) === "제출" ? lab : null,
      최종배정: latest.decision === "배정" ? lab : null,
      "유학 시작": first ? first.startDate : null,
      "유학 종료": ended,
      "마지막 학기 마지막날": last ? last.termEnd : null,
      "최근 신청 결과": latest.decision,
      "최근 결과 사유": latest.rejectReason || latest.decisionBasis,
      "미선정 단계": latest.rejectStage,
      "미선정 사유": latest.rejectClass,
      "최근 유학지역": last ? last.region : null,
      "최근 유학학교": last ? last.school : null,
      "최근 거주유형": last ? last.residence : null,
      "최근 거주지": last ? last.place : null,
      "현재 학년": last ? last.grade : null,
      "유학 학년도": [...new Set(lst.map((e) => e.year))].sort().join(", ") || null,
      "단계 기록 여부": latest.intakeYear &&
        semIndex(latest.intakeYear, latest.intakeTerm) >= semIndex(...STAGE_RECORDED_FROM)
        ? "기록" : "미기록",
    });
  }

  const semesters = [...new Set(enrollments.map((e) => semIndex(e.year, e.term)))]
    .sort((a, b) => a - b).map(semFromIndex);

  return {
    sheetName,
    students: order.map((sid) => students.get(sid)),
    applications: apps,
    enrollments,
    issues,
    byStudent,
    profiles,
    semesters,
  };
}

/* 학생의 현재 단계. 워크북의 '현재 단계' 수식과 같은 순서로 본다. */
function studentStage(prof, baseDate) {
  if (prof["유학 종료"]) {
    return cmp(prof["유학 종료"], prof["마지막 학기 마지막날"]) >= 0 ? "유학종료" : "중도복귀";
  }
  if (prof["유학 시작"] && cmp(prof["유학 시작"], baseDate) <= 0) return "유학중";
  if (prof["최종배정"]) return "최종배정";
  if (prof["참가신청서"]) return "참가신청서 제출";
  if (prof["가배정"]) return "가배정";
  return "미선정·미전학";
}
