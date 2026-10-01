import React, { useCallback, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import Button from '../components/common/Button';
import PressableScale from '../components/common/PressableScale';
import { Payment } from '../types';
import { chunk } from '../utils/array';
import { getCurrentDate } from '../utils/date';
import {
  buildMonthLedger,
  formatWon,
  LedgerEntry,
  LedgerStatus,
  monthLabel,
  monthOf,
  shiftMonth,
  summarizeLedger,
} from '../utils/ledger';
import { KIND_LABEL, METHOD_LABEL, needsCashReceipt } from '../utils/tax';
import { studentDisplayName } from '../utils/student';
import { logger } from '../utils/logger';

const Header = styled.View`
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const MonthBar = styled.View`
  flex-direction: row;
  align-items: center;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  padding: 4px;
`;

const MonthButton = styled(PressableScale)`
  padding: 8px;
`;

const MonthText = styled.Text`
  font-size: 16px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
  min-width: 96px;
  text-align: center;
`;

const Summary = styled.View`
  background-color: ${({ theme }) => theme.colors.primaryStrong};
  border-radius: ${({ theme }) => theme.borderRadius.large}px;
  padding: ${({ theme }) => theme.spacing.large}px;
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
`;

const SummaryLabel = styled.Text`
  color: rgba(255, 255, 255, 0.8);
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
`;

const SummaryValue = styled.Text`
  color: white;
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 26px;
  margin-top: 2px;
`;

const SummaryOf = styled.Text`
  color: rgba(255, 255, 255, 0.8);
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
`;

const Stats = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 28px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const StatValue = styled.Text`
  color: white;
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 16px;
  margin-top: 2px;
`;

const Card = styled.View`
  flex-grow: 1;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  padding: ${({ theme }) => theme.spacing.medium}px;
  shadow-color: #000;
  shadow-offset: 0px 2px;
  shadow-opacity: 0.08;
  shadow-radius: 4px;
  elevation: 2;
`;

const CardTop = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const NameText = styled.Text`
  flex-shrink: 1;
  font-size: 17px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Meta = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 4px;
`;

const Tag = styled.View<{ $color: string }>`
  padding-vertical: 3px;
  padding-horizontal: 9px;
  border-radius: 12px;
  background-color: ${({ $color }) => $color}26;
`;

const TagText = styled.Text<{ $color: string }>`
  font-size: 12px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ $color }) => $color};
`;

/* 받은 한 건. 누르면 고친다. */
const PaymentLine = styled(PressableScale)`
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

const LineAmount = styled.Text<{ $negative: boolean }>`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 14px;
  color: ${({ theme, $negative }) => ($negative ? theme.colors.dangerStrong : theme.colors.textPrimary)};
`;

const CardActions = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
`;

const AddMore = styled(PressableScale)`
  padding-vertical: 8px;
  padding-horizontal: 12px;
`;

const AddMoreText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.primaryStrong};
`;

const EmptyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
  line-height: 22px;
