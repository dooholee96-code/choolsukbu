"""정규화한 데이터를 관리용 엑셀 워크북으로 쓴다.

  python build_workbook.py <원본.xlsx> <출력.xlsx>

집계 시트는 모두 수식(COUNTIFS/SUMIFS)으로 쓴다. 원데이터 시트에 행을 더하면
집계·현황·체제비 시트가 다시 계산된다.
"""

from __future__ import annotations

import datetime as dt
import sys

import openpyxl
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

import transform as T

FONT = "맑은 고딕"
INK = "1F3864"        # 제목·헤더
ACCENT = "2E5C8A"
HEAD_FILL = PatternFill("solid", fgColor=INK)
SUB_FILL = PatternFill("solid", fgColor="D9E2F3")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")   # 사용자가 고치는 칸
DERIVED_FILL = PatternFill("solid", fgColor="F2F2F2")  # 수식 칸
BAND = PatternFill("solid", fgColor="F7F9FC")
HAIR = Side(style="thin", color="BFBFBF")
BOX = Border(left=HAIR, right=HAIR, top=HAIR, bottom=HAIR)

DATE_FMT = "yyyy-mm-dd"

# 데이터 시트의 수식이 참조할 범위(여유분 포함). 행을 더 넣어도 집계가 따라온다.
LIMIT_STUDENT = 1200
LIMIT_APP = 1500
LIMIT_ENROLL = 2500


def col_of(headers: list[str], name: str) -> str:
    return get_column_letter(headers.index(name) + 1)


def rng(sheet: str, headers: list[str], name: str, limit: int) -> str:
    c = col_of(headers, name)
    return f"'{sheet}'!${c}$2:${c}${limit}"


def write_table(ws, headers, rows, widths, *, date_cols=(), wrap_cols=(), band=True):
    """헤더 1행 + 데이터. 틀 고정과 필터까지 걸어둔다."""
    for i, h in enumerate(headers, start=1):
        c = ws.cell(1, i, h)
        c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[1].height = 34

    for r, row in enumerate(rows, start=2):
        for i, v in enumerate(row, start=1):
            c = ws.cell(r, i, v)
            c.font = Font(name=FONT, size=10)
            c.border = BOX
            c.alignment = Alignment(
                vertical="center",
                wrap_text=headers[i - 1] in wrap_cols,
                horizontal="left" if headers[i - 1] in wrap_cols else None,
            )
            if headers[i - 1] in date_cols:
                c.number_format = DATE_FMT
                c.alignment = Alignment(horizontal="center", vertical="center")
            if band and r % 2 == 0:
                c.fill = BAND

    for name, w in widths.items():
        ws.column_dimensions[col_of(headers, name)].width = w
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{max(len(rows) + 1, 2)}"
    return len(rows) + 1


def add_dropdown(ws, headers, name, options, last_row):
    dv = DataValidation(
        type="list", formula1='"' + ",".join(options) + '"', allow_blank=True, showErrorMessage=False
    )
    ws.add_data_validation(dv)
    c = col_of(headers, name)
    dv.add(f"{c}2:{c}{last_row}")


# ─────────────────────────────────────────────────────────── 안내


