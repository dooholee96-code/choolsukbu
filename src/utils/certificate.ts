import { AcademyInfo, Payment, Student } from '../types';
import { KIND_LABEL } from './tax';

/**
 * 원생 한 명의 교육비납입증명서 (인쇄용 HTML).
 *
 * 보호자가 연말정산에 내려고 학원에 받아 가는 증명서다. 취학 전 아동의 학원비는
 * 교육비 세액공제 대상인데 연말정산 간소화에 나오지 않아서 이 증명서가 필요하다.
 * 그 밖의 학생도 회사 복지 등으로 납입 사실 증명을 요청하는 일이 있어 누구에게나 뽑는다.
 *
 * 칸은 학원 교육비 납입증명서의 항목을 따른다 — 신청인, 학원생, 학원(상호·사업자등록번호·
 * 소재지·전화번호·교육 내용), 납입 내역, 발급일과 학원 확인.
 *
 * 주민등록번호·주소·관계 칸은 비워서 뽑는다. 이 앱은 그런 정보를 받지도 담지도 않는다.
 * 뽑은 종이에 손으로 쓰거나, PDF로 저장한 뒤 채운다.
 */

export interface CertificateInput {
  academy: AcademyInfo | null;
  student: Student;
  /** 이 원생의 그 해 수납 (받은 날 기준). 다른 원생·다른 해가 섞여 있어도 걸러 낸다. */
  payments: Payment[];
  year: number;
  /** 발급일 'YYYY-MM-DD' */
  issuedOn: string;
  /** 신청인(보호자) 이름. 비우면 빈 칸으로 뽑는다. 저장하지 않는다. */
  applicant?: string;
}

/** 이름이나 메모에 <, & 가 들어가도 표가 깨지지 않게. */
export const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

const dateLabel = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
};

/** 그 해, 그 원생, 받은 날 순. 화면 미리보기와 인쇄물이 같은 목록을 쓴다. */
export const certificatePayments = (payments: Payment[], studentId: string, year: number) =>
  payments
    .filter((p) => p.studentId === studentId && p.paidOn.startsWith(`${year}-`) && !p.deletedAt)
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));

export const summarizeCertificate = (rows: Payment[]) => ({
  total: rows.reduce((sum, p) => sum + p.amount, 0),
  /** 받는 순간 미취학이었던 것만. 교육비 공제가 되는 금액이다. */
  preschool: rows.filter((p) => p.preschool).reduce((sum, p) => sum + p.amount, 0),
});

/** 비어 있으면 손으로 쓸 자리를 남긴다. */
const field = (value: string | undefined) =>
  value?.trim() ? escapeHtml(value.trim()) : '<span class="blank"></span>';

export const buildCertificateHtml = ({
  academy,
  student,
  payments,
  year,
  issuedOn,
  applicant,
}: CertificateInput): string => {
  const rows = certificatePayments(payments, student.id, year);
  const { total, preschool } = summarizeCertificate(rows);

  const lines = rows
    .map(
      (p) => `
        <tr>
          <td>${dateLabel(p.paidOn)}</td>
          <td>${Number(p.month.slice(5))}월분</td>
          <td>${escapeHtml(KIND_LABEL[p.kind])}${p.amount < 0 ? ' (환불)' : ''}</td>
          <td class="num">${won(p.amount)}</td>
        </tr>`
    )
    .join('');

  const studentName = escapeHtml(student.name);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>교육비 납입 증명서 - ${studentName} (${year})</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    color: #111; font-size: 12.5pt; line-height: 1.5; margin: 0;
  }
  h1 { text-align: center; font-size: 22pt; letter-spacing: 0.3em; margin: 0 0 4pt; }
  .sub { text-align: center; color: #444; margin: 0 0 14pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
  th, td { border: 1px solid #333; padding: 6pt 8pt; vertical-align: middle; }
  th { background: #f1f1f1; font-weight: 600; white-space: nowrap; }
  .section th.group { width: 18%; }
  .num { text-align: right; white-space: nowrap; }
  .blank { display: inline-block; min-width: 40mm; }
  .list th { text-align: center; }
  .total td { font-weight: 700; background: #fafafa; }
  .note { font-size: 10.5pt; color: #333; margin: 4pt 0 0; }
  .statement { text-align: center; margin: 22pt 0 10pt; font-size: 13pt; }
  .date { text-align: center; margin-bottom: 18pt; }
  .sign { text-align: right; font-size: 13pt; }
  .sign .stamp { display: inline-block; margin-left: 10pt; color: #888; }
  .foot { margin-top: 18pt; font-size: 9.5pt; color: #555; border-top: 1px solid #bbb; padding-top: 6pt; }
</style>
</head>
<body>
  <h1>교육비 납입 증명서</h1>
  <p class="sub">(학원 교육비 · ${year}년 1월 1일 ~ 12월 31일 납입분)</p>

  <table class="section">
    <tr>
      <th class="group" rowspan="2">신청인</th>
      <th>성명</th><td>${field(applicant)}</td>
      <th>주민등록번호</th><td>${field('')}</td>
    </tr>
    <tr>
      <th>학원생과의 관계</th><td colspan="3">${field('')}</td>
    </tr>
    <tr>
      <th class="group" rowspan="2">학원생</th>
      <th>성명</th><td>${studentName}</td>
      <th>주민등록번호</th><td>${field('')}</td>
    </tr>
    <tr>
      <th>주소</th><td colspan="3">${field('')}</td>
    </tr>
    <tr>
      <th class="group" rowspan="3">학원</th>
      <th>상호</th><td>${field(academy?.name)}</td>
      <th>사업자등록번호</th><td>${field(academy?.bizNumber)}</td>
    </tr>
    <tr>
      <th>소재지</th><td colspan="3">${field(academy?.address)}</td>
    </tr>
    <tr>
      <th>전화번호</th><td>${field(academy?.phone)}</td>
      <th>교육 내용</th><td>${field(academy?.subject)}</td>
    </tr>
  </table>

  <table class="list">
    <tr><th>납입일</th><th>수강월</th><th>구분</th><th>금액</th></tr>
    ${lines || '<tr><td colspan="4" style="text-align:center">이 기간에 납입한 내역이 없습니다.</td></tr>'}
    <tr class="total"><td colspan="3">합계</td><td class="num">${won(total)}</td></tr>
  </table>
  ${
    preschool !== 0
      ? `<p class="note">위 금액 중 초등학교 입학 전에 납입한 금액(취학 전 아동 교육비): <b>${won(preschool)}</b></p>`
      : ''
  }

  <p class="statement">위와 같이 교육비를 납입하였음을 증명합니다.</p>
  <p class="date">${dateLabel(issuedOn)}</p>
  <p class="sign">
    ${field(academy?.name)} &nbsp; 대표 ${field(academy?.owner)}
    <span class="stamp">(인)</span>
  </p>

  <p class="foot">
    주민등록번호·주소·관계는 이 증명서를 발급한 프로그램이 보관하지 않는 정보라 비워 두었습니다.
    제출 전에 직접 적어 주세요.
  </p>
</body>
</html>`;
};
