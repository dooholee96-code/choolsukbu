import type { NavigatorScreenParams } from '@react-navigation/native';

export type TabParamList = {
  Today: undefined;
  Students: undefined;
  Payments: undefined;
  Makeup: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList> | undefined;
  /** studentId가 있으면 수정, 없으면 신규 등록 */
  StudentFormModal: { studentId?: string } | undefined;
  /** 휴강·특강·요일 변경처럼 그 날 하루만 달라지는 일정 */
  ScheduleModal: undefined;
  /** 수강료 받은 한 건. paymentId가 있으면 그 건을 고친다. month는 'YYYY-MM' 수강월. */
  PaymentModal: { studentId: string; month: string; paymentId?: string };
  /** 원생 한 명의 교육비 납입 증명서 */
  CertificateModal: { studentId: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