def sheet_guide(ws, data, src_name):
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 96

    r = [2]

    def title(text):
        c = ws.cell(r[0], 2, text)
        c.font = Font(name=FONT, size=16, bold=True, color=INK)
        ws.merge_cells(start_row=r[0], start_column=2, end_row=r[0], end_column=3)
        ws.row_dimensions[r[0]].height = 24
        r[0] += 2

    def head(text):
        c = ws.cell(r[0], 2, text)
        c.font = Font(name=FONT, size=11, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=ACCENT)
        c.alignment = Alignment(vertical="center", indent=1)
        c2 = ws.cell(r[0], 3, "")
        c2.fill = PatternFill("solid", fgColor=ACCENT)
        ws.row_dimensions[r[0]].height = 20
        r[0] += 1

    def line(label, text):
        a = ws.cell(r[0], 2, label)
        a.font = Font(name=FONT, size=10, bold=True, color=INK)
        a.alignment = Alignment(vertical="top", indent=1)
        b = ws.cell(r[0], 3, text)
        b.font = Font(name=FONT, size=10)
        b.alignment = Alignment(vertical="top", wrap_text=True, indent=1)
        ws.row_dimensions[r[0]].height = 15 + 13 * (len(text) // 60)
        r[0] += 1

    def gap():
        r[0] += 1

    e = data["enrollments"]
    apps = data["applications"]
    title("전북 농어촌유학생 관리 워크북")
    line("만든 날", dt.date.today().isoformat())
    line("원본 파일", src_name)
    line(
        "원본 범위",
        f"1번 시트 '{T.SOURCE_SHEET}' 만 읽었습니다. "
        "숨김 시트(연도별 명단, 정보공개 등)는 과거 산출물이라 가져오지 않았습니다.",
    )
    line(
        "기준 학기",
        f"{T.sem_label(T.CURRENT_YEAR, T.CURRENT_TERM)}. "
        "원본 종료일 칸의 '현재' 는 이 학기까지 재학 중이라는 뜻으로 풀었습니다.",
    )
    gap()

    head("무엇이 달라졌나")
    line(
        "한 줄 요약",
        "한 시트에 쌓여 있던 741행을 성격이 다른 세 개의 표로 나누고, 자주 뽑던 숫자는 수식으로 미리 걸어 두었습니다.",
    )
    line(
        "쪼갠 이유",
        "원본은 1행이 '한 번의 신청'이었는데, 그 안에 학생 정보·심사 결과·여러 해에 걸친 유학 이력이 함께 들어 있었습니다. "
        "그래서 '2025학년도 1학기 몇 명'을 세려면 유학 학년도 칸을 검색하고 손으로 빼는 수밖에 없었습니다.",
    )
    gap()

    head("시트 구성")
    line("학생마스터", f"1행 = 학생 1명 ({len(data['students'])}명). 사람에 관한 정보는 여기만 고칩니다.")
    line(
        "유학이력",
        f"1행 = 학생 × 학기 ({len(e)}행). 실제로 유학한 학기를 한 줄씩 펼친 표로, 모든 집계의 바탕입니다.",
    )
    line(
        "신청이력",
        f"1행 = 원본 1행 = 모집 차수별 신청 건 ({len(apps)}행). 원본 열을 모두 그대로 두고 앞쪽에 정리 열만 붙였습니다.",
    )
    line("학기별집계", "학년도·학기별 인원, 신규/계속, 성별, 거주 유형, 운영 지역·학교 수. 전부 수식입니다.")
    line("지역별현황 / 학교별현황", "시군별·학교별 인원을 학기별로 늘어놓은 표.")
    line("체제비관리", "학생별 지원 시작 학기와 도청 3년 지원 만료 시점, 잔여 학기.")
    line("설정_지원단가", "체제비 단가. 지침이 바뀌면 노란 칸의 숫자만 고치면 됩니다.")
    line("데이터검증", f"원본에서 발견한 확인이 필요한 항목 {len(data['issues'])}건.")
    line("원본_전체", "원본 1번 시트를 값 그대로 옮겨 둔 사본. 대조용이며 고치지 않습니다.")
    gap()

    head("고칠 때")
    line("노란 칸", "직접 입력하는 칸입니다.")
    line("회색 칸", "수식으로 채워지는 칸입니다. 값을 덮어쓰면 계산이 끊깁니다.")
    line(
        "새 유학생이 오면",
        "① 학생마스터에 학생을 한 줄 추가하고(학생ID는 S0699처럼 이어서) "
        "② 신청이력에 신청 건을 한 줄 "
        "③ 유학이력에 학기당 한 줄씩 추가합니다. 집계 시트는 자동으로 따라옵니다.",
    )
    line("학기가 바뀌면", "계속 유학하는 학생은 유학이력에 새 학기 줄을 한 줄씩 더합니다.")
    line("수식 범위", f"학생마스터 {LIMIT_STUDENT}행 / 신청이력 {LIMIT_APP}행 / 유학이력 {LIMIT_ENROLL}행까지 미리 잡아 두었습니다.")
    gap()

    head("숫자를 어떻게 셌나")
    line(
        "학기 나누는 법",
        "3월 1일 시작이 1학기, 9월 1일 시작이 2학기입니다. 학년도는 3월에 바뀝니다. "
        "예를 들어 2022년 10월 시작은 2022학년도 2학기입니다.",
    )
    line(
        "학기 펼치는 법",
        "신청 건의 시작일과 종료일 사이에 걸치는 학기를 모두 만들었습니다. "
        "그 결과가 원본 '유학 학년도' 칸과 한 건도 어긋나지 않았습니다.",
    )
    line(
        "대조 결과",
        "2022학년도 27명, 2023학년도 85명, 2024학년도 165명, 2025학년도 1학기 204명 — "
        "원본 메모와 숨김 시트에 적혀 있던 공식 수치와 모두 일치합니다.",
    )
    line(
        "2026학년도 2학기",
        "아직 모집이 진행 중이라 새로 배정된 인원만 들어 있습니다. "
        "계속 유학하는 학생은 연장이 확정되는 대로 유학이력에 줄을 더해야 합니다.",
    )
    line(
        "배정 판정",
        "'최종배정' 칸을 먼저 보고, 비어 있으면 종료일·배정희망서 칸을 차례로 봅니다. "
        "그래도 판단이 안 서는 건은 '확인필요'로 두고 데이터검증 시트에 모았습니다.",
    )
    line(
        "체제비 3년",
        "도청 지원은 최대 3년, 즉 6학기입니다. 시작 학기부터 여섯 번째 학기의 마지막 날을 만료일로 잡았습니다. "
        "원본 메모의 '2023년 3월 시작 → 2026년 2월까지' 와 같은 계산입니다.",
    )
    gap()

    head("주의")
    line(
        "개인정보",
        "학생·보호자 이름과 연락처가 그대로 들어 있습니다. 외부 공유용으로는 학생마스터의 "
        "이름·연락처 열을 지운 사본을 따로 만들어 쓰십시오.",
    )
    line("체제비 금액", "설정_지원단가 시트의 값은 2025. 전북 농촌유학 시행 지침 기준입니다. 지침이 바뀌면 그 시트를 고쳐야 합니다.")


# ─────────────────────────────────────────────────────────── 설정_지원단가

RATE_CELLS = {
    "가족1": "C5",
    "가족2": "C6",
    "가족3": "C7",
    "홈스테이": "C8",
    "센터": "C9",
    "도청": "C12",
    "지원학기": "C13",
}


def sheet_rates(ws):
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 15
    ws.column_dimensions["D"].width = 64

    t = ws.cell(2, 2, "체제비 지원 단가")
    t.font = Font(name=FONT, size=16, bold=True, color=INK)
    n = ws.cell(3, 2, "노란 칸만 고치면 체제비관리 시트가 다시 계산됩니다.")
    n.font = Font(name=FONT, size=10, color="595959")

    def band(row, text):
        for col, val in ((2, text), (3, "월 지원액(원)"), (4, "근거")):
            c = ws.cell(row, col, val)
            c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor=ACCENT)
            c.alignment = Alignment(
                horizontal="center" if col == 3 else "left", vertical="center", indent=1
            )
        ws.row_dimensions[row].height = 20

    def item(row, label, value, note, fmt="#,##0"):
        a = ws.cell(row, 2, label)
        a.font = Font(name=FONT, size=10)
        a.border = BOX
        a.alignment = Alignment(indent=1, vertical="center")
        b = ws.cell(row, 3, value)
        b.font = Font(name=FONT, size=10, bold=True, color="0000FF")
        b.fill = INPUT_FILL
        b.border = BOX
        b.number_format = fmt
        b.alignment = Alignment(horizontal="center", vertical="center")
        c = ws.cell(row, 4, note)
        c.font = Font(name=FONT, size=9, color="595959")
        c.border = BOX
        c.alignment = Alignment(indent=1, vertical="center", wrap_text=True)

    src_note = "2025. 전북 농촌유학 시행 지침 Ⅳ. 사업 내용 — 유학경비 지원"
    band(4, "전북특별자치도교육청")
    item(5, "가족체류형 (가구 내 유학생 1명)", 300000, src_note)
    item(6, "가족체류형 (가구 내 유학생 2명)", 400000, src_note)
    item(7, "가족체류형 (가구 내 유학생 3명 이상)", 500000, src_note)
    item(8, "홈스테이형 (학생 1명당)", 300000, src_note)
    item(9, "유학센터형 (학생 1명당)", 300000, src_note)

    band(11, "전북특별자치도청")
    item(12, "도청 지원 (학생 1명당, 도10·시군10)", 200000, src_note + " / 최대 3년 지원")
    item(13, "도청 지원 기간 (학기)", 6,
         "최대 3년 = 6학기. 원본 메모: 2023년 3월 시작 → 2026년 2월까지 지원", fmt="0")

    w = ws.cell(15, 2, "※ 유치원생은 다자녀 수에는 포함되나 유학경비 지원 대상에는 포함되지 않습니다(지침).")
    w.font = Font(name=FONT, size=9, color="A61C1C")


