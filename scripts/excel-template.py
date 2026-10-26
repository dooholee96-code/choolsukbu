"""
엑셀 양식(templates/출석부_엑셀양식.xlsx)을 만든다.

    python3 scripts/excel-template.py

openpyxl이 필요하다 (pip install openpyxl). 앱 빌드와는 상관없고, 양식을 고칠 때만 돌린다.

양식의 '원생'·'수납' 시트 머리글은 앱의 가져오기 형식과 글자 하나까지 같아야 한다.
  원생 → src/utils/csv.ts 의 STUDENT_HEADERS
  수납 → src/utils/paymentImport.ts 의 PAYMENT_HEADERS
머리글을 바꾸면 세 곳을 같이 고친다. tests/template.test.mts 가 어긋나면 실패한다.

이 양식은 무료로 나눠 주는 입문용이다. 장부(원생·수납)와 달마다 낸 사람·안 낸 사람만 본다.
신고 일정, 현금영수증 확인, 증명서 발급, 출결은 앱에만 있다.
"""
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = Path(__file__).resolve().parent.parent / 'templates' / '출석부_엑셀양식.xlsx'
ROWS = 500  # 서식과 목록 고르기를 미리 깔아 둘 줄 수

FONT = '맑은 고딕'
INK = '4B3B53'
HEAD = '4A7585'
SOFT = 'F6F2EC'
LINE = 'E7DEE6'
WARN = 'F6D5DA'
GOOD = 'D7EBDF'

head_font = Font(name=FONT, bold=True, color='FFFFFF', size=11)
head_fill = PatternFill('solid', fgColor=HEAD)
body_font = Font(name=FONT, color=INK, size=11)
note_font = Font(name=FONT, color='776A7E', size=10)
title_font = Font(name=FONT, bold=True, color=INK, size=16)
thin = Side(style='thin', color=LINE)
box = Border(left=thin, right=thin, top=thin, bottom=thin)

STUDENT_COLUMNS = [
    # 머리글, 너비, 서식, 설명
    ('이름', 12, '@', '원생 이름'),
    ('학년', 8, '@', '예: 7세, 초3, 중1'),
    ('요일', 12, '@', '예: 월,수  또는  월수금'),
    ('시작', 8, '@', '수업 시작 16:00'),
    ('끝', 8, '@', '수업 끝 17:00'),
    ('월 수강료', 12, '#,##0', '원'),
    ('구분', 10, '@', '동명이인일 때만: 월수반, 강북초'),
    ('미취학', 8, '@', '초등학교 입학 전이면 예'),
    ('퇴원일', 13, 'yyyy-mm-dd', '그만둔 날 (비우면 재원)'),
]

PAYMENT_COLUMNS = [
    ('받은날', 13, 'yyyy-mm-dd', '돈을 받은 날'),
    ('수강월', 10, '@', '어느 달 수강료인가 2026-03 (비우면 받은 달)'),
    ('원생', 12, '@', '원생 시트의 이름'),
    ('구분', 10, '@', '동명이인일 때만'),
    ('수입구분', 11, '@', '비우면 수강료'),
    ('금액', 12, '#,##0', '원. 환불은 -50000'),
    ('결제수단', 10, '@', '카드·계좌이체·현금'),
    ('현금영수증', 11, '@', '계좌이체·현금일 때 발급 여부'),
    ('미취학', 8, '@', '원생 시트에서 자동'),
    ('메모', 24, '@', ''),
]

KINDS = '수강료,특강비,입학금,교재대,모의고사비,기타수입'
METHODS = '카드,계좌이체,현금'


def header_row(ws, columns):
    for i, (name, width, fmt, hint) in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=i, value=name)
        cell.font = head_font
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = box
        ws.column_dimensions[get_column_letter(i)].width = width
        if hint:
            cell.comment = Comment(hint, '출석부')
        for r in range(2, ROWS + 2):
            c = ws.cell(row=r, column=i)
            c.number_format = fmt
            c.font = body_font
            c.border = box
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = 'A2'


