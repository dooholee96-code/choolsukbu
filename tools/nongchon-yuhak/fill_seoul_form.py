"""서울시교육청 참가자 명단 서식에 우리 명단을 채운다.

  python fill_seoul_form.py <원본.xlsx> <서식.xlsx> <출력.xlsx> [지난제출본.xlsx]

서식의 열 차례를 그대로 두고 값만 넣는다. 서식 자체(제목·머리글·예시 줄)는
건드리지 않는다.

지원금 대상 여부는 서울시교육청 기준('26. 3. 1.)으로 판정한다.

  지원대상  초1 ~ 중2 · 가족체류형 또는 유학센터형
  지원기간  최대 1년 — 최초 참여 학년도가 기준 학년도와 같아야 한다
  가구 단위  가족체류형은 가구당 유학생 수로 차등하므로, 형제자매가 먼저
             받았으면 뒤에 온 동생은 대상이 아니다

지난 학기 제출본을 같이 주면, 명단에 비어 있는 '원 교육지원청' 을 거기서 가져와
메운다. 우리가 지어내는 값이 아니라 담당자가 이미 서울에 낸 값이라 믿을 수 있다.

원 소속교가 사립초·해외 학교·유치원(예비초)이면 서울시교육청이 미지원으로
처리해 왔다. 그건 이름만으로 확실히 가릴 수 없어 '확인' 으로 남기고 사람이
정하게 한다 — 틀린 ○ 보다 확인 요청이 낫다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill

import transform as T

FONT = "맑은 고딕"
HOLD = PatternFill("solid", fgColor="FFF2CC")     # 사람이 확인할 칸
PLAN = PatternFill("solid", fgColor="F2F2F2")     # 아직 연장 입력 전인 줄

# 서식 머리글 → 우리 값을 어떻게 넣을지. 서식 열 차례는 그대로 둔다.
HEAD_ROW = 4
FIRST_EXAMPLE, LAST_EXAMPLE = 5, 7                # '예시' 세 줄
FIRST_DATA = 8

# 도교육청 발표 자료의 시군 차례. 제출 자료도 이 차례를 따른다.
REGION_ORDER = ["군산", "익산", "정읍", "남원", "김제", "완주", "진안",
                "무주", "장수", "임실", "순창", "고창", "부안"]

MAX_GRADE = "중2"                                 # 서울 지원 대상 상한
OK_RESIDENCE = {"가족체류형", "유학센터형"}       # 홈스테이형은 서울 지원 대상이 아니다


# 원 소속교는 원본에 적힌 그대로 쓴다. 서울 공립초는 '서울관악초' 처럼 '서울' 이
# 정식 교명에 들어가는 곳이 많아, 접두사를 떼면 오히려 약칭이 된다. 원본 표기가
# 갈리는 것은 명단에서 바로잡아야 할 일이지 여기서 손댈 일이 아니다.


def read_prev(path: str):
    """지난 학기 제출본에서 (성명, 연락처) → 원 교육지원청 을 읽는다."""
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    head = next((r for r in range(1, 12)
                 if T.s(ws.cell(r, 11).value) == "원 교육지원청"), None)
    if head is None:
        return {}
    out = {}
    for r in range(head + 1, ws.max_row + 1):
        nm, ph = T.s(ws.cell(r, 5).value), T.s(ws.cell(r, 10).value)
        off = T.s(ws.cell(r, 11).value)
        # '기타' 도 담당자가 실제로 적어 낸 값이라 그대로 가져온다
        if nm and off:
            out[(nm, ph)] = off
    return out


def collect(src: str, base_year: int, base_term: int):
    """기준 학기에 참가하는 서울 원적 학생을 모은다."""
    d = T.build(src)
    ws = T.find_sheet(openpyxl.load_workbook(src, data_only=True))

    # 원본에 적힌 '현재 학년' 을 쓴다. 예비유학생처럼 계산으로 못 잡는 예외가 있어
    # 담당자가 관리하는 값이 진실이다.
    listed_grade, listed_office = {}, {}
    for r in range(T.FIRST_DATA_ROW, ws.max_row + 1):
        nm = T.s(ws.cell(r, T.COL["성명"]).value)
        ph = T.s(ws.cell(r, T.COL["보호자연락처"]).value)
        if not nm:
            continue
        g = T.s(ws.cell(r, T.COL["현재학년"]).value)
        if g:
            listed_grade[(nm, ph)] = g
        o = T.s(ws.cell(r, T.COL["원소속청"]).value)
        if o:
            listed_office[(nm, ph)] = o

    first, last = {}, {}
    for e in sorted(d["enrollments"], key=lambda e: T.sem_index(e.year, e.term)):
        first.setdefault(e.student_id, e)
        last[e.student_id] = e

    idx = T.sem_index(base_year, base_term)
    joined = {e.student_id for e in d["enrollments"]
              if T.sem_index(e.year, e.term) == idx}
    # 앞 학기를 끝까지 다닌 학생은 이어질 것으로 본다(연장 입력 전이라 줄이 없다)
    staying = {e.student_id for e in d["enrollments"]
               if T.sem_index(e.year, e.term) == idx - 1
               and (e.end_date is None or e.end_date >= e.term_end)}

    rows = []
    for st in d["students"]:
        if T.s(st.home_region) != "서울" or st.student_id not in first:
            continue
        confirmed = st.student_id in joined
        if not confirmed and st.student_id not in staying:
            continue
        f, l = first[st.student_id], last[st.student_id]
        key = (st.name, T.s(st.guardian_phone))
        rows.append(dict(
            sid=st.student_id, name=st.name,
            region=l.region, school=l.school,
            grade=listed_grade.get(key) or l.grade,
            gender=st.gender, residence=l.residence,
            guardian=st.guardian, phone=T.s(st.guardian_phone),
            office=listed_office.get(key) or T.s(st.home_office),
            home_school=T.s(st.home_school),
            home_school_raw=T.s(st.home_school),
            first_year=f.year, first_term=f.term,
            household=st.household_id, confirmed=confirmed,
        ))

    # 가구 안에서 누가 먼저 왔는지 — 형제자매 기참여 판정에 쓴다
    house_first = {}
    for st in d["students"]:
        if st.student_id in first:
            i = T.sem_index(*[first[st.student_id].year, first[st.student_id].term])
            k = st.household_id
            if k not in house_first or i < house_first[k][0]:
                fe = first[st.student_id]
                house_first[k] = (i, st.name, T.sem_label(fe.year, fe.term))

    size = {}
    for x in rows:
        size[x["household"]] = size.get(x["household"], 0) + 1
    for x in rows:
        x["house_first"] = house_first.get(x["household"])
        x["household_size"] = size.get(x["household"], 1)
    rows.sort(key=lambda x: (REGION_ORDER.index(x["region"])
                            if x["region"] in REGION_ORDER else 99,
                            x["school"] or "", x["name"]))
    return rows


def judge(x, base_year, base_term):
    """지원금 대상 여부와 그 근거."""
    my = T.sem_index(x["first_year"], x["first_term"])
    base = T.sem_index(base_year, base_term)

    if x["first_year"] != base_year:
        return "×", f"최초 참여 {x['first_year']}학년도 — 1년 초과"
    if x["residence"] not in OK_RESIDENCE:
        return "×", f"거주 유형 {x['residence']} — 서울 지원 대상 아님"
    if x["grade"] and T.GRADE_INDEX.get(x["grade"], 99) > T.GRADE_INDEX[MAX_GRADE]:
        return "×", f"{x['grade']} — 지원 대상은 초1~중2"
    # 형제자매가 먼저 왔으면 가구 단위 1년을 이미 썼을 수 있다. 다만 그 형제가
    # 실제로 지원금을 받았는지는 지급 이력을 봐야 알 수 있어 단정하지 않는다 —
    # 민성주(2025-2학기 참여)의 동생 민주성에게 담당자가 ○ 를 준 사례가 있다.
    hf = x["house_first"]
    if hf and hf[0] < my:
        return "확인", f"형제자매 {hf[1]} 가 {hf[2]} 에 먼저 참여 — 기지급이면 ×"

    raw = x["home_school_raw"] or ""
    if "사립" in raw:
        return "×", f"원 소속교 '{raw}' — 사립초는 서울시교육청 미지원"
    if not raw or "유치원" in raw:
        # 형제자매가 같은 학기에 함께 오면 가구 단위로 대상이 된다(금액은 대표 1명).
        # 혼자 온 예비초는 담당자가 미지원으로 처리해 왔다.
        if x["household_size"] > 1:
            return "○", ""
        return "확인", "원 소속교가 비어 있거나 유치원 — 혼자면 예비초로 미지원"
    if not raw.endswith(("초", "중")):
        return "확인", f"원 소속교 '{raw}' 가 서울 공립 초·중으로 보이지 않음"
    return "○", ""


def main(src_path: str, form_path: str, out_path: str,
         prev_path: str | None = None) -> int:
    src = Path(src_path).read_text().strip() if src_path.endswith(".txt") else src_path
    base_year, base_term = T.CURRENT_YEAR, T.CURRENT_TERM + 1
    if base_term > 2:
        base_year, base_term = base_year + 1, 1

    rows = collect(src, base_year, base_term)

    # 빈 '원 교육지원청' 을 지난 제출본에서 메운다. 값이 다른 칸은 손대지 않고 알린다.
    prev = read_prev(prev_path) if prev_path else {}
    filled, clash = 0, []
    for x in rows:
        got = prev.get((x["name"], x["phone"]))
        if not got:
            continue
        if not x["office"]:
            x["office"] = got
            filled += 1
        elif x["office"] != got:
            clash.append(f"{x['name']} 명단 {x['office']} ≠ 지난 제출본 {got}")

    wb = openpyxl.load_workbook(form_path)
    ws = wb[wb.sheetnames[0]]

    counts = {"○": 0, "×": 0, "확인": 0}
    for i, x in enumerate(rows):
        r = FIRST_DATA + i
        mark, why = judge(x, base_year, base_term)
        counts[mark] += 1
        note = []
        if not x["confirmed"]:
            note.append("2학기 연장 예정(입력 전)")
        hf = x["house_first"]
        if (hf and x["household"] and "형제자매" not in why
                and sum(1 for y in rows if y["household"] == x["household"]) > 1):
            note.append("형제자매")
        if why:
            note.append(why)

        vals = [
            i + 1, "전북", x["region"], x["school"], x["name"], x["grade"],
            x["gender"], x["residence"], x["guardian"], x["phone"],
            x["office"], x["home_school"],
            f"{x['first_year']}. {x['first_term']}학기",
            " / ".join(note), mark,
        ]
        for c, v in enumerate(vals, start=1):
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=10,
                             bold=(c == 15 and mark != "○"))
            cell.alignment = Alignment(
                horizontal="left" if c in (14,) else "center",
                vertical="center", wrap_text=(c == 14))
            if mark == "확인" and c == 15:
                cell.fill = HOLD
            elif not x["confirmed"]:
                cell.fill = PLAN

    # 남은 빈 줄의 연번은 지운다 — 몇 명인지 헷갈리지 않게
    for r in range(FIRST_DATA + len(rows), ws.max_row + 1):
        if ws.cell(r, 1).value is not None:
            ws.cell(r, 1).value = None

    wb.save(out_path)
    print(f"저장: {out_path}")
    print(f"  {base_year}학년도 {base_term}학기 · 서울 원적 참가자 {len(rows)}명")
    print(f"  지원 대상 ○ {counts['○']}명 · × {counts['×']}명 · 확인 {counts['확인']}명")
    print(f"  이 중 2학기 줄이 아직 없는(연장 예정) 학생 "
          f"{sum(1 for x in rows if not x['confirmed'])}명 — 회색으로 칠했습니다")
    blank = sum(1 for x in rows if not x["office"])
    if prev:
        print(f"  원 교육지원청 {filled}칸을 지난 제출본에서 가져왔습니다")
    if blank:
        print(f"  원 교육지원청이 아직 빈 줄 {blank}개 — 손으로 채워 주세요")
    for c in clash:
        print("  ! 원 교육지원청이 지난 제출본과 다릅니다:", c)
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:5]))
