import React from 'react';
import styled from 'styled-components/native';
import { TouchableOpacityProps } from 'react-native';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'regular' | 'compact';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
  variant?: Variant;
  size?: Size;
}

// $ 접두사(transient prop)를 쓰면 styled-components가 해당 prop을 하위
// TouchableOpacity로 넘기지 않는다. 네이티브 컴포넌트에 알 수 없는 prop이
// 흘러드는 것을 막고, styled 타입과 컴포넌트 타입이 엉키는 것도 피할 수 있다.
const StyledButton = styled.TouchableOpacity<{ $variant: Variant; $size: Size }>`
  background-color: ${({ theme, $variant }) => {
    switch ($variant) {
      case 'secondary':
        return theme.colors.secondary;
      case 'danger':
        return theme.colors.danger;
      default:
        return theme.colors.primary;
    }
  }};
  padding-vertical: ${({ theme, $size }) =>
    $size === 'compact' ? theme.spacing.small : theme.spacing.medium}px;
  padding-horizontal: ${({ theme, $size }) =>
    $size === 'compact' ? theme.spacing.medium : theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  align-items: center;
  justify-content: center;
`;

const ButtonText = styled.Text<{ $size: Size }>`
  color: white;
  font-size: ${({ $size }) => ($size === 'compact' ? 14 : 16)}px;
  font-weight: bold;
`;

const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'regular',
  ...props
}) => {
  return (
    <StyledButton
      $variant={variant}
      $size={size}
      accessibilityRole="button"
      accessibilityLabel={title}
      {...props}
    >
      <ButtonText $size={size}>{title}</ButtonText>
    </StyledButton>
  );
};

export default Button;