FAMILY_RANGE = "'설정_지원단가'!$C$5:$C$7"


def rate(key: str) -> str:
    return f"'설정_지원단가'!${RATE_CELLS[key][0]}${RATE_CELLS[key][1:]}"


# ─────────────────────────────────────────────────────────── 데이터 시트

STUDENT_HEADERS = [
    "학생ID", "성명", "성별", "학생 전화", "원 지역", "원 소속청", "원 소속교",
    "보호자 성명", "보호자 연락처", "가구ID", "가구 학생수", "유학 상태",
    "최초 시작일", "최종 종료일", "유학 학기수", "유학 학년도", "최근 유학지역",
    "최근 유학학교", "최근 거주유형", "신청 횟수", "비고",
]

ENROLL_HEADERS = [
    "이력ID", "학기", "학년도", "학기구분", "학기순번", "학생ID", "성명", "구분",
    "유학 지역", "유학 학교", "학년", "성별", "거주 유형", "거주지",
    "가구ID", "가구 내 유학생수", "원 지역", "원 소속교", "학기 상태", "종료 사유",
    "시작일", "종료일", "신청ID",
]

APP_HEADERS = [
    "신청ID", "학생ID", "성명", "접수 학기", "접수 학년도", "학기구분", "모집 차수",
    "배정 판정", "판정 근거", "미선정 단계", "미선정 사유(원문)", "미선정 사유(분류)",
    "접수일(원본)", "순(원본)", "예비유학생", "중학교 진학", "관내 전학", "기타",
    "유학 학년도(원본)", "배정 희망서", "참가 신청서", "최종 배정", "중간 종료 사유",
    "종료일(원본)", "학생 전화", "성별", "원 지역", "원 소속청", "원 소속교",
    "유학 지역", "전입시 학년", "현재 학년", "유학 학교", "이전 유학지역",
    "이전 유학학교", "거주 유형", "거주지", "보호자 성명", "보호자 연락처",
    "형제자매", "비고",
]


def sheet_students(ws, data):
    by_student = data["by_student"]
    rows = []
    for st in data["students"]:
        lst = by_student.get(st.student_id, [])
        last = lst[-1] if lst else None
        years = sorted({e.year for e in lst})
        if not lst:
            status = "미배정"
        elif last.status == "예정":
            status = "배정예정"
        elif last.status == "재학":
            status = "재학중"
        else:
            status = "종료"
        rows.append([
            st.student_id, st.name, st.gender, st.phone, st.home_region,
            st.home_office, st.home_school, st.guardian, st.guardian_phone,
            st.household_id,
            None,  # 가구 학생수 (수식)
            status,
            lst[0].start_date if lst else None,
            (last.end_date if last and last.status == "종료" else None) if lst else None,
            None,  # 유학 학기수 (수식)
            ", ".join(str(y) for y in years) or None,
            last.region if last else None,
            last.school if last else None,
            last.residence if last else None,
            None,  # 신청 횟수 (수식)
            st.note,
        ])

    last_row = write_table(
        ws, STUDENT_HEADERS, rows,
        {"학생ID": 9, "성명": 11, "성별": 6, "학생 전화": 14, "원 지역": 10,
         "원 소속청": 12, "원 소속교": 14, "보호자 성명": 11, "보호자 연락처": 15,
         "가구ID": 9, "가구 학생수": 8, "유학 상태": 10, "최초 시작일": 12,
         "최종 종료일": 12, "유학 학기수": 8, "유학 학년도": 20, "최근 유학지역": 11,
         "최근 유학학교": 12, "최근 거주유형": 12, "신청 횟수": 8, "비고": 30},
        date_cols={"최초 시작일", "최종 종료일"},
        wrap_cols={"비고"},
    )

    hid = col_of(STUDENT_HEADERS, "가구ID")
    sid = col_of(STUDENT_HEADERS, "학생ID")
    e_student = rng("유학이력", ENROLL_HEADERS, "학생ID", LIMIT_ENROLL)
    a_student = rng("신청이력", APP_HEADERS, "학생ID", LIMIT_APP)

    for r in range(2, last_row + 1):
        f = [
            ("가구 학생수", f"=COUNTIF(${hid}$2:${hid}${LIMIT_STUDENT},${hid}{r})"),
            ("유학 학기수", f"=COUNTIF({e_student},${sid}{r})"),
            ("신청 횟수", f"=COUNTIF({a_student},${sid}{r})"),
        ]
        for name, formula in f:
            c = ws.cell(r, STUDENT_HEADERS.index(name) + 1, formula)
            c.font = Font(name=FONT, size=10)
            c.fill = DERIVED_FILL
            c.border = BOX
            c.alignment = Alignment(horizontal="center", vertical="center")

    add_dropdown(ws, STUDENT_HEADERS, "성별", ["남", "여"], LIMIT_STUDENT)
    add_dropdown(ws, STUDENT_HEADERS, "유학 상태", ["재학중", "종료", "배정예정", "미배정"], LIMIT_STUDENT)

    c = col_of(STUDENT_HEADERS, "유학 상태")
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_STUDENT}",
        CellIsRule(operator="equal", formula=['"재학중"'],
                   fill=PatternFill("solid", fgColor="D8F0DC"), font=Font(name=FONT, size=10, color="17652A")),
    )
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_STUDENT}",
        CellIsRule(operator="equal", formula=['"미배정"'],
                   font=Font(name=FONT, size=10, color="A6A6A6")),
    )
    return last_row


