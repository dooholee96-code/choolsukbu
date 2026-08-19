import React, { useCallback, useMemo, useState } from 'react';
import styled, { useTheme } from 'styled-components/native';
import { FlatList, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../hooks/useData';
import { useResponsive } from '../hooks/useResponsive';
import Screen from '../components/common/Screen';
import GridRow from '../components/common/GridRow';
import StudentCard from '../components/StudentCard';
import { chunk } from '../utils/array';
import { duplicateNames, isWithdrawn } from '../utils/student';
import { Student } from '../types';

const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
`;

const HeaderActions = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-family: ${({ theme }) => theme.fonts.bold};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const RoundButton = styled.TouchableOpacity<{ $variant: 'primary' | 'plain' }>`
  background-color: ${({ theme, $variant }) =>
    $variant === 'primary' ? theme.colors.primaryStrong : theme.colors.cardBackground};
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  border-width: ${({ $variant }) => ($variant === 'primary' ? 0 : 1)}px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const EmptyText = styled.Text`
  font-family: ${({ theme }) => theme.fonts.regular};

  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
`;

/** 퇴원생이 하나라도 있을 때만 나온다. 없으면 고를 것이 없는 선택지다. */
const Segmented = styled.View`
  flex-direction: row;
  background-color: ${({ theme }) => theme.colors.cardBackground};
  border-radius: ${({ theme }) => theme.borderRadius.small}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  margin-bottom: ${({ theme }) => theme.spacing.medium}px;
  overflow: hidden;
`;

const SegmentButton = styled.TouchableOpacity<{ $active: boolean }>`
  flex: 1;
  padding-vertical: 10px;
  align-items: center;
  background-color: ${({ theme, $active }) =>
    $active ? theme.colors.primaryStrong : 'transparent'};
`;

const SegmentLabel = styled.Text<{ $active: boolean }>`
  font-size: 14px;
  font-family: ${({ theme, $active }) => ($active ? theme.fonts.bold : theme.fonts.regular)};
  color: ${({ theme, $active }) => ($active ? 'white' : theme.colors.textSecondary)};
`;

const StudentsScreen: React.FC = () => {
  const { students } = useData();
  const navigation = useNavigation();
  const { columns } = useResponsive();
  const theme = useTheme();

  // 수강료는 기본적으로 가려두고 필요할 때만 켠다.
  // (이전에는 setter를 아무도 호출하지 않아 영구히 false였고,
  //  StudentCard의 showFee 분기가 도달 불가 코드로 남아 있었다.)
  const [showFee, setShowFee] = useState(false);

  /**
   * 퇴원생은 접어 둔다. 지우지 않으므로 명단에 계속 있는데, 그대로 섞여 있으면
   * 한 해만 지나도 목록의 절반이 이미 나간 사람이 된다.
   */
  const [tab, setTab] = useState<'active' | 'withdrawn'>('active');

  const { active, withdrawn } = useMemo(
    () => ({
      active: students.filter((student) => !isWithdrawn(student)),
      withdrawn: students.filter(isWithdrawn),
    }),
    [students]
  );

  const twins = useMemo(() => duplicateNames(students), [students]);

  const visible = tab === 'active' ? active : withdrawn;
  const rows = useMemo(() => chunk(visible, columns), [visible, columns]);

  const handleEdit = useCallback(
    (student: Student) => navigation.navigate('StudentFormModal', { studentId: student.id }),
    [navigation]
  );

  return (
    <Screen>
      <Header>
        <View>
          <TitleText>원생</TitleText>
          <SubText>{active.length}명 재원</SubText>
        </View>
        <HeaderActions>
          <RoundButton
            $variant="plain"
            onPress={() => setShowFee((previous) => !previous)}
            accessibilityRole="button"
            accessibilityLabel={showFee ? '수강료 숨기기' : '수강료 보기'}
            accessibilityState={{ selected: showFee }}
          >
            <Ionicons
              name={showFee ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={theme.colors.textSecondary}
            />
          </RoundButton>
          <RoundButton
            $variant="plain"
            onPress={() => navigation.navigate('SettingsModal')}
            accessibilityRole="button"
            accessibilityLabel="설정"
          >
            <Ionicons
              name="settings-outline"
              size={21}
              color={theme.colors.textSecondary}
            />
          </RoundButton>
          <RoundButton
            $variant="primary"
            onPress={() => navigation.navigate('StudentFormModal')}
            accessibilityRole="button"
            accessibilityLabel="원생 추가"
          >
            <Ionicons name="add" size={26} color="white" />
          </RoundButton>
        </HeaderActions>
      </Header>

      {withdrawn.length > 0 && (
        <Segmented>
          {(
            [
              ['active', `재원 ${active.length}`],
              ['withdrawn', `퇴원 ${withdrawn.length}`],
            ] as const
          ).map(([value, label]) => (
            <SegmentButton
              key={value}
              $active={tab === value}
              onPress={() => setTab(value)}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === value }}
            >
              <SegmentLabel $active={tab === value}>{label}</SegmentLabel>
            </SegmentButton>
          ))}
        </Segmented>
      )}

      <FlatList<Student[]>
        data={rows}
        keyExtractor={(row, index) => row[0]?.id ?? `row-${index}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <GridRow
            items={item}
            columns={columns}
            keyExtractor={(student) => student.id}
            renderItem={(student) => (
              <StudentCard
                student={student}
                showFee={showFee}
                onPress={handleEdit}
                hasNameTwin={twins.has(student.name.trim())}
              />
            )}
          />
        )}
        ListEmptyComponent={
          <EmptyText>
            {tab === 'withdrawn' ? '퇴원한 원생이 없습니다.' : '등록된 원생이 없습니다.'}
          </EmptyText>
        }
      />
    </Screen>
  );
};

export default StudentsScreen;
