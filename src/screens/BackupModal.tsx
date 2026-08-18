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
} from '../utils/backup';
import { confirm, notify } from '../utils/dialog';
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

const BackupModal: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    students,
    loadAllAttendance,
    loadAllMakeups,
    loadAllExceptions,
    importStudents,
    lastSyncAt,
    syncUnavailable,
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
          <TitleText>백업</TitleText>
          <Lead>
            이 앱은 기기 안에만 저장합니다.{'\n'}
            앱을 지우거나 기기를 바꾸면 기록도 함께 사라집니다.
          </Lead>

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

          <SectionTitle>내보내기</SectionTitle>
          <Note>
            CSV 파일로 저장한 뒤 공유 시트에서 보관할 곳을 고릅니다. 엑셀에서 바로 열립니다.
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

export default BackupModal;
