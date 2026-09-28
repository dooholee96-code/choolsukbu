import React from 'react';
import styled from 'styled-components/native';
import PressableScale, { PressableScaleProps } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'regular' | 'compact';

interface ButtonProps extends PressableScaleProps {
  title: string;
  variant?: Variant;
  size?: Size;
}

// $ 접두사(transient prop)를 쓰면 styled-components가 해당 prop을 하위
// 컴포넌트로 넘기지 않는다. 네이티브 뷰에 알 수 없는 prop이 흘러드는 것을 막고,
// styled 타입과 컴포넌트 타입이 엉키는 것도 피할 수 있다.
const StyledButton = styled(PressableScale)<{ $variant: Variant; $size: Size; $disabled: boolean }>`
  background-color: ${({ theme, $variant }) => {
    switch ($variant) {
      case 'secondary':
        return theme.colors.secondaryStrong;
      case 'danger':
        return theme.colors.dangerStrong;
      default:
        return theme.colors.primaryStrong;
    }
  }};
  padding-vertical: ${({ theme, $size }) =>
    $size === 'compact' ? theme.spacing.small : theme.spacing.medium}px;
  padding-horizontal: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  align-items: center;
  justify-content: center;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
`;

const ButtonText = styled.Text<{ $size: Size }>`
  color: white;
  font-size: ${({ $size }) => ($size === 'compact' ? 14 : 16)}px;
  font-family: ${({ theme }) => theme.fonts.bold};`;

/**
 * 누를 수 없을 때는 흐리게 둔다. 예전에는 저장 중에도 모양이 그대로라, 눌러도
 * 반응이 없는 것이 고장인지 기다리는 중인지 알 수 없었다.
 *
 * 작은 버튼이 더 깊이 눌린다. 같은 비율이면 큰 버튼이 훨씬 많이 움직인다.
 */
const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'regular',
  disabled,
  ...props
}) => {
  return (
    <StyledButton
      $variant={variant}
      $size={size}
      $disabled={Boolean(disabled)}
      pressScale={size === 'compact' ? 0.93 : 0.96}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      {...props}
    >
      <ButtonText $size={size}>{title}</ButtonText>
    </StyledButton>
  );
};

export default Button;
