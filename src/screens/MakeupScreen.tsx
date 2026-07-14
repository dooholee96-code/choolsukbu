import React from 'react';
import styled from 'styled-components/native';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  align-items: center;
  justify-content: center;
`;

const TitleText = styled.Text`
  font-size: 28px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MakeupScreen: React.FC = () => {
  return (
    <Container>
      <TitleText>Makeup Classes</TitleText>
      <Text>Coming Soon...</Text>
    </Container>
  );
};

export default MakeupScreen;
