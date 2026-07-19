import React, { useState } from 'react';
import styled from 'styled-components/native';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../hooks/useData';
import StudentCard from '../components/StudentCard';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const Content = styled.View<{ insetTop: number }>`
  flex: 1;
  padding-top: ${({ insetTop }) => insetTop + 16}px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  width: ${({ theme }) => theme.layout.contentWidth};
  align-self: center;
`;

const Header = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
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

const AddButton = styled.TouchableOpacity`
  background-color: ${({ theme }) => theme.colors.primary};
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
`;

const StudentsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { students } = useData();
  const navigation = useNavigation();
  // 실제 앱에서는 설정 등에서 이 값을 제어하도록 구현
  const [showFee, setShowFee] = useState(false);

  return (
    <Container>
      <Content insetTop={insets.top}>
        <Header>
          <View>
            <TitleText>Students</TitleText>
            <SubText>{students.length} enrolled</SubText>
          </View>
          <AddButton onPress={() => navigation.navigate('AddStudentModal')}>
            <Ionicons name="add" size={24} color="white" />
          </AddButton>
        </Header>
        <FlatList
          data={students}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <StudentCard student={item} showFee={showFee} />}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      </Content>
    </Container>
  );
};

export default StudentsScreen;
