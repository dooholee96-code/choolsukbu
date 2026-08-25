"""유학경비가 앞으로 얼마나 나갈지 달마다 셈한다.

도교육청이 주는 유학경비와, 서울 원적 학생에게 서울시교육청이 주는 지원금을
따로 적고 합친다.

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
  - 서울시교육청 지원금은 그 달이 든 학기 기준으로 따로 셈해 붙인다
    (기준·단가는 fill_seoul_pay 참고). 도교육청 몫과 성격이 달라 열을 나눈다

가르는 두 축

  기존 / 신규   기준 학기에 처음 온 학생이 신규, 그 전부터 이어 온 학생이
                기존이다. 이 가름은 대외 현황표의 '신규 + 연장' 과 맞는다
                (2024-2학기 33+127, 2025-2학기 65+192 그대로)
  서울 / 서울 외  원 지역이 서울인 학생과 아닌 학생. 서울시교육청 지원금이
                걸리는 쪽이라 따로 본다

  가족체류형은 가구 단위로 단가가 매겨진다. 형제가 서로 다른 쪽으로 갈리면
  가구 금액을 **인원 수로 나눠** 각자 몫으로 돌린다. 2명 가구 400,000원이면
  한 사람당 200,000원이다. 나머지가 남으면 인원이 많은 쪽에 붙여 합계가
  어긋나지 않게 한다.
"""

from __future__ import annotations

import calendar
import datetime as dt
import sys
from collections import defaultdict

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

import fill_seoul_pay as P
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


def seoul_month(src: str, year: int, term: int) -> dict:
    """그 학기 서울시교육청 지원금을 학생마다 달 몫으로 돌린다."""
    rows = P.plan(src, year, term)
    house = defaultdict(list)
    for x in rows:
        house[x["household"]].append(x)
    out: dict[str, int] = {}
    for members in house.values():
        # 가구 대표 한 사람에게 몰아 적혀 있으니 다시 인원 수로 나눈다
        each, rest = divmod(sum(y["unit"] for y in members), len(members))
        for i, y in enumerate(members):
            out[y["sid"]] = each + (rest if i == 0 else 0)
    return out


def share(residence: str, members) -> dict:
    """가구 금액을 사람 수로 나눠 학생마다 몫을 준다. 나머지는 첫 사람에게."""
    total = month_rate(residence, len(members))
    each, rest = divmod(total, len(members))
    out = {sid: each for sid, _, _ in members}
    out[members[0][0]] += rest
    return out


def sum_by(groups, pick):
    """가구별 금액을 학생 몫으로 풀어 pick(학생) 별로 더한다."""
    got = defaultdict(int)
    for (hid, res), members in groups.items():
        part = share(res, members)
        for sid, e, kind in members:
            got[pick(sid, e, kind)] += part[sid]
    return got


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
    # 원 지역이 서울인 학생 — 서울시교육청 지원금이 걸리는 쪽
    seoul_of = {sid: (T.s(st[sid].home_region) == "서울") for sid in st}

    # 학생마다 마지막 유학 이력을 붙든다 — 다음 학기 줄이 아직 없어도 이어진다고 본다
    last: dict[str, object] = {}
    for e in sorted(d["enrollments"], key=lambda e: T.sem_index(e.year, e.term)):
        last[e.student_id] = e

    pay_cache: dict[tuple[int, int], dict] = {}

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
        sem = T.sem_of(first)
        if sem not in pay_cache:
            pay_cache[sem] = seoul_month(src, *sem)
        out.append((dt.date(y, m, 1), alive, groups, st, seoul_of,
                    pay_cache[sem]))
    return out


