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
  - 모집은 중2까지지만 지원은 중3까지라 학년으로 걸러 내지 않는다

기존과 신규를 가르는 법

  기준 학기에 처음 온 학생이 신규, 그 전부터 이어 온 학생이 기존이다. 이
  가름은 대외 현황표의 '신규 + 연장' 과 맞는다(2024-2학기 33+127, 2025-2학기
  65+192 그대로).

  가족체류형은 가구 단위로 단가가 매겨져 형제가 기존과 신규로 갈리면 금액을
  쪼갤 수 없다. 그래서 **신규가 없었다면 얼마였을까** 를 기존 몫으로 두고,
  늘어난 만큼을 신규 몫으로 본다. 기존 형 혼자면 300,000원, 신규 동생이 오면
  400,000원 — 이때 기존 300,000 · 신규 100,000 이다. 예산이 신규 때문에 얼마나
  늘었는지 보는 자리라 이 편이 맞다.
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


def split(residence: str, members) -> tuple[int, int, int]:
    """(전체, 기존 몫, 신규 몫). 신규가 없었을 때의 단가를 기존 몫으로 둔다."""
    total = month_rate(residence, len(members))
    old = sum(1 for _, e, kind in members if kind == "기존")
    old_amount = month_rate(residence, old) if old else 0
    return total, old_amount, total - old_amount


def roll(src: str, start: dt.date, months: int, base_year: int, base_term: int):
    """달마다 (재적 명단, 가구별 금액) 을 낸다."""
    d = T.build(src)
    st = {s.student_id: s for s in d["students"]}

    # 기준 학기에 처음 온 학생이 신규다
    first: dict[str, object] = {}
    for e in sorted(d["enrollments"], key=lambda e: T.sem_index(e.year, e.term)):
        first.setdefault(e.student_id, e)
    kind_of = {sid: ("신규" if (e.year, e.term) == (base_year, base_term) else "기존")
               for sid, e in first.items()}

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
            groups[key].append((sid, e, kind_of[sid]))
        out.append((dt.date(y, m, 1), alive, groups, st))
    return out


