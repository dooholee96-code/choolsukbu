import React, { useCallback, useState } from 'react';
import styled from 'styled-components/native';
import { ScrollView } from 'react-native';
import { useData } from '../hooks/useData';
import Screen from '../components/common/Screen';
import Button from '../components/common/Button';
import AcademySection from '../components/AcademySection';
import FeeRulesSection from '../components/FeeRulesSection';
import {
  buildAttendanceCsv,
  buildExceptionCsv,
  buildMakeupCsv,
  buildStudentsCsv,
  parseCSV,
} from '../utils/csv';
import { backupStamp, exportCsv, exportFile, pickBackupText, pickCsvText } from '../utils/backup';
import {
  buildAcademyReviewCsv,
  buildPaymentLedgerCsv,
  buildPreschoolCsv,
  buildRevenueSummaryCsv,
} from '../utils/tax';
import { confirm, notify } from '../utils/dialog';
import LockSection from '../components/LockSection';
import { useAppLockContext } from '../hooks/appLockContext';
import { logger } from '../utils/logger';
import type { Payment, Student } from '../types';

/* 설정은 한 줄로 읽는 글이 많아 넓은 화면에서도 폭을 묶어 둔다. */
const Content = styled.View`
  width: 100%;
  max-width: 640px;
  align-self: center;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Lead = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  line-height: 21px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

/* 묶음 하나. 설정이 길어서 카드로 나눠야 어디까지가 한 일인지 보인다. */
const Card = styled.View`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: ${({ theme }) => theme.spacing.medium}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const SectionTitle = styled.Text`
  font-size: 16px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 6px;
`;

const Note = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 20px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const Stack = styled.View`
  gap: 10px;
`;

const YearBar = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const YearText = styled.Text`
  font-size: 18px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  min-width: 90px;
  text-align: center;
`;

/**
 * 신고 자료의 기본 연도. 신고는 대부분 지난해 것을 낸다 — 1월 교육비납입증명서,
 * 2월 사업장현황신고, 5월 종합소득세. 그 뒤로는 올해 것을 미리 보는 일이 많다.
 */
const defaultTaxYear = () => {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
};

/**
 * 설정 탭. 예전에는 [원생] 탭의 톱니바퀴로 여는 시트였는데, 학원 정보·신고 자료·백업처럼
 * 원생과 상관없는 것이 늘어 탭으로 뺐다.
 */
