import { useCallback, useState } from 'react';
import { useData } from './useData';
import { buildCertificatesHtml, certificateTargets } from '../utils/certificate';
import { getCurrentDate } from '../utils/date';
import { notify } from '../utils/dialog';
import { logger } from '../utils/logger';
import { printHtml } from '../utils/print';

/**
 * 교육비 납입 증명서 일괄 발급. [설정]의 신고 자료와 [수납]의 일정 안내가 같이 쓴다.
 *
 * 인쇄 화면이 열리면 프린터로 보내거나 PDF로 저장한다. 보호자 이름 칸은 비워서 뽑는다 —
 * 원생마다 다른 이름을 여기서 받을 수 없고, 앱은 보호자 정보를 담지 않는다.
 */
export const useCertificateBatch = () => {
  const { loadPaymentsPaidBetween, loadStudentsIncludingDeleted, loadAcademy } = useData();
  const [printing, setPrinting] = useState(false);

  const printAll = useCallback(
    async (year: number, preschoolOnly: boolean) => {
      setPrinting(true);
      try {
        const [payments, students, academy] = await Promise.all([
          loadPaymentsPaidBetween(`${year}-01-01`, `${year}-12-31`),
          // 지운 원생에게 받은 돈도 그 해 납입이다. 보호자는 여전히 증명서가 필요하다.
          loadStudentsIncludingDeleted(),
          loadAcademy(),
        ]);
        const targets = certificateTargets(students, payments, year, preschoolOnly);
        if (targets.length === 0) {
          notify(
            '발급할 원생이 없습니다',
            preschoolOnly
              ? `${year}년에 미취학으로 받은 돈 기록이 없습니다.`
              : `${year}년에 받은 돈 기록이 없습니다.`
          );
          return;
        }
        const issuedOn = getCurrentDate();
        await printHtml(
          buildCertificatesHtml(
            targets.map((student) => ({ academy, student, payments, year, issuedOn })),
            year
          )
        );
      } catch (error) {
        logger.error('Batch certificate failed', error);
        notify('인쇄하지 못했습니다', error instanceof Error ? error.message : '다시 시도해 주세요.');
      } finally {
        setPrinting(false);
      }
    },
    [loadPaymentsPaidBetween, loadStudentsIncludingDeleted, loadAcademy]
  );

  return { printAll, printing };
};
