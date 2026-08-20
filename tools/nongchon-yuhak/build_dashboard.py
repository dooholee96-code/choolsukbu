"""정규화한 데이터를 조회용 HTML 한 장으로 만든다.

  python build_dashboard.py <원본.xlsx> <출력.html>

파일 하나로 끝나도록 데이터·스타일·스크립트를 모두 안에 넣는다. 바깥으로
요청을 보내지 않으므로 인터넷 없이 열린다. 개인정보가 들어 있으니 파일을
그대로 공유하지 않는다.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import sys
from collections import defaultdict

import transform as T

STAGE_COLOR = {
    "접수": "stage-1",
    "가배정": "stage-2",
    "참가신청서 제출": "stage-3",
    "최종배정": "stage-4",
    "유학중": "stage-live",
    "유학종료": "stage-done",
    "중도복귀": "stage-drop",
    "미선정·미전학": "stage-out",
}


def student_stage(prof, base: dt.date) -> str:
    """워크북의 '현재 단계' 수식과 같은 순서로 판단한다."""
    if prof["유학 종료"]:
        return "유학종료" if prof["유학 종료"] >= prof["마지막 학기 마지막날"] else "중도복귀"
    if prof["유학 시작"] and prof["유학 시작"] <= base:
        return "유학중"
    if prof["최종배정"]:
        return "최종배정"
    if prof["참가신청서"]:
        return "참가신청서 제출"
    if prof["가배정"]:
        return "가배정"
    return "미선정·미전학"


def iso(d):
    return d.isoformat() if isinstance(d, (dt.date, dt.datetime)) else None


def payload(data, base: dt.date):
    prof = data["profiles"]
    by_student = data["by_student"]
    sems = [T.sem_label(y, t) for y, t in data["semesters"]]
    recorded_from = T.sem_index(*T.STAGE_RECORDED_FROM)

    apps_by_student = defaultdict(list)
    for a in data["applications"]:
        apps_by_student[a.student_id].append(a)

    stage_count = defaultdict(int)
    students = []
    for st in data["students"]:
        p = prof[st.student_id]
        stage = student_stage(p, base)
        stage_count[stage] += 1
        lst = by_student.get(st.student_id, [])
        expire = None
        if lst:
            expire = T.sem_end(*T.sem_from_index(T.sem_index(lst[0].year, lst[0].term) + 5))
        students.append({
            "id": st.student_id,
            "name": st.name,
            "gender": st.gender,
            "stage": stage,
            "grade": p["현재 학년"],
            "region": p["최근 유학지역"],
            "school": p["최근 유학학교"],
            "residence": p["최근 거주유형"],
            "place": p["최근 거주지"],
            "homeRegion": st.home_region,
            "homeSchool": st.home_school,
            "guardian": st.guardian,
            "phone": st.guardian_phone,
            "start": iso(p["유학 시작"]),
            "end": iso(p["유학 종료"]),
            "terms": len(lst),
            "expire": iso(expire),
            "left": max(0, 6 - len(lst)) if lst else None,
            "years": p["유학 학년도"],
            "reject": p["미선정 사유"],
            "rejectStage": p["미선정 단계"],
            "history": [
                {
                    "sem": T.sem_label(e.year, e.term),
                    "region": e.region,
                    "school": e.school,
                    "grade": e.grade,
                    "kind": e.kind,
                    "status": e.status,
                    "stay": e.end_date is None or e.end_date >= e.term_end,
                    "end": iso(e.end_date),
                    "reason": e.end_reason,
                }
                for e in lst
            ],
            "apps": [
                {
                    "sem": T.sem_label(a.intake_year, a.intake_term) if a.intake_year else None,
                    "round": a.intake_round,
                    "stage": a.stage,
                    "decision": a.decision,
                    "reason": a.reject_reason or a.decision_basis,
                    "region": T.s(a.raw["유학지역"]),
                    "school": T.s(a.raw["유학학교"]),
                }
                for a in apps_by_student[st.student_id]
            ],
        })

    sem_rows = []
    for y, t in data["semesters"]:
        lab = T.sem_label(y, t)
        sel = [e for e in data["enrollments"] if e.year == y and e.term == t]
        stay = [e for e in sel if e.end_date is None or e.end_date >= e.term_end]
        apps = [a for a in data["applications"]
                if a.intake_year == y and a.intake_term == t]
        sem_rows.append({
            "sem": lab,
            "official": len(sel),
            "stay": len(stay),
            "out": len(sel) - len(stay),
            "new": sum(1 for e in sel if e.kind == "신규"),
            "male": sum(1 for e in sel if e.gender == "남"),
            "female": sum(1 for e in sel if e.gender == "여"),
            "family": sum(1 for e in sel if e.residence == "가족체류형"),
            "center": sum(1 for e in sel if e.residence == "유학센터형"),
            "home": sum(1 for e in sel if e.residence == "홈스테이형"),
            "apply": len(apps),
            "pre": sum(1 for a in apps if T.s(a.raw["배정희망서"]) == "선정"),
            "submit": sum(1 for a in apps if T.s(a.raw["참가신청서"]) == "제출"),
            "final": sum(1 for a in apps if a.decision == "배정"),
            "reject": sum(1 for a in apps if a.decision == "미배정"),
            "check": sum(1 for a in apps if a.decision == "확인필요"),
            "recorded": T.sem_index(y, t) >= recorded_from,
        })

    regions, schools = defaultdict(lambda: defaultdict(int)), defaultdict(lambda: defaultdict(int))
    school_region = {}
    for e in data["enrollments"]:
        lab = T.sem_label(e.year, e.term)
        if e.region:
            regions[lab][e.region] += 1
        if e.school:
            schools[lab][e.school] += 1
            school_region[e.school] = e.region

    reasons = defaultdict(lambda: defaultdict(int))
    for a in data["applications"]:
        if a.reject_class and a.intake_year:
            reasons[T.sem_label(a.intake_year, a.intake_term)][a.reject_class] += 1

    issues = defaultdict(lambda: defaultdict(int))
    for i in data["issues"]:
        issues[i["심각도"]][i["유형"]] += 1

    return {
        "meta": {
            "baseSem": T.sem_label(T.CURRENT_YEAR, T.CURRENT_TERM),
            "baseDate": base.isoformat(),
            "built": dt.date.today().isoformat(),
            "recordedFrom": T.sem_label(*T.STAGE_RECORDED_FROM),
            "counts": {
                "students": len(data["students"]),
                "apps": len(data["applications"]),
                "enrollments": len(data["enrollments"]),
            },
        },
        "stages": [{"name": s, "count": stage_count.get(s, 0)} for s in T.STAGES],
        "semesters": sem_rows,
        "regions": {k: dict(v) for k, v in regions.items()},
        "schools": {k: dict(v) for k, v in schools.items()},
        "schoolRegion": school_region,
        "reasons": {k: dict(v) for k, v in reasons.items()},
        "issues": {k: dict(v) for k, v in issues.items()},
        "students": students,
        "official": {
            "2022": 27, "2023": 85, "2024": 165, "2025": 269, "2026": 333,
        },
    }


STYLE = """
:root {
  color-scheme: light;
  --page: #f9f9f7;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --axis: #c3c2b7;
  --ring: rgba(11,11,11,0.10);
  --stage-1: #86b6ef;
  --stage-2: #5598e7;
  --stage-3: #2a78d6;
  --stage-4: #184f95;
  --stage-live: #008300;
  --stage-done: #52514e;
  --stage-drop: #d03b3b;
  --stage-out: #898781;
  --series-1: #2a78d6;
  --series-2: #eb6834;
  --good: #0ca30c;
  --warn: #fab219;
  --crit: #d03b3b;
  --wash: rgba(42,120,214,0.08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --axis: #383835;
    --ring: rgba(255,255,255,0.10);
    --stage-1: #b7d3f6;
    --stage-2: #6da7ec;
    --stage-3: #3987e5;
    --stage-4: #184f95;
    --stage-done: #c3c2b7;
    --series-1: #3987e5;
    --series-2: #d95926;
    --wash: rgba(57,135,229,0.14);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "맑은 고딕", sans-serif;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 96px; }
header.top { margin-bottom: 28px; }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
.sub { color: var(--ink-2); font-size: 13px; margin: 0; }
.card {
  background: var(--surface);
  border: 1px solid var(--ring);
  border-radius: 12px;
  padding: 20px 22px;
  margin-bottom: 20px;
}
h2 { font-size: 17px; margin: 0 0 4px; }
.note { color: var(--muted); font-size: 12.5px; margin: 0 0 16px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 20px; }
.tile { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 16px 18px; }
.tile .label { font-size: 12.5px; color: var(--ink-2); }
.tile .value { font-size: 34px; font-weight: 650; letter-spacing: -0.02em; margin-top: 2px; }
.tile .foot { font-size: 12px; color: var(--muted); margin-top: 2px; }
.filters { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
label.f { font-size: 13px; color: var(--ink-2); display: flex; gap: 7px; align-items: center; }
select, input[type=search] {
  font: inherit; font-size: 14px; padding: 7px 10px;
  border: 1px solid var(--axis); border-radius: 8px;
  background: var(--surface); color: var(--ink);
}
input[type=search] { min-width: 240px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--grid); }
th { color: var(--ink-2); font-weight: 600; font-size: 12.5px; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
tbody tr.pick:hover { background: var(--wash); cursor: pointer; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 2px 9px; border-radius: 999px;
  border: 1px solid var(--ring); white-space: nowrap;
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); margin-bottom: 10px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
svg { display: block; width: 100%; overflow: visible; }
.bar { rx: 4; }
.tip {
  position: fixed; pointer-events: none; opacity: 0; transition: opacity .1s;
  background: var(--ink); color: var(--page); font-size: 12.5px; line-height: 1.45;
  padding: 7px 10px; border-radius: 8px; max-width: 260px; z-index: 20;
}
.axis-label { font-size: 12px; fill: var(--muted); }
.val-label { font-size: 12px; fill: var(--ink-2); font-variant-numeric: tabular-nums; }
.detail { margin-top: 16px; border-top: 1px solid var(--grid); padding-top: 16px; }
.tl { list-style: none; margin: 10px 0 0; padding: 0 0 0 18px; border-left: 2px solid var(--grid); }
.tl li { position: relative; padding: 0 0 12px 16px; font-size: 13.5px; }
.tl li::before {
  content: ""; position: absolute; left: -25px; top: 7px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--series-1); box-shadow: 0 0 0 2px var(--surface);
}
.tl li.out::before { background: var(--stage-out); }
.tl .when { color: var(--ink-2); font-weight: 600; }
.tl .what { color: var(--ink-2); }
.empty { color: var(--muted); font-size: 13.5px; padding: 14px 0; }
.k { color: var(--muted); font-size: 12px; }
.warnrow td { color: var(--crit); }
@media (max-width: 720px) {
  .wrap { padding: 20px 14px 72px; }
  .tile .value { font-size: 28px; }
}
"""


def build(data, base: dt.date, src_name: str) -> str:
    p = payload(data, base)
    body = SCRIPT.replace("__DATA__", json.dumps(p, ensure_ascii=False))
    return (
        "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>전북 농어촌유학생 현황</title>\n"
        f"<style>{STYLE}</style>\n</head>\n<body>\n"
        f"<div class=\"wrap\" id=\"app\"></div>\n"
        f"<div class=\"tip\" id=\"tip\"></div>\n"
        f"<script>const SRC={json.dumps(src_name, ensure_ascii=False)};</script>\n"
        f"<script>{body}</script>\n</body>\n</html>\n"
    )


SCRIPT = r"""
const D = __DATA__;
const $ = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
const n = (v) => (v == null ? "" : v.toLocaleString("ko-KR"));
const app = document.getElementById("app");
const tip = document.getElementById("tip");

/* SVG 는 조각을 따로 만들면 HTML 네임스페이스로 들어가 그려지지 않는다.
   통째로 문자열을 만들어 넣고, data-tip 이 붙은 것에만 나중에 손을 건다. */
function putSvg(host, markup) {
  host.innerHTML = markup;
  host.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => showTip(e, el.getAttribute("data-tip")));
    el.addEventListener("mouseleave", hideTip);
  });
}

