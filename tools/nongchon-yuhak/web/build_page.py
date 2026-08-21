"""web/ 의 조각들을 파일 하나짜리 HTML 로 묶는다.

  python web/build_page.py <출력.html>

SheetJS·스타일·스크립트를 모두 안에 넣어 바깥으로 요청을 보내지 않는다.
데이터는 넣지 않는다 — 브라우저에서 원본 엑셀을 직접 읽는다. 그래서 이 파일
자체에는 개인정보가 없고, 원본 파일도 어디로도 올라가지 않는다.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

HERE = Path(__file__).parent

BODY = """
<div class="wrap">
  <header>
    <h1>전북 농어촌유학생 현황</h1>
    <p class="sub">원본 명단 엑셀을 열면 이 자리에서 계산해 보여줍니다.
      파일은 이 컴퓨터 밖으로 나가지 않습니다.</p>
  </header>

  <div id="landing">
    <div class="drop" id="drop">
      <h2>원본 명단 파일을 여기에 끌어다 놓으세요</h2>
      <p class="sub" style="margin:6px 0 18px">
        1번 시트 '★☆★전북 농어촌 유학생 명단★☆★' 을 읽습니다. .xlsx / .xlsm</p>
      <button class="primary" id="openbtn">파일 고르기</button>
      <input type="file" id="fileinput" accept=".xlsx,.xlsm" hidden>
      <p class="err" id="loaderr" style="margin-top:14px"></p>
    </div>
    <section class="card" style="margin-top:22px">
      <h2>무엇을 보여주나</h2>
      <p class="note">원본은 1행이 '한 번의 신청'이라, 그 안에 학생 정보·심사 결과·여러 해에 걸친
        유학 이력이 함께 들어 있습니다. 이 화면은 그것을 학생·신청·학기로 갈라 다시 셉니다.</p>
      <table>
        <tbody>
          <tr><th style="width:120px">요약</th>
            <td>학생이 지금 어느 단계에 몇 명씩 있는지, 학기별 인원 추이, 모집 단계별 이탈,
              발표 자료와의 대조</td></tr>
          <tr><th>표 만들기</th>
            <td>시군별·학교별·연도별 같은 참고자료 표를 단추 하나로 뽑습니다.
              시군 안에 학교를 묶는 2단 표, 희망학교 접수·배정 현황도 있습니다.
              엑셀·한글에 붙여넣거나 CSV 로 내려받고, 그대로 인쇄할 수도 있습니다</td></tr>
          <tr><th>학생</th>
            <td>이름으로 찾아 신청부터 지금까지의 이력을 시간순으로 봅니다.
              체제비 지원 만료가 가까운 학생도 함께</td></tr>
          <tr><th>입력</th>
            <td>새 학생을 채우면 원본 시트의 열 차례 그대로 한 줄을 만들어 줍니다.
              복사해 원본에 붙여넣고 다시 읽으면 됩니다</td></tr>
          <tr><th>확인 항목</th>
            <td>원본에서 손봐야 할 곳. 집계 숫자를 움직이는 것과 그렇지 않은 것을 갈라 둡니다</td></tr>
        </tbody>
      </table>
      <p class="note" style="margin:16px 0 0">
        원본을 고친 뒤 '다시 읽기'를 누르면 모든 화면이 새 내용으로 다시 계산됩니다.
        크롬·엣지에서는 같은 파일을 다시 고르지 않아도 됩니다.</p>
    </section>
  </div>

  <div id="main" hidden>
    <div class="filebar" id="filebar"></div>
    <nav class="tabs">
      <button data-tab="summary" aria-selected="true">요약</button>
      <button data-tab="pivot" aria-selected="false">표 만들기</button>
      <button data-tab="students" aria-selected="false">학생</button>
      <button data-tab="entry" aria-selected="false">입력</button>
      <button data-tab="issues" aria-selected="false">확인 항목</button>
    </nav>
    <section id="tab-summary"></section>
    <section id="tab-pivot" hidden></section>
    <section id="tab-students" hidden></section>
    <section id="tab-entry" hidden></section>
    <section id="tab-issues" hidden></section>
  </div>
</div>
<div class="tip" id="tip"></div>
<div class="toast" id="toast"></div>
"""


def main(out: str):
    css = (HERE / "styles.css").read_text(encoding="utf-8")
    sheetjs = (HERE / "vendor" / "xlsx.full.min.js").read_text(encoding="utf-8")
    transform = (HERE / "transform.js").read_text(encoding="utf-8")
    app = (HERE / "app.js").read_text(encoding="utf-8")

    page = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>전북 농어촌유학생 현황</title>
<!-- 만든 날 {dt.date.today().isoformat()} -->
<!-- 엑셀 읽기: SheetJS (xlsx) 0.18.5, Apache-2.0 — web/vendor/xlsx-LICENSE.txt -->
<style>{css}</style>
</head>
<body>
{BODY}
<script>{sheetjs}</script>
<script>{transform}</script>
<script>{app}</script>
</body>
</html>
"""
    Path(out).write_text(page, encoding="utf-8")
    print(f"저장: {out}  ({len(page) / 1024:.0f} KB)")


if __name__ == "__main__":
    main(sys.argv[1])
