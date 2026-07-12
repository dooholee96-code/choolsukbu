import React from 'react';
import styled from 'styled-components/native';
import { TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

const StyledButton = styled.TouchableOpacity<ButtonProps>`
  background-color: ${({ theme, variant }) => {
    switch (variant) {
      case 'secondary':
        return theme.colors.secondary;
      case 'danger':
        return theme.colors.danger;
      default:
        return theme.colors.primary;
    }
  }};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  align-items: center;
  justify-content: center;
`;

const ButtonText = styled.Text`
  color: white;
  font-size: 16px;
  font-weight: bold;
`;

const Button: React.FC<ButtonProps> = ({ title, variant = 'primary', ...props }) => {
  return (
    <StyledButton variant={variant} {...props}>
      <ButtonText>{title}</ButtonText>
    </StyledButton>
  );
};

export default Button;
