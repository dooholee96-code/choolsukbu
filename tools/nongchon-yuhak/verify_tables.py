"""화면에서 만든 참고자료 표가 원데이터와 맞는지 확인한다.

  python verify_tables.py <현황판.html> <원본.xlsx>

미리 담아 둔 표(프리셋)를 하나씩 눌러 보고, 화면에 그려진 표를 그대로 읽어
파이썬으로 따로 센 값과 칸마다 맞춘다. 표를 못 그리거나 합계가 어긋나면 잡는다.
"""

from __future__ import annotations

import asyncio
import sys
from collections import defaultdict
from pathlib import Path

import transform as T

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# 화면에 그려진 표를 읽어 온다. 소계·합계 줄까지 그대로 가져온다.
READ = """() => {
  const t = document.querySelector('#pvtable table');
  if (!t) return null;
  const head = [...t.tHead.rows[0].cells].map((c) => c.textContent.trim());
  const rows = [...t.tBodies[0].rows].map((r) => ({
    cls: r.className,
    cells: [...r.cells].map((c) => ({
      text: c.textContent.trim(), span: c.rowSpan, tag: c.tagName,
    })),
  }));
  const foot = [...t.tFoot.rows[0].cells].map((c) => c.textContent.trim());
  return { head, rows, foot, title: document.getElementById('pvtitle').textContent };
}"""

PRESET_NAMES = """() => [...document.querySelectorAll('#pvpresets button.preset')]
  .map((b) => b.textContent.trim())"""


def num(s):
    s = s.replace(",", "").strip()
    return int(s) if s else 0


def python_tables(src):
    """파이썬 쪽에서 프리셋과 같은 규칙으로 센 값."""
    d = T.build(src)
    cut = T.sem_index(T.CURRENT_YEAR, T.CURRENT_TERM)

    def enr(row, col, keep=lambda e: True):
        g = defaultdict(set)
        for e in d["enrollments"]:
            if T.sem_index(e.year, e.term) > cut or not keep(e):
                continue
            g[(row(e) or "(빈칸)", col(e) or "(빈칸)")].add(e.student_id)
        return g

    def app(row, col, keep=lambda a: True):
        g = defaultdict(set)
        for a in d["applications"]:
            if not a.intake_year:
                continue
            if T.sem_index(a.intake_year, a.intake_term) > cut or not keep(a):
                continue
            g[(row(a) or "(빈칸)", col(a) or "(빈칸)")].add(a.app_id)
        return g

    year = lambda e: str(e.year)                                     # noqa: E731
    sem = lambda e: T.sem_label(e.year, e.term)                      # noqa: E731
    ayear = lambda a: str(a.intake_year)                             # noqa: E731
    asem = lambda a: T.sem_label(a.intake_year, a.intake_term)       # noqa: E731
    rgn = lambda a: (T.s(a.raw["유학지역"]) or "").strip() or None   # noqa: E731

    return {
        "시군별 연도별": enr(lambda e: e.region, year),
        "시군별 학교별 연도별": enr(lambda e: f"{e.region}|{e.school}", year),
        "학교별 연도별": enr(lambda e: e.school, year),
        "시군별 학기별": enr(lambda e: e.region, sem),
        "학교별 학기별": enr(lambda e: e.school, sem),
        "신규 유학생 시군별 연도별": enr(lambda e: e.region, year, lambda e: e.kind == "신규"),
        "거주 유형별 연도별": enr(lambda e: e.residence, year),
        "원적지별 연도별": enr(lambda e: e.home_region, year),
        "학년별 연도별": enr(lambda e: e.grade, year),
        "성별 연도별": enr(lambda e: e.gender, year),
        "희망학교별 접수·배정": app(lambda a: T.s(a.raw["유학학교"]), lambda a: a.decision),
        "시군별 희망학교별 접수·배정":
            app(lambda a: f"{rgn(a)}|{T.s(a.raw['유학학교'])}", lambda a: a.decision),
        "희망학교별 연도별 접수": app(lambda a: T.s(a.raw["유학학교"]), ayear),
        "미선정 사유별 학기별": app(lambda a: a.reject_class, asem),
    }


