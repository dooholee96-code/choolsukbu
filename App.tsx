import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider } from 'styled-components/native';

import HomeScreen from './src/screens/HomeScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import MakeupScreen from './src/screens/MakeupScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import StudentFormModal from './src/screens/StudentFormModal';
import BackupModal from './src/screens/BackupModal';
import ScheduleModal from './src/screens/ScheduleModal';
import { theme, systemFontTheme } from './src/constants/theme';
import { initDB } from './src/db';
import { DataProvider } from './src/hooks/useData';
import ErrorBoundary from './src/components/ErrorBoundary';
import { logger } from './src/utils/logger';
import { useResponsive } from './src/hooks/useResponsive';
import type { RootStackParamList, TabParamList } from './src/types/navigation';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const TAB_ICONS: Record<keyof TabParamList, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Today: ['home', 'home-outline'],
  Students: ['people', 'people-outline'],
  Makeup: ['book', 'book-outline'],
  History: ['calendar', 'calendar-outline'],
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const [active, inactive] = TAB_ICONS[route.name] ?? ['help', 'help'];
          return <Ionicons name={focused ? active : inactive} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primaryStrong,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Today" component={HomeScreen} options={{ title: '오늘' }} />
      <Tab.Screen name="Students" component={StudentsScreen} options={{ title: '원생' }} />
      <Tab.Screen name="Makeup" component={MakeupScreen} options={{ title: '보충' }} />
      <Tab.Screen name="History" component={HistoryScreen} options={{ title: '이력' }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { sizeClass } = useResponsive();

  // iPad처럼 넓은 창에서는 모달이 화면 전체를 덮지 않도록 form sheet로 띄운다.
  // Stage Manager로 창을 좁히면 compact가 되어 다시 전체 모달로 돌아간다.
  const modalPresentation = sizeClass === 'compact' ? 'modal' : 'formSheet';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={TabNavigator} />
      <Stack.Screen
        name="StudentFormModal"
        component={StudentFormModal}
        options={{ presentation: modalPresentation }}
      />
      <Stack.Screen
        name="BackupModal"
        component={BackupModal}
        options={{ presentation: modalPresentation }}
      />
      <Stack.Screen
        name="ScheduleModal"
        component={ScheduleModal}
        options={{ presentation: modalPresentation }}
      />
    </Stack.Navigator>
  );
}

type DBState = 'loading' | 'ready' | 'error';

const centered = {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  padding: 24,
  backgroundColor: theme.colors.background,
} as const;

export default function App() {
  const [dbState, setDBState] = useState<DBState>('loading');

  // 커스텀 글꼴. 로드 전에 화면을 그리면 시스템 글꼴로 한 번 그렸다가
  // 바뀌면서 글자가 튀므로 DB와 함께 시작 게이트에서 기다린다.
  const [fontsLoaded, fontError] = useFonts({
    GowunDodum: require('./assets/fonts/GowunDodum-Regular.ttf'),
    'GowunBatang-Bold': require('./assets/fonts/GowunBatang-Bold.ttf'),
  });

  // 글꼴을 못 읽었으면 이름이 살아 있는 테마를 넘기면 안 된다.
  const activeTheme = useMemo(
    () => (fontError ? systemFontTheme : theme),
    [fontError]
  );

  const setupDatabase = useCallback(() => {
    setDBState('loading');
    initDB()
      .then(() => setDBState('ready'))
      .catch((error) => {
        logger.error('Database initialization failed:', error);
        setDBState('error');
      });
  }, []);

  useEffect(setupDatabase, [setupDatabase]);

  const fontsSettled = fontsLoaded || Boolean(fontError);

  if (dbState !== 'ready' || !fontsSettled) {
    // 이전에는 초기화가 실패해도 상태를 바꾸지 않아 스피너에 영구히 갇혔다.
    return (
      <View style={centered}>
        {dbState !== 'error' ? (
          <ActivityIndicator size="large" color={theme.colors.primaryStrong} />
        ) : (
          <>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, textAlign: 'center' }}>
              데이터베이스를 열지 못했습니다.
            </Text>
            <TouchableOpacity
              onPress={setupDatabase}
              accessibilityRole="button"
              style={{
                marginTop: 16,
                paddingVertical: 12,
                paddingHorizontal: 24,
                borderRadius: theme.borderRadius.medium,
                backgroundColor: theme.colors.primaryStrong,
              }}
            >
              <Text style={{ color: 'white', fontWeight: 'bold' }}>다시 시도</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider theme={activeTheme}>
          <DataProvider>
            <StatusBar style="dark" />
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </DataProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
