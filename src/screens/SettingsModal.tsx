import React, { useCallback, useState } from 'react';
import styled from 'styled-components/native';
import { Platform, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import { parseCSV } from '../utils/csv';
import {
  backupStamp,
  buildAttendanceCsv,
  buildMakeupCsv,
  buildExceptionCsv,
  buildStudentsCsv,
  exportCsv,
  pickCsvText,
  pickBackupText,
  exportFile,
} from '../utils/backup';
import { confirm, notify } from '../utils/dialog';
import LockSection from '../components/LockSection';
import { useAppLockContext } from '../hooks/appLockContext';
import { logger } from '../utils/logger';

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Content = styled.View`
  width: 100%;
  max-width: 560px;
  align-self: center;
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 24px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const Lead = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  line-height: 21px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const SectionTitle = styled.Text`
  font-size: 15px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: ${({ theme }) => theme.spacing.large}px;
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

const SettingsModal: React.FC = () => {
  const navigation = useNavigation();
  const lock = useAppLockContext();
  const insets = useSafeAreaInsets();
  const {
    students,
    loadAllAttendance,
    loadAllMakeups,
    loadAllExceptions,
    importStudents,
    exportBackup,
    restoreBackup,
    lastSyncAt,
    syncUnavailable,
    syncError,
    syncing,
    syncNow,
  } = useData();
  const [busy, setBusy] = useState(false);

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
          `원생 ${summary.students} · 출결 ${summary.attendance} · 보충 ${summary.makeups}\n\n` +
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
          '\n이미 같은 이름이 있으면 추가하지 않습니다.',
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
    <Root>
      <ScrollView
        // flex 없이는 ScrollView가 내용 높이만큼 커져서 시트 밖으로 잘려 나가고,
        // 스크롤 영역이 화면보다 커지므로 스크롤도 먹지 않는다.
        style={{ flex: 1 }}
        contentContainerStyle={{
          // iOS의 modal/formSheet는 상태 표시줄 아래에서 시작하므로 창의 top 인셋을 더하면 안 된다.
          paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Content>
          <TitleText>설정</TitleText>
          <Lead>
            이 앱은 기기 안에만 저장합니다.{'\n'}
            앱을 지우거나 기기를 바꾸면 기록도 함께 사라집니다.
          </Lead>

          <LockSection onChanged={lock.refresh} />

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

          <SectionTitle>가져오기</SectionTitle>
          <Note>
            원생 명단만 가져옵니다. 내보내기로 만든 파일과 같은 형식이어야 합니다
            {'\n'}(name, grade, scheduledDays, scheduledStartTime, scheduledEndTime, dayTimes, fee).
            {'\n'}출결 기록은 덮어쓸 위험이 커서 가져오기를 지원하지 않습니다.
          </Note>
          <Button title="원생 명단 가져오기" variant="secondary" onPress={importRoster} disabled={busy} />

          <View style={{ marginTop: 28 }}>
            <Button title="닫기" variant="secondary" onPress={() => navigation.goBack()} />
          </View>
        </Content>
      </ScrollView>
    </Root>
  );
};

export default SettingsModal;
