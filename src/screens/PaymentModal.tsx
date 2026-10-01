import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import Chip from '../components/common/Chip';
import PressableScale from '../components/common/PressableScale';
import { Payment, PaymentKind, PaymentMethod } from '../types';
import type { RootStackParamList } from '../types/navigation';
import { createId } from '../utils/id';
import { formatDateLabel, fromDateKey, getCurrentDate, toDateKey } from '../utils/date';
import { formatWon, monthLabel, shiftMonth } from '../utils/ledger';
import { CASH_RECEIPT_REQUIRED_FROM, KIND_LABEL, KINDS, METHOD_LABEL } from '../utils/tax';
import { studentDisplayName } from '../utils/student';
import { confirm, notify } from '../utils/dialog';
import { haptic } from '../utils/haptics';
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

const AmountInput = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 22px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const TextInput = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Row = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
`;

const FieldButton = styled(PressableScale)`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const FieldText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MonthStepper = styled.View`
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

const ToggleRow = styled(PressableScale).attrs({ pressScale: 0.98, haptic: 'select' as const })`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding-vertical: 10px;
`;

const ToggleBox = styled.View<{ $on: boolean }>`
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border-width: 2px;
  border-color: ${({ theme, $on }) => ($on ? theme.colors.primaryStrong : theme.colors.border)};
  background-color: ${({ theme, $on }) => ($on ? theme.colors.primaryStrong : 'transparent')};
  align-items: center;
  justify-content: center;
`;

const ToggleLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Hint = styled.Text<{ $warn?: boolean }>`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme, $warn }) => ($warn ? theme.colors.secondaryStrong : theme.colors.textSecondary)};
  margin-top: 4px;
`;

const Actions = styled.View`
  margin-top: ${({ theme }) => theme.spacing.large}px;
  gap: 12px;
