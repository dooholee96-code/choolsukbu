import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { theme } from '../constants/theme';
import { logger } from '../utils/logger';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 렌더 중 발생한 예외를 잡아 복구 화면을 보여준다.
 *
 * 이게 없으면 어느 화면에서든 예외 하나로 앱 전체가 백지가 되고,
 * 사용자는 앱을 강제 종료하는 것 외에 할 수 있는 게 없다.
 * 출결 도중 그런 일이 생기면 그날 기록을 이어서 넣지 못한다.
 *
 * 주의: 이벤트 핸들러나 비동기 코드의 예외는 잡지 못한다(React의 제약).
 * 그쪽은 각 호출부의 try/catch가 담당한다.
 */
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('Unhandled render error: ' + (info.componentStack ?? ''), error);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: theme.colors.background,
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: theme.colors.textPrimary,
            textAlign: 'center',
          }}
        >
          문제가 발생했습니다
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          저장된 출결 기록은 그대로 있습니다.
        </Text>

        {__DEV__ && (
          <ScrollView style={{ maxHeight: 160, marginTop: 16 }}>
            <Text style={{ fontSize: 12, color: theme.colors.danger }}>
              {error.message}
              {'\n'}
              {error.stack}
            </Text>
          </ScrollView>
        )}

        <TouchableOpacity
          onPress={this.reset}
          accessibilityRole="button"
          style={{
            marginTop: 24,
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderRadius: theme.borderRadius.medium,
            backgroundColor: theme.colors.primary,
          }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold' }}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

export default ErrorBoundary;