def add_list(ws, col_letter, formula, prompt_title, prompt):
    dv = DataValidation(type='list', formula1=formula, allow_blank=True)
    dv.promptTitle = prompt_title
    dv.prompt = prompt
    dv.showInputMessage = True
    dv.errorTitle = '목록에 없는 값'
    dv.error = '목록에서 골라 주세요.'
    ws.add_data_validation(dv)
    dv.add(f'{col_letter}2:{col_letter}{ROWS + 1}')


def guide(wb):
    ws = wb.active
    ws.title = '사용법'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 3
    ws.column_dimensions['B'].width = 18
    ws.column_dimensions['C'].width = 96
    ws['B2'] = '출석부 엑셀 양식'
    ws['B2'].font = title_font
    ws['B3'] = '원생과 받은 돈을 적고, 달마다 누가 냈는지 봅니다. 나중에 출석부 앱으로 그대로 옮길 수 있습니다.'
    ws['B3'].font = note_font

    rows = [
        ('1. 원생', '원생 시트에 한 줄에 한 명씩 적습니다. 요일은 "월,수"처럼, 시간은 "16:00"처럼 적습니다.'),
        ('', '동명이인이 있으면 구분 칸에 "월수반"처럼 짧게 구별할 말을 적습니다.'),
        ('2. 수납', '돈을 받을 때마다 한 줄씩 적습니다. 원생·수입구분·결제수단은 칸을 누르면 목록에서 고를 수 있습니다.'),
        ('', '수강월은 "어느 달 수강료인가"입니다. 9월 말에 받은 10월분은 2026-10 으로 적습니다.'),
        ('', '돌려준 돈은 지우지 말고 금액을 -50000 처럼 음수로 한 줄 더 적습니다.'),
        ('', '계좌이체·현금으로 한 번에 10만 원 이상 받으면 달라는 말이 없어도 받은 날부터 5일 안에 현금영수증을 발급합니다.'),
        ('3. 월별 현황', '위쪽 노란 칸에 연도를 적으면 원생별로 달마다 낸 수강료가 나옵니다.'),
        ('', '빨간 칸은 그 달 수강료보다 덜 받은 곳, 초록 칸은 다 받은 곳입니다.'),
        ('', '새로 온 원생은 처음 낸 달부터, 그만둔 원생은 퇴원일이 든 달까지만 빨갛게 칠합니다. 이번 달은 아직 안 냈으면 빨갛습니다.'),
        ('', '아래 표는 달마다 받은 돈을 결제수단별로 더한 것입니다(받은 날 기준).'),
        ('앱으로 옮기기', '원생 시트를 열고 [파일 → 다른 이름으로 저장 → CSV UTF-8(쉼표로 분리)]로 저장합니다.'),
        ('', '수납 시트도 같은 방법으로 따로 저장합니다(CSV는 한 번에 한 시트만 저장됩니다).'),
        ('', '앱의 [설정 → 가져오기]에서 원생 명단을 먼저, 수납 기록을 그다음에 가져옵니다.'),
        ('', '같은 파일을 두 번 가져와도 같은 기록은 한 번만 들어갑니다.'),
        ('주의', '원생·수납 시트의 첫 줄(머리글)은 고치지 마세요. 앱이 이 글자로 칸을 알아봅니다.'),
        ('', '열 순서를 바꾸거나 열을 더하는 것은 괜찮습니다. 앱은 머리글 이름으로 읽습니다.'),
    ]
    r = 5
    for label, text in rows:
        lab = ws.cell(row=r, column=2, value=label)
        lab.font = Font(name=FONT, bold=True, color=INK)
        lab.alignment = Alignment(vertical='top')
        c = ws.cell(row=r, column=3, value=text)
        c.font = body_font
        c.alignment = Alignment(wrap_text=True, vertical='top')
        r += 1

    r += 1
    ws.cell(row=r, column=2, value='앱에만 있는 것').font = Font(name=FONT, bold=True, color=HEAD)
    for text in [
        '아이패드로 등원·결석을 누르는 출결과 보충 관리',
        '신고 일정 알림(사업장현황신고·종합소득세)과 현금영수증 빠진 건 모아 보기',
        '홈택스 신고용 숫자와 교육비 납입 증명서를 한 번에 뽑기',
        '아이폰·아이패드 사이 자동 동기화와 앱 잠금',
    ]:
        r += 1
        ws.cell(row=r, column=3, value='· ' + text).font = note_font


