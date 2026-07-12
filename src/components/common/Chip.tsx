import React from 'react';
import styled from 'styled-components/native';
import { TouchableOpacityProps } from 'react-native';

interface ChipProps extends TouchableOpacityProps {
  label: string;
  selected?: boolean;
}

const StyledChip = styled.TouchableOpacity<{ selected: boolean }>`
  background-color: ${({ theme, selected }) =>
    selected ? theme.colors.primary : theme.colors.background};
  padding-vertical: 8px;
  padding-horizontal: 16px;
  border-radius: 20px;
  margin-right: 8px;
  border-width: 1px;
  border-color: ${({ theme, selected }) => (selected ? theme.colors.primary : theme.colors.border)};
`;

const ChipText = styled.Text<{ selected: boolean }>`
  color: ${({ theme, selected }) => (selected ? 'white' : theme.colors.textPrimary)};
  font-size: 14px;
`;

const Chip: React.FC<ChipProps> = ({ label, selected = false, ...props }) => {
  return (
    <StyledChip selected={selected} {...props}>
      <ChipText selected={selected}>{label}</ChipText>
    </StyledChip>
  );
};

export default Chip;