function showTip(e, html) {
  tip.innerHTML = html;
  tip.style.opacity = 1;
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.opacity = 0; };

const STAGE_VAR = {
  "접수": "--stage-1", "가배정": "--stage-2", "참가신청서 제출": "--stage-3",
  "최종배정": "--stage-4", "유학중": "--stage-live", "유학종료": "--stage-done",
  "중도복귀": "--stage-drop", "미선정·미전학": "--stage-out",
};
const stageChip = (s) =>
  `<span class="chip"><i class="dot" style="background:var(${STAGE_VAR[s] || "--muted"})"></i>${esc(s)}</span>`;

let semester = D.semesters.some((x) => x.sem === D.meta.baseSem)
  ? D.meta.baseSem : D.semesters[D.semesters.length - 1].sem;
const semRow = (s) => D.semesters.find((x) => x.sem === s);

/* ── 머리말 ─────────────────────────────────────────── */
app.appendChild($(`<header class="top">
  <h1>전북 농어촌유학생 현황</h1>
  <p class="sub">기준 학기 ${esc(D.meta.baseSem)} · 기준일 ${esc(D.meta.baseDate)} ·
    학생 ${n(D.meta.counts.students)}명 / 신청 ${n(D.meta.counts.apps)}건 / 유학이력 ${n(D.meta.counts.enrollments)}행 ·
    원본 ${esc(SRC)}</p>
</header>`));

