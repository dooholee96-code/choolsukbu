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
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SubText = styled.Text`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const RoundButton = styled.TouchableOpacity<{ $variant: 'primary' | 'plain' }>`
  background-color: ${({ theme, $variant }) =>
    $variant === 'primary' ? theme.colors.primary : theme.colors.cardBackground};
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  border-width: ${({ $variant }) => ($variant === 'primary' ? 0 : 1)}px;
  border-color: ${({ theme }) => theme.colors.border};
`;

const EmptyText = styled.Text`
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.large}px;
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

  const rows = useMemo(() => chunk(students, columns), [students, columns]);

  const handleEdit = useCallback(
    (student: Student) => navigation.navigate('StudentFormModal', { studentId: student.id }),
    [navigation]
  );

  return (
    <Screen>
      <Header>
        <View>
          <TitleText>Students</TitleText>
          <SubText>{students.length} enrolled</SubText>
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
            $variant="primary"
            onPress={() => navigation.navigate('StudentFormModal')}
            accessibilityRole="button"
            accessibilityLabel="원생 추가"
          >
            <Ionicons name="add" size={26} color="white" />
          </RoundButton>
        </HeaderActions>
      </Header>

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
              <StudentCard student={student} showFee={showFee} onPress={handleEdit} />
            )}
          />
        )}
        ListEmptyComponent={<EmptyText>등록된 원생이 없습니다.</EmptyText>}
      />
    </Screen>
  );
};

export default StudentsScreen;
