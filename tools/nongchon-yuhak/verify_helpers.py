"""입력 도우미를 붙인 명단이 원본과 같은지, 그리고 새 수식이 맞는지 확인한다.

  python verify_helpers.py <원본.xlsx> <도우미붙인.xlsx>

두 가지를 본다.

  ① 원본 칸이 한 칸도 안 바뀌었나 — 매일 쓰는 마스터라 값이 바뀌면 안 된다
  ② 새로 넣은 '배정 판정' 수식이 transform.decide 와 같은 답을 내나
     — 명단 옆에서 보이는 판정과 워크북이 내는 판정이 갈리면 안 된다
"""

from __future__ import annotations

import sys

import openpyxl
from openpyxl.utils import get_column_letter

import formula_eval as F
import transform as T


def main(src_path: str, out_path: str) -> int:
    # 원본에도 수식이 든 열이 있다(현재 학년). 값이 아니라 수식끼리 맞춰야 한다.
    src = T.find_sheet(openpyxl.load_workbook(src_path))
    wb = openpyxl.load_workbook(out_path)
    ws = T.find_sheet(wb)
    problems, cells = [], 0

    # ① 원본 칸이 그대로인가
    for r in range(1, src.max_row + 1):
        for c in range(1, src.max_column + 1):
            cells += 1
            a, b = src.cell(r, c).value, ws.cell(r, c).value
            if a != b:
                problems.append(
                    f"{get_column_letter(c)}{r} 원본 {a!r} → 도우미 {b!r}")
    print(f"원본 칸 {cells:,}칸 대조 · 어긋남 {len(problems)}칸")
    for p in problems[:5]:
        print("   !", p)

    # ② 판정 수식이 파이썬과 같은 답을 내나
    book = F.Book(wb)
    head, first = T.HEADER_ROW, T.FIRST_DATA_ROW
    jcol = next(get_column_letter(c) for c in range(1, ws.max_column + 1)
                if ws.cell(head, c).value == "배정 판정")
    scol = next(get_column_letter(c) for c in range(1, ws.max_column + 1)
                if ws.cell(head, c).value == "접수 학기")

    checked, bad = 0, []
    d = T.build(src_path)
    by_row = {a.row: a for a in d["applications"]}
    for r, app in sorted(by_row.items()):
        checked += 1
        got = book.value(ws.title, f"{jcol}{r}")
        if got != app.decision:
            bad.append(f"{r}행 {T.s(app.raw['성명'])}: 수식 {got!r} ≠ 파이썬 {app.decision!r}")
        if app.intake_year:
            want = T.sem_label(app.intake_year, app.intake_term)
            g2 = book.value(ws.title, f"{scol}{r}")
            checked += 1
            if g2 != want:
                bad.append(f"{r}행 접수 학기: 수식 {g2!r} ≠ 파이썬 {want!r}")

    print(f"판정·학기 수식 {checked}건 대조 · 어긋남 {len(bad)}건")
    for p in bad[:8]:
        print("   !", p)
    print(f"계산 오류 {len(book.errors)}건")
    for e in book.errors[:5]:
        print("   !", e)

    ok = not problems and not bad and not book.errors
    print("원본 그대로이고 수식도 파이썬과 같습니다" if ok else "확인 필요")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
