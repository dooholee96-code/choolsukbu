import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { subDays } from 'date-fns';
import { useData } from '../hooks/useData';
import { useCertificateBatch } from '../hooks/useCertificateBatch';
import Button from './common/Button';
import PressableScale from './common/PressableScale';
import { Payment } from '../types';
import { fromDateKey, toDateKey } from '../utils/date';
import { deadlineLabel, deadlineTaxYear, upcomingDeadlines, UpcomingDeadline } from '../utils/deadlines';
import { formatWon } from '../utils/ledger';
import { logger } from '../utils/logger';
import { studentDisplayName } from '../utils/student';
import { CASH_RECEIPT_REQUIRED_FROM, METHOD_LABEL, needsCashReceipt } from '../utils/tax';

const Box = styled.View<{ $color: string }>`
  background-color: ${({ $color }) => $color}1F;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ $color }) => $color}55;
  padding: ${({ theme }) => theme.spacing.medium}px;
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
`;

const TitleRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const Title = styled.Text`
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const When = styled.Text<{ $color: string }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ $color }) => $color};
`;

const Detail = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

const Actions = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
`;

const Line = styled(PressableScale)`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding-vertical: 8px;
  border-top-width: 1px;
  border-top-color: ${({ theme }) => theme.colors.border};
`;

const LineText = styled.Text`
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const LineAmount = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const More = styled(PressableScale)`
  padding-top: 8px;
  align-self: flex-start;
`;

const MoreText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.primaryStrong};
`;

/** 이만큼 지난 수납까지 현금영수증 누락을 찾는다. 사업장현황신고가 지난해 전체를 보므로 1년. */
const RECEIPT_LOOKBACK_DAYS = 365;
/** 접어 둘 때 보이는 줄 수 */
const COLLAPSED_LINES = 3;

const shortDate = (dateKey: string) => `${Number(dateKey.slice(5, 7))}.${Number(dateKey.slice(8))}`;

/**
 * 세무 비서. [수납] 탭 위에서 두 가지를 챙긴다.
 *
 *   1. 다가오는 신고 일정 (utils/deadlines). 눌러서 바로 증명서를 뽑거나 신고 자료로 간다.
 *   2. 현금영수증을 끊어야 했는데 표시가 없는 수납. 학원은 의무발행업종이라 10만 원 이상을
 *      현금·계좌이체로 받으면 요청이 없어도 발급해야 하고, 빠뜨리면 가산세가 붙는다.
 *
 * 할 일이 없으면 아무것도 그리지 않는다. 늘 떠 있는 안내는 금방 안 읽힌다.
 */
const TaxAssistant: React.FC = () => {
  const { students, today, revision, loadPaymentsPaidBetween } = useData();
  const theme = useTheme();
  const navigation = useNavigation();
  const { printAll, printing } = useCertificateBatch();

  const [missing, setMissing] = useState<Payment[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const from = toDateKey(subDays(fromDateKey(today), RECEIPT_LOOKBACK_DAYS));
    loadPaymentsPaidBetween(from, today)
      .then((rows) => {
        if (cancelled) return;
        setMissing(
          rows
            .filter((p) => !p.deletedAt && needsCashReceipt(p))
            .sort((a, b) => b.paidOn.localeCompare(a.paidOn))
        );
      })
      .catch((error) => logger.error('Failed to load payments for receipts', error));
    return () => {
      cancelled = true;
    };
    // revision: 수납을 고치고 돌아오면 다시 본다.
  }, [today, revision, loadPaymentsPaidBetween]);

  const deadlines = useMemo(() => upcomingDeadlines(today), [today]);
  const names = useMemo(() => new Map(students.map((s) => [s.id, studentDisplayName(s)])), [students]);

  const openPayment = useCallback(
    (payment: Payment) =>
      navigation.navigate('PaymentModal', {
        studentId: payment.studentId,
        month: payment.month,
        paymentId: payment.id,
      }),
    [navigation]
  );

  const openExports = useCallback(
    () => navigation.navigate('Main', { screen: 'Settings' }),
    [navigation]
  );

  const deadlineTone = (deadline: UpcomingDeadline) =>
    !deadline.soft && deadline.daysLeft <= 14 ? theme.colors.dangerStrong : theme.colors.sunStrong;

  if (deadlines.length === 0 && missing.length === 0) return null;

  const shown = expanded ? missing : missing.slice(0, COLLAPSED_LINES);

  return (
    <View style={{ marginBottom: 8 }}>
      {deadlines.map((deadline) => {
        const year = deadlineTaxYear(deadline);
        const tone = deadlineTone(deadline);
        return (
          <Box key={deadline.key} $color={tone}>
            <TitleRow>
              <Ionicons name="calendar-outline" size={16} color={tone} />
              <Title>{deadline.title}</Title>
              <When $color={tone}>{deadlineLabel(deadline)}</When>
            </TitleRow>
            <Detail>{deadline.detail}</Detail>
            <Actions>
              {deadline.action === 'certificates' ? (
                <>
                  <Button
                    title={printing ? '만드는 중…' : `${year}년 미취학 원생 증명서`}
                    size="compact"
                    disabled={printing}
                    onPress={() => printAll(year, true)}
                  />
                  <Button
                    title="받은 원생 전원"
                    size="compact"
                    variant="secondary"
                    disabled={printing}
                    onPress={() => printAll(year, false)}
                  />
                </>
              ) : (
                <Button
                  title={`${year}년 신고용 자료`}
                  size="compact"
                  variant="secondary"
                  onPress={openExports}
                />
              )}
            </Actions>
          </Box>
        );
      })}

      {missing.length > 0 && (
        <Box $color={theme.colors.secondaryStrong}>
          <TitleRow>
            <Ionicons name="alert-circle" size={16} color={theme.colors.secondaryStrong} />
            <Title>현금영수증 확인 {missing.length}건</Title>
          </TitleRow>
          <Detail>
            {formatWon(CASH_RECEIPT_REQUIRED_FROM)} 이상을 현금·계좌이체로 받으면 요청이 없어도
            현금영수증을 발급해야 합니다. 보호자 번호를 모르면 국세청 지정번호(010-000-1234)로
            발급합니다. 이미 발급했다면 눌러서 표시해 주세요.
          </Detail>
          <View style={{ marginTop: 8 }}>
            {shown.map((payment) => (
              <Line
                key={payment.id}
                onPress={() => openPayment(payment)}
                pressScale={0.98}
                pressOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${names.get(payment.studentId) ?? '원생'} ${shortDate(payment.paidOn)} 수납 열기`}
              >
                <LineText numberOfLines={1}>
                  {shortDate(payment.paidOn)} · {names.get(payment.studentId) ?? '(삭제된 원생)'} ·{' '}
                  {METHOD_LABEL[payment.method]}
                </LineText>
                <LineAmount>{formatWon(payment.amount)}</LineAmount>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
              </Line>
            ))}
          </View>
          {missing.length > COLLAPSED_LINES && (
            <More
              onPress={() => setExpanded((v) => !v)}
              pressScale={0.95}
              accessibilityRole="button"
            >
              <MoreText>{expanded ? '접기' : `${missing.length - COLLAPSED_LINES}건 더 보기`}</MoreText>
            </More>
          )}
        </Box>
      )}
    </View>
  );
};

export default TaxAssistant;
