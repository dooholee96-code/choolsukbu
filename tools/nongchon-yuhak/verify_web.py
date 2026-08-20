"""브라우저에서 도는 transform.js 가 transform.py 와 같은 답을 내는지 확인한다.

  python verify_web.py <현황판.html> <원본.xlsx>

같은 원본을 두 쪽에 물려 놓고 학생 수·단계·학기별 인원·시군별 인원을 맞춘다.
규칙을 한쪽만 고치면 여기서 갈린다.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import transform as T

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

DUMP = """() => {
  const sc = stageCounts();
  const byYear = {}, byRegion = {}, bySem = {};
  for (const e of D.enrollments) {
    const lab = semLabel(e.year, e.term);
    (bySem[lab] = bySem[lab] || new Set()).add(e.studentId + '|' + lab);
    const rk = e.year + '|' + (e.region || '');
    (byRegion[rk] = byRegion[rk] || new Set()).add(e.studentId);
    (byYear[e.year] = byYear[e.year] || new Set()).add(e.studentId);
  }
  const size = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.size]));
  return {
    students: D.students.length,
    apps: D.applications.length,
    enrollments: D.enrollments.length,
    issues: D.issues.length,
    stages: Object.fromEntries([...sc]),
    years: size(byYear),
    regions: size(byRegion),
    sems: size(bySem),
  };
}"""


def python_side(src: str) -> dict:
    d = T.build(src)
    stages = {s: 0 for s in T.STAGES}
    for st in d["students"]:
        p = d["profiles"][st.student_id]
        if p["유학 종료"]:
            s = "유학종료" if p["유학 종료"] >= p["마지막 학기 마지막날"] else "중도복귀"
        elif p["유학 시작"] and p["유학 시작"] <= T.dt.date.today():
            s = "유학중"
        elif p["최종배정"]:
            s = "최종배정"
        elif p["참가신청서"]:
            s = "참가신청서 제출"
        elif p["가배정"]:
            s = "가배정"
        else:
            s = "미선정·미전학"
        stages[s] += 1

    years, regions, sems = {}, {}, {}
    for e in d["enrollments"]:
        years.setdefault(str(e.year), set()).add(e.student_id)
        regions.setdefault(f"{e.year}|{e.region or ''}", set()).add(e.student_id)
        sems.setdefault(T.sem_label(e.year, e.term), set()).add(e.student_id)
    return {
        "students": len(d["students"]),
        "apps": len(d["applications"]),
        "enrollments": len(d["enrollments"]),
        "issues": len(d["issues"]),
        "stages": stages,
        "years": {k: len(v) for k, v in years.items()},
        "regions": {k: len(v) for k, v in regions.items()},
        "sems": {k: len(v) for k, v in sems.items()},
    }


async def js_side(page_path: str, src: str) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME)
        page = await browser.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto("file://" + str(Path(page_path).resolve()))
        await page.set_input_files("#fileinput", str(Path(src).resolve()))
        await page.wait_for_selector("#main:not([hidden])", timeout=90_000)
        out = await page.evaluate(DUMP)
        await browser.close()
        if errors:
            raise RuntimeError("화면에서 오류: " + "; ".join(errors[:3]))
        return out


def diff(a: dict, b: dict, path: str = "") -> list[str]:
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            out += diff(a.get(k), b.get(k), f"{path}.{k}" if path else str(k))
    elif a != b:
        out.append(f"{path}: 파이썬 {a} ≠ 화면 {b}")
    return out


def main(page_path: str, src: str) -> int:
    py = python_side(src)
    js = asyncio.run(js_side(page_path, src))
    problems = diff(py, js)
    print(f"학생 {py['students']} / 신청 {py['apps']} / 유학이력 {py['enrollments']} / 확인 항목 {py['issues']}")
    print("단계:", json.dumps(py["stages"], ensure_ascii=False))
    print(f"대조 항목 {len(py['years']) + len(py['regions']) + len(py['sems']) + len(py['stages']) + 4}건")
    for p in problems[:20]:
        print("  !", p)
    print("파이썬과 화면이 같은 답을 냅니다" if not problems else f"{len(problems)}건 어긋남")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