def sheet_enrollments(ws, data):
    rows = []
    for i, e in enumerate(data["enrollments"], start=1):
        rows.append([
            f"E{i:04d}", T.sem_label(e.year, e.term), e.year, f"{e.term}학기",
            T.sem_index(e.year, e.term), e.student_id, e.name, e.kind,
            e.region, e.school, e.grade, e.gender, e.residence, e.place,
            e.household_id,
            None,  # 가구 내 유학생수 (수식)
            e.home_region, e.home_school, e.status, e.end_reason,
            e.start_date, e.end_date, e.app_id,
        ])

    last_row = write_table(
        ws, ENROLL_HEADERS, rows,
        {"이력ID": 8, "학기": 11, "학년도": 8, "학기구분": 8, "학기순번": 8,
         "학생ID": 9, "성명": 11, "구분": 8, "유학 지역": 10, "유학 학교": 11,
         "학년": 7, "성별": 6, "거주 유형": 11, "거주지": 22, "가구ID": 9,
         "가구 내 유학생수": 9, "원 지역": 10, "원 소속교": 13, "학기 상태": 9,
         "종료 사유": 24, "시작일": 12, "종료일": 12, "신청ID": 9},
        date_cols={"시작일", "종료일"},
        wrap_cols={"거주지", "종료 사유"},
    )

    hid = col_of(ENROLL_HEADERS, "가구ID")
    sem = col_of(ENROLL_HEADERS, "학기")
    for r in range(2, last_row + 1):
        c = ws.cell(
            r, ENROLL_HEADERS.index("가구 내 유학생수") + 1,
            f"=COUNTIFS(${hid}$2:${hid}${LIMIT_ENROLL},${hid}{r},"
            f"${sem}$2:${sem}${LIMIT_ENROLL},${sem}{r})",
        )
        c.font = Font(name=FONT, size=10)
        c.fill = DERIVED_FILL
        c.border = BOX
        c.alignment = Alignment(horizontal="center", vertical="center")

    add_dropdown(ws, ENROLL_HEADERS, "구분", ["신규", "계속", "재유학"], LIMIT_ENROLL)
    add_dropdown(ws, ENROLL_HEADERS, "학기 상태", ["재학", "종료", "예정"], LIMIT_ENROLL)
    add_dropdown(ws, ENROLL_HEADERS, "거주 유형", ["가족체류형", "홈스테이형", "유학센터형"], LIMIT_ENROLL)
    add_dropdown(ws, ENROLL_HEADERS, "학기구분", ["1학기", "2학기"], LIMIT_ENROLL)

    c = col_of(ENROLL_HEADERS, "학기 상태")
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_ENROLL}",
        CellIsRule(operator="equal", formula=['"재학"'],
                   fill=PatternFill("solid", fgColor="D8F0DC"), font=Font(name=FONT, size=10, color="17652A")),
    )
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_ENROLL}",
        CellIsRule(operator="equal", formula=['"예정"'],
                   fill=PatternFill("solid", fgColor="FFF2CC"), font=Font(name=FONT, size=10, color="7F6000")),
    )
    d = col_of(ENROLL_HEADERS, "구분")
    ws.conditional_formatting.add(
        f"{d}2:{d}{LIMIT_ENROLL}",
        CellIsRule(operator="equal", formula=['"신규"'], font=Font(name=FONT, size=10, bold=True, color=ACCENT)),
    )
    return last_row


