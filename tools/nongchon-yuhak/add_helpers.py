"""원본 명단에 입력 도우미를 붙인다. 값은 한 칸도 건드리지 않는다.

  python add_helpers.py <원본.xlsx> <출력.xlsx>

원본을 계속 원본으로 쓰면서, 입력할 때 표기가 흔들리지 않게 붙잡아 주는 것만
더한다. 세 가지다.

  ① 드롭다운(경고형)  — 유학지역·거주유형·성별·최종배정 등. 목록에 없는 값도
                        넣을 수는 있고 경고만 뜬다. 기존 값은 그대로 둔다.
  ② 조건부 서식        — 배정인데 필수 칸이 빈 곳, 종료일 표기가 낯선 곳
  ③ 계산 열(AE~AI)     — 접수 학기·모집 차수·배정 판정을 원본 옆에 수식으로 낸다.
                        워크북이 내는 값과 같은 규칙이라, 어긋나면 그 자리에서 보인다.

표기가 흔들리면 판정이 흔들린다. 종료일 칸이 '현재' 에서 '유학중' 으로 바뀌었을
때 배정 9건이 확인필요로 떨어지고 인원이 11명 줄었던 일이 있었다. 그런 일을
입력 단계에서 막는 것이 이 파일의 목적이다.
"""

from __future__ import annotations

import sys

import openpyxl
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

import transform as T

FONT = "맑은 고딕"
INK = "0B0B0B"
HEAD_FILL = PatternFill("solid", fgColor="184F95")
CALC_FILL = PatternFill("solid", fgColor="F2F2F2")
WARN_FILL = PatternFill("solid", fgColor="FCE4E4")
HOLD_FILL = PatternFill("solid", fgColor="FFF2CC")

# 목록에 없는 값도 넣을 수는 있게 경고만 띄운다. 사유를 길게 적는 칸이 있어서다.
DROPDOWNS = {
    "유학지역": ["군산", "익산", "정읍", "남원", "김제", "완주", "진안",
                 "무주", "장수", "임실", "순창", "고창", "부안"],
    "이전유학지역": ["군산", "익산", "정읍", "남원", "김제", "완주", "진안",
                     "무주", "장수", "임실", "순창", "고창", "부안"],
    "거주유형": ["가족체류형", "홈스테이형", "유학센터형"],
    "성별": ["남", "여"],
    "최종배정": ["배정", "미배정"],
    "참가신청서": ["제출", "미제출"],
    "전입학년": ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3"],
    "현재학년": ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3"],
}

# 종료일 칸에 날짜 대신 쓰는 말. transform.py 의 ONGOING_TOKENS 와 같아야 한다.
ONGOING = list(T.ONGOING_TOKENS)

# 기준 학년도를 적어 두는 칸. '현재 학년' 을 여기에 맞춰 계산한다.
# 학년도가 바뀌면 이 한 칸만 고치면 명단 전체가 따라온다.
BASE_YEAR_ROW = 5

CALC = [
    ("접수 학기", 13,
     '=IF(ISNUMBER($G{r}),'
     'IF(MONTH($G{r})>=3,YEAR($G{r}),YEAR($G{r})-1)&"-"'
     '&IF(OR(MONTH($G{r})>=9,MONTH($G{r})<=2),2,1)&"학기","")'),
    ("모집 차수", 9,
     '=IF(ISNUMBER($G{r}),IF(DAY($G{r})<=9,DAY($G{r}),1)&"차","")'),
    ("배정 판정", 11, None),          # 아래에서 길게 만든다
    ("재학 표기", 11,
     '=IF($M{r}="","",IF(AND(ISNUMBER($L{r}),$L{r}>0),"종료일",'
     'IF(ISNUMBER($L{r}),"숫자 오입력",'
     'IF($L{r}="","비어 있음",IF(OR({ongoing}),"재학 중","그 밖"))))) '),
    ("확인", 30, None),
    ("학년 순번", 9, None),
    ("현재 학년(원본 기재)", 15, None),
]