def students_sheet(wb):
    ws = wb.create_sheet('원생')
    header_row(ws, STUDENT_COLUMNS)
    add_list(ws, 'H', '"예"', '미취학', '초등학교 입학 전이면 예')
    ws.sheet_properties.tabColor = HEAD
    return ws


def payments_sheet(wb):
    ws = wb.create_sheet('수납')
    header_row(ws, PAYMENT_COLUMNS)
    add_list(ws, 'C', f'원생!$A$2:$A${ROWS + 1}', '원생', '원생 시트의 이름에서 고릅니다')
    add_list(ws, 'E', f'"{KINDS}"', '수입구분', '비우면 수강료')
    add_list(ws, 'G', f'"{METHODS}"', '결제수단', '카드·계좌이체·현금')
    add_list(ws, 'H', '"발급,미발급"', '현금영수증', '계좌이체·현금일 때만')
    # 미취학은 원생 시트의 지금 값을 보여 준다. 입학 전 1·2월분처럼 받은 순간의 값은
    # 앱으로 옮긴 뒤 앱이 지킨다(가져올 때 이 열의 값이 그대로 들어간다).
    for r in range(2, ROWS + 2):
        ws.cell(row=r, column=9).value = (
            f'=IF(C{r}="","",IFERROR(IF(INDEX(원생!$H:$H,MATCH(C{r},원생!$A:$A,0))="예","예",""),""))'
        )
    ws.sheet_properties.tabColor = 'E8B27A'
    return ws