/* ── 요약 타일 ──────────────────────────────────────── */
const live = D.stages.find((s) => s.name === "유학중").count;
const waiting = D.stages.find((s) => s.name === "최종배정").count;
const inflight = D.stages.filter((s) => ["가배정", "참가신청서 제출"].includes(s.name))
  .reduce((a, b) => a + b.count, 0);
const expiring = D.students.filter((s) => s.left != null && s.left <= 2 && s.end == null).length;
const cur = semRow(D.meta.baseSem);

const tiles = $(`<div class="tiles"></div>`);
[
  ["현재 유학중", live, "전학을 마치고 재학 중인 학생"],
  ["최종배정 (전학 전)", waiting, "배정을 받았으나 시작일이 아직"],
  ["심사 진행 중", inflight, "가배정 · 참가신청서 단계"],
  [`${D.meta.baseSem} 유학생`, cur ? cur.official : 0, "발표 자료와 같은 기준"],
  ["체제비 만료 임박", expiring, "도청 지원 잔여 2학기 이하"],
].forEach(([label, value, foot]) => {
  tiles.appendChild($(`<div class="tile"><div class="label">${esc(label)}</div>
    <div class="value">${n(value)}</div><div class="foot">${esc(foot)}</div></div>`));
});
app.appendChild(tiles);