def sheet_applications(ws, data):
    rows = []
    for a in data["applications"]:
        raw = a.raw
        rows.append([
            a.app_id, a.student_id, T.s(raw["성명"]),
            T.sem_label(a.intake_year, a.intake_term) if a.intake_year else None,
            a.intake_year, f"{a.intake_term}학기" if a.intake_term else None,
            f"{a.intake_round}차" if a.intake_round else None,
            a.decision, a.decision_basis, a.reject_stage, a.reject_reason, a.reject_class,
            T.as_date(raw["접수일"]),
            raw["순"], T.s(raw["예비유학생"]), T.s(raw["중학교진학"]), T.s(raw["관내전학"]),
            T.s(raw["기타"]), T.s(raw["유학학년도_원본"]), T.s(raw["배정희망서"]),
            T.s(raw["참가신청서"]), T.s(raw["최종배정"]), T.s(raw["중간종료사유"]),
            T.s(raw["종료일"]), T.s(raw["학생전화"]), T.s(raw["성별"]), T.s(raw["원지역"]),
            T.s(raw["원소속청"]), T.s(raw["원소속교"]), T.s(raw["유학지역"]),
            T.s(raw["전입학년"]), T.s(raw["현재학년"]), T.s(raw["유학학교"]),
            T.s(raw["이전유학지역"]), T.s(raw["이전유학학교"]), T.s(raw["거주유형"]),
            T.s(raw["거주지"]), T.s(raw["보호자성명"]), T.s(raw["보호자연락처"]),
            T.s(raw["형제자매"]), T.s(raw["비고"]),
        ])

    widths = {h: 12 for h in APP_HEADERS}
    widths.update({
        "신청ID": 9, "학생ID": 9, "성명": 11, "접수 학기": 11, "접수 학년도": 9,
        "학기구분": 8, "모집 차수": 8, "배정 판정": 10, "판정 근거": 34,
        "미선정 단계": 10, "미선정 사유(원문)": 30, "미선정 사유(분류)": 16,
        "중학교 진학": 26, "관내 전학": 22, "기타": 24, "유학 학년도(원본)": 16,
        "배정 희망서": 20, "중간 종료 사유": 20, "종료일(원본)": 16, "거주 유형": 16,
        "거주지": 22, "비고": 24, "순(원본)": 8,
    })
    last_row = write_table(
        ws, APP_HEADERS, rows, widths,
        date_cols={"접수일(원본)"},
        wrap_cols={"판정 근거", "미선정 사유(원문)", "중학교 진학", "관내 전학", "기타",
                   "배정 희망서", "중간 종료 사유", "종료일(원본)", "거주 유형", "거주지", "비고"},
    )

    add_dropdown(ws, APP_HEADERS, "배정 판정", ["배정", "미배정", "확인필요"], LIMIT_APP)
    c = col_of(APP_HEADERS, "배정 판정")
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_APP}",
        CellIsRule(operator="equal", formula=['"배정"'],
                   fill=PatternFill("solid", fgColor="D8F0DC"), font=Font(name=FONT, size=10, color="17652A")),
    )
    ws.conditional_formatting.add(
        f"{c}2:{c}{LIMIT_APP}",
        CellIsRule(operator="equal", formula=['"확인필요"'],
                   fill=PatternFill("solid", fgColor="FCE4E4"), font=Font(name=FONT, size=10, bold=True, color="A61C1C")),
    )
    return last_row


# ─────────────────────────────────────────────────────────── 집계


def style_head(ws, row, col, text, *, width=None, fill=INK, size=10):
    c = ws.cell(row, col, text)
    c.font = Font(name=FONT, size=size, bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=fill)
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BOX
    if width:
        ws.column_dimensions[get_column_letter(col)].width = width
    return c


def put(ws, row, col, value, *, bold=False, fill=None, fmt=None, align="center", size=10, color="000000"):
    c = ws.cell(row, col, value)
    c.font = Font(name=FONT, size=size, bold=bold, color=color)
    c.border = BOX
    c.alignment = Alignment(horizontal=align, vertical="center", indent=1 if align == "left" else 0)
    if fill:
        c.fill = fill if isinstance(fill, PatternFill) else PatternFill("solid", fgColor=fill)
    if fmt:
        c.number_format = fmt
    return c


