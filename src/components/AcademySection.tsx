import React, { useCallback, useRef, useState } from 'react';
import styled from 'styled-components/native';
import { useFocusEffect } from '@react-navigation/native';
import { useData } from '../hooks/useData';
import Button from './common/Button';
import { AcademyInfo } from '../types';
import { emptyAcademy } from '../data/academy';
import { haptic } from '../utils/haptics';
import { notify } from '../utils/dialog';
import { logger } from '../utils/logger';

const Field = styled.View`
  margin-bottom: 10px;
`;

const FieldLabel = styled.Text`
  font-family: ${({ theme }) => theme.fonts.bold};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
`;

const Input = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding-vertical: 12px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.regular};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Row = styled.View`
  flex-direction: row;
  gap: 10px;
`;

const Half = styled.View`
  flex: 1;
`;

type Key = 'name' | 'owner' | 'bizNumber' | 'address' | 'phone' | 'subject';

const FIELDS: { key: Key; label: string; placeholder: string; keyboard?: 'phone-pad' | 'number-pad' }[] = [
  { key: 'name', label: '상호 (학원 이름)', placeholder: '예: 숲속영어학원' },
  { key: 'owner', label: '대표자', placeholder: '대표자 성명' },
  { key: 'bizNumber', label: '사업자등록번호', placeholder: '000-00-00000', keyboard: 'number-pad' },
  { key: 'phone', label: '전화번호', placeholder: '02-000-0000', keyboard: 'phone-pad' },
  { key: 'address', label: '소재지', placeholder: '사업장 주소' },
  { key: 'subject', label: '교육 내용', placeholder: '예: 영어, 수학' },
];

/** '1234567890' → '123-45-67890'. 이미 하이픈이 있거나 자리가 다르면 그대로 둔다. */
export const formatBizNumber = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : value;
};

/**
 * 학원 정보. 교육비납입증명서의 학원 칸(상호·사업자등록번호·소재지·전화번호·교육 내용,
 * 대표자)으로 들어간다. 한 번 적어 두면 증명서를 뗄 때마다 다시 적지 않는다.
 */
const AcademySection: React.FC = () => {
  const { loadAcademy, patchAcademy } = useData();
  const [info, setInfo] = useState<AcademyInfo>(emptyAcademy);
  const [saved, setSaved] = useState<AcademyInfo>(emptyAcademy);
  const [saving, setSaving] = useState(false);

  const dirty = FIELDS.some(({ key }) => info[key].trim() !== saved[key].trim());
  /** 고치던 중에는 다시 읽지 않는다. 탭을 오가다 적던 것을 잃으면 안 된다. */
  const editing = useRef(false);
  editing.current = dirty;

  // 탭에 들어올 때마다 읽는다. 다른 기기에서 고친 학원 정보가 동기화로 넘어왔을 수 있다.
  useFocusEffect(
    useCallback(() => {
      if (editing.current) return;
      loadAcademy()
        .then((stored) => {
          if (editing.current) return;
          const value = stored ?? emptyAcademy();
          setInfo(value);
          setSaved(value);
        })
        .catch((error) => logger.error('Failed to load academy info', error));
    }, [loadAcademy])
  );

  const save = async () => {
    setSaving(true);
    try {
      const next = { ...info, bizNumber: formatBizNumber(info.bizNumber) };
      // 이 칸들만 고친다. 수강료 기준표는 따로 저장된다.
      await patchAcademy({
        name: next.name,
        owner: next.owner,
        bizNumber: next.bizNumber,
        address: next.address,
        phone: next.phone,
        subject: next.subject,
      });
      setInfo(next);
      setSaved(next);
      haptic('success');
    } catch (error) {
      logger.error('Failed to save academy info', error);
      notify('저장 실패', '학원 정보를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const input = (key: Key) => {
    const spec = FIELDS.find((f) => f.key === key)!;
    return (
      <Field>
        <FieldLabel>{spec.label}</FieldLabel>
        <Input
          value={info[key]}
          onChangeText={(text) => setInfo((current) => ({ ...current, [key]: text }))}
          placeholder={spec.placeholder}
          keyboardType={spec.keyboard}
          accessibilityLabel={spec.label}
        />
      </Field>
    );
  };

  return (
    <>
      <Row>
        <Half>{input('name')}</Half>
        <Half>{input('owner')}</Half>
      </Row>
      <Row>
        <Half>{input('bizNumber')}</Half>
        <Half>{input('phone')}</Half>
      </Row>
      {input('address')}
      {input('subject')}
      <Button
        title={saving ? '저장 중…' : dirty ? '학원 정보 저장' : '저장됨'}
        variant={dirty ? 'primary' : 'secondary'}
        onPress={save}
        disabled={saving || !dirty}
      />
    </>
  );
};

export default AcademySection;
