"""서울시교육청 지원금 대상자 명단을 만든다.

  python fill_seoul_pay.py <원본.xlsx> <출력.xlsx> [지난제출본.xlsx ...]

지원기준('26. 3. 1.)

  지원대상  초1 ~ 중2 · 가족체류형 또는 유학센터형 · 서울 공립 초·중 원적
  지원기간  최대 1년 = 두 학기. 최초 참여 학년도 안에서만 받는다
  단가      6개월을 경계로 깎인다. 3월 1일 시작이니 1학기가 최초 6개월,
            2학기가 7~12개월로 학기와 맞아떨어진다

              가족체류형(가구당)      유학센터형(1명당)
    최초~6개월  1명 30 / 2명 40 / 3명 50 / 4명↑ 60만원      30만원
    7개월~1년   1명 20 / 2명 30 / 3명 40 / 4명↑ 50만원      20만원

  지급        가족체류형은 가구 대표 한 사람에게 몰아 적고 나머지 형제는 0
  지원금      단가 × 6개월

그래서 2026학년도 2학기 명단은 이렇게 갈린다.

  2026-1학기 진입  7~12개월 — 단가가 한 칸 내려간다
  2026-2학기 진입  최초~6개월
  2025-2학기 이전  1년을 다 썼으므로 지원 종료 — 명단에 넣지 않는다

첫 시트는 제출용이라 지난 제출본의 열 차례를 그대로 쓴다. 둘째 시트에
가구·구간·단가를 풀어 두어 사람이 검산할 수 있게 한다.
"""

from __future__ import annotations

import sys
from collections import defaultdict

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

import fill_seoul_form as FS
import transform as T

FONT = "맑은 고딕"
MONTHS = 6                                  # 한 학기 = 6개월치를 한 번에

HEADERS = ["연번", "유학지역\n(광역)", "유학지역\n(기초)", "유학학교", "학생 성명",
           "학년({y})", "성별", "거주유형", "보호자 성명", "보호자 연락처",
           "원 교육지원청", "원 소속교", "최초 참여 기수", "지원여부",
           "지원단가", "지원금"]

WIDTHS = [5, 8, 8, 12, 10, 8, 5, 11, 10, 14, 12, 14, 13, 8, 11, 12]

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD = PatternFill("solid", fgColor="DDEBF7")
SUM = PatternFill("solid", fgColor="FFF2CC")


def unit_price(residence: str, n: int, first_half: bool) -> int:
    """단가. n 은 가구 안의 지원 대상 수(유학센터형은 1명당이라 쓰지 않는다)."""
    if residence == "유학센터형":
        return 300_000 if first_half else 200_000
    base = 300_000 if first_half else 200_000
    return base + 100_000 * min(max(n, 1) - 1, 3)


def plan(src: str, base_year: int, base_term: int):
    """지원 대상과 단가를 정한다."""
    rows = [x for x in FS.collect(src, base_year, base_term)
            if FS.judge(x, base_year, base_term)[0] == "○"]

    house = defaultdict(list)
    for x in rows:
        # 최초 참여가 이 학기면 최초 6개월, 앞 학기면 7~12개월
        x["first_half"] = (x["first_year"], x["first_term"]) == (base_year, base_term)
        x["months"] = "최초~6개월" if x["first_half"] else "7개월~1년"
        house[x["household"]].append(x)

    for members in house.values():
        members.sort(key=lambda y: FS.T.GRADE_INDEX.get(y["grade"], 99), reverse=True)
        n = len(members)
        for i, y in enumerate(members):
            if y["residence"] == "유학센터형":
                # 1명당 나가므로 형제와 나눠 갖지 않는다
                y["unit"] = unit_price(y["residence"], 1, y["first_half"])
                y["size"] = 1
            else:
                y["size"] = n
                # 가구 대표(맏이) 한 사람에게 몰아 적는다
                y["unit"] = (unit_price(y["residence"], n, y["first_half"])
                             if i == 0 else 0)
            y["amount"] = y["unit"] * MONTHS

    rows.sort(key=lambda x: (FS.REGION_ORDER.index(x["region"])
                             if x["region"] in FS.REGION_ORDER else 99,
                             x["school"] or "", x["name"]))
    return rows