/* ── 학생 현재 단계 ─────────────────────────────────── */
{
  const card = $(`<section class="card"><h2>학생 현재 단계</h2>
    <p class="note">학생 한 명이 한 번만 세어집니다. 접수부터 최종배정까지는 진행 중인 단계이고,
      유학종료·중도복귀·미선정은 끝난 상태입니다. 막대를 짚으면 인원이 나옵니다.</p>
    <div id="stagechart"></div></section>`);
  app.appendChild(card);
  const rows = D.stages;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const H = 34, W = 720, LEFT = 132, RIGHT = 60, PLOT = W - LEFT - RIGHT;
  const parts = rows.map((r, i) => {
    const y = i * H + 6, h = 20;
    const w = Math.max((r.count / max) * PLOT, r.count ? 3 : 0);
    const pct = (r.count / D.meta.counts.students * 100).toFixed(1);
    return `<text class="axis-label" x="${LEFT - 10}" y="${y + 14}" text-anchor="end">${esc(r.name)}</text>
      <rect class="bar" x="${LEFT}" y="${y}" width="${w}" height="${h}" fill="var(${STAGE_VAR[r.name]})"
        data-tip="&lt;b&gt;${esc(r.name)}&lt;/b&gt;&lt;br&gt;${n(r.count)}명 · 전체의 ${pct}%"></rect>
      <text class="val-label" x="${LEFT + w + 8}" y="${y + 14}">${n(r.count)}</text>`;
  });
  putSvg(card.querySelector("#stagechart"),
    `<svg viewBox="0 0 ${W} ${rows.length * H}" style="height:${rows.length * H}px" role="img"
       aria-label="학생 현재 단계별 인원">${parts.join("")}</svg>`);
}

