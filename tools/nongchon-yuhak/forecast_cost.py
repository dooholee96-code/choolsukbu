"""도교육청 유학경비(월 체재비)가 앞으로 얼마나 나갈지 달마다 셈한다.

  python forecast_cost.py <원본.xlsx> <출력.xlsx> [시작 YYYY-MM] [개월 수]

단가 — 시·도교육청 현황 조사에 낸 자료의 '학생' 지원 내용 그대로다.

  가족체류형  가구당  1명 300,000 / 2명 400,000 / 3명 이상 500,000원/월
  유학센터형  1명당  300,000원/월
  홈스테이형  1명당  300,000원/월

세는 법

  - 그 달에 재적인 학생만 센다. 유학 시작일 이전, 종료일 다음 달은 뺀다
  - 가족체류형은 가구(보호자 연락처)로 묶어 한 단가를 매긴다
  - 아직 다음 학기 줄이 없는 학생도, 앞 학기를 끝까지 다녔으면 이어지는 것으로
    본다. '신규는 모두 확정되고 중도 종료는 없다'는 가정이 여기에 해당한다
"""

from __future__ import annotations

import calendar
import datetime as dt
import sys
from collections import defaultdict

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

import transform as T

FONT = "맑은 고딕"
FAMILY_TIER = (300_000, 400_000, 500_000)      # 1명 / 2명 / 3명 이상
PER_HEAD = 300_000                              # 유학센터형·홈스테이형 1명당

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD = PatternFill("solid", fgColor="DDEBF7")
SUMF = PatternFill("solid", fgColor="FFF2CC")


def month_rate(residence: str, n: int) -> int:
    if residence == "가족체류형":
        return FAMILY_TIER[min(max(n, 1), 3) - 1]
    return PER_HEAD * max(n, 1)


def roll(src: str, start: dt.date, months: int):
    """달마다 (재적 명단, 가구별 금액) 을 낸다."""
    d = T.build(src)
    st = {s.student_id: s for s in d["students"]}

    # 학생마다 마지막 유학 이력을 붙든다 — 다음 학기 줄이 아직 없어도 이어진다고 본다
    last: dict[str, object] = {}
    for e in sorted(d["enrollments"], key=lambda e: T.sem_index(e.year, e.term)):
        last[e.student_id] = e

    out = []
    for i in range(months):
        y, m = divmod((start.year * 12 + start.month - 1) + i, 12)
        m += 1
        first = dt.date(y, m, 1)
        alive = []
        for sid, e in last.items():
            if e.start_date and e.start_date > dt.date(y, m,
                                                       calendar.monthrange(y, m)[1]):
                continue
            if e.end_date and e.end_date < first:
                continue
            alive.append((sid, e))

        groups = defaultdict(list)
        for sid, e in alive:
            key = (st[sid].household_id, e.residence or "(빈칸)")
            groups[key].append((sid, e))
        out.append((dt.date(y, m, 1), alive, groups, st))
    return out


