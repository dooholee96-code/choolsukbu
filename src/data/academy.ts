import type { SQLiteDatabase } from 'expo-sqlite';
import { AcademyInfo, FeeRule } from '../types';
import { stamp } from './stamp';

/** 학원 정보는 한 줄뿐이다. */
const ID = 'self';

export const emptyAcademy = (): AcademyInfo => ({
  name: '',
  owner: '',
  bizNumber: '',
  address: '',
  phone: '',
  subject: '',
  feeRules: [],
});

type Row = Record<string, string | null> & { id: string };

/** 깨진 값이 한 줄 섞여도 나머지 기준은 살린다. */
const parseRules = (raw: string | null): FeeRule[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return parsed
      .filter((r) => r && typeof r === 'object' && num(r.fee) !== null)
      .map((r) => ({
        id: String(r.id ?? Math.random()),
        perWeek: num(r.perWeek),
        gradeFrom: num(r.gradeFrom),
        gradeTo: num(r.gradeTo),
        fee: num(r.fee) as number,
      }));
  } catch {
    return [];
  }
};

/** 아직 적은 적이 없으면 null. 화면은 빈 칸으로, 동기화는 '보낼 것 없음'으로 본다. */
export const getAcademy = async (db: SQLiteDatabase): Promise<AcademyInfo | null> => {
  const row = await db.getFirstAsync<Row>('SELECT * FROM academy WHERE id = ?;', ID);
  if (!row) return null;
  const minutes = Number(row.classMinutes);
  return {
    name: row.name ?? '',
    owner: row.owner ?? '',
    bizNumber: row.bizNumber ?? '',
    address: row.address ?? '',
    phone: row.phone ?? '',
    subject: row.subject ?? '',
    feeRules: parseRules(row.feeRules),
    classMinutes: minutes > 0 ? minutes : undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
};

/** updatedAt을 주면 그대로 쓴다 (동기화로 들어온 값). 안 주면 지금 시각. */
export const saveAcademy = (db: SQLiteDatabase, info: AcademyInfo, updatedAt = stamp()) =>
  db.runAsync(
    `INSERT INTO academy (id, name, owner, bizNumber, address, phone, subject, feeRules, classMinutes, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, owner = excluded.owner, bizNumber = excluded.bizNumber,
       address = excluded.address, phone = excluded.phone, subject = excluded.subject,
       feeRules = excluded.feeRules, classMinutes = excluded.classMinutes,
       updatedAt = excluded.updatedAt;`,
    ID,
    info.name.trim(),
    info.owner.trim(),
    info.bizNumber.trim(),
    info.address.trim(),
    info.phone.trim(),
    info.subject.trim(),
    JSON.stringify(info.feeRules ?? []),
    info.classMinutes && info.classMinutes > 0 ? String(info.classMinutes) : null,
    updatedAt
  );

/**
 * 일부만 고친다. 학원 정보 칸과 수강료 기준표는 설정 화면에서 따로 저장되는데, 각자
 * 들고 있던 옛 값으로 통째로 쓰면 서로가 고친 것을 덮는다. 늘 지금 저장된 값 위에 얹는다.
 */
export const patchAcademy = async (
  db: SQLiteDatabase,
  patch: Partial<Omit<AcademyInfo, 'updatedAt'>>
): Promise<AcademyInfo> => {
  const next = { ...((await getAcademy(db)) ?? emptyAcademy()), ...patch };
  await saveAcademy(db, next);
  return next;
};