def sheet_month(ws, roll_out):
    head = ["달", "재적 인원", "기존", "신규", "서울 원적", "서울 외",
            "도교육청 유학경비", "기존 몫", "신규 몫", "서울 몫", "서울 외 몫",
            "서울시교육청 지원금", "서울 지원 인원", "총 지원액",
            "가족체류형 인원", "가족체류형 가구", "가족체류형 금액",
            "유학센터형 인원", "유학센터형 금액",
            "홈스테이형 인원", "홈스테이형 금액"]
    width = ([11, 10, 8, 8, 10, 9] + [16] * 5 + [18, 13, 16]
             + [14, 14, 15, 14, 15, 14, 15])
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        ws.column_dimensions[get_column_letter(c)].width = width[c - 1]
    ws.row_dimensions[1].height = 30

    for i, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        r = 2 + i
        people = [m for ms in groups.values() for m in ms]
        by_res = defaultdict(lambda: [0, 0, 0])          # 인원, 가구, 금액
        for (hid, res), members in groups.items():
            by_res[res][0] += len(members)
            by_res[res][1] += 1
            by_res[res][2] += month_rate(res, len(members))
        by_kind = sum_by(groups, lambda sid, e, k: k)
        by_home = sum_by(groups, lambda sid, e, k: "서울" if seoul_of[sid] else "서울 외")
        vals = [f"{day.year}. {day.month:>2}월", len(alive),
                sum(1 for _, _, k in people if k == "기존"),
                sum(1 for _, _, k in people if k == "신규"),
                sum(1 for sid, _, _ in people if seoul_of[sid]),
                sum(1 for sid, _, _ in people if not seoul_of[sid]),
                sum(v[2] for v in by_res.values()),
                by_kind["기존"], by_kind["신규"],
                by_home["서울"], by_home["서울 외"],
                sum(pay_of.get(sid, 0) for sid, _, _ in people),
                sum(1 for sid, _, _ in people if sid in pay_of),
                (sum(v[2] for v in by_res.values())
                 + sum(pay_of.get(sid, 0) for sid, _, _ in people)),
                by_res["가족체류형"][0], by_res["가족체류형"][1],
                by_res["가족체류형"][2],
                by_res["유학센터형"][0], by_res["유학센터형"][2],
                by_res["홈스테이형"][0], by_res["홈스테이형"][2]]
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BOX
            if c in (7, 8, 9, 10, 11, 12, 14, 17, 19, 21):
                cell.number_format = "#,##0"

    r = 2 + len(roll_out)
    ws.cell(r, 1, "합계").font = Font(name=FONT, size=10, bold=True)
    for c in (7, 8, 9, 10, 11, 12, 14, 17, 19, 21):
        L = get_column_letter(c)
        cell = ws.cell(r, c, f"=SUM({L}2:{L}{r - 1})")
        cell.number_format = "#,##0"
        cell.font = Font(name=FONT, size=10, bold=True)
    for c in range(1, len(head) + 1):
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "B2"


