import { Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');
const isPad = Platform.OS === 'ios' && (width > 768 || height > 768);

export const theme = {
  colors: {
    primary: '#007AFF', // 블루
    secondary: '#FF9500', // 오렌지 (보충/예외)
    success: '#34C759', // 그린 (완료/정상)
    danger: '#FF3B30', // 레드 (결석)
    background: '#F2F2F7', // 배경색
    cardBackground: '#FFFFFF', // 카드 배경색
    textPrimary: '#1C1C1E', // 기본 텍스트
    textSecondary: '#8E8E93', // 보조 텍스트
    border: '#C7C7CC', // 테두리
    modalBackground: 'rgba(0, 0, 0, 0.5)', // 모달 배경
  },
  fonts: {
    regular: 'System',
    bold: 'System-Bold',
  },
  spacing: {
    small: 8,
    medium: 16,
    large: 24,
  },
  borderRadius: {
    small: 8,
    medium: 12,
    large: 20,
  },
  layout: {
    isPad,
    contentWidth: isPad ? '70%' : '90%',
  },
};

export type Theme = typeof theme;
