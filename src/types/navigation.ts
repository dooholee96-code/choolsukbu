import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Today: undefined;
  Students: undefined;
  Makeup: undefined;
  History: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  /** studentId가 있으면 수정, 없으면 신규 등록 */
  StudentFormModal: { studentId?: string } | undefined;
  BackupModal: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