`;

const STATUS_LABEL: Record<LedgerStatus, string> = {
  unpaid: '미납',
  partial: '일부',
  paid: '완납',
  noFee: '금액 미정',
};

/** '10.5' — 같은 달 안에서 읽으니 해와 0은 뺀다. */
const shortDate = (dateKey: string) => `${Number(dateKey.slice(5, 7))}.${Number(dateKey.slice(8))}`;

/**
 * 수납. 한 달치 수강료를 원생마다 받았는지 본다.
 *
 * 달은 '어느 달 수강료인가'다 (받은 날이 아니다). 10월 수강료를 9월 말에 받아도
 * 10월에 보여야 미납으로 잘못 뜨지 않는다. 신고 자료는 반대로 받은 날로 가른다
 * (utils/tax).
 *
 * 금액이 보이는 화면이다. 아이에게 아이패드를 건네기 전에는 [오늘] 화면의 자물쇠를 쓴다.
 */
const PaymentsScreen: React.FC = () => {
  const { students, loadPaymentsForMonth, revision } = useData();
  const { columns } = useResponsive();
  const theme = useTheme();
  const navigation = useNavigation();

  const thisMonth = monthOf(getCurrentDate());
  const [month, setMonth] = useState(thisMonth);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setPayments(await loadPaymentsForMonth(month));
    } catch (error) {
      logger.error('Failed to load payments', error);
      setPayments([]);
    } finally {
      setLoading(false);
    }
    // revision: 수납을 기록하고 돌아오면, 다른 기기에서 넘어오면 다시 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, loadPaymentsForMonth, revision]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const ledger = useMemo(
    () => buildMonthLedger(students, payments, month),
    [students, payments, month]
  );
  const summary = useMemo(() => summarizeLedger(ledger), [ledger]);
  const rows = useMemo(() => chunk(ledger, columns), [ledger, columns]);

  const tone: Record<LedgerStatus, string> = {
    unpaid: theme.colors.dangerStrong,
    partial: theme.colors.sunStrong,
    paid: theme.colors.successStrong,
    noFee: theme.colors.textSecondary,
  };

  const receive = (entry: LedgerEntry) =>
    navigation.navigate('PaymentModal', { studentId: entry.student.id, month });
  const edit = (payment: Payment) =>
    navigation.navigate('PaymentModal', {
      studentId: payment.studentId,
      month,
      paymentId: payment.id,
    });

  const renderCard = (entry: LedgerEntry) => {
    const { student, expected, paid, status } = entry;
    const name = studentDisplayName(student);
    return (
      <Card>
        <CardTop>
          <NameText numberOfLines={1}>{name}</NameText>
          <Tag $color={tone[status]}>
            <TagText $color={tone[status]}>{STATUS_LABEL[status]}</TagText>
          </Tag>
        </CardTop>
        <Meta>
          {student.grade}
          {expected > 0 ? ` · 월 ${formatWon(expected)}` : ' · 수강료를 정하지 않음'}
          {status === 'partial' ? ` · ${formatWon(expected - paid)} 남음` : ''}
          {student.preschool ? ' · 미취학' : ''}
        </Meta>

        {entry.payments.length > 0 && <View style={{ marginTop: 8 }}>
          {entry.payments.map((payment) => (
            <PaymentLine
              key={payment.id}
              onPress={() => edit(payment)}
              pressScale={0.98}
              pressOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${name} ${shortDate(payment.paidOn)} 수납 수정`}
            >
              <LineText numberOfLines={1}>
                {shortDate(payment.paidOn)}
                {payment.kind !== 'tuition' ? ` · ${KIND_LABEL[payment.kind]}` : ''} ·{' '}
                {METHOD_LABEL[payment.method]}
                {payment.method !== 'card' && payment.cashReceipt ? ' · 현금영수증' : ''}
                {payment.amount < 0 ? ' · 환불' : ''}
              </LineText>
              {needsCashReceipt(payment) && (
                <Ionicons name="alert-circle" size={16} color={theme.colors.secondaryStrong} />
              )}
              <LineAmount $negative={payment.amount < 0}>{formatWon(payment.amount)}</LineAmount>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} />
            </PaymentLine>
          ))}
        </View>}

        <CardActions>
          {status === 'paid' ? (
            <AddMore
              onPress={() => receive(entry)}
              pressScale={0.9}
              accessibilityRole="button"
              accessibilityLabel={`${name} 수납 추가`}
            >
              <AddMoreText>+ 추가</AddMoreText>
            </AddMore>
          ) : (
            <Button
              title="받음"
              size="compact"
              onPress={() => receive(entry)}
              accessibilityLabel={`${name} 수납 기록`}
            />
          )}
        </CardActions>
      </Card>
    );
  };

  const header = (
    <>
      <Header>
        <View>
          <TitleText>수납</TitleText>
          <SubText>{monthLabel(month)} 수강료</SubText>
        </View>
        <MonthBar>
          <MonthButton
            pressScale={0.85}
            haptic="select"
            hitSlop={8}
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            accessibilityRole="button"
            accessibilityLabel="이전 달"
          >
            <Ionicons name="chevron-back" size={20} color={theme.colors.primaryStrong} />
          </MonthButton>
          <MonthText>{monthLabel(month)}</MonthText>
          {/* 다음 달은 열어 둔다. 선납을 다음 달 수강료로 적을 수 있어야 한다. */}
          <MonthButton
            pressScale={0.85}
            haptic="select"
            hitSlop={8}
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            accessibilityRole="button"
            accessibilityLabel="다음 달"
          >
            <Ionicons name="chevron-forward" size={20} color={theme.colors.primaryStrong} />
          </MonthButton>
        </MonthBar>
      </Header>

      <Summary>
        <SummaryLabel>받은 수강료</SummaryLabel>
        <SummaryValue>
          {formatWon(summary.paid)}
          {summary.expected > 0 && <SummaryOf>  / {formatWon(summary.expected)}</SummaryOf>}
        </SummaryValue>
        <Stats>
          <View>
            <SummaryLabel>남은 원생</SummaryLabel>
            <StatValue>{summary.outstanding}명</StatValue>
          </View>
          <View>
            <SummaryLabel>카드</SummaryLabel>
            <StatValue>{formatWon(summary.byMethod.card)}</StatValue>
          </View>
          <View>
            <SummaryLabel>계좌이체</SummaryLabel>
            <StatValue>{formatWon(summary.byMethod.transfer)}</StatValue>
          </View>
          {summary.otherIncome !== 0 && (
            <View>
              <SummaryLabel>수강료 외</SummaryLabel>
              <StatValue>{formatWon(summary.otherIncome)}</StatValue>
            </View>
          )}
          {summary.byMethod.cash !== 0 && (
            <View>
              <SummaryLabel>현금</SummaryLabel>
              <StatValue>{formatWon(summary.byMethod.cash)}</StatValue>
            </View>
          )}
        </Stats>
      </Summary>

      {loading && (
        <View style={{ paddingVertical: 16 }}>
          <ActivityIndicator color={theme.colors.primaryStrong} />
        </View>
      )}
    </>
  );

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(_row, index) => String(index)}
        renderItem={({ item }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(entry) => entry.student.id}
            renderItem={renderCard}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? null : (
            <EmptyText>
              {students.length === 0
                ? '등록된 원생이 없습니다.\n[원생] 탭에서 추가해 주세요.'
                : '이 달에 다니는 원생이 없습니다.'}
            </EmptyText>
          )
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
};

export default PaymentsScreen;
