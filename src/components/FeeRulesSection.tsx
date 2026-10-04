import React, { useCallback, useMemo, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import Button from './common/Button';
import PressableScale from './common/PressableScale';
import { FeeRule } from '../types';
import { createId } from '../utils/id';
import { DEFAULT_CLASS_MINUTES, describeFeeRule, matchFeeRule } from '../utils/fees';
import { formatWon } from '../utils/ledger';
import { confirm, notify } from '../utils/dialog';
import { haptic } from '../utils/haptics';
import { logger } from '../utils/logger';

const RuleRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
`;

/* 폭을 못 박는다. TextInput은 기본 폭이 넓어서, 그대로 두면 한 줄이 여러 줄로 쪼개진다. */
const Small = styled.TextInput`
  width: 52px;
  text-align: center;
  background-color: ${({ theme }) => theme.colors.background};
  padding-vertical: 10px;
  padding-horizontal: 8px;
  border-radius: 10px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Money = styled(Small)`
  width: 130px;
  text-align: right;
`;

const Unit = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Remove = styled(PressableScale)`
  padding: 6px;
`;

const Described = styled.Text`
  width: 100%;
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: -4px;
  margin-bottom: 6px;
`;

const Note = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 13px;
  line-height: 19px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 10px;
`;

const Stack = styled.View`
  gap: 10px;
  margin-top: 6px;
`;

/** 화면에서 고치는 줄. 빈 칸을 그대로 들고 있어야 사람이 지우고 다시 쓸 수 있다. */
interface Draft {
  id: string;
  perWeek: string;
  gradeFrom: string;
  gradeTo: string;
  fee: string;
}

const toDraft = (rule: FeeRule): Draft => ({
  id: rule.id,
  perWeek: rule.perWeek?.toString() ?? '',
  gradeFrom: rule.gradeFrom?.toString() ?? '',
  gradeTo: rule.gradeTo?.toString() ?? '',
  fee: rule.fee ? String(rule.fee) : '',
});

const num = (text: string) => {
  const n = Number(text.replace(/[^0-9]/g, ''));
  return text.trim() && Number.isFinite(n) ? n : null;
};

/** 금액이 없는 줄은 버린다 — 반쯤 쓰다 만 줄이 기준이 되면 안 된다. */
const toRules = (drafts: Draft[]): FeeRule[] =>
  drafts
    .map((d) => ({
      id: d.id,
      perWeek: num(d.perWeek),
      gradeFrom: num(d.gradeFrom),
      gradeTo: num(d.gradeTo),
      fee: num(d.fee) ?? 0,
    }))
    .filter((r) => r.fee > 0);

const digits = (text: string) => text.replace(/[^0-9]/g, '');

/**
 * 수강료 기준표와 기본 수업 시간. 원생을 등록할 때 월 수강료와 끝나는 시각이 여기서
 * 채워진다. 기준표를 고쳐도 이미 적힌 원생의 수강료는 바뀌지 않는다 — 비어 있는 원생에게만
 * 따로 채울 수 있다.
 */
const FeeRulesSection: React.FC = () => {
  const theme = useTheme();
  const { students, loadAcademy, patchAcademy, fillMissingFees } = useData();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [minutes, setMinutes] = useState('');
  const [saved, setSaved] = useState<{ rules: FeeRule[]; minutes: string }>({
    rules: [],
    minutes: '',
  });
  const [busy, setBusy] = useState(false);

  const rules = useMemo(() => toRules(drafts), [drafts]);
  const dirty =
    JSON.stringify(rules) !== JSON.stringify(saved.rules) || minutes.trim() !== saved.minutes;
  const editing = useRef(false);
  editing.current = dirty;

  useFocusEffect(
    useCallback(() => {
      if (editing.current) return;
      loadAcademy()
        .then((info) => {
          if (editing.current) return;
          const stored = info?.feeRules ?? [];
          const storedMinutes = info?.classMinutes ? String(info.classMinutes) : '';
          setDrafts(stored.map(toDraft));
          setMinutes(storedMinutes);
          setSaved({ rules: stored, minutes: storedMinutes });
        })
        .catch((error) => logger.error('Failed to load fee rules', error));
    }, [loadAcademy])
  );

  const update = (id: string, key: keyof Omit<Draft, 'id'>, text: string) =>
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, [key]: digits(text) } : d)));

  const add = () =>
    setDrafts((current) => [
      ...current,
      { id: createId(), perWeek: '', gradeFrom: '', gradeTo: '', fee: '' },
    ]);

  const remove = (id: string) => setDrafts((current) => current.filter((d) => d.id !== id));

  const save = async () => {
    setBusy(true);
    try {
      const m = num(minutes);
      await patchAcademy({ feeRules: rules, classMinutes: m && m > 0 ? m : undefined });
      setDrafts(rules.map(toDraft));
      setSaved({ rules, minutes: m && m > 0 ? String(m) : '' });
      setMinutes(m && m > 0 ? String(m) : '');
      haptic('success');
    } catch (error) {
      logger.error('Failed to save fee rules', error);
      notify('저장 실패', '수강료 기준을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /** 수강료가 비어 있는 재원생 중 기준표에 맞는 사람. */
  const fillable = useMemo(
    () =>
      students.filter(
        (s) => s.fee == null && !s.withdrawnAt && matchFeeRule(saved.rules, s) !== null
      ).length,
    [students, saved.rules]
  );

  const fill = () =>
    confirm({
      title: '수강료 채우기',
      message: `수강료가 비어 있는 원생 ${fillable}명에게 기준표대로 채웁니다.\n이미 적힌 금액(할인 등)은 그대로 둡니다.`,
      confirmLabel: '채우기',
      onConfirm: async () => {
        try {
          const filled = await fillMissingFees(saved.rules);
          haptic('success');
          notify('채웠습니다', `${filled}명의 수강료를 채웠습니다.`);
        } catch (error) {
          logger.error('Failed to fill fees', error);
          notify('실패', '수강료를 채우지 못했습니다.');
        }
      },
    });

  return (
    <>
      <Note>
        한 줄에 &lsquo;주 몇 회 · 몇~몇 학년 → 월 얼마&rsquo;. 빈 칸은 따지지 않습니다. 여러 줄이 맞으면
        조건을 더 많이 채운 줄을 씁니다. 중학생은 7~9학년으로 적습니다.
      </Note>

      {drafts.map((d) => {
        const rule = toRules([d])[0];
        return (
          <View key={d.id}>
            <RuleRow>
              <Unit>주</Unit>
              <Small
                value={d.perWeek}
                onChangeText={(t) => update(d.id, 'perWeek', t)}
                keyboardType="number-pad"
                placeholder="-"
                accessibilityLabel="주 몇 회"
              />
              <Unit>회 ·</Unit>
              <Small
                value={d.gradeFrom}
                onChangeText={(t) => update(d.id, 'gradeFrom', t)}
                keyboardType="number-pad"
                placeholder="-"
                accessibilityLabel="학년부터"
              />
              <Unit>~</Unit>
              <Small
                value={d.gradeTo}
                onChangeText={(t) => update(d.id, 'gradeTo', t)}
                keyboardType="number-pad"
                placeholder="-"
                accessibilityLabel="학년까지"
              />
              <Unit>학년 →</Unit>
              <Money
                value={d.fee ? Number(d.fee).toLocaleString('ko-KR') : ''}
                onChangeText={(t) => update(d.id, 'fee', t)}
                keyboardType="number-pad"
                placeholder="월 수강료"
                accessibilityLabel="월 수강료"
              />
              <Unit>원</Unit>
              <Remove
                onPress={() => remove(d.id)}
                pressScale={0.85}
                accessibilityRole="button"
                accessibilityLabel="이 기준 지우기"
              >
                <Ionicons name="close-circle" size={22} color={theme.colors.textSecondary} />
              </Remove>
            </RuleRow>
            <Described>
              {rule ? `${describeFeeRule(rule)} → ${formatWon(rule.fee)}` : '금액을 적어야 기준이 됩니다'}
            </Described>
          </View>
        );
      })}

      <Button title="+ 기준 추가" variant="secondary" size="compact" onPress={add} />

      <RuleRow style={{ marginTop: 16 }}>
        <Unit>기본 수업 시간</Unit>
        <Small
          value={minutes}
          onChangeText={(t) => setMinutes(digits(t))}
          keyboardType="number-pad"
          placeholder={String(DEFAULT_CLASS_MINUTES)}
          accessibilityLabel="기본 수업 시간(분)"
        />
        <Unit>분</Unit>
      </RuleRow>
      <Described>새 원생을 등록할 때 끝나는 시각을 &lsquo;시작 + 이 시간&rsquo;으로 채웁니다.</Described>

      <Stack>
        <Button
          title={busy ? '저장 중…' : dirty ? '수강료 기준 저장' : '저장됨'}
          variant={dirty ? 'primary' : 'secondary'}
          onPress={save}
          disabled={busy || !dirty}
        />
        <Button
          title={`수강료가 빈 원생에게 적용 (${fillable}명)`}
          variant="secondary"
          onPress={fill}
          disabled={dirty || fillable === 0}
        />
        {dirty && <Note>기준을 저장한 뒤에 원생에게 적용할 수 있습니다.</Note>}
      </Stack>
    </>
  );
};

export default FeeRulesSection;