def check(name, table, want, grouped):
    """화면 표를 한 칸씩 맞춘다."""
    problems = []
    head = table["head"]
    lead = 2 if grouped else 1
    cols = head[lead:-1]

    group = None
    seen = {}
    for r in table["rows"]:
        cells = r["cells"]
        if grouped:
            if cells[0].get("span", 1) > 1 or (len(cells) == len(cols) + 3):
                group = cells[0]["text"]
                cells = cells[1:]
            label = cells[0]["text"]
            key = None if label == "소계" else f"{group}|{label}"
        else:
            label = cells[0]["text"]
            key = label
        nums = [num(c["text"]) for c in cells[1:]]
        if key is None:
            # 소계 줄 — 그 묶음의 사람 수(중복 없이)와 맞아야 한다.
            # 학기 중에 학교를 옮긴 학생이 있으면 세부 줄의 단순 합보다 작다.
            for c, v in zip(cols, nums[:-1]):
                w = len({i for (rk, ck), ids in want.items()
                         if ck == c and rk.split("|")[0] == group for i in ids})
                if v != w:
                    problems.append(f"{name} 소계 [{group} / {c}] 화면 {v} ≠ 원데이터 {w}")
            w = len({i for (rk, ck), ids in want.items()
                     if rk.split("|")[0] == group for i in ids})
            if nums[-1] != w:
                problems.append(f"{name} 소계 [{group} 합계] 화면 {nums[-1]} ≠ 원데이터 {w}")
            continue
        for c, v in zip(cols, nums[:-1]):
            seen[(key, c)] = v
            if v != len(want.get((key, c), ())):
                problems.append(f"{name} [{key} / {c}] 화면 {v} ≠ 원데이터 {len(want.get((key, c), ()))}")

    # 화면에 없는데 원데이터에는 있는 칸
    for (rk, ck), ids in want.items():
        if ck in cols and (rk, ck) not in seen and ids:
            problems.append(f"{name} [{rk} / {ck}] 화면에 없음 (원데이터 {len(ids)})")

    # 합계 줄
    for c, txt in zip(cols, table["foot"][lead:-1]):
        got = num(txt)
        w = len({i for (rk, ck), ids in want.items() if ck == c for i in ids})
        if got != w:
            problems.append(f"{name} 합계 [{c}] 화면 {got} ≠ 원데이터 {w}")
    grand = num(table["foot"][-1])
    w = len({i for ids in want.values() for i in ids})
    if grand != w:
        problems.append(f"{name} 총합계 화면 {grand} ≠ 원데이터 {w}")
    return problems, len(seen) + len(cols) + 1


async def run(page_path, src, want):
    from playwright.async_api import async_playwright

    out, errors = [], []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME)
        ctx = await browser.new_context(timezone_id="Asia/Seoul", locale="ko-KR")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto("file://" + str(Path(page_path).resolve()))
        await page.set_input_files("#fileinput", str(Path(src).resolve()))
        await page.wait_for_selector("#main:not([hidden])", timeout=90_000)
        await page.click('nav.tabs button[data-tab="pivot"]')
        await page.wait_for_selector("#pvpresets button.preset")
        names = await page.evaluate(PRESET_NAMES)
        for i, name in enumerate(names):
            await page.click(f'#pvpresets button.preset[data-i="{i}"]')
            await page.wait_for_function("() => !!document.querySelector('#pvtable table')")
            out.append((name, await page.evaluate(READ)))
        await browser.close()
    return out, errors


def main(page_path, src):
    want = python_tables(src)
    tables, errors = asyncio.run(run(page_path, src, want))

    problems, checked = [], 0
    for name, table in tables:
        if table is None:
            problems.append(f"{name}: 표가 그려지지 않음")
            continue
        if name not in want:
            problems.append(f"{name}: 파이썬 쪽 대조 규칙이 없음")
            continue
        grouped = "소계" in "".join(
            c["text"] for r in table["rows"] for c in r["cells"])
        ps, k = check(name, table, want[name], grouped)
        problems += ps
        checked += k
        print(f"  {name:<24} {len(table['rows']):>3}행 "
              f"{'일치' if not ps else f'{len(ps)}건 어긋남'}")

    print(f"\n표 {len(tables)}개 · 칸 {checked}건 대조")
    for e in errors[:5]:
        print("  ! 화면 오류:", e)
    for p in problems[:15]:
        print("  !", p)
    ok = not problems and not errors
    print("화면 표가 원데이터와 맞습니다" if ok else "확인 필요")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
