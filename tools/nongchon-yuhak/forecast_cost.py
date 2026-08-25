"""유학경비가 앞으로 얼마나 나갈지 달마다 셈한다.

  python forecast_cost.py <원본.xlsx> <출력.xlsx> [시작 YYYY-MM] [개월 수]

도교육청이 주는 유학경비와, 서울 원적 학생에게 서울시교육청이 주는 지원금을
따로 적고 합친다.

단가 — 시·도교육청 현황 조사에 낸 자료의 '학생' 지원 내용 그대로다.

  가족체류형  가구당  1자녀 300,000 / 2자녀 400,000 / 3자녀 이상 500,000원/월
  유학센터형  1명당  300,000원/월
  홈스테이형  1명당  300,000원/월

세는 법

  - 그 달에 재적인 학생만 센다. 유학 시작일 이전, 종료일 다음 달은 뺀다
  - 가족체류형은 가구(보호자 연락처)로 묶어 한 단가를 매긴다. 그래서 1자녀
    가구가 몇이고 다자녀 가구가 몇인지가 금액을 가른다 — 따로 세어 보인다
  - 아직 다음 학기 줄이 없는 학생도, 앞 학기를 끝까지 다녔으면 이어지는 것으로
    본다. '신규는 모두 확정되고 중도 종료는 없다'는 가정이 여기에 해당한다
  - 모집은 중2까지지만 지원은 중3까지라 학년으로 걸러 내지 않는다
  - 홈스테이형은 지금 한 명도 없다. 있는 학기에만 칸이 생긴다

가르는 축

  기존 / 신규   기준 학기에 처음 온 학생이 신규, 그 전부터 이어 온 학생이
                기존이다. 이 가름은 대외 현황표의 '신규 + 연장' 과 맞는다
                (2024-2학기 33+127, 2025-2학기 65+192 그대로)
  서울 / 서울 외  서울시교육청 지원금에만 쓴다. 도교육청 유학경비는 원적을
                가리지 않으므로 나누지 않는다

  가족체류형 가구 금액을 기존·신규로 갈라야 할 때는 인원 수로 나눈다. 나머지가
  남으면 인원이 많은 쪽에 붙여 합계가 어긋나지 않게 한다.
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
FAMILY_TIER = (300_000, 400_000, 500_000)      # 1자녀 / 2자녀 / 3자녀 이상
PER_HEAD = 300_000                              # 유학센터형·홈스테이형 1명당

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD = PatternFill("solid", fgColor="DDEBF7")
SEOUL = PatternFill("solid", fgColor="FCE4D6")
SUMF = PatternFill("solid", fgColor="FFF2CC")


def month_rate(residence: str, n: int) -> int:
    if residence == "가족체류형":
        return FAMILY_TIER[min(max(n, 1), 3) - 1]
    return PER_HEAD * max(n, 1)


def seoul_month(src: str, year: int, term: int) -> dict:
    """그 학기 서울시교육청 지원금을 학생마다 달 몫으로 돌린다."""
    house = defaultdict(list)
    for x in P.plan(src, year, term):
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
    """달마다 (재적 명단, 가구별 묶음, 서울 지원금) 을 낸다."""
    d = T.build(src)
    st = {s.student_id: s for s in d["students"]}

    last: dict[str, object] = {}
    first: dict[str, object] = {}
    for e in sorted(d["enrollments"], key=lambda e: T.sem_index(e.year, e.term)):
        first.setdefault(e.student_id, e)
        last[e.student_id] = e

    kind_of = {sid: ("신규" if (e.year, e.term) == (base_year, base_term) else "기존")
               for sid, e in first.items()}
    seoul_of = {sid: (T.s(st[sid].home_region) == "서울") for sid in st}

    pay_cache: dict[tuple[int, int], dict] = {}
    out = []
    for i in range(months):
        y, m = divmod((start.year * 12 + start.month - 1) + i, 12)
        m += 1
        day = dt.date(y, m, 1)
        last_day = dt.date(y, m, calendar.monthrange(y, m)[1])

        alive = []
        for sid, e in last.items():
            if e.start_date and e.start_date > last_day:
                continue
            if e.end_date and e.end_date < day:
                continue
            alive.append((sid, e))

        groups = defaultdict(list)
        for sid, e in alive:
            groups[(st[sid].household_id, e.residence or "(빈칸)")].append(
                (sid, e, kind_of[sid]))

        sem = T.sem_of(day)
        if sem not in pay_cache:
            pay_cache[sem] = seoul_month(src, *sem)
        out.append((day, alive, groups, st, seoul_of, pay_cache[sem]))
    return out


# ── 시트 그리기 도구 ────────────────────────────────────────────────────────

def put_head(ws, head, width, fills=None):
    for c, h in enumerate(head, start=1):
        cell = ws.cell(1, c, h)
        cell.font = Font(name=FONT, size=10, bold=True)
        cell.fill = (fills or {}).get(c, HEAD)
        cell.border = BOX
        cell.alignment = Alignment(horizontal="center", vertical="center",
                                   wrap_text=True)
        ws.column_dimensions[get_column_letter(c)].width = width[c - 1]
    ws.row_dimensions[1].height = 30


def put_row(ws, r, vals, money=(), left_cols=(), fills=None):
    for c, v in enumerate(vals, start=1):
        cell = ws.cell(r, c, v)
        cell.font = Font(name=FONT, size=10)
        cell.border = BOX
        cell.alignment = Alignment(
            horizontal="left" if c in left_cols else "center", vertical="center")
        if c in money:
            cell.number_format = "#,##0"
        if fills and c in fills:
            cell.fill = fills[c]


def put_sum(ws, r, ncol, sum_cols, label="합계", first=2):
    ws.cell(r, 1, label)
    for c in sum_cols:
        L = get_column_letter(c)
        cell = ws.cell(r, c, f"=SUM({L}{first}:{L}{r - 1})")
        cell.number_format = "#,##0"
    for c in range(1, ncol + 1):
        ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
        ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
        ws.cell(r, c).alignment = Alignment(horizontal="center", vertical="center")


# ── 시트 ────────────────────────────────────────────────────────────────────

def sheet_month(ws, roll_out, has_home):
    head = ["달", "재적 인원", "기존", "신규",
            "도교육청 유학경비", "기존 몫", "신규 몫",
            "가족체류형 인원", "1자녀 가구", "2자녀 가구", "3자녀 이상 가구",
            "가족체류형 금액", "유학센터형 인원", "유학센터형 금액"]
    width = [11, 10, 8, 8, 17, 16, 16, 13, 11, 11, 13, 15, 13, 15]
    if has_home:
        head += ["홈스테이형 인원", "홈스테이형 금액"]
        width += [13, 15]
    head += ["서울 지원 인원", "서울시교육청 지원금", "총 지원액"]
    width += [13, 18, 17]
    n = len(head)
    put_head(ws, head, width,
             {n - 2: SEOUL, n - 1: SEOUL, n: SUMF})

    money = {5, 6, 7, 12, 14, n - 1, n} | ({16} if has_home else set())
    for i, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        people = [m for ms in groups.values() for m in ms]
        by_res = defaultdict(lambda: [0, 0])                   # 인원, 금액
        tier = defaultdict(int)                                # 가족체류형 가구 크기
        for (hid, res), members in groups.items():
            by_res[res][0] += len(members)
            by_res[res][1] += month_rate(res, len(members))
            if res == "가족체류형":
                tier[min(len(members), 3)] += 1
        kind = sum_by(groups, lambda sid, e, k: k)
        do = sum(v[1] for v in by_res.values())
        pay = sum(pay_of.get(sid, 0) for sid, _, _ in people)

        vals = [f"{day.year}. {day.month:>2}월", len(alive),
                sum(1 for _, _, k in people if k == "기존"),
                sum(1 for _, _, k in people if k == "신규"),
                do, kind["기존"], kind["신규"],
                by_res["가족체류형"][0], tier[1], tier[2], tier[3],
                by_res["가족체류형"][1],
                by_res["유학센터형"][0], by_res["유학센터형"][1]]
        if has_home:
            vals += [by_res["홈스테이형"][0], by_res["홈스테이형"][1]]
        vals += [sum(1 for sid, _, _ in people if sid in pay_of), pay, do + pay]
        put_row(ws, 2 + i, vals, money=money,
                fills={n - 2: SEOUL, n - 1: SEOUL, n: SUMF})

    put_sum(ws, 2 + len(roll_out), n, sorted(money))
    ws.freeze_panes = "B2"


def sheet_kind(ws, roll_out):
    """기존 / 신규 두 갈래. 서울 지원금은 원적이 걸리므로 여기에만 나온다."""
    months = [d for d, *_ in roll_out]
    head = ["구분", "값"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    put_head(ws, head, [9, 20] + [15] * (len(months) + 1))

    rows = defaultdict(lambda: [0] * len(months))
    for j, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        kind = sum_by(groups, lambda sid, e, k: k)
        for ms in groups.values():
            for sid, e, k in ms:
                rows[(k, "인원")][j] += 1
                rows[(k, "서울 원적 인원")][j] += 1 if seoul_of[sid] else 0
                rows[(k, "서울시교육청 지원금")][j] += pay_of.get(sid, 0)
        for k in ("기존", "신규"):
            rows[(k, "도교육청 유학경비")][j] = kind[k]
            rows[(k, "총 지원액")][j] = kind[k] + rows[(k, "서울시교육청 지원금")][j]

    labels = ["인원", "서울 원적 인원", "도교육청 유학경비",
              "서울시교육청 지원금", "총 지원액"]
    r = 2
    for label in labels:
        head_count = label.endswith("인원")
        for k in ("기존", "신규"):
            put_row(ws, r, [k, label] + rows[(k, label)]
                    + [rows[(k, label)][0] if head_count else None],
                    money={} if head_count else set(range(3, len(head) + 1)))
            if not head_count:
                L1, L2 = get_column_letter(3), get_column_letter(2 + len(months))
                ws.cell(r, len(head), f"=SUM({L1}{r}:{L2}{r})").number_format = "#,##0"
            r += 1
        ws.cell(r, 2, label)
        for c in range(3, len(head) + 1):
            L = get_column_letter(c)
            ws.cell(r, c, f"=SUM({L}{r - 2}:{L}{r - 1})").number_format = "#,##0"
        for c in range(1, len(head) + 1):
            ws.cell(r, c).font = Font(name=FONT, size=10, bold=True)
            ws.cell(r, c).fill, ws.cell(r, c).border = SUMF, BOX
            ws.cell(r, c).alignment = Alignment(horizontal="center",
                                                vertical="center")
        ws.cell(r, 1, "합계")
        r += 2
    ws.freeze_panes = "C2"


def sheet_house(ws, roll_out):
    """가구 구성 — 1자녀와 다자녀가 각각 몇 가구이고 얼마인지."""
    day, alive, groups, st, seoul_of, pay_of = roll_out[0]
    n = len(roll_out)
    head = ["거주 유형", "가구 구성", "1자녀 / 다자녀", "가구 수", "학생 수",
            "월 단가", "월 금액", f"{n}개월 금액", "비고"]
    put_head(ws, head, [12, 11, 13, 9, 9, 12, 15, 16, 28])

    tier = defaultdict(lambda: [0, 0])
    center = [0, 0]
    for (hid, res), members in groups.items():
        if res == "가족체류형":
            k = min(len(members), 4)
            tier[k][0] += 1
            tier[k][1] += len(members)
        else:
            center[0] += 1
            center[1] += len(members)

    r = 2
    for k in sorted(tier):
        houses, kids = tier[k]
        rate = month_rate("가족체류형", k)
        put_row(ws, r, ["가족체류형", f"{k}자녀" + ("↑" if k >= 4 else ""),
                        "1자녀" if k == 1 else "다자녀",
                        houses, kids, rate, rate * houses, rate * houses * n,
                        "3자녀 이상은 단가가 같다" if k >= 3 else ""],
                money={6, 7, 8}, left_cols={9})
        r += 1
    if center[0]:
        put_row(ws, r, ["유학센터형", "1명당", "—", None, center[1], PER_HEAD,
                        PER_HEAD * center[1], PER_HEAD * center[1] * n,
                        "가구로 묶지 않고 사람마다 나간다"],
                money={6, 7, 8}, left_cols={9})
        r += 1

    put_sum(ws, r, len(head), [4, 5, 7, 8])

    r += 2
    one = tier[1][0]
    many = sum(v[0] for k, v in tier.items() if k >= 2)
    ws.cell(r, 1, f"가족체류형 {one + many}가구 가운데 1자녀 {one}가구 · "
                  f"다자녀 {many}가구입니다.")
    ws.cell(r, 1).font = Font(name=FONT, size=10)
    ws.freeze_panes = "A2"


def sheet_region(ws, roll_out):
    months = [d for d, *_ in roll_out]
    head = ["시군", "구분"] + [f"{d.year}. {d.month}월" for d in months] + ["합계"]
    put_head(ws, head, [10, 9] + [15] * (len(months) + 1))

    table = defaultdict(lambda: defaultdict(int))
    for j, (day, alive, groups, st, seoul_of, pay_of) in enumerate(roll_out):
        for (region, kind), amt in sum_by(
                groups, lambda sid, e, k: (e.region or "(빈칸)", k)).items():
            table[region][(kind, j)] += amt

    order = sorted(table, key=lambda k: -sum(table[k].values()))
    r = 2
    for region in order:
        for kind in ("기존", "신규"):
            put_row(ws, r, [region if kind == "기존" else None, kind]
                    + [table[region][(kind, j)] for j in range(len(months))]
                    + [None], money=set(range(3, len(head) + 1)))
            L1, L2 = get_column_letter(3), get_column_letter(2 + len(months))
            ws.cell(r, len(head), f"=SUM({L1}{r}:{L2}{r})").number_format = "#,##0"
            r += 1
        ws.merge_cells(start_row=r - 2, start_column=1, end_row=r - 1, end_column=1)
    put_sum(ws, r, len(head), range(3, len(head) + 1))
    ws.freeze_panes = "C2"


def sheet_basis(ws, roll_out):
    """첫 달 기준으로 가구마다 어떻게 셈했는지 풀어 둔다."""
    day, alive, groups, st, seoul_of, pay_of = roll_out[0]
    n = len(roll_out)
    head = ["가구", "시군", "유학학교", "학생", "구분", "거주유형", "가구 구성",
            "가구 월 단가", "학생 몫", "원적", "서울 지원금", "월 합계",
            f"{n}개월", "셈법"]
    put_head(ws, head, [9, 8, 12, 10, 7, 11, 10, 13, 12, 8, 13, 13, 13, 34],
             {10: SEOUL, 11: SEOUL})

    r = 2
    for (hid, res), members in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        rate = month_rate(res, len(members))
        part = share(res, members)
        for i, (sid, e, kind) in enumerate(members):
            if i:
                how = ""
            elif res == "가족체류형":
                how = (f"{'1자녀' if len(members) == 1 else f'{len(members)}자녀'} "
                       f"가구 → {rate:,}원/월")
            else:
                how = f"{res} {len(members)}명 × {PER_HEAD:,}원/월"
            pay = pay_of.get(sid, 0)
            put_row(ws, r,
                    [hid, e.region, e.school, st[sid].name, kind, res,
                     f"{len(members)}자녀" if res == "가족체류형" else f"{len(members)}명",
                     rate if not i else None, part[sid],
                     "서울" if seoul_of[sid] else "서울 외", pay, part[sid] + pay,
                     (part[sid] + pay) * n, how],
                    money={8, 9, 11, 12, 13}, left_cols={14},
                    fills={10: SEOUL, 11: SEOUL})
            r += 1
    ws.freeze_panes = "A2"


def main(src: str, out: str, start_text: str = "2026-09", months: str = "6") -> int:
    y, m = (int(x) for x in start_text.split("-"))
    # 시작 달이 든 학기를 기준 학기로 삼는다 — 그 학기에 처음 온 학생이 신규다
    base_year, base_term = T.sem_of(dt.date(y, m, 1))
    roll_out = roll(src, dt.date(y, m, 1), int(months), base_year, base_term)
    has_home = any(res == "홈스테이형"
                   for _, _, groups, *_ in roll_out for _, res in groups)

    wb = openpyxl.Workbook()
    sheet_month(wb.active, roll_out, has_home)
    wb.active.title = "월별 예상"
    sheet_house(wb.create_sheet("가구 구성"), roll_out)
    sheet_kind(wb.create_sheet("기존·신규"), roll_out)
    sheet_region(wb.create_sheet("시군별"), roll_out)
    sheet_basis(wb.create_sheet("산출 근거"), roll_out)
    wb.save(out)

    print(f"저장: {out}")
    print(f"  기준 학기 {base_year}학년도 {base_term}학기 — "
          f"이 학기에 처음 온 학생이 신규입니다")
    acc = defaultdict(int)
    for day, alive, groups, st, seoul_of, pay_of in roll_out:
        people = [m for ms in groups.values() for m in ms]
        do = sum(month_rate(res, len(v)) for (h, res), v in groups.items())
        pay = sum(pay_of.get(sid, 0) for sid, _, _ in people)
        kind = sum_by(groups, lambda sid, e, k: k)
        for key, v in (("도", do), ("서울", pay),
                       ("기존", kind["기존"]), ("신규", kind["신규"])):
            acc[key] += v
        print(f"  {day.year}. {day.month:>2}월  재적 {len(alive):>3}명 · "
              f"도교육청 {do:>12,} ＋ 서울 {pay:>10,} = {do + pay:>12,}원")
    print(f"  {int(months)}개월 도교육청 유학경비 {acc['도']:,}원 "
          f"(기존 {acc['기존']:,} ＋ 신규 {acc['신규']:,})")
    print(f"  {int(months)}개월 서울시교육청 지원금 {acc['서울']:,}원")
    print(f"  {int(months)}개월 총 지원액 {acc['도'] + acc['서울']:,}원")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