`;

const METHODS: PaymentMethod[] = ['card', 'transfer', 'cash'];

/**
 * 수강료 받은 한 건을 적거나 고친다.
 *
 * 기본값은 '오늘, 남은 수강료, 그 집이 지난번에 낸 방법'이라 대부분은 [저장] 한 번이면
 * 끝난다. 처음 내는 집은 카드로 시작한다 (카드 단말기가 주 결제수단인 학원).
 */
const PaymentModal: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { params } = useRoute<RouteProp<RootStackParamList, 'PaymentModal'>>();
  const {
    students,
    loadPaymentsForMonth,
    loadLastPaymentMethod,
    recordPayment,
    updatePayment,
    deletePayment,
  } = useData();

  const student = students.find((s) => s.id === params.studentId);
  const [existing, setExisting] = useState<Payment[] | null>(null);
  const editing = existing?.find((p) => p.id === params.paymentId);
  const isEditing = Boolean(params.paymentId);

  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<PaymentKind>('tuition');
  const [refund, setRefund] = useState(false);
  const [paidOn, setPaidOn] = useState(getCurrentDate);
  const [month, setMonth] = useState(params.month);
  const [method, setMethod] = useState<PaymentMethod>('card');
  /** 사람이 결제수단을 직접 골랐는가. 골랐으면 늦게 도착한 기본값이 덮어쓰지 않는다. */
  const methodTouched = useRef(false);
  const [cashReceipt, setCashReceipt] = useState(false);
  /** 사람이 현금영수증 칸을 직접 건드렸는가. 건드렸으면 금액을 바꿔도 따라 바꾸지 않는다. */
  const receiptTouched = useRef(false);
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (params.paymentId) return;
    let alive = true;
    loadLastPaymentMethod(params.studentId)
      .then((last) => {
        if (alive && last && !methodTouched.current) setMethod(last);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [loadLastPaymentMethod, params.studentId, params.paymentId]);

  // 같은 달에 이미 받은 것을 읽는다. 새로 받을 때는 남은 금액을, 고칠 때는 그 건을 채운다.
  useEffect(() => {
    let alive = true;
    loadPaymentsForMonth(params.month)
      .then((rows) => alive && setExisting(rows))
      .catch((error) => {
        logger.error('Failed to load payments for modal', error);
        if (alive) setExisting([]);
      });
    return () => {
      alive = false;
    };
  }, [loadPaymentsForMonth, params.month]);

  // 수강료만 센다. 교재비를 받았다고 남은 수강료가 줄지 않는다.
  const alreadyPaid = useMemo(
    () =>
      (existing ?? [])
        .filter(
          (p) =>
            p.studentId === params.studentId && p.id !== params.paymentId && p.kind === 'tuition'
        )
        .reduce((sum, p) => sum + p.amount, 0),
    [existing, params.studentId, params.paymentId]
  );

  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || existing === null) return;
    filled.current = true;

    if (editing) {
      setAmount(String(Math.abs(editing.amount)));
      setKind(editing.kind);
      setRefund(editing.amount < 0);
      setPaidOn(editing.paidOn);
      setMonth(editing.month);
      setMethod(editing.method);
      setCashReceipt(editing.cashReceipt);
      receiptTouched.current = true;
      setNote(editing.note ?? '');
      return;
    }

    const fee = student?.fee ?? 0;
    const remaining = fee - alreadyPaid;
    const suggested = remaining > 0 ? remaining : fee;
    if (suggested > 0) {
      setAmount(String(suggested));
      setCashReceipt(suggested >= CASH_RECEIPT_REQUIRED_FROM);
    }
  }, [existing, editing, student, alreadyPaid]);

  const value = Number(amount.replace(/[^0-9]/g, '')) || 0;
  const cashLike = method !== 'card';
  const receiptRequired = cashLike && !refund && value >= CASH_RECEIPT_REQUIRED_FROM;

  const onAmountChange = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    setAmount(digits);
    // 금액을 바꾸면 영수증 기본값도 따라간다. 사람이 직접 고른 뒤에는 건드리지 않는다.
    if (!receiptTouched.current) setCashReceipt(Number(digits) >= CASH_RECEIPT_REQUIRED_FROM);
  };

  const onDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setShowDate(false);
    if (event.type === 'dismissed' || !selected) return;
    setPaidOn(toDateKey(selected));
  };

  const save = async () => {
    if (!student) return;
    if (value <= 0) {
      notify('금액 확인', '받은 금액을 입력해 주세요.');
      return;
    }

    const payment: Payment = {
      id: editing?.id ?? createId(),
      studentId: student.id,
      paidOn,
      month,
      amount: refund ? -value : value,
      kind,
      method,
      cashReceipt: cashLike && cashReceipt,
      // 미취학은 받는 순간의 사실이다. 고칠 때는 처음 적은 값을 지킨다.
      preschool: editing ? editing.preschool : Boolean(student.preschool),
      note: note.trim() || null,
    };

    setSaving(true);
    try {
      await (editing ? updatePayment(payment) : recordPayment(payment));
      haptic('success');
      navigation.goBack();
    } catch (error) {
      logger.error('Failed to save payment', error);
      haptic('error');
      notify('저장 실패', '수납 기록을 저장하지 못했습니다. 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editing) return;
    confirm({
      title: '수납 기록 삭제',
      message: `${formatDateLabel(editing.paidOn)} ${formatWon(editing.amount)} 기록을 지울까요?\n잘못 적은 것일 때만 지우세요. 돌려준 돈은 [환불]로 적습니다.`,
      confirmLabel: '삭제',
      destructive: true,
      onConfirm: async () => {
        try {
          await deletePayment(editing.id);
          haptic('tap');
          navigation.goBack();
        } catch (error) {
          logger.error('Failed to delete payment', error);
          notify('삭제 실패', '수납 기록을 지우지 못했습니다.');
        }
      },
    });
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
            <TitleText>{isEditing ? '수납 고치기' : '수납 기록'}</TitleText>
            <Lead>
              {studentDisplayName(student)} · {student.grade}
              {student.fee ? ` · 월 ${formatWon(student.fee)}` : ''}
              {alreadyPaid !== 0 ? `\n이 달에 이미 ${formatWon(alreadyPaid)} 받음` : ''}
            </Lead>

            {/* 학원사업자 수입금액검토표가 이렇게 나눠 묻는다. 수강료만 완납·미납에 들어간다. */}
            <Label style={{ marginTop: 0 }}>무슨 돈인가</Label>
            <Row>
              {KINDS.map((k) => (
                <Chip
                  key={k}
                  label={KIND_LABEL[k]}
                  selected={kind === k}
                  onPress={() => {
                    setKind(k);
                    // 수강료를 미리 채워 두었는데 교재비로 바꾸면 그 금액은 맞을 리 없다.
                    if (!editing && k !== 'tuition' && kind === 'tuition') onAmountChange('');
                  }}
                />
              ))}
            </Row>

            <Label>{refund ? '돌려준 금액' : '받은 금액'}</Label>
            <AmountInput
              value={amount ? Number(amount).toLocaleString('ko-KR') : ''}
              onChangeText={onAmountChange}
              placeholder="0"
              keyboardType="number-pad"
              accessibilityLabel="금액"
            />

            <Label>결제수단</Label>
            <Row>
              {METHODS.map((m) => (
                <Chip
                  key={m}
                  label={METHOD_LABEL[m]}
                  selected={method === m}
                  onPress={() => {
                    methodTouched.current = true;
                    setMethod(m);
                  }}
                />
              ))}
            </Row>

            {cashLike && (
              <>
                <ToggleRow
                  onPress={() => {
                    receiptTouched.current = true;
                    setCashReceipt((on) => !on);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: cashReceipt }}
                  accessibilityLabel="현금영수증 발급"
                >
                  <ToggleBox $on={cashReceipt}>
                    {cashReceipt && <Ionicons name="checkmark" size={14} color="white" />}
                  </ToggleBox>
                  <ToggleLabel>현금영수증 발급함</ToggleLabel>
                </ToggleRow>
                {receiptRequired && !cashReceipt ? (
                  <Hint $warn>
                    학원은 현금영수증 의무발행업종입니다. 10만 원 이상을 현금·계좌이체로 받으면
                    요청이 없어도 발급해야 합니다.
                  </Hint>
                ) : (
                  <Hint>신고 때 '현금영수증 매출'과 '기타 매출'이 이것으로 갈립니다.</Hint>
                )}
              </>
            )}

            <Label>받은 날</Label>
            <FieldButton
              onPress={() => setShowDate((on) => !on)}
              pressScale={0.98}
              accessibilityRole="button"
              accessibilityLabel="받은 날 고르기"
            >
              <FieldText>{formatDateLabel(paidOn)}</FieldText>
              <Ionicons name="calendar-outline" size={18} color={theme.colors.primaryStrong} />
            </FieldButton>
            {showDate && (
              <DateTimePicker
                value={fromDateKey(paidOn)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                maximumDate={new Date()}
                onChange={onDateChange}
                accessibilityLabel="받은 날"
              />
            )}
            <Hint>신고 연도는 받은 날로 정해집니다.</Hint>

            <Label>어느 달 수강료인가</Label>
            <MonthStepper>
              <StepButton
                onPress={() => setMonth((m) => shiftMonth(m, -1))}
                pressScale={0.85}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel="수강월 이전 달"
              >
                <Ionicons name="chevron-back" size={20} color={theme.colors.primaryStrong} />
              </StepButton>
              <FieldText>{monthLabel(month)}분</FieldText>
              <StepButton
                onPress={() => setMonth((m) => shiftMonth(m, 1))}
                pressScale={0.85}
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel="수강월 다음 달"
              >
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primaryStrong} />
              </StepButton>
            </MonthStepper>

            <ToggleRow
              onPress={() => setRefund((on) => !on)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: refund }}
              accessibilityLabel="환불"
              style={{ marginTop: 8 }}
            >
              <ToggleBox $on={refund}>
                {refund && <Ionicons name="checkmark" size={14} color="white" />}
              </ToggleBox>
              <ToggleLabel>환불 (돌려준 돈)</ToggleLabel>
            </ToggleRow>
            {refund && <Hint>그 달 받은 돈과 신고 수입금액에서 빠집니다.</Hint>}

            <Label>메모 (선택)</Label>
            <TextInput value={note} onChangeText={setNote} placeholder="예: 형제 할인, 교재비 포함" />

            <Actions>
              <Button
                title={saving ? '저장 중…' : '저장'}
                onPress={save}
                disabled={saving || existing === null}
              />
              <View>
                <Button title="취소" variant="secondary" onPress={() => navigation.goBack()} />
              </View>
              {isEditing && (
                <View>
                  <Button title="기록 삭제" variant="danger" onPress={remove} />
                </View>
              )}
            </Actions>
          </Form>
        </ScrollView>
      </KeyboardAvoidingView>
    </Root>
  );
};

export default PaymentModal;