/* ── 학기별 추이 ────────────────────────────────────── */
{
  const card = $(`<section class="card"><h2>학기별 유학생 수</h2>
    <p class="note">'유학생 수'는 그 학기에 한 번이라도 유학한 인원으로, 도교육청 발표 자료와 같은 기준입니다.
      '학기말 재적'은 그 학기 끝까지 남은 인원이며, 둘의 차이가 학기 중에 그만둔 인원입니다.</p>
    <div class="legend">
      <span><i style="background:var(--series-1)"></i>유학생 수(공식 기준)</span>
      <span><i style="background:var(--series-2)"></i>학기말 재적</span>
    </div><div id="trend"></div></section>`);
  app.appendChild(card);
  const rows = D.semesters;
  const W = 720, H = 280, L = 44, R = 16, TP = 14, B = 40;
  const max = Math.ceil(Math.max(...rows.map((r) => r.official)) / 50) * 50 || 50;
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
    g += `<text class="axis-label" x="${x(i)}" y="${H - 14}" text-anchor="middle">${esc(r.sem.replace("학기", ""))}</text>`;
    g += `<circle cx="${x(i)}" cy="${y(r.official)}" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"></circle>`;
    g += `<circle cx="${x(i)}" cy="${y(r.stay)}" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"></circle>`;
    g += `<rect x="${x(i) - 22}" y="${TP}" width="44" height="${H - TP - B}" fill="transparent"
      data-tip="&lt;b&gt;${esc(r.sem)}&lt;/b&gt;&lt;br&gt;유학생 수 ${n(r.official)}명&lt;br&gt;학기말 재적 ${n(r.stay)}명&lt;br&gt;학기 중 종료 ${n(r.out)}명&lt;br&gt;신규 ${n(r.new)}명"></rect>`;
  });
  const peak = rows.reduce((a, b, i) => (b.official > rows[a].official ? i : a), 0);
  g += `<text class="val-label" x="${x(peak)}" y="${y(rows[peak].official) - 11}"
    text-anchor="middle">${n(rows[peak].official)}명</text>`;
  const lastOpen = rows.length - 1;
  if (rows[lastOpen].sem !== D.meta.baseSem) {
    g += `<line x1="${x(lastOpen)}" x2="${x(lastOpen)}" y1="${TP}" y2="${H - B}"
      stroke="var(--axis)" stroke-width="1" stroke-dasharray="3 3"></line>
      <text class="axis-label" x="${x(lastOpen) - 6}" y="${TP + 12}" text-anchor="end">모집 중</text>`;
  }
  putSvg(card.querySelector("#trend"),
    `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="학기별 유학생 수 추이">${g}</svg>`);
}

/* ── 학기 선택 ──────────────────────────────────────── */
const filters = $(`<div class="filters"><label class="f">학기
  <select id="sem">${D.semesters.map((s) => `<option value="${esc(s.sem)}"${s.sem === semester ? " selected" : ""}>${esc(s.sem)}</option>`).reverse().join("")}</select>
</label><span class="k" id="semnote"></span></div>`);
app.appendChild(filters);

/* ── 모집 단계 ──────────────────────────────────────── */
const funnelCard = $(`<section class="card"><h2>모집 단계</h2>
  <p class="note">접수한 학생이 단계마다 얼마나 남는지. 학교 배정희망서와 학부모 참가신청서 칸은
    ${esc(D.meta.recordedFrom)} 모집부터 기록되기 시작해, 그 전 학기는 가운데 두 단계가 비어 있습니다.</p>
  <div id="funnel"></div></section>`);
app.appendChild(funnelCard);