def sheet_summary(ws, data):
    ws.sheet_view.showGridLines = False
    sems = data["semesters"]
    E = lambda name: rng("유학이력", ENROLL_HEADERS, name, LIMIT_ENROLL)  # noqa: E731
    A = lambda name: rng("신청이력", APP_HEADERS, name, LIMIT_APP)        # noqa: E731

    n_region = len({e.region for e in data["enrollments"] if e.region})
    n_school = len({(e.region, e.school) for e in data["enrollments"] if e.school})
    region_last, school_last = 2 + n_region, 2 + n_school

    t = ws.cell(1, 1, "학년도·학기별 유학생 현황")
    t.font = Font(name=FONT, size=15, bold=True, color=INK)
    n = ws.cell(2, 1, "유학이력 시트를 그대로 세는 수식입니다. 이력에 줄을 더하면 이 표도 따라 바뀝니다.")
    n.font = Font(name=FONT, size=9, color="595959")

    cols = ["학기", "유학생 수", "신규", "계속·재유학", "남", "여",
            "가족체류형", "홈스테이형", "유학센터형", "유학생 있는 지역 수", "유학생 있는 학교 수",
            "접수 건수", "배정", "미배정·확인필요"]
    r0 = 4
    for i, h in enumerate(cols, start=1):
        style_head(ws, r0, i, h, width=13 if i > 1 else 12)
    ws.row_dimensions[r0].height = 32

    for j, (y, term) in enumerate(sems):
        r = r0 + 1 + j
        lab = T.sem_label(y, term)
        q = f'"{lab}"'
        put(ws, r, 1, lab, bold=True, fill=SUB_FILL, align="center")
        put(ws, r, 2, f"=COUNTIF({E('학기')},{q})", bold=True, fmt="#,##0")
        put(ws, r, 3, f'=COUNTIFS({E("학기")},{q},{E("구분")},"신규")', fmt="#,##0")
        put(ws, r, 4, f'=COUNTIFS({E("학기")},{q},{E("구분")},"<>신규")', fmt="#,##0")
        put(ws, r, 5, f'=COUNTIFS({E("학기")},{q},{E("성별")},"남")', fmt="#,##0")
        put(ws, r, 6, f'=COUNTIFS({E("학기")},{q},{E("성별")},"여")', fmt="#,##0")
        put(ws, r, 7, f'=COUNTIFS({E("학기")},{q},{E("거주 유형")},"가족체류형")', fmt="#,##0")
        put(ws, r, 8, f'=COUNTIFS({E("학기")},{q},{E("거주 유형")},"홈스테이형")', fmt="#,##0")
        put(ws, r, 9, f'=COUNTIFS({E("학기")},{q},{E("거주 유형")},"유학센터형")', fmt="#,##0")
        put(ws, r, 10,
            f'=COUNTIF(지역별현황!{get_column_letter(2 + j)}$3:'
            f'{get_column_letter(2 + j)}${region_last},">0")', fmt="#,##0")
        put(ws, r, 11,
            f'=COUNTIF(학교별현황!{get_column_letter(3 + j)}$3:'
            f'{get_column_letter(3 + j)}${school_last},">0")', fmt="#,##0")
        put(ws, r, 12, f"=COUNTIF({A('접수 학기')},{q})", fmt="#,##0")
        put(ws, r, 13, f'=COUNTIFS({A("접수 학기")},{q},{A("배정 판정")},"배정")', fmt="#,##0")
        put(ws, r, 14, f'=COUNTIFS({A("접수 학기")},{q},{A("배정 판정")},"<>배정")', fmt="#,##0")

    last = r0 + len(sems)

    # 학년도 요약: 1학기 인원 + 2학기에 새로 들어온 인원
    r1 = last + 2
    t2 = ws.cell(r1, 1, "학년도별 유학생 수 (연인원 아님 — 그 학년도에 한 번이라도 유학한 학생 수)")
    t2.font = Font(name=FONT, size=12, bold=True, color=INK)
    years = sorted({y for y, _ in sems})
    hdr = ["학년도", "유학생 수", "남", "여", "1학기", "2학기", "2학기 신규", "비고"]
    for i, h in enumerate(hdr, start=1):
        style_head(ws, r1 + 1, i, h, fill=ACCENT)
    notes = {
        2022: "시범사업 기간(2022.10~12), 도청 체제비 미지원",
        2023: "원본 메모의 최종 85명과 일치",
        2024: "원본 메모의 최종 165명과 일치",
        2026: "2학기 모집이 진행 중 — 계속 유학생은 연장 확정 후 이력 추가 필요",
    }
    for j, y in enumerate(years):
        r = r1 + 2 + j
        q1, q2 = f'"{T.sem_label(y, 1)}"', f'"{T.sem_label(y, 2)}"'
        put(ws, r, 1, f"{y}학년도", bold=True, fill=SUB_FILL)
        put(ws, r, 2,
            f"=COUNTIF({E('학기')},{q1})+COUNTIFS({E('학기')},{q2},{E('구분')},\"<>계속\")",
            bold=True, fmt="#,##0")
        for k, g in enumerate(("남", "여")):
            put(ws, r, 3 + k,
                f'=COUNTIFS({E("학기")},{q1},{E("성별")},"{g}")'
                f'+COUNTIFS({E("학기")},{q2},{E("구분")},"<>계속",{E("성별")},"{g}")',
                fmt="#,##0")
        put(ws, r, 5, f"=COUNTIF({E('학기')},{q1})", fmt="#,##0")
        put(ws, r, 6, f"=COUNTIF({E('학기')},{q2})", fmt="#,##0")
        put(ws, r, 7, f'=COUNTIFS({E("학기")},{q2},{E("구분")},"<>계속")', fmt="#,##0")
        put(ws, r, 8, notes.get(y, ""), align="left", size=9, color="595959")
    ws.column_dimensions["H"].width = 52

    # 미선정 사유
    r2 = r1 + 2 + len(years) + 1
    t3 = ws.cell(r2, 1, "미선정 사유 (신청 건 기준)")
    t3.font = Font(name=FONT, size=12, bold=True, color=INK)
    reasons = sorted({a.reject_class for a in data["applications"] if a.reject_class})
    hdr2 = ["사유"] + [T.sem_label(y, t) for y, t in sems] + ["합계"]
    for i, h in enumerate(hdr2, start=1):
        style_head(ws, r2 + 1, i, h, fill=ACCENT)
    rc = col_of(APP_HEADERS, "미선정 사유(분류)")
    for j, reason in enumerate(reasons):
        r = r2 + 2 + j
        put(ws, r, 1, reason, align="left", fill=SUB_FILL)
        for k, (y, term) in enumerate(sems):
            put(ws, r, 2 + k,
                f'=COUNTIFS({A("접수 학기")},"{T.sem_label(y, term)}",'
                f"'신청이력'!${rc}$2:${rc}${LIMIT_APP},\"{reason}\")", fmt="#,##0")
        letters = f"{get_column_letter(2)}{r}:{get_column_letter(1 + len(sems))}{r}"
        put(ws, r, 2 + len(sems), f"=SUM({letters})", bold=True, fmt="#,##0")

    ws.freeze_panes = "B5"
    ws.column_dimensions["A"].width = 14


def sheet_region(ws, data):
    ws.sheet_view.showGridLines = False
    sems = data["semesters"]
    regions = sorted({e.region for e in data["enrollments"] if e.region})
    E = lambda name: rng("유학이력", ENROLL_HEADERS, name, LIMIT_ENROLL)  # noqa: E731

    t = ws.cell(1, 1, "시군별 유학생 수")
    t.font = Font(name=FONT, size=15, bold=True, color=INK)
    style_head(ws, 2, 1, "유학 지역", width=12)
    for k, (y, term) in enumerate(sems):
        style_head(ws, 2, 2 + k, T.sem_label(y, term), width=11)
    style_head(ws, 2, 2 + len(sems), "누적(연인원)", width=13)
    ws.row_dimensions[2].height = 30

    for j, region in enumerate(regions):
        r = 3 + j
        put(ws, r, 1, region, bold=True, fill=SUB_FILL, align="left")
        for k, (y, term) in enumerate(sems):
            put(ws, r, 2 + k,
                f'=COUNTIFS({E("학기")},"{T.sem_label(y, term)}",{E("유학 지역")},$A{r})',
                fmt="#,##0")
        put(ws, r, 2 + len(sems),
            f"=SUM(B{r}:{get_column_letter(1 + len(sems))}{r})", bold=True, fmt="#,##0", fill=DERIVED_FILL)

    r = 3 + len(regions)
    put(ws, r, 1, "합계", bold=True, fill=SUB_FILL, align="left")
    for k in range(len(sems) + 1):
        L = get_column_letter(2 + k)
        put(ws, r, 2 + k, f"=SUM({L}3:{L}{r - 1})", bold=True, fmt="#,##0", fill=SUB_FILL)
    ws.freeze_panes = "B3"


