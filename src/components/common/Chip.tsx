import React from 'react';
import styled from 'styled-components/native';
import { TouchableOpacityProps } from 'react-native';

interface ChipProps extends TouchableOpacityProps {
  label: string;
  selected?: boolean;
}

const StyledChip = styled.TouchableOpacity<{ $selected: boolean }>`
  background-color: ${({ theme, $selected }) =>
    $selected ? theme.colors.primaryStrong : theme.colors.cardBackground};
  padding-vertical: 10px;
  padding-horizontal: 16px;
  border-radius: 20px;
  margin-right: 8px;
  margin-bottom: 8px;
  border-width: 1px;
  border-color: ${({ theme, $selected }) =>
    $selected ? theme.colors.primaryStrong : theme.colors.border};
`;

const ChipText = styled.Text<{ $selected: boolean }>`
  color: ${({ theme, $selected }) => ($selected ? 'white' : theme.colors.textPrimary)};
  font-family: ${({ theme, $selected }) => ($selected ? theme.fonts.bold : theme.fonts.regular)};
  font-size: 14px;
`;

const Chip: React.FC<ChipProps> = ({ label, selected = false, ...props }) => {
  return (
    <StyledChip
      $selected={selected}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      {...props}
    >
      <ChipText $selected={selected}>{label}</ChipText>
    </StyledChip>
  );
};

export default Chip;