def sheet_cross(ws, roll_out):
    """기존/신규 × 서울/서울 외 네 갈래."""
    months = [d for d, *_ in roll_out]
    head = ["구분", "원적", "값"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = (
            9 if c <= 2 else 19 if c == 3 else 15)

    cuts = [(k, h) for k in ("기존", "신규") for h in ("서울", "서울 외")]
    money = {c: [0] * len(months) for c in cuts}
    heads = {c: [0] * len(months) for c in cuts}
    seoul = {c: [0] * len(months) for c in cuts}
    total = {c: [0] * len(months) for c in cuts}
    for j, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        got = sum_by(groups, lambda sid, e, k: (k, "서울" if seoul_of[sid] else "서울 외"))
        for c in cuts:
            money[c][j] = got[c]
        for ms in groups.values():
            for sid, e, k in ms:
                key = (k, "서울" if seoul_of[sid] else "서울 외")
                heads[key][j] += 1
                seoul[key][j] += pay_of.get(sid, 0)
        for c in cuts:
            total[c][j] = money[c][j] + seoul[c][j]

    r = 2
    for label, table, fmt in (("인원", heads, "#,##0"),
                              ("도교육청 유학경비", money, "#,##0"),
                              ("서울시교육청 지원금", seoul, "#,##0"),
                              ("총 지원액", total, "#,##0")):
        for kind, home in cuts:
            ws.cell(r, 1, kind)
            ws.cell(r, 2, home)
            ws.cell(r, 3, label)
            for j in range(len(months)):
                ws.cell(r, 4 + j, table[(kind, home)][j]).number_format = fmt
            L1, L2 = get_column_letter(4), get_column_letter(3 + len(months))
            ws.cell(r, 4 + len(months),
                    table[(kind, home)][0] if label == "인원"
                    else f"=SUM({L1}{r}:{L2}{r})").number_format = fmt
            for c in range(1, len(head) + 1):
                ws.cell(r, c).font = Font(name=FONT, size=10)
                ws.cell(r, c).border = BOX
                ws.cell(r, c).alignment = Alignment(horizontal="center",
                                                    vertical="center")
            r += 1
        ws.cell(r, 1, "합계")
        ws.cell(r, 3, label)
        for c in range(4, len(head) + 1):
            L = get_column_letter(c)
            ws.cell(r, c, f"=SUM({L}{r - 4}:{L}{r - 1})").number_format = fmt
        for c in range(1, len(head) + 1):
            ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
            ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
            ws.cell(r, c).alignment = Alignment(horizontal="center",
                                                vertical="center")
        r += 2
    ws.freeze_panes = "D2"


def sheet_region(ws, roll_out):
    months = [d for d, *_ in roll_out]
    head = ["시군", "구분", "원적"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = 10 if c <= 3 else 14

    cuts = [(k, h) for k in ("기존", "신규") for h in ("서울", "서울 외")]
    table = defaultdict(lambda: defaultdict(int))
    for j, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        got = sum_by(groups, lambda sid, e, k: (
            e.region or "(빈칸)", k, "서울" if seoul_of[sid] else "서울 외"))
        for (region, kind, home), amt in got.items():
            table[region][(kind, home, j)] += amt

    order = sorted(table, key=lambda k: -sum(table[k].values()))
    r = 2
    for region in order:
        for kind, home in cuts:
            ws.cell(r, 1, region if (kind, home) == cuts[0] else None)
            ws.cell(r, 2, kind)
            ws.cell(r, 3, home)
            for j in range(len(months)):
                ws.cell(r, 4 + j,
                        table[region][(kind, home, j)]).number_format = "#,##0"
            L1, L2 = get_column_letter(4), get_column_letter(3 + len(months))
            ws.cell(r, 4 + len(months),
                    f"=SUM({L1}{r}:{L2}{r})").number_format = "#,##0"
            for c in range(1, len(head) + 1):
                ws.cell(r, c).font = Font(name=FONT, size=10)
                ws.cell(r, c).border = BOX
                ws.cell(r, c).alignment = Alignment(horizontal="center",
                                                    vertical="center")
            r += 1
        ws.merge_cells(start_row=r - 4, start_column=1, end_row=r - 1, end_column=1)

    ws.cell(r, 1, "합계")
    for c in range(4, len(head) + 1):
        L = get_column_letter(c)
        ws.cell(r, c, f"=SUM({L}2:{L}{r - 1})").number_format = "#,##0"
    for c in range(1, len(head) + 1):
        ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")
    ws.freeze_panes = "D2"


def sheet_basis(ws, roll_out):
    """첫 달 기준으로 가구마다 어떻게 셈했는지 풀어 둔다."""
    day, alive, groups, st, seoul_of, pay_of = roll_out[0]
    head = ["가구", "시군", "유학학교", "학생", "구분", "원적", "거주유형",
            "가구 인원", "가구 월 단가", "학생 몫", "서울 지원금", "월 합계",
            f"{len(roll_out)}개월", "셈법"]
    width = [9, 8, 12, 10, 7, 8, 11, 10, 13, 12, 13, 13, 13, 38]
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill, cell.border = HEAD, BOX
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(c)].width = width[c - 1]

    r = 2
    for (hid, res), members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        rate = month_rate(res, len(members))
        part = share(res, members)
        split_home = len({seoul_of[sid] for sid, _, _ in members}) > 1
        for i, (sid, e, kind) in enumerate(members):
            if i:
                how = ""
            elif res == "가족체류형":
                how = f"가족체류형 가구 {len(members)}명 → {rate:,}원/월"
                if split_home:
                    how += " · 원적이 갈려 인원 수로 나눔"
            else:
                how = f"{res} {len(members)}명 × {PER_HEAD:,}원/월"
            vals = [hid, e.region, e.school, st[sid].name, kind,
                    "서울" if seoul_of[sid] else "서울 외", res, len(members),
                    rate if not i else None, part[sid],
                    pay_of.get(sid, 0), part[sid] + pay_of.get(sid, 0),
                    (part[sid] + pay_of.get(sid, 0)) * len(roll_out), how]
            for c, v in enumerate(vals, start=1):
                cell = ws.cell(r, c, v)
                cell.font = Font(name=FONT, size=10)
                cell.border = BOX
                cell.alignment = Alignment(
                    horizontal="left" if c == 14 else "center", vertical="center")
                if c in (9, 10, 11, 12, 13):
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
    sheet_cross(wb.create_sheet("기존·신규 × 원적"), roll_out)
    sheet_region(wb.create_sheet("시군별"), roll_out)
    sheet_basis(wb.create_sheet("산출 근거"), roll_out)
    wb.save(out)

    print(f"저장: {out}")
    print(f"  기준 학기 {base_year}학년도 {base_term}학기 — 이 학기에 처음 온 "
          f"학생이 신규입니다")
    acc = defaultdict(int)
    for day, alive, groups, st, seoul_of, pay_of in roll_out:
        amt = sum(month_rate(res, len(v)) for (h, res), v in groups.items())
        kind = sum_by(groups, lambda sid, e, k: k)
        home = sum_by(groups, lambda sid, e, k: "서울" if seoul_of[sid] else "서울 외")
        people = [m for ms in groups.values() for m in ms]
        pay = sum(pay_of.get(sid, 0) for sid, _, _ in people)
        for key, v in (("계", amt), ("기존", kind["기존"]), ("신규", kind["신규"]),
                       ("서울", home["서울"]), ("서울 외", home["서울 외"]),
                       ("서울지원", pay)):
            acc[key] += v
        print(f"  {day.year}. {day.month:>2}월  재적 {len(alive):>3}명 · "
              f"도교육청 {amt:>12,} ＋ 서울 {pay:>10,} = {amt + pay:>12,}원")
        print(f"          기존 {sum(1 for _, _, k in people if k == '기존'):>3}명 "
              f"{kind['기존']:>12,} · 신규 "
              f"{sum(1 for _, _, k in people if k == '신규'):>3}명 {kind['신규']:>11,}")
        print(f"          서울 {sum(1 for s2, _, _ in people if seoul_of[s2]):>3}명 "
              f"{home['서울']:>12,} · 서울 외 "
              f"{sum(1 for s2, _, _ in people if not seoul_of[s2]):>3}명 "
              f"{home['서울 외']:>11,}")
    print(f"  {int(months)}개월 도교육청 유학경비 {acc['계']:,}원")
    print(f"    기존 {acc['기존']:,} ＋ 신규 {acc['신규']:,}")
    print(f"    서울 원적 {acc['서울']:,} ＋ 서울 외 {acc['서울 외']:,}")
    print(f"  {int(months)}개월 서울시교육청 지원금 {acc['서울지원']:,}원")
    print(f"  {int(months)}개월 총 지원액 {acc['계'] + acc['서울지원']:,}원")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