function drawFunnel() {
  const r = semRow(semester);
  const host = document.getElementById("funnel");
  host.innerHTML = "";
  let steps = [
    ["접수", r.apply, "--stage-1"],
    ["가배정", r.pre, "--stage-2"],
    ["참가신청서 제출", r.submit, "--stage-3"],
    ["최종배정", r.final, "--stage-4"],
  ];
  if (!r.recorded) steps = [steps[0], steps[3]];
  const max = Math.max(...steps.map((s) => s[1]), 1);
  const H = 40, W = 720, LEFT = 132, RIGHT = 128;
  const g = steps.map((s, i) => {
    const [name, v, color] = s;
    const y = i * H + 8, h = 24, w = Math.max((v / max) * (W - LEFT - RIGHT), v ? 3 : 0);
    const pct = steps[0][1] ? (v / steps[0][1] * 100).toFixed(1) : "0.0";
    return `<text class="axis-label" x="${LEFT - 10}" y="${y + 17}" text-anchor="end">${esc(name)}</text>
      <rect class="bar" x="${LEFT}" y="${y}" width="${w}" height="${h}" fill="var(${color})"
        data-tip="&lt;b&gt;${esc(name)}&lt;/b&gt;&lt;br&gt;${n(v)}명 · 접수 대비 ${pct}%"></rect>
      <text class="val-label" x="${LEFT + w + 8}" y="${y + 17}">${n(v)}명 · ${pct}%</text>`;
  }).join("");
  const chart = document.createElement("div");
  putSvg(chart, `<svg viewBox="0 0 ${W} ${steps.length * H}" style="height:${steps.length * H}px"
    role="img" aria-label="${esc(semester)} 모집 단계별 인원">${g}</svg>`);
  host.appendChild(chart);

  const rs = D.reasons[semester] || {};
  const keys = Object.keys(rs).sort((a, b) => rs[b] - rs[a]);
  if (keys.length) {
    host.appendChild($(`<div class="scroll"><table><thead><tr><th>미선정 사유</th><th class="num">인원</th></tr></thead>
      <tbody>${keys.map((k) => `<tr><td>${esc(k)}</td><td class="num">${n(rs[k])}</td></tr>`).join("")}</tbody></table></div>`));
  }
  document.getElementById("semnote").textContent =
    r.recorded ? "" : `${semester}는 단계 기록 전이라 접수와 결과만 남아 있습니다.`;
}

/* ── 시군별 현황 ────────────────────────────────────── */
const regionCard = $(`<section class="card"><h2>시군별 유학생 수</h2>
  <p class="note">선택한 학기에 그 시군에서 유학한 인원입니다.</p>
  <div id="regions"></div></section>`);
app.appendChild(regionCard);

function drawRegions() {
  const m = D.regions[semester] || {};
  const rows = Object.keys(m).sort((a, b) => m[b] - m[a]);
  const host = document.getElementById("regions");
  host.innerHTML = "";
  if (!rows.length) { host.appendChild($(`<p class="empty">해당 학기에 유학생이 없습니다.</p>`)); return; }
  const max = Math.max(...rows.map((k) => m[k]));
  const H = 30, W = 720, LEFT = 74, RIGHT = 56;
  const g = rows.map((k, i) => {
    const y = i * H + 5, h = 20, w = Math.max((m[k] / max) * (W - LEFT - RIGHT), 3);
    return `<text class="axis-label" x="${LEFT - 10}" y="${y + 14}" text-anchor="end">${esc(k)}</text>
      <rect class="bar" x="${LEFT}" y="${y}" width="${w}" height="${h}" fill="var(--series-1)"
        data-tip="&lt;b&gt;${esc(k)}&lt;/b&gt;&lt;br&gt;${n(m[k])}명"></rect>
      <text class="val-label" x="${LEFT + w + 8}" y="${y + 14}">${n(m[k])}</text>`;
  }).join("");
  putSvg(host, `<svg viewBox="0 0 ${W} ${rows.length * H}" style="height:${rows.length * H}px"
    role="img" aria-label="${esc(semester)} 시군별 유학생 수">${g}</svg>`);
}

/* ── 학교별 현황 ────────────────────────────────────── */
const schoolCard = $(`<section class="card"><h2>학교별 유학생 수</h2>
  <p class="note">선택한 학기 기준. 인원이 많은 학교부터.</p>
  <div class="scroll" id="schools"></div></section>`);
app.appendChild(schoolCard);

function drawSchools() {
  const m = D.schools[semester] || {};
  const rows = Object.keys(m).sort((a, b) => m[b] - m[a]);
  const host = document.getElementById("schools");
  host.innerHTML = rows.length
    ? `<table><thead><tr><th>지역</th><th>학교</th><th class="num">유학생</th></tr></thead><tbody>${
        rows.map((k) => `<tr><td>${esc(D.schoolRegion[k])}</td><td>${esc(k)}</td><td class="num">${n(m[k])}</td></tr>`).join("")
      }</tbody></table>`
    : `<p class="empty">해당 학기에 유학생이 없습니다.</p>`;
}

