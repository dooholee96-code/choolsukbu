import { Platform } from 'react-native';
import * as Print from 'expo-print';

/**
 * HTML 한 장을 인쇄한다. iPad에서는 iOS 인쇄 화면이 열린다 — 프린터로 보내거나,
 * 공유 버튼이나 미리보기를 벌려 PDF로 저장·공유할 수 있다.
 *
 * 웹의 expo-print는 넘긴 HTML이 아니라 지금 화면을 인쇄한다. 웹은 미리보기 도구일
 * 뿐이지만, 거기서도 증명서가 맞게 나오는지 보려고 새 창에 써서 인쇄한다.
 */
export const printHtml = async (html: string): Promise<void> => {
  if (Platform.OS !== 'web') {
    await Print.printAsync({ html });
    return;
  }

  const popup = window.open('', '_blank');
  if (!popup) throw new Error('새 창을 열 수 없습니다. 팝업 차단을 꺼 주세요.');
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
};