def judge_formula(r: int) -> str:
    """워크북·현황판과 같은 순서로 배정 여부를 정한다 (transform.decide)."""
    ongoing = ",".join(f'LEFT($L{r},{len(k)})="{k}"' for k in ONGOING)
    return (
        f'=IF($M{r}="","",'
        f'IF(IFERROR(SEARCH("미전학",$L{r}),0)>0,"미배정",'
        f'IF(OR($L{r}="배정",$L{r}="최종배정"),"확인필요",'
        f'IF(AND(OR($J{r}="배정",$J{r}="최종배정"),$L{r}=""),"확인필요",'
        f'IF(OR($J{r}="배정",$J{r}="최종배정"),"배정",'
        f'IF(OR($J{r}="미배정",$J{r}="X",$J{r}="x"),"미배정",'
        f'IF($J{r}<>"","미배정",'
        f'IF(AND($L{r}<>"",OR(AND(ISNUMBER($L{r}),$L{r}>0),{ongoing})),"배정",'
        f'IF($H{r}="선정","확인필요",'
        f'IF($H{r}<>"","미배정","확인필요"))))))))))'
    )


def grade_index_formula(r: int, base_cell: str) -> str:
    """전입 학년에서 기준 학년도까지 몇 학년이 되었는지를 숫자로.

    초1=1 … 초6=6, 중1=7 … 중3=9. 유학이 끝났는지는 따지지 않는다 — 나이로
    따진 학년이라, 기준 학년도 칸을 고치면 명단 전체가 그 시점 기준으로 바뀐다.

    원본에 있던 수식은 연도를 2025 로 박아 두고 3월이 학년도 시작이라는 것도
    따지지 않아 '초7' 같은 값이 나왔다.
    """
    # 전입 학년을 숫자로. '3' 처럼 숫자만 적힌 줄은 유학 학교 이름 끝글자로
    # 초·중을 가린다 (transform.normalize_grade 와 같은 규칙).
    num = f'IFERROR($T{r}*1,0)'
    base = (f'IF($T{r}="유치원",0,'
            f'IF(LEFT($T{r},1)="초",RIGHT($T{r},1)*1,'
            f'IF(LEFT($T{r},1)="중",6+RIGHT($T{r},1)*1,'
            f'IF({num}>0,IF(RIGHT($V{r},1)="중",6+{num},{num}),-99))))')
    year_g = f'IF(MONTH($G{r})>=3,YEAR($G{r}),YEAR($G{r})-1)'
    return (f'=IF(OR($T{r}="",ISNUMBER($G{r})=FALSE),"",'
            f'{base}+{base_cell}-({year_g}))')


def grade_text_formula(r: int, idx: str) -> str:
    """학년 순번을 다시 '초5' · '중2' 로 되돌린다. 범위를 넘으면 '졸업'."""
    return (f'=IF(ISNUMBER(${idx}{r}),'
            f'IF(${idx}{r}<0,"",IF(${idx}{r}=0,"유치원",'
            f'IF(${idx}{r}>9,"졸업",'
            f'IF(${idx}{r}<=6,"초"&${idx}{r},"중"&(${idx}{r}-6))))),"")')


def check_formula(r: int, judge: str, stay: str) -> str:
    """손봐야 할 곳을 한 칸에 모은다."""
    return (
        f'=IF($M{r}="","",'
        f'IF(AND(${judge}{r}="확인필요",OR($J{r}="배정",$J{r}="최종배정")),'
        f'"배정이면 종료일에 \'유학중\', 아니면 최종배정 칸을 미배정으로",'
        f'IF(${judge}{r}="확인필요","배정 결과를 채워 주세요",'
        f'IF(AND(${judge}{r}="배정",${stay}{r}="비어 있음"),'
        f'"종료일 칸에 날짜나 \'유학중\' 을 적어 주세요",'
        f'IF(AND(${judge}{r}="배정",'
        f'OR(${stay}{r}="그 밖",${stay}{r}="숫자 오입력")),'
        f'"종료일 칸을 확인해 주세요",'
        f'IF(AND(${judge}{r}="배정",$Y{r}=""),"거주 유형을 채워 주세요",'
        f'IF(AND(${judge}{r}="배정",$V{r}=""),"유학 학교를 채워 주세요","")))))))'
    )


