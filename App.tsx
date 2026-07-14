import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider } from 'styled-components/native';

import HomeScreen from './src/screens/HomeScreen';
import StudentsScreen from './src/screens/StudentsScreen';
import MakeupScreen from './src/screens/MakeupScreen';
import AddStudentModal from './src/screens/AddStudentModal';
import { theme } from './src/constants/theme';
import { initDB } from './src/db';
import { DataProvider } from './src/hooks/useData';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Today') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Students') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Makeup') {
            iconName = focused ? 'book' : 'book-outline';
          } else {
            iconName = 'help'; // Fallback icon
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: false,
      })}
    >
      <Tab.Screen name="Today" component={HomeScreen} options={{ title: '오늘' }} />
      <Tab.Screen name="Students" component={StudentsScreen} options={{ title: '원생' }} />
      <Tab.Screen name="Makeup" component={MakeupScreen} options={{ title: '보충' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  useEffect(() => {
    initDB()
      .then(() => console.log('Database initialized successfully'))
      .catch((err) => console.error('Database initialization failed:', err));
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <DataProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen
              name="AddStudentModal"
              component={AddStudentModal}
              options={{ presentation: 'modal' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </DataProvider>
    </ThemeProvider>
  );
}