/* ── 학생 검색 ──────────────────────────────────────── */
{
  const card = $(`<section class="card"><h2>학생 찾기</h2>
    <p class="note">이름·학교·지역·보호자 이름으로 찾습니다. 줄을 누르면 그 학생의 신청부터 지금까지가 아래에 펼쳐집니다.</p>
    <div class="filters">
      <input type="search" id="q" placeholder="이름, 학교, 지역, 보호자" autocomplete="off">
      <label class="f">단계 <select id="stagef"><option value="">전체</option>${
        D.stages.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} (${s.count})</option>`).join("")
      }</select></label>
      <span class="k" id="hits"></span>
    </div>
    <div class="scroll" id="list"></div>
    <div class="detail" id="detail"><p class="empty">학생을 고르면 이력이 여기에 나옵니다.</p></div>
  </section>`);
  app.appendChild(card);

  const list = card.querySelector("#list");
  const detail = card.querySelector("#detail");
  const hits = card.querySelector("#hits");

  function render() {
    const q = card.querySelector("#q").value.trim().toLowerCase();
    const sf = card.querySelector("#stagef").value;
    let rows = D.students;
    if (sf) rows = rows.filter((s) => s.stage === sf);
    if (q) rows = rows.filter((s) =>
      [s.name, s.school, s.region, s.guardian, s.homeSchool, s.homeRegion]
        .some((v) => v && v.toLowerCase().includes(q)));
    hits.textContent = `${rows.length.toLocaleString("ko-KR")}명`;
    const show = rows.slice(0, 200);
    list.innerHTML = `<table><thead><tr>
      <th>성명</th><th>단계</th><th>학년</th><th>유학 지역</th><th>유학 학교</th>
      <th>거주 유형</th><th class="num">학기</th><th>보호자</th></tr></thead>
      <tbody>${show.map((s) => `<tr class="pick" data-id="${s.id}">
        <td>${esc(s.name)}</td><td>${stageChip(s.stage)}</td><td>${esc(s.grade)}</td>
        <td>${esc(s.region)}</td><td>${esc(s.school)}</td><td>${esc(s.residence)}</td>
        <td class="num">${n(s.terms)}</td><td>${esc(s.guardian)}</td></tr>`).join("")}</tbody></table>
      ${rows.length > show.length ? `<p class="k" style="padding:8px 10px">앞 ${show.length}명만 보입니다. 검색어를 좁혀 주세요.</p>` : ""}`;
    list.querySelectorAll("tr.pick").forEach((tr) =>
      tr.addEventListener("click", () => open(tr.dataset.id)));
  }

  function open(id) {
    const s = D.students.find((x) => x.id === id);
    const items = [];
    s.apps.forEach((a) => items.push({
      sem: a.sem, out: a.decision !== "배정",
      when: `${a.sem || "?"}${a.round ? ` ${a.round}차 모집` : ""}`,
      what: `신청 — ${a.stage}${a.decision === "배정" ? "" : ` (${a.decision})`}` +
            `${a.school ? ` · ${a.region || ""} ${a.school}` : ""}` +
            `${a.decision !== "배정" && a.reason ? `<br><span class="k">${esc(a.reason)}</span>` : ""}`,
    }));
    s.history.forEach((h) => items.push({
      sem: h.sem, out: !h.stay,
      when: h.sem,
      what: `${h.kind} 유학 — ${h.region || ""} ${h.school || ""} ${h.grade || ""}` +
            `${h.status === "종료" ? ` · 종료 ${h.end || ""}${h.reason ? ` (${esc(h.reason)})` : ""}` : ""}` +
            `${h.status === "예정" ? " · 전학 예정" : ""}`,
    }));
    items.sort((a, b) => (a.sem || "").localeCompare(b.sem || ""));
    detail.innerHTML = `
      <h3 style="margin:0 0 2px;font-size:16px">${esc(s.name)} ${stageChip(s.stage)}</h3>
      <p class="k" style="margin:0 0 4px">
        ${esc(s.gender || "")} · 원적 ${esc(s.homeRegion || "")} ${esc(s.homeSchool || "")} ·
        보호자 ${esc(s.guardian || "")} ${esc(s.phone || "")}
        ${s.place ? ` · 거주 ${esc(s.place)}` : ""}
      </p>
      <p class="k" style="margin:0">
        유학 ${esc(s.years || "-")} · 누적 ${n(s.terms)}학기
        ${s.expire ? ` · 도청 지원 만료 ${esc(s.expire)}` : ""}
        ${s.left != null ? ` · 잔여 ${n(s.left)}학기` : ""}
      </p>
      <ul class="tl">${items.map((i) =>
        `<li class="${i.out ? "out" : ""}"><span class="when">${esc(i.when)}</span> <span class="what">${i.what}</span></li>`).join("")}</ul>`;
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  card.querySelector("#q").addEventListener("input", render);
  card.querySelector("#stagef").addEventListener("change", render);
  render();
}

/* ── 체제비 만료 ────────────────────────────────────── */
{
  const rows = D.students
    .filter((s) => s.end == null && s.left != null && s.left <= 2)
    .sort((a, b) => (a.left - b.left) || (a.expire || "").localeCompare(b.expire || ""));
  const card = $(`<section class="card"><h2>체제비 지원 만료 임박</h2>
    <p class="note">전북특별자치도청 지원은 최대 3년(6학기)입니다. 아직 유학 중이면서 잔여 2학기 이하인 학생입니다.</p>
    <div class="scroll">${rows.length ? `<table><thead><tr>
      <th>성명</th><th>단계</th><th>유학 지역</th><th>유학 학교</th>
      <th class="num">누적 학기</th><th class="num">잔여</th><th>만료일</th></tr></thead>
      <tbody>${rows.map((s) => `<tr class="${s.left === 0 ? "warnrow" : ""}">
        <td>${esc(s.name)}</td><td>${stageChip(s.stage)}</td><td>${esc(s.region)}</td>
        <td>${esc(s.school)}</td><td class="num">${n(s.terms)}</td>
        <td class="num">${n(s.left)}</td><td>${esc(s.expire)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">해당하는 학생이 없습니다.</p>`}</div></section>`);
  app.appendChild(card);
}

/* ── 발표 자료 대조 ─────────────────────────────────── */
{
  const byYear = {};
  D.students.forEach((s) => s.history.forEach((h) => {
    const y = h.sem.slice(0, 4);
    if (y === "2026" && !h.sem.endsWith("1학기")) return;
    (byYear[y] = byYear[y] || new Set()).add(s.id);
  }));
  const rows = Object.keys(D.official).sort();
  const card = $(`<section class="card"><h2>발표 자료 대조</h2>
    <p class="note">도교육청 '연도별 시·군 유학생 수'와 맞춰 본 결과입니다. 2026학년도는 1학기 모집 기준입니다.</p>
    <div class="scroll"><table><thead><tr><th>학년도</th><th class="num">발표 자료</th>
      <th class="num">이 데이터</th><th>비고</th></tr></thead><tbody>${
      rows.map((y) => {
        const got = byYear[y] ? byYear[y].size : 0;
        const want = D.official[y];
        const ok = got === want;
        return `<tr><td>${y}학년도${y === "2026" ? " 1학기" : ""}</td>
          <td class="num">${n(want)}</td><td class="num">${n(got)}</td>
          <td>${ok ? "<span style='color:var(--good)'>일치</span>"
                   : "고창 1명 차이 — 학교 오보고분, 실제 " + n(got) + "명"}</td></tr>`;
      }).join("")}</tbody></table></div></section>`);
  app.appendChild(card);
}

/* ── 확인 항목 ──────────────────────────────────────── */
{
  const order = ["조치 필요", "확인 권장", "참고"];
  const parts = order.filter((k) => D.issues[k]).map((k) => {
    const m = D.issues[k];
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    return `<tr><td>${esc(k)}</td><td class="num">${n(total)}</td>
      <td class="k">${Object.keys(m).map((t) => `${esc(t)} ${m[t]}`).join(" · ")}</td></tr>`;
  });
  app.appendChild($(`<section class="card"><h2>확인 항목</h2>
    <p class="note">'참고'는 집계 숫자에 영향이 없는 항목입니다. 자세한 목록은 엑셀 워크북의 데이터검증 시트에 있습니다.</p>
    <div class="scroll"><table><thead><tr><th>구분</th><th class="num">건수</th><th>내용</th></tr></thead>
      <tbody>${parts.join("")}</tbody></table></div></section>`));
}

document.getElementById("sem").addEventListener("change", (e) => {
  semester = e.target.value;
  drawFunnel(); drawRegions(); drawSchools();
});
drawFunnel(); drawRegions(); drawSchools();
"""


def main(src, out):
    data = T.build(src)
    base = dt.date.today()
    html_text = build(data, base, src.split("/")[-1])
    with open(out, "w", encoding="utf-8") as f:
        f.write(html_text)
    print(f"저장: {out}  ({len(html_text) / 1024:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