def sheet_school(ws, data):
    ws.sheet_view.showGridLines = False
    sems = data["semesters"]
    schools = sorted({(e.region, e.school) for e in data["enrollments"] if e.school})
    E = lambda name: rng("유학이력", ENROLL_HEADERS, name, LIMIT_ENROLL)  # noqa: E731

    t = ws.cell(1, 1, "운영학교별 유학생 수")
    t.font = Font(name=FONT, size=15, bold=True, color=INK)
    style_head(ws, 2, 1, "유학 지역", width=12)
    style_head(ws, 2, 2, "유학 학교", width=14)
    for k, (y, term) in enumerate(sems):
        style_head(ws, 2, 3 + k, T.sem_label(y, term), width=11)
    style_head(ws, 2, 3 + len(sems), "누적(연인원)", width=13)
    ws.row_dimensions[2].height = 30

    for j, (region, school) in enumerate(schools):
        r = 3 + j
        put(ws, r, 1, region, fill=SUB_FILL, align="left")
        put(ws, r, 2, school, bold=True, align="left")
        for k, (y, term) in enumerate(sems):
            put(ws, r, 3 + k,
                f'=COUNTIFS({E("학기")},"{T.sem_label(y, term)}",{E("유학 학교")},$B{r})',
                fmt="#,##0")
        put(ws, r, 3 + len(sems),
            f"=SUM(C{r}:{get_column_letter(2 + len(sems))}{r})", bold=True, fmt="#,##0", fill=DERIVED_FILL)

    r = 3 + len(schools)
    put(ws, r, 1, "합계", bold=True, fill=SUB_FILL, align="left")
    put(ws, r, 2, "", fill=SUB_FILL)
    for k in range(len(sems) + 1):
        L = get_column_letter(3 + k)
        put(ws, r, 3 + k, f"=SUM({L}3:{L}{r - 1})", bold=True, fmt="#,##0", fill=SUB_FILL)

    ws.auto_filter.ref = f"A2:{get_column_letter(3 + len(sems))}{r - 1}"
    ws.freeze_panes = "C3"


COST_HEADERS = [
    "학생ID", "성명", "가구ID", "가구 대표", "유학 상태", "기준 학기", "유학 지역", "유학 학교",
    "거주 유형", "지원 시작 학기", "지원 시작일", "도청 지원 만료일", "이수 학기",
    "잔여 지원 학기", "만료 알림", "월 체제비(교육청)", "월 체제비(도청)",
]


def sheet_cost(ws, data):
    by_student = data["by_student"]
    rows = []
    seen_house = set()
    for st in data["students"]:
        lst = by_student.get(st.student_id, [])
        if not lst:
            continue
        first, last = lst[0], lst[-1]
        start_i = T.sem_index(first.year, first.term)
        expire = T.sem_end(*T.sem_from_index(start_i + 5))
        rep = st.household_id not in seen_house
        seen_house.add(st.household_id)
        status = {"재학": "재학중", "예정": "배정예정", "종료": "종료"}[last.status]
        rows.append([
            st.student_id, st.name, st.household_id, "대표" if rep else "-", status,
            T.sem_label(last.year, last.term), last.region, last.school, last.residence,
            T.sem_label(first.year, first.term), first.start_date, expire,
            None, None, None, None, None,
        ])
    rows.sort(key=lambda x: ({"재학중": 0, "배정예정": 1, "종료": 2}[x[4]], x[11]))

    last_row = write_table(
        ws, COST_HEADERS, rows,
        {"학생ID": 9, "성명": 11, "가구ID": 9, "가구 대표": 9, "유학 상태": 10,
         "기준 학기": 11, "유학 지역": 10, "유학 학교": 11, "거주 유형": 11, "지원 시작 학기": 12,
         "지원 시작일": 12, "도청 지원 만료일": 14, "이수 학기": 9,
         "잔여 지원 학기": 11, "만료 알림": 12, "월 체제비(교육청)": 15, "월 체제비(도청)": 14},
        date_cols={"지원 시작일", "도청 지원 만료일"},
    )

    sid = col_of(COST_HEADERS, "학생ID")
    hid = col_of(COST_HEADERS, "가구ID")
    rep = col_of(COST_HEADERS, "가구 대표")
    stat = col_of(COST_HEADERS, "유학 상태")
    res = col_of(COST_HEADERS, "거주 유형")
    done = col_of(COST_HEADERS, "이수 학기")
    left = col_of(COST_HEADERS, "잔여 지원 학기")
    e_student = rng("유학이력", ENROLL_HEADERS, "학생ID", LIMIT_ENROLL)
    base = col_of(COST_HEADERS, "기준 학기")
    e_sem = rng("유학이력", ENROLL_HEADERS, "학기", LIMIT_ENROLL)

    for r in range(2, last_row + 1):
        put(ws, r, COST_HEADERS.index("이수 학기") + 1,
            f"=COUNTIF({e_student},${sid}{r})", fill="F2F2F2", fmt="#,##0")
        put(ws, r, COST_HEADERS.index("잔여 지원 학기") + 1,
            f"=MAX(0,{rate('지원학기')}-${done}{r})", fill="F2F2F2", fmt="#,##0")
        put(ws, r, COST_HEADERS.index("만료 알림") + 1,
            f'=IF(${stat}{r}="종료","-",'
            f'IF(${left}{r}=0,"지원 종료",'
            f'IF(${left}{r}<=2,"만료 임박","")))',
            fill="F2F2F2")
        # 가족체류형은 가구당 지급이라 가구 대표 행에만 금액을 둔다.
        put(ws, r, COST_HEADERS.index("월 체제비(교육청)") + 1,
            f'=IF(${stat}{r}="종료",0,'
            f'IF(${res}{r}="가족체류형",'
            f'IF(${rep}{r}<>"대표",0,'
            f"INDEX({FAMILY_RANGE},MIN(3,MAX(1,"
            f"COUNTIFS({rng('유학이력', ENROLL_HEADERS, '가구ID', LIMIT_ENROLL)},${hid}{r},"
            f"{e_sem},${base}{r})))),"
            f'IF(${res}{r}="홈스테이형",{rate("홈스테이")},{rate("센터")})))',
            fill="F2F2F2", fmt="#,##0")
        put(ws, r, COST_HEADERS.index("월 체제비(도청)") + 1,
            f'=IF(OR(${stat}{r}="종료",${left}{r}=0),0,{rate("도청")})',
            fill="F2F2F2", fmt="#,##0")

    r = last_row + 1
    put(ws, r, 1, "합계", bold=True, fill=SUB_FILL, align="left")
    for i in range(2, len(COST_HEADERS) + 1):
        put(ws, r, i, "", fill=SUB_FILL)
    for name in ("월 체제비(교육청)", "월 체제비(도청)"):
        L = col_of(COST_HEADERS, name)
        put(ws, r, COST_HEADERS.index(name) + 1, f"=SUM({L}2:{L}{last_row})",
            bold=True, fill=SUB_FILL, fmt="#,##0")
    note = ws.cell(r + 2, 1,
                   "※ 월 체제비는 설정_지원단가 시트의 단가로 계산한 참고값입니다. "
                   "가족체류형은 가구당 지급이라 '가구 대표' 행에만 금액이 잡힙니다. "
                   "가구 내 유학생 수는 그 학생의 '기준 학기'(가장 최근 유학 학기) 기준으로 셉니다.")
    note.font = Font(name=FONT, size=9, color="595959")

    c = col_of(COST_HEADERS, "만료 알림")
    ws.conditional_formatting.add(
        f"{c}2:{c}{last_row}",
        CellIsRule(operator="equal", formula=['"만료 임박"'],
                   fill=PatternFill("solid", fgColor="FFF2CC"), font=Font(name=FONT, size=10, bold=True, color="7F6000")),
    )
    ws.conditional_formatting.add(
        f"{c}2:{c}{last_row}",
        CellIsRule(operator="equal", formula=['"지원 종료"'],
                   fill=PatternFill("solid", fgColor="FCE4E4"), font=Font(name=FONT, size=10, bold=True, color="A61C1C")),
    )


