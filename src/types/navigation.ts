import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Today: undefined;
  Students: undefined;
  Makeup: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  AddStudentModal: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
