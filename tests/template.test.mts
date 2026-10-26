import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { parseCSV, STUDENT_HEADERS } from '../src/utils/csv';
import { parsePaymentsCsv, PAYMENT_HEADERS } from '../src/utils/paymentImport';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));

/** xlsx(zip) 안의 파일 하나를 꺼낸다. 의존성 없이 중앙 디렉터리만 읽는다. */
const unzip = (zip: Buffer, name: string): string => {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = zip.readUInt32LE(end + 16);
  const count = zip.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (entry === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    at += 46 + nameLength + extra + comment;
  }
  throw new Error(`${name} 없음`);
};

const text = (xml: string) =>
  xml
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const attrs = (tag: string) =>
  Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** 시트의 첫 줄 글자들. openpyxl은 칸 안에 바로(inlineStr), 엑셀은 sharedStrings에 적는다. */
const headerRow = (zip: Buffer, sheet: string): string[] => {
  const sheets = [...unzip(zip, 'xl/workbook.xml').matchAll(/<sheet [^>]*>/g)].map((m) => attrs(m[0]));
  const rid = sheets.find((s) => s.name === sheet)?.['r:id'];
  const rels = [...unzip(zip, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*>/g)].map((m) => attrs(m[0]));
  const target = rels.find((r) => r.Id === rid)?.Target;
  assert.ok(target, `${sheet} 시트 없음`);
  const xml = unzip(zip, `xl/${target!.replace(/^\/?xl\//, '')}`);
  let shared: string[] = [];
  try {
    shared = [...unzip(zip, 'xl/sharedStrings.xml').matchAll(/<si>.*?<t[^>]*>(.*?)<\/t>.*?<\/si>/gs)].map((m) => m[1]);
  } catch {
    // openpyxl은 sharedStrings를 만들지 않는다
  }
  const row1 = /<row [^>]*r="1"[^>]*>(.*?)<\/row>/s.exec(xml)?.[1] ?? '';
  return [...row1.matchAll(/<c ([^>]*)>(.*?)<\/c>/gs)].map(([, head, body]) =>
    text(
      attrs(head).t === 's'
        ? shared[Number(/<v>(\d+)<\/v>/.exec(body)?.[1])]
        : (/<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? '')
    )
  );
};

const template = read('templates/출석부_엑셀양식.xlsx');

test('엑셀 양식 원생 시트의 머리글을 앱이 모두 알아본다', () => {
  const headers = headerRow(template, '원생');
  assert.ok(headers.length > 0);
  for (const header of headers) assert.ok(header in STUDENT_HEADERS, `원생 시트 '${header}'`);
  for (const must of ['이름', '요일', '시작', '끝']) assert.ok(headers.includes(must), must);
});

test('엑셀 양식 수납 시트의 머리글을 앱이 모두 알아본다', () => {
  const headers = headerRow(template, '수납');
  const known = Object.values(PAYMENT_HEADERS) as string[];
  for (const header of headers) assert.ok(known.includes(header), `수납 시트 '${header}'`);
  for (const must of known) assert.ok(headers.includes(must), `수납 시트에 '${must}' 없음`);
});

// tests/fixtures/엑셀양식-*.csv 는 양식에 예시를 채우고 LibreOffice로 시트마다 CSV로 저장한 그대로다.
// 빈 수식 줄이 수백 줄 따라오는 것까지 실제 엑셀 저장과 같다.
test('양식에서 저장한 CSV가 원생 → 수납 순서로 그대로 들어온다', async () => {
  const roster = await parseCSV('﻿' + read('tests/fixtures/엑셀양식-원생.csv').toString('utf8'));
  assert.deepEqual(roster.skipped, []);
  assert.equal(roster.students.length, 6);
  const [haneul, jun, junMwf, seoyeon, min, saebom] = roster.students;
  assert.deepEqual(haneul.scheduledDays, ['Mon', 'Wed']);
  assert.equal(haneul.preschool, true);
  assert.deepEqual(junMwf.scheduledDays, ['Mon', 'Wed', 'Fri']);
  assert.equal(junMwf.note, '월수반');
  assert.equal(seoyeon.scheduledEndTime, '18:30');
  assert.equal(min.withdrawnAt, '2026-05-15');
  assert.equal(saebom.note, '강북');

  const result = parsePaymentsCsv(
    '﻿' + read('tests/fixtures/엑셀양식-수납.csv').toString('utf8'),
    roster.students,
    []
  );
  assert.deepEqual(result.skipped, []);
  assert.equal(result.payments.length, 10);
  const byJun = result.payments.filter((p) => p.studentId === jun.id);
  assert.equal(byJun.length, 4, '구분 없는 이준');
  const mwf = result.payments.filter((p) => p.studentId === junMwf.id);
  assert.equal(mwf.length, 1, '월수반 이준');
  assert.equal(mwf[0].preschool, false, '양식의 미취학 칸이 동명이인을 구분 없는 이준과 헷갈리지 않는다');
  assert.ok(byJun.every((p) => p.preschool), '구분 없는 이준은 공제 대상');
  assert.equal(result.payments.filter((p) => p.studentId === saebom.id).length, 1, '이름이 하나뿐이면 구분 없이도 찾는다');
  assert.equal(result.payments.find((p) => p.note === '수강월 비움')!.month, '2026-05', '수강월이 비면 받은 달');
  const refund = byJun.find((p) => p.amount < 0)!;
  assert.equal(refund.method, 'transfer');
  assert.equal(refund.note, '환불');
  assert.equal(byJun.find((p) => p.amount === 30000)!.kind, 'materials');
  assert.equal(result.payments.find((p) => p.note === '4월분 미리')!.month, '2026-04');

  // 같은 파일을 다시 가져오면 모두 겹친다
  const again = parsePaymentsCsv(read('tests/fixtures/엑셀양식-수납.csv').toString('utf8'), roster.students, result.payments);
  assert.equal(again.payments.length, 0);
  assert.equal(again.duplicates, 10);
});