const SettingsScreen: React.FC = () => {
  const lock = useAppLockContext();
  const {
    students,
    loadAllAttendance,
    loadAllMakeups,
    loadAllExceptions,
    importStudents,
    exportBackup,
    restoreBackup,
    loadPaymentsPaidBetween,
    loadStudentsIncludingDeleted,
    lastSyncAt,
    syncUnavailable,
    syncError,
    syncing,
    syncNow,
  } = useData();
  const [busy, setBusy] = useState(false);
  const [taxYear, setTaxYear] = useState(defaultTaxYear);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      logger.error('Backup action failed', error);
      notify('실패', error instanceof Error ? error.message : '작업을 마치지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * 기기 전체를 파일 하나로. CSV는 사람이 읽으려고 만든 것이라 되돌릴 수 없다 —
   * id도 관계도 없어서 출결을 어느 원생 것으로 붙일지 알 수 없다.
   */
  const exportWhole = () =>
    run(async () => {
      await exportFile(`출석부_전체백업_${backupStamp()}.json`, await exportBackup(), 'json');
    });

  const restoreWhole = () =>
    run(async () => {
      const text = await pickBackupText();
      if (text === null) return;

      const result = await restoreBackup(text);
      if (!result) {
        notify('복원할 수 없는 파일', '이 앱이 만든 전체 백업 파일(.json)을 골라 주세요.');
        return;
      }

      const { summary, applied } = result;
      notify(
        applied > 0 ? '복원했습니다' : '되돌릴 것이 없습니다',
        `백업 시점: ${new Date(summary.exportedAt).toLocaleString('ko-KR')}\n` +
          `원생 ${summary.students} · 출결 ${summary.attendance} · 보충 ${summary.makeups} · 수납 ${summary.payments}\n\n` +
          (applied > 0
            ? `${applied}건을 되돌렸습니다.`
            : '이미 이 기기에 모두 있는 기록입니다.')
      );
    });

  const exportStudents = () =>
    run(async () => {
      if (students.length === 0) {
        notify('내보낼 원생이 없습니다.');
        return;
      }
      await exportCsv(`출석부_원생_${backupStamp()}.csv`, buildStudentsCsv(students));
    });

  const exportAttendance = () =>
    run(async () => {
      const records = await loadAllAttendance();
      if (records.length === 0) {
        notify('내보낼 출결 기록이 없습니다.');
        return;
      }
      await exportCsv(`출석부_출결_${backupStamp()}.csv`, buildAttendanceCsv(records, students));
    });

  const exportExceptions = () =>
    run(async () => {
      const records = await loadAllExceptions();
      if (records.length === 0) {
        notify('내보낼 일정 변경이 없습니다.');
        return;
      }
      await exportCsv(`출석부_일정_${backupStamp()}.csv`, buildExceptionCsv(records, students));
    });

  const exportMakeups = () =>
    run(async () => {
      const records = await loadAllMakeups();
      if (records.length === 0) {
        notify('내보낼 보충 기록이 없습니다.');
        return;
      }
      await exportCsv(`출석부_보충_${backupStamp()}.csv`, buildMakeupCsv(records, students));
    });

  /**
   * 신고 자료 하나. 그 해에 받은 돈(받은 날 기준)을 읽어 표로 만든다.
   * 이름은 지운 원생까지 찾는다 — 지운 원생에게 받은 돈도 그 해 수입이다.
   */
  const exportTax = (
    label: string,
    build: (payments: Payment[], students: Student[]) => string
  ) =>
    run(async () => {
      const [payments, everyone] = await Promise.all([
        loadPaymentsPaidBetween(`${taxYear}-01-01`, `${taxYear}-12-31`),
        loadStudentsIncludingDeleted(),
      ]);
      if (payments.length === 0) {
        notify(
          `${taxYear}년에 받은 돈 기록이 없습니다.`,
          '[수납] 탭에서 받은 돈을 기록하면 여기에 모입니다.'
        );
        return;
      }
      await exportCsv(`출석부_${taxYear}_${label}.csv`, build(payments, everyone));
    });

  const importRoster = () =>
    run(async () => {
      const text = await pickCsvText();
      if (text === null) return;

      const { students: parsed, skipped } = await parseCSV(text);
      if (parsed.length === 0) {
        notify(
          '가져올 원생이 없습니다',
          skipped.length
            ? `${skipped.length}행을 해석하지 못했습니다.\n첫 줄: ${skipped[0].reason}`
            : '파일이 비어 있거나 형식이 다릅니다.'
        );
        return;
      }

      confirm({
        title: '원생 가져오기',
        message:
          `${parsed.length}명을 가져옵니다.` +
          (skipped.length ? `\n형식이 맞지 않는 ${skipped.length}행은 건너뜁니다.` : '') +
          '\n이름·학년·구분이 모두 같은 원생은 추가하지 않습니다.',
        confirmLabel: '가져오기',
        onConfirm: async () => {
          try {
            const { added, skipped: dupes } = await importStudents(parsed);
            notify(
              '가져오기 완료',
              `${added}명 추가${dupes ? `, 중복 ${dupes}명 건너뜀` : ''}`
            );
          } catch {
            notify('실패', '원생을 가져오지 못했습니다.');
          }
        },
      });
    });

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Content>
          <TitleText>설정</TitleText>
          <Lead>
            이 앱은 기기 안에만 저장합니다. 앱을 지우거나 기기를 바꾸면 기록도 함께
            사라지니 전체 백업을 가끔 해 두세요.
          </Lead>

          <Card>
            <SectionTitle>학원 정보</SectionTitle>
            <Note>교육비 납입 증명서의 학원 칸에 들어갑니다.</Note>
            <AcademySection />
          </Card>

          <Card>
            <SectionTitle>수강료 기준 · 수업 시간</SectionTitle>
            <FeeRulesSection />
          </Card>

          <Card>
          <LockSection onChanged={lock.refresh} />
          </Card>

          <Card>
          <SectionTitle>기기 간 동기화</SectionTitle>
          {syncUnavailable ? (
            <Note>{syncUnavailable}</Note>
          ) : (
            <>
              <Note>
                {lastSyncAt
                  ? `마지막으로 맞춘 시각 ${new Date(lastSyncAt).toLocaleString('ko-KR')}`
                  : '아직 한 번도 맞추지 않았습니다.'}
                {'\n'}같은 iCloud 계정을 쓰는 기기끼리 자동으로 맞춰집니다.
                {syncError ? `\n\n마지막 시도 실패: ${syncError}` : ''}
              </Note>
              <Button
                title={syncing ? '맞추는 중…' : '지금 맞추기'}
                variant="secondary"
                onPress={() => {
                  syncNow().catch(() => {});
                }}
                disabled={syncing || busy}
              />
            </>
          )}
          </Card>

          <Card>
          <SectionTitle>신고용 자료 (홈택스)</SectionTitle>
          <Note>
            [수납] 탭에 기록한 받은 돈으로 만듭니다. 연도는 받은 날 기준입니다.
            {'\n'}· 사업장현황신고(2월 10일까지): 수입금액과 그 구성(신용카드·현금영수증·기타)
            {'\n'}· 학원사업자 수입금액검토표(사업장현황신고 때 함께): 수입구분별 금액, 단가별
            수강연인원
            {'\n'}· 수납 장부: 받은 돈 한 건씩 — 종합소득세(5월)의 근거
            {'\n'}· 미취학 아동 교육비: 보호자가 요청하는 교육비납입증명서에 옮길 금액
            {'\n\n'}홈택스에 자동으로 제출하지는 않습니다. 숫자를 옮겨 적거나 세무사에게
            전달하세요. 시설·직원·경비처럼 수납 기록에 없는 칸은 직접 채웁니다.
          </Note>
          <YearBar>
            <Button
              title="◀"
              variant="secondary"
              size="compact"
              onPress={() => setTaxYear((y) => y - 1)}
              accessibilityLabel="이전 해"
            />
            <YearText>{taxYear}년</YearText>
            <Button
              title="▶"
              variant="secondary"
              size="compact"
              onPress={() => setTaxYear((y) => y + 1)}
              disabled={taxYear >= new Date().getFullYear()}
              accessibilityLabel="다음 해"
            />
          </YearBar>
          <Stack>
            <Button
              title="사업장현황신고 수입금액"
              onPress={() =>
                exportTax('사업장현황신고', (payments) => buildRevenueSummaryCsv(payments, taxYear))
              }
              disabled={busy}
            />
            <Button
              title="학원사업자 수입금액검토표"
              onPress={() =>
                exportTax('수입금액검토표', (payments) => buildAcademyReviewCsv(payments, taxYear))
              }
              disabled={busy}
            />
            <Button
              title="수납 장부 (한 건씩)"
              onPress={() =>
                exportTax('수납장부', (payments, everyone) => buildPaymentLedgerCsv(payments, everyone))
              }
              disabled={busy}
            />
            <Button
              title="미취학 아동 교육비"
              onPress={() =>
                exportTax('미취학교육비', (payments, everyone) =>
                  buildPreschoolCsv(payments, everyone, taxYear)
                )
              }
              disabled={busy}
            />
          </Stack>
          </Card>

          <Card>
          <SectionTitle>전체 백업</SectionTitle>
          <Note>
            기록 전부를 파일 하나로 저장하고, 그 파일로 되돌립니다. 기기를 바꾸거나
            앱을 지웠을 때 쓰는 것은 이쪽입니다.
            {'\n'}복원은 덮어쓰기가 아니라 합치기라, 백업 이후에 찍은 기록은 그대로
            남고 같은 파일을 두 번 복원해도 두 배가 되지 않습니다.
          </Note>
          <Stack>
            <Button title="전체 백업 저장" onPress={exportWhole} disabled={busy} />
            <Button title="백업에서 복원" variant="secondary" onPress={restoreWhole} disabled={busy} />
          </Stack>
          </Card>

          <Card>
          <SectionTitle>표로 내보내기</SectionTitle>
          <Note>
            엑셀에서 열어 보려고 만드는 것입니다. 되돌릴 수는 없습니다 — 사람이 읽는
            형식이라 기록끼리의 연결이 빠집니다. 복구용으로는 위의 전체 백업을 쓰세요.
          </Note>
          <Stack>
            <Button title="원생 명단" onPress={exportStudents} disabled={busy} />
            <Button title="출결 기록 (전체)" onPress={exportAttendance} disabled={busy} />
            <Button title="보충 기록" onPress={exportMakeups} disabled={busy} />
            <Button title="일정 변경 (휴강·특강)" onPress={exportExceptions} disabled={busy} />
          </Stack>
          </Card>

          <Card>
          <SectionTitle>가져오기</SectionTitle>
          <Note>
            원생 명단만 가져옵니다. 내보내기로 만든 파일과 같은 형식이어야 합니다
            {'\n'}(name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes,
            fee, note, withdrawnAt, preschool).
            {'\n'}이름·학년·구분이 모두 같은 원생은 건너뜁니다. 동명이인은 구분(note)을 적어
            주세요.
            {'\n'}출결 기록은 덮어쓸 위험이 커서 가져오기를 지원하지 않습니다.
          </Note>
          <Button title="원생 명단 가져오기" variant="secondary" onPress={importRoster} disabled={busy} />
          </Card>

        </Content>
      </ScrollView>
    </Screen>
  );
};

export default SettingsScreen;