def sheet_month(ws, roll_out):
    head = ["달", "재적 인원", "가족체류형 인원", "가족체류형 가구", "가족체류형 금액",
            "유학센터형 인원", "유학센터형 금액", "홈스테이형 인원", "홈스테이형 금액",
            "합계"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        ws.column_dimensions[get_column_letter(c)].width = \
            [11, 10, 14, 14, 15, 14, 15, 14, 15, 16][c - 1]
    ws.row_dimensions[1].height = 30

    for i, (day, alive, groups, st) in enumerate(roll_out):
        r = 2 + i
        by = defaultdict(lambda: [0, 0, 0])          # 인원, 가구, 금액
        for (hid, res), members in groups.items():
            by[res][0] += len(members)
            by[res][1] += 1
            by[res][2] += month_rate(res, len(members))
        vals = [f"{day.year}. {day.month:>2}월", len(alive),
                by["가족체류형"][0], by["가족체류형"][1], by["가족체류형"][2],
                by["유학센터형"][0], by["유학센터형"][2],
                by["홈스테이형"][0], by["홈스테이형"][2],
                sum(v[2] for v in by.values())]
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BOX
            if c in (5, 7, 9, 10):
                cell.number_format = "#,##0"

    r = 2 + len(roll_out)
    ws.cell(r, 1, "합계").font = Font(name=FONT, size=10, bold=True)
    for c in (5, 7, 9, 10):
        L = get_column_letter(c)
        cell = ws.cell(r, c, f"=SUM({L}2:{L}{r - 1})")
        cell.number_format = "#,##0"
        cell.font = Font(name=FONT, size=10, bold=True)
    for c in range(1, len(head) + 1):
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "B2"


def sheet_region(ws, roll_out):
    months = [d for d, *_ in roll_out]
    head = ["시군"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = 10 if c == 1 else 14

    table = defaultdict(lambda: defaultdict(int))
    for j, (day, alive, groups, st) in enumerate(roll_out):
        for (hid, res), members in groups.items():
            # 한 가구가 여러 시군에 걸치는 일은 없다 — 첫 학생의 시군으로 잡는다
            table[members[0][1].region or "(빈칸)"][j] += month_rate(res, len(members))

    for i, region in enumerate(sorted(table, key=lambda k: -sum(table[k].values()))):
        r = 2 + i
        ws.cell(r, 1, region)
        for j in range(len(months)):
            ws.cell(r, 2 + j, table[region][j]).number_format = "#,##0"
        L1, L2 = get_column_letter(2), get_column_letter(1 + len(months))
        ws.cell(r, 2 + len(months), f"=SUM({L1}{r}:{L2}{r})").number_format = "#,##0"
        for c in range(1, len(head) + 1):
            ws.cell(r, c).font = Font(name=FONT, size=10)
            ws.cell(r, c).border = BOX
            ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")

    r = 2 + len(table)
    ws.cell(r, 1, "합계")
    for c in range(2, len(head) + 1):
        L = get_column_letter(c)
        ws.cell(r, c, f"=SUM({L}2:{L}{r - 1})").number_format = "#,##0"
    for c in range(1, len(head) + 1):
        ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "B2"


def sheet_basis(ws, roll_out):
    """첫 달 기준으로 가구마다 어떻게 셈했는지 풀어 둔다."""
    day, alive, groups, st = roll_out[0]
    head = ["가구", "시군", "유학학교", "학생", "거주유형", "가구 인원",
            "월 단가", f"{len(roll_out)}개월", "셈법"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        ws.column_dimensions[get_column_letter(c)].width = \
            [9, 8, 12, 10, 11, 10, 12, 13, 34][c - 1]

    r = 2
    for (hid, res), members in sorted(groups.items(),
                                      key=lambda kv: -len(kv[1])):
        rate = month_rate(res, len(members))
        for i, (sid, e) in enumerate(members):
            how = ("" if i else
                   (f"가족체류형 가구 {len(members)}명 → {rate:,}원/월"
                    if res == "가족체류형"
                    else f"{res} {len(members)}명 × {PER_HEAD:,}원/월"))
            vals = [hid, e.region, e.school, st[sid].name, res, len(members),
                    rate if not i else None,
                    rate * len(roll_out) if not i else None, how]
            for c, v in enumerate(vals, start=1):
                cell = ws.cell(r, c, v)
                cell.font = Font(name=FONT, size=10)
                cell.border = BOX
                cell.alignment = Alignment(
                    horizontal="left" if c == 9 else "center", vertical="center")
                if c in (7, 8):
                    cell.number_format = "#,##0"
            r += 1
    ws.freeze_panes = "A2"


def main(src: str, out: str, start_text: str = "2026-09", months: str = "6") -> int:
    y, m = (int(x) for x in start_text.split("-"))
    roll_out = roll(src, dt.date(y, m, 1), int(months))

    wb = openpyxl.Workbook()
    sheet_month(wb.active, roll_out)
    wb.active.title = "월별 예상"
    sheet_region(wb.create_sheet("시군별"), roll_out)
    sheet_basis(wb.create_sheet("산출 근거"), roll_out)
    wb.save(out)

    print(f"저장: {out}")
    total = 0
    for day, alive, groups, st in roll_out:
        amt = sum(month_rate(res, len(v)) for (h, res), v in groups.items())
        total += amt
        print(f"  {day.year}. {day.month:>2}월  재적 {len(alive):>3}명 · "
              f"가구 {len(groups):>3} · {amt:>12,}원")
    print(f"  {int(months)}개월 합계 {total:,}원")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
