import React, { useEffect, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import PressableScale from '../components/common/PressableScale';
import { AcademyInfo, Payment } from '../types';
import type { RootStackParamList } from '../types/navigation';
import {
  buildCertificateHtml,
  certificatePayments,
  summarizeCertificate,
} from '../utils/certificate';
import { getCurrentDate } from '../utils/date';
import { formatWon } from '../utils/ledger';
import { KIND_LABEL } from '../utils/tax';
import { printHtml } from '../utils/print';
import { studentDisplayName } from '../utils/student';
import { haptic } from '../utils/haptics';
import { notify } from '../utils/dialog';
import { logger } from '../utils/logger';

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Form = styled.View`
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
`;

const Lead = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: 4px;
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const Label = styled.Text`
  font-size: 16px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const YearBar = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: 4px;
`;

const StepButton = styled(PressableScale)`
  padding: 10px;
`;

const YearText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 17px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Input = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Hint = styled.Text<{ $warn?: boolean }>`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme, $warn }) => ($warn ? theme.colors.secondaryStrong : theme.colors.textSecondary)};
  margin-top: 6px;
`;

const Preview = styled.View`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const Line = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding-vertical: 6px;
`;

const LineText = styled.Text<{ $bold?: boolean }>`
  font-family: ${({ theme, $bold }) => ($bold ? theme.fonts.bold : theme.fonts.regular)};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Divider = styled.View`
  height: 1px;
  background-color: ${({ theme }) => theme.colors.border};
  margin-vertical: 6px;
`;

const Actions = styled.View`
  margin-top: ${({ theme }) => theme.spacing.large}px;
  gap: 12px;
`;

/**
 * 증명서는 대개 연초에 지난해 것을 떼어 간다 (연말정산). 하반기에는 올해 것을 미리
 * 떼는 일이 많다. 신고용 자료와 같은 기준이다.
 */
const defaultYear = () => {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
};

const shortDate = (dateKey: string) => `${Number(dateKey.slice(5, 7))}.${Number(dateKey.slice(8))}`;

/**
 * 원생 한 명의 교육비납입증명서. 해를 고르고 미리 본 뒤 인쇄한다 (iPad 인쇄 화면에서
 * PDF로 저장도 된다). 증명서 내용은 utils/certificate가 만든다.
 */
const CertificateModal: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { params } = useRoute<RouteProp<RootStackParamList, 'CertificateModal'>>();
  const { students, loadPaymentsPaidBetween, loadAcademy } = useData();

  const student = students.find((s) => s.id === params.studentId);
  const [year, setYear] = useState(defaultYear);
  const [applicant, setApplicant] = useState('');
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [academy, setAcademy] = useState<AcademyInfo | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let alive = true;
    setPayments(null);
    Promise.all([loadPaymentsPaidBetween(`${year}-01-01`, `${year}-12-31`), loadAcademy()])
      .then(([rows, info]) => {
        if (!alive) return;
        setPayments(rows);
        setAcademy(info);
      })
      .catch((error) => {
        logger.error('Failed to load certificate data', error);
        if (alive) setPayments([]);
      });
    return () => {
      alive = false;
    };
  }, [year, loadPaymentsPaidBetween, loadAcademy]);

  const rows = useMemo(
    () => (payments && student ? certificatePayments(payments, student.id, year) : []),
    [payments, student, year]
  );
  const { total, preschool } = summarizeCertificate(rows);
  const missingAcademy = !academy?.name || !academy?.bizNumber;

  const print = async () => {
    if (!student) return;
    setPrinting(true);
    try {
      await printHtml(
        buildCertificateHtml({
          academy,
          student,
          payments: rows,
          year,
          issuedOn: getCurrentDate(),
          applicant,
        })
      );
      haptic('success');
    } catch (error) {
      logger.error('Failed to print certificate', error);
      notify('인쇄하지 못했습니다', error instanceof Error ? error.message : '다시 시도해 주세요.');
    } finally {
      setPrinting(false);
    }
  };

  const topInset = Platform.OS === 'ios' ? 0 : insets.top;

  if (!student) {
    return (
      <Root>
        <Form style={{ paddingTop: topInset + 32 }}>
          <Lead>원생을 찾을 수 없습니다.</Lead>
          <Button title="닫기" variant="secondary" onPress={() => navigation.goBack()} />
        </Form>
      </Root>
    );
  }

  return (
    <Root>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <Form>
            <TitleText>교육비 납입 증명서</TitleText>
            <Lead>
              {studentDisplayName(student)} · {student.grade}
            </Lead>

            <Label style={{ marginTop: 0 }}>어느 해</Label>
            <YearBar>
              <StepButton
                onPress={() => setYear((y) => y - 1)}
                pressScale={0.85}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel="이전 해"
              >
                <Ionicons name="chevron-back" size={20} color={theme.colors.primaryStrong} />
              </StepButton>
              <YearText>{year}년 납입분</YearText>
              <StepButton
                onPress={() => setYear((y) => y + 1)}
                disabled={year >= new Date().getFullYear()}
                pressScale={0.85}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel="다음 해"
              >
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={
                    year >= new Date().getFullYear()
                      ? theme.colors.border
                      : theme.colors.primaryStrong
                  }
                />
              </StepButton>
            </YearBar>

            <Label>신청인 (보호자) 이름 (선택)</Label>
            <Input
              value={applicant}
              onChangeText={setApplicant}
              placeholder="비우면 빈 칸으로 인쇄됩니다"
              accessibilityLabel="신청인 이름"
            />
            <Hint>저장하지 않습니다. 주민등록번호·주소는 인쇄된 종이에 직접 적어 주세요.</Hint>

            <Label>납입 내역</Label>
            <Preview>
              {payments === null ? (
                <ActivityIndicator color={theme.colors.primaryStrong} />
              ) : rows.length === 0 ? (
                <LineText>{year}년에 받은 기록이 없습니다.</LineText>
              ) : (
                <>
                  {rows.map((p) => (
                    <Line key={p.id}>
                      <LineText>
                        {shortDate(p.paidOn)} · {Number(p.month.slice(5))}월분 · {KIND_LABEL[p.kind]}
                        {p.amount < 0 ? ' (환불)' : ''}
                      </LineText>
                      <LineText>{formatWon(p.amount)}</LineText>
                    </Line>
                  ))}
                  <Divider />
                  <Line>
                    <LineText $bold>합계</LineText>
                    <LineText $bold>{formatWon(total)}</LineText>
                  </Line>
                  {preschool !== 0 && (
                    <Line>
                      <LineText>그중 취학 전 납입 (교육비 공제)</LineText>
                      <LineText>{formatWon(preschool)}</LineText>
                    </Line>
                  )}
                </>
              )}
            </Preview>

            {missingAcademy && payments !== null && (
              <Hint $warn>
                학원 상호·사업자등록번호가 비어 있습니다. [설정] 탭의 학원 정보를 채우면 증명서에
                들어갑니다. 지금 인쇄하면 그 칸은 빈 칸으로 나옵니다.
              </Hint>
            )}

            <Actions>
              <Button
                title={printing ? '여는 중…' : '인쇄 · PDF로 저장'}
                onPress={print}
                disabled={printing || payments === null}
              />
              <View>
                <Button title="닫기" variant="secondary" onPress={() => navigation.goBack()} />
              </View>
            </Actions>
            <Hint style={{ textAlign: 'center' }}>
              인쇄 화면 위쪽의 공유 버튼(또는 미리보기를 두 손가락으로 벌리기)으로 PDF로 저장하거나 보낼 수 있습니다.
            </Hint>
          </Form>
        </ScrollView>
      </KeyboardAvoidingView>
    </Root>
  );
};

export default CertificateModal;