def sheet_month(ws, roll_out):
    head = ["달", "재적 인원", "기존", "신규", "월 금액", "기존 몫", "신규 몫",
            "가족체류형 인원", "가족체류형 가구", "가족체류형 금액",
            "유학센터형 인원", "유학센터형 금액",
            "홈스테이형 인원", "홈스테이형 금액"]
    width = [11, 10, 8, 8, 15, 15, 15, 14, 14, 15, 14, 15, 14, 15]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        ws.column_dimensions[get_column_letter(c)].width = width[c - 1]
    ws.row_dimensions[1].height = 30

    for i, (day, alive, groups, st) in enumerate(roll_out):
        r = 2 + i
        by = defaultdict(lambda: [0, 0, 0])          # 인원, 가구, 금액
        total = old_amt = new_amt = 0
        for (hid, res), members in groups.items():
            t, o, n = split(res, members)
            total, old_amt, new_amt = total + t, old_amt + o, new_amt + n
            by[res][0] += len(members)
            by[res][1] += 1
            by[res][2] += t
        vals = [f"{day.year}. {day.month:>2}월", len(alive),
                sum(1 for _, _, k in
                    (m for ms in groups.values() for m in ms) if k == "기존"),
                sum(1 for _, _, k in
                    (m for ms in groups.values() for m in ms) if k == "신규"),
                total, old_amt, new_amt,
                by["가족체류형"][0], by["가족체류형"][1], by["가족체류형"][2],
                by["유학센터형"][0], by["유학센터형"][2],
                by["홈스테이형"][0], by["홈스테이형"][2]]
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BOX
            if c in (5, 6, 7, 10, 12, 14):
                cell.number_format = "#,##0"

    r = 2 + len(roll_out)
    ws.cell(r, 1, "합계").font = Font(name=FONT, size=10, bold=True)
    for c in (5, 6, 7, 10, 12, 14):
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
    head = ["시군", "구분"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = 10 if c <= 2 else 14

    table = defaultdict(lambda: defaultdict(int))
    for j, (day, alive, groups, st) in enumerate(roll_out):
        for (hid, res), members in groups.items():
            # 한 가구가 여러 시군에 걸치는 일은 없다 — 첫 학생의 시군으로 잡는다
            region = members[0][1].region or "(빈칸)"
            t, o, n = split(res, members)
            table[region][("기존", j)] += o
            table[region][("신규", j)] += n

    order = sorted(table, key=lambda k: -sum(table[k].values()))
    r = 2
    for region in order:
        for kind in ("기존", "신규"):
            ws.cell(r, 1, region if kind == "기존" else None)
            ws.cell(r, 2, kind)
            for j in range(len(months)):
                ws.cell(r, 3 + j, table[region][(kind, j)]).number_format = "#,##0"
            L1, L2 = get_column_letter(3), get_column_letter(2 + len(months))
            ws.cell(r, 3 + len(months),
                    f"=SUM({L1}{r}:{L2}{r})").number_format = "#,##0"
            for c in range(1, len(head) + 1):
                ws.cell(r, c).font = Font(name=FONT, size=10)
                ws.cell(r, c).border = BOX
                ws.cell(r, c).alignment = Alignment(horizontal="center",
                                                    vertical="center")
            r += 1
        ws.merge_cells(start_row=r - 2, start_column=1, end_row=r - 1, end_column=1)

    ws.cell(r, 1, "합계")
    ws.cell(r, 2, "기존＋신규")
    for c in range(3, len(head) + 1):
        L = get_column_letter(c)
        ws.cell(r, c, f"=SUM({L}2:{L}{r - 1})").number_format = "#,##0"
    for c in range(1, len(head) + 1):
        ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "C2"


def sheet_basis(ws, roll_out):
    """첫 달 기준으로 가구마다 어떻게 셈했는지 풀어 둔다."""
    day, alive, groups, st = roll_out[0]
    head = ["가구", "시군", "유학학교", "학생", "구분", "거주유형", "가구 인원",
            "월 단가", "기존 몫", "신규 몫", f"{len(roll_out)}개월", "셈법"]
    width = [9, 8, 12, 10, 7, 11, 10, 12, 12, 12, 13, 40]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = width[c - 1]

    r = 2
    for (hid, res), members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        total, old_amt, new_amt = split(res, members)
        n_old = sum(1 for _, _, k in members if k == "기존")
        for i, (sid, e, kind) in enumerate(members):
            if i:
                how = ""
            elif res == "가족체류형":
                how = f"가족체류형 가구 {len(members)}명 → {total:,}원/월"
                if new_amt and n_old:
                    how += (f" (신규 없었으면 {n_old}명 {old_amt:,}원 "
                            f"→ 늘어난 {new_amt:,}원이 신규 몫)")
            else:
                how = f"{res} {len(members)}명 × {PER_HEAD:,}원/월"
            vals = [hid, e.region, e.school, st[sid].name, kind, res, len(members),
                    total if not i else None,
                    old_amt if not i else None, new_amt if not i else None,
                    total * len(roll_out) if not i else None, how]
            for c, v in enumerate(vals, start=1):
                cell = ws.cell(r, c, v)
                cell.font = Font(name=FONT, size=10)
                cell.border = BOX
                cell.alignment = Alignment(
                    horizontal="left" if c == 12 else "center", vertical="center")
                if c in (8, 9, 10, 11):
                    cell.number_format = "#,##0"
            r += 1
    ws.freeze_panes = "A2"


def main(src: str, out: str, start_text: str = "2026-09", months: str = "6") -> int:
    y, m = (int(x) for x in start_text.split("-"))
    # 시작 달이 든 학기를 기준 학기로 삼는다 — 그 학기에 처음 온 학생이 신규다
    base_year, base_term = T.sem_of(dt.date(y, m, 1))
    roll_out = roll(src, dt.date(y, m, 1), int(months), base_year, base_term)

    wb = openpyxl.Workbook()
    sheet_month(wb.active, roll_out)
    wb.active.title = "월별 예상"
    sheet_region(wb.create_sheet("시군별"), roll_out)
    sheet_basis(wb.create_sheet("산출 근거"), roll_out)
    wb.save(out)

    print(f"저장: {out}")
    print(f"  기준 학기 {base_year}학년도 {base_term}학기 — 이 학기에 처음 온 "
          f"학생이 신규입니다")
    total = told = tnew = 0
    for day, alive, groups, st in roll_out:
        amt = o = n = 0
        for (h, res), v in groups.items():
            a, b, c = split(res, v)
            amt, o, n = amt + a, o + b, n + c
        kinds = [k for ms in groups.values() for _, _, k in ms]
        total, told, tnew = total + amt, told + o, tnew + n
        print(f"  {day.year}. {day.month:>2}월  재적 {len(alive):>3}명"
              f"(기존 {kinds.count('기존'):>3} · 신규 {kinds.count('신규'):>3}) · "
              f"{amt:>12,}원 = 기존 {o:>12,} ＋ 신규 {n:>11,}")
    print(f"  {int(months)}개월 합계 {total:,}원 "
          f"= 기존 {told:,} ＋ 신규 {tnew:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