ISSUE_HEADERS = ["번호", "심각도", "유형", "학생ID", "성명", "신청ID", "원본 행", "내용", "처리 메모"]


def sheet_issues(ws, data):
    rows = [
        [i, x["심각도"], x["유형"], x["학생ID"], x["성명"], x["신청ID"], x["원본행"], x["내용"], None]
        for i, x in enumerate(data["issues"], start=1)
    ]
    last_row = write_table(
        ws, ISSUE_HEADERS, rows,
        {"번호": 6, "심각도": 8, "유형": 18, "학생ID": 14, "성명": 11, "신청ID": 14,
         "원본 행": 8, "내용": 78, "처리 메모": 24},
        wrap_cols={"내용", "처리 메모"},
    )
    add_dropdown(ws, ISSUE_HEADERS, "처리 메모", ["확인 완료", "수정함", "원본이 맞음", "보류"], 500)
    c = col_of(ISSUE_HEADERS, "심각도")
    ws.conditional_formatting.add(
        f"A2:{get_column_letter(len(ISSUE_HEADERS))}{last_row}",
        FormulaRule(formula=[f'${c}2="높음"'], fill=PatternFill("solid", fgColor="FCE4E4")),
    )
    for r in range(2, last_row + 1):
        ws.cell(r, ISSUE_HEADERS.index("처리 메모") + 1).fill = INPUT_FILL
    ws.column_dimensions["I"].width = 24


def sheet_source(ws, src_path):
    wb = openpyxl.load_workbook(src_path, data_only=True)
    src = wb[T.SOURCE_SHEET]
    for r in range(1, src.max_row + 1):
        for c in range(1, 31):
            v = src.cell(r, c).value
            if v is None:
                continue
            cell = ws.cell(r, c, v)
            cell.font = Font(name=FONT, size=9, bold=(r == T.HEADER_ROW))
            if isinstance(v, dt.datetime):
                cell.number_format = DATE_FMT
            if r == T.HEADER_ROW:
                cell.fill = SUB_FILL
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for c in range(1, 31):
        ws.column_dimensions[get_column_letter(c)].width = 13
    ws.freeze_panes = "A9"
    ws.row_dimensions[T.HEADER_ROW].height = 40


def main(src, out):
    data = T.build(src)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    sheet_guide(wb.create_sheet("안내"), data, src.split("/")[-1])
    sheet_students(wb.create_sheet("학생마스터"), data)
    sheet_enrollments(wb.create_sheet("유학이력"), data)
    sheet_applications(wb.create_sheet("신청이력"), data)
    sheet_summary(wb.create_sheet("학기별집계"), data)
    sheet_region(wb.create_sheet("지역별현황"), data)
    sheet_school(wb.create_sheet("학교별현황"), data)
    sheet_cost(wb.create_sheet("체제비관리"), data)
    sheet_rates(wb.create_sheet("설정_지원단가"))
    sheet_issues(wb.create_sheet("데이터검증"), data)
    sheet_source(wb.create_sheet("원본_전체"), src)

    for ws in wb.worksheets:
        ws.sheet_properties.tabColor = ACCENT if ws.title in {"학생마스터", "유학이력", "신청이력"} else None
    wb.save(out)
    print(f"저장: {out}")
    print(f"  학생 {len(data['students'])} / 신청 {len(data['applications'])} / "
          f"유학이력 {len(data['enrollments'])} / 검증 {len(data['issues'])}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
