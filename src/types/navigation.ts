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
  /** 휴강·특강·요일 변경처럼 그 날 하루만 달라지는 일정 */
  ScheduleModal: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