def status_sheet(wb):
    ws = wb.create_sheet('월별 현황')
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 14
    ws.column_dimensions['B'].width = 12
    for m in range(12):
        ws.column_dimensions[get_column_letter(3 + m)].width = 11

    ws['A1'] = '연도'
    ws['A1'].font = Font(name=FONT, bold=True, color=INK)
    ws['B1'] = 2026
    ws['B1'].font = Font(name=FONT, bold=True, color=INK, size=13)
    ws['B1'].fill = PatternFill('solid', fgColor='FBE9B7')
    ws['B1'].border = box
    ws['C1'] = '← 연도를 바꾸면 아래가 다시 계산됩니다. 수강료(수입구분)만 셉니다.'
    ws['C1'].font = note_font

    head = ['원생', '월 수강료'] + [f'{m}월' for m in range(1, 13)]
    for i, name in enumerate(head, start=1):
        c = ws.cell(row=3, column=i, value=name)
        c.font = head_font
        c.fill = head_fill
        c.alignment = Alignment(horizontal='center')
        c.border = box

    first, last = 4, 4 + ROWS - 1
    for k in range(ROWS):
        r = first + k
        src = k + 2  # 원생 시트의 줄
        ws.cell(row=r, column=1, value=f'=IF(원생!$A{src}="","",원생!$A{src}&IF(원생!$G{src}="",""," ("&원생!$G{src}&")"))')
        ws.cell(row=r, column=2, value=f'=IF(원생!$A{src}="","",원생!$F{src})').number_format = '#,##0'
        for m in range(1, 13):
            col = 2 + m
            # 끝의 *는 글자로만 맞춰 보게 한다. 없으면 엑셀이 "2026-03"을 날짜로 읽어 글자 칸과 어긋난다.
            month = f'$B$1&"-"&TEXT({m},"00")&"*"'
            # 이름과 구분이 같은 줄만 더한다 (동명이인). 수입구분이 비어 있으면 수강료다.
            formula = (
                f'=IF(원생!$A{src}="","",'
                f'SUMIFS(수납!$F:$F,수납!$C:$C,원생!$A{src},수납!$D:$D,IF(원생!$G{src}="","",원생!$G{src}),'
                f'수납!$B:$B,{month},수납!$E:$E,"수강료")'
                f'+SUMIFS(수납!$F:$F,수납!$C:$C,원생!$A{src},수납!$D:$D,IF(원생!$G{src}="","",원생!$G{src}),'
                f'수납!$B:$B,{month},수납!$E:$E,""))'
            )
            cell = ws.cell(row=r, column=col, value=formula)
            cell.number_format = '#,##0;-#,##0;-'
        for col in range(1, 15):
            c = ws.cell(row=r, column=col)
            c.font = body_font
            c.border = box

    # 숨긴 도움 열: O = 퇴원일, P~AA = 그 달에 덜 받았으면 1.
    # 덜 받음은 (수강료가 있고) 지난달까지이며, 퇴원일이 그 달 전이 아니고,
    # 올해 한 번이라도 낸 뒤이거나 이번 달일 때만 센다. 새로 온 원생의 오기 전 달을 빨갛게 칠하지 않으려고.
    ws.column_dimensions['O'].hidden = True
    for m in range(1, 13):
        ws.column_dimensions[get_column_letter(15 + m)].hidden = True
    for k in range(ROWS):
        r = first + k
        src = k + 2
        ws.cell(row=r, column=15, value=f'=IF(원생!$I{src}="","",원생!$I{src})')
        for m in range(1, 13):
            L = get_column_letter(2 + m)
            start = f'DATE($B$1,{m},1)'
            ws.cell(row=r, column=15 + m, value=(
                f'=IF($A{r}="","",IF(AND($B{r}>0,{L}{r}<$B{r},{start}<=TODAY(),'
                f'OR($O{r}="",$O{r}>={start}),'
                f'OR(COUNTIF($C{r}:{L}{r},">0")>0,{start}=DATE(YEAR(TODAY()),MONTH(TODAY()),1))),1,0))'
            ))

    rng = f'C{first}:N{last}'
    ws.conditional_formatting.add(
        rng,
        FormulaRule(formula=[f'P{first}=1'], fill=PatternFill('solid', fgColor=WARN)),
    )
    ws.conditional_formatting.add(
        rng,
        FormulaRule(
            formula=[f'AND($A{first}<>"",$B{first}>0,C{first}>=$B{first})'],
            fill=PatternFill('solid', fgColor=GOOD),
        ),
    )

    # 월별 합계 (받은 날 기준, 결제수단별). 신고와 같은 기준이다.
    top = last + 3
    ws.cell(row=top, column=1, value='월별 받은 돈 (받은 날 기준, 수입구분 전체)').font = Font(name=FONT, bold=True, color=INK)
    labels = ['카드', '계좌이체', '현금', '합계', '덜 받은 원생 수']
    for i, name in enumerate(head[2:], start=3):
        c = ws.cell(row=top + 1, column=i, value=name)
        c.font = head_font
        c.fill = head_fill
        c.alignment = Alignment(horizontal='center')
    for j, label in enumerate(labels):
        r = top + 2 + j
        c = ws.cell(row=r, column=1, value=label)
        c.font = Font(name=FONT, bold=True, color=INK)
        for m in range(1, 13):
            col = 2 + m
            lo = f'DATE($B$1,{m},1)'
            hi = f'DATE($B$1,{m + 1},1)' if m < 12 else 'DATE($B$1+1,1,1)'
            if label in ('카드', '계좌이체', '현금'):
                f = f'=SUMIFS(수납!$F:$F,수납!$A:$A,">="&{lo},수납!$A:$A,"<"&{hi},수납!$G:$G,"{label}")'
            elif label == '합계':
                L = get_column_letter(col)
                f = f'=SUM({L}{top + 2}:{L}{top + 4})'
            else:
                L = get_column_letter(col)
                F = get_column_letter(15 + m)
                f = f'=IF(DATE($B$1,{m},1)>TODAY(),"",SUM({F}{first}:{F}{last}))'
            cell = ws.cell(row=r, column=col, value=f)
            cell.number_format = '#,##0;-#,##0;-'
            cell.font = body_font
            cell.border = box
    ws.freeze_panes = 'C4'
    ws.sheet_properties.tabColor = '7FBFA1'
    return ws


def build(out: Path):
    wb = Workbook()
    guide(wb)
    students_sheet(wb)
    payments_sheet(wb)
    status_sheet(wb)
    wb.active = 0
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return out


if __name__ == '__main__':
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    print(build(target))