def write_sheet(ws, rows, base_year, base_term):
    ws.cell(1, 1, f"{base_year}학년도 {base_term}학기 서울시교육청 "
                  f"농촌유학생 지원금 대상자 명단 (전북)")
    ws.cell(1, 1).font = Font(name=FONT, size=13, bold=True)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(HEADERS))
    ws.cell(1, 1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28

    for c, h in enumerate(HEADERS, start=1):
        cell = ws.cell(2, c, h.format(y=base_year))
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        cell.fill, cell.border = HEAD, BOX
        ws.column_dimensions[get_column_letter(c)].width = WIDTHS[c - 1]
    ws.row_dimensions[2].height = 32

    for i, x in enumerate(rows):
        r = 3 + i
        vals = [i + 1, "전북", x["region"], x["school"], x["name"], x["grade"],
                x["gender"], x["residence"], x["guardian"], x["phone"],
                x["office"], x["home_school"],
                f"{x['first_year']}. {x['first_term']}학기", "○",
                x["unit"] or None, x["amount"] or (0 if x["unit"] == 0 else None)]
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BOX
            if c in (15, 16):
                cell.number_format = "#,##0"

    r = 3 + len(rows)
    ws.cell(r, 1, "합계").font = Font(name=FONT, size=10, bold=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=14)
    ws.cell(r, 1).alignment = Alignment(horizontal="center", vertical="center")
    top, bot = 3, 3 + len(rows) - 1
    for c in (15, 16):
        cell = ws.cell(r, c, f"=SUM({get_column_letter(c)}{top}:"
                             f"{get_column_letter(c)}{bot})")
        cell.number_format = "#,##0"
        cell.font = Font(name=FONT, size=10, bold=True)
    for c in range(1, len(HEADERS) + 1):
        ws.cell(r, c).fill, ws.cell(r, c).border = SUM, BOX
    ws.freeze_panes = "A3"


def write_basis(ws, rows):
    """가구·구간·단가를 풀어 둔다 — 사람이 검산하는 자리."""
    head = ["가구", "학생", "거주유형", "최초 참여", "지원 구간",
            "가구 내 대상 수", "단가", "지원금", "셈법"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        ws.column_dimensions[get_column_letter(c)].width = \
            [9, 10, 11, 12, 12, 14, 11, 12, 40][c - 1]

    by_house = defaultdict(list)
    for x in rows:
        by_house[x["household"]].append(x)

    r = 2
    for hid in sorted(by_house, key=lambda h: -len(by_house[h])):
        for x in by_house[hid]:
            if x["residence"] == "유학센터형":
                how = f"유학센터형 1명당 {x['unit']:,}원 × {MONTHS}개월"
            elif x["unit"]:
                how = (f"가족체류형 가구 {x['size']}명 · {x['months']} "
                       f"→ {x['unit']:,}원 × {MONTHS}개월")
            else:
                how = "형제 몫은 가구 대표에게 몰아 적었다"
            for c, v in enumerate([hid, x["name"], x["residence"],
                                   f"{x['first_year']}. {x['first_term']}학기",
                                   x["months"], x["size"], x["unit"] or None,
                                   x["amount"] or 0, how], start=1):
                cell = ws.cell(r, c, v)
                cell.font = Font(name=FONT, size=10)
                cell.border = BOX
                cell.alignment = Alignment(
                    horizontal="left" if c == 9 else "center", vertical="center")
                if c in (7, 8):
                    cell.number_format = "#,##0"
            r += 1
    ws.freeze_panes = "A2"


def main(src_path: str, out_path: str, *prev_paths: str) -> int:
    base_year, base_term = T.CURRENT_YEAR, T.CURRENT_TERM + 1
    if base_term > 2:
        base_year, base_term = base_year + 1, 1

    rows = plan(src_path, base_year, base_term)

    prev: dict = {}
    for q in reversed(prev_paths):
        prev.update(FS.read_prev(q))
    filled = 0
    for x in rows:
        got = FS.resolve_office(x, prev)
        if got and not x["office"]:
            x["office"], filled = got, filled + 1

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"지원금 명단(전북) {base_year}-{base_term}학기"
    write_sheet(ws, rows, base_year, base_term)
    write_basis(wb.create_sheet("계산 근거"), rows)
    wb.save(out_path)

    total = sum(x["amount"] for x in rows)
    early = [x for x in rows if x["first_half"]]
    late = [x for x in rows if not x["first_half"]]
    print(f"저장: {out_path}")
    print(f"  {base_year}학년도 {base_term}학기 지원 대상 {len(rows)}명 · "
          f"가구 {len({x['household'] for x in rows})}곳")
    print(f"    최초~6개월({base_year}-{base_term}학기 진입) {len(early)}명 · "
          f"{sum(x['amount'] for x in early):,}원")
    print(f"    7개월~1년({base_year}-1학기 진입)  {len(late)}명 · "
          f"{sum(x['amount'] for x in late):,}원")
    print(f"  합계 {total:,}원")
    if filled:
        print(f"  원 교육지원청 {filled}칸을 지난 제출본에서 가져왔습니다")
    blank = sum(1 for x in rows if not x["office"])
    if blank:
        print(f"  원 교육지원청이 아직 빈 줄 {blank}개 — 손으로 채워 주세요")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