def main(src: str, out: str) -> int:
    wb = openpyxl.load_workbook(src)
    ws = T.find_sheet(wb)
    head, first = T.HEADER_ROW, T.FIRST_DATA_ROW
    last_data = max(
        (r for r in range(first, ws.max_row + 1)
         if T.s(ws.cell(r, T.COL["성명"]).value)),
        default=first,
    )
    # 앞으로 넣을 줄까지 미리 잡아 둔다
    limit = last_data + 300
    n_orig = ws.max_column

    # ── ① 드롭다운
    added = 0
    for name, values in DROPDOWNS.items():
        col = get_column_letter(T.COL[name])
        dv = DataValidation(
            type="list",
            formula1='"' + ",".join(values) + '"',
            allow_blank=True,
            showErrorMessage=True,
            errorStyle="warning",          # 막지 않고 경고만. 사유를 길게 적는 칸이 있다
            errorTitle="목록에 없는 값입니다",
            error="그대로 쓰시려면 '예'를 누르세요. 표기가 갈리면 집계가 흔들립니다.",
            promptTitle=name,
            prompt=" / ".join(values),
            showInputMessage=True,
        )
        dv.add(f"{col}{first}:{col}{limit}")
        ws.add_data_validation(dv)
        added += 1

    # ── ③ 계산 열 (원본 오른쪽에 붙인다. 원본 열은 건드리지 않는다)
    c0 = n_orig + 2                       # 한 칸 띄워서 원본과 눈으로 갈라 둔다
    names = [n for n, _, _ in CALC]
    col_of = {n: get_column_letter(c0 + i) for i, n in enumerate(names)}

    t = ws.cell(head - 1, c0, "▼ 아래 다섯 칸은 수식입니다. 고치지 마세요")
    t.font = Font(name=FONT, size=9, bold=True, color="A61C1C")

    for i, (name, width, _) in enumerate(CALC):
        c = ws.cell(head, c0 + i, name)
        c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(c0 + i)].width = width

    # 기준 학년도 — 이 한 칸이 '현재 학년' 을 정한다
    lab = ws.cell(BASE_YEAR_ROW, c0, "기준 학년도 →")
    lab.font = Font(name=FONT, size=10, bold=True, color=INK)
    lab.alignment = Alignment(horizontal="right", vertical="center")
    base_cell = f"${get_column_letter(c0 + 1)}${BASE_YEAR_ROW}"
    bc = ws.cell(BASE_YEAR_ROW, c0 + 1, T.CURRENT_YEAR)
    bc.font = Font(name=FONT, size=11, bold=True, color="7F6000")
    bc.fill = HOLD_FILL
    bc.alignment = Alignment(horizontal="center", vertical="center")
    note = ws.cell(BASE_YEAR_ROW, c0 + 2,
                   "이 칸을 고치면 '현재 학년' 이 그 학년도 기준으로 전부 바뀝니다")
    note.font = Font(name=FONT, size=9, color="7F6000")

    ongoing_expr = ",".join(f'LEFT($L{{r}},{len(k)})="{k}"' for k in ONGOING)
    idx_col = col_of["학년 순번"]
    # '현재 학년'(원본 U 열)을 수식으로 바꾸기 전에, 지금 적혀 있는 값을 옆으로 옮겨 둔다.
    # 수식이던 칸은 값이 없으므로 빈칸으로 둔다.
    old_u = {}
    for r in range(first, last_data + 1):
        v = ws.cell(r, T.COL["현재학년"]).value
        old_u[r] = None if (isinstance(v, str) and v.startswith("=")) else v
    kept = sum(1 for v in old_u.values() if v is not None)

    for r in range(first, limit + 1):
        for i, (name, _, tmpl) in enumerate(CALC):
            if name == "배정 판정":
                f = judge_formula(r)
            elif name == "확인":
                f = check_formula(r, col_of["배정 판정"], col_of["재학 표기"])
            elif name == "학년 순번":
                f = grade_index_formula(r, base_cell)
            elif name == "현재 학년(원본 기재)":
                f = old_u.get(r)
            else:
                f = tmpl.format(r=r, ongoing=ongoing_expr.format(r=r)).strip()
            c = ws.cell(r, c0 + i, f)
            c.font = Font(name=FONT, size=9)
            c.fill = CALC_FILL
            c.alignment = Alignment(
                horizontal="left" if name == "확인" else "center", vertical="center")

    # 원본 '현재 학년' 열을 수식으로 채운다. 지금 값은 위에서 옮겨 두었다.
    for r in range(first, limit + 1):
        cell = ws.cell(r, T.COL["현재학년"], grade_text_formula(r, idx_col))
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # ── ② 조건부 서식
    j = col_of["배정 판정"]
    s = col_of["재학 표기"]
    k = col_of["확인"]
    ws.conditional_formatting.add(
        f"{j}{first}:{j}{limit}",
        CellIsRule(operator="equal", formula=['"확인필요"'], fill=WARN_FILL,
                   font=Font(name=FONT, size=9, bold=True, color="A61C1C")))
    ws.conditional_formatting.add(
        f"{j}{first}:{j}{limit}",
        CellIsRule(operator="equal", formula=['"배정"'],
                   font=Font(name=FONT, size=9, bold=True, color="17652A")))
    ws.conditional_formatting.add(
        f"{s}{first}:{s}{limit}",
        CellIsRule(operator="equal", formula=['"그 밖"'], fill=HOLD_FILL,
                   font=Font(name=FONT, size=9, bold=True, color="7F6000")))
    ws.conditional_formatting.add(
        f"{k}{first}:{k}{limit}",
        FormulaRule(formula=[f'LEN(${k}{first})>0'], fill=WARN_FILL,
                    font=Font(name=FONT, size=9, color="A61C1C")))
    # 같은 성명+보호자연락처가 이미 있으면 재신청이거나 중복 입력이다
    nm, ph = get_column_letter(T.COL["성명"]), get_column_letter(T.COL["보호자연락처"])
    ws.conditional_formatting.add(
        f"{nm}{first}:{nm}{limit}",
        FormulaRule(
            formula=[f'AND(${nm}{first}<>"",'
                     f'COUNTIFS(${nm}${first}:${nm}${limit},${nm}{first},'
                     f'${ph}${first}:${ph}${limit},${ph}{first})>1)'],
            fill=HOLD_FILL))

    # 자동 필터를 새 열까지 넓힌다
    ws.auto_filter.ref = f"A{head}:{get_column_letter(c0 + len(CALC) - 1)}{last_data}"

    wb.save(out)
    print(f"저장: {out}")
    print(f"  자료 {first}~{last_data}행 · 수식 범위 {limit}행까지")
    print(f"  드롭다운 {added}개 열 · 계산 열 {len(CALC)}개 "
          f"({col_of[names[0]]}~{col_of[names[-1]]}) · 조건부 서식 5개")
    print(f"  '현재 학년'({get_column_letter(T.COL['현재학년'])}열)을 수식으로 바꿈 "
          f"· 원래 적혀 있던 {kept}칸은 '{col_of['현재 학년(원본 기재)']}' 열에 그대로 옮김")
    print(f"  기준 학년도 칸 {base_cell.replace('$', '')} = {T.CURRENT_YEAR}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
