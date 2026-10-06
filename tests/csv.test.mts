import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentsCsv, parseCSV } from '../src/utils/csv';
import type { Student } from '../src/types';

const student: Student = {
  id: 's1', name: '김하윤', grade: '7세', scheduledDays: ['Mon', 'Wed'],
  scheduledStartTime: '16:00', scheduledEndTime: '17:00', fee: 250000, note: '유치반',
  withdrawnAt: null, preschool: true,
};

test('내보낸 원생 명단을 그대로 가져오면 미취학 표시까지 같은 원생이 된다', async () => {
  const csv = buildStudentsCsv([student, { ...student, id: 's2', name: '이서연', grade: '중1', preschool: false }]);
  const { students, skipped } = await parseCSV(csv);
  assert.equal(skipped.length, 0);
  assert.equal(students[0].preschool, true);
  assert.equal(students[1].preschool, false);
  assert.equal(students[0].note, '유치반');
  assert.equal(students[0].fee, 250000);
});

test('미취학 칸은 몇 가지 표기를 받고, 없는 옛 파일은 아니오로 읽는다', async () => {
  const header = 'name,grade,scheduledDays,scheduledStartTime,scheduledEndTime,preschool\n';
  const rows = ['가,7세,Mon,16:00,17:00,예', '나,7세,Mon,16:00,17:00,TRUE', '다,7세,Mon,16:00,17:00,아니오', '라,7세,Mon,16:00,17:00,'];
  const { students } = await parseCSV(header + rows.join('\n'));
  assert.deepEqual(students.map((s) => s.preschool), [true, true, false, false]);

  const old = await parseCSV('name,grade,scheduledDays,scheduledStartTime,scheduledEndTime\n마,초1,Mon,16:00,17:00');
  assert.equal(old.students[0].preschool, false);
});
