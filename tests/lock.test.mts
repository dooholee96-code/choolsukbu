import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

/**
 * src/security/lock.ts 의 해시 규칙을 그대로 재현해 검증한다.
 * expo-secure-store와 expo-crypto는 React Native 밖에서 부를 수 없어서,
 * 저장 자체가 아니라 '무엇을 저장하는가'의 규칙을 고정한다.
 */
const hash = (pin: string, salt: string) =>
  createHash('sha256').update(`${salt.length}:${salt}:${pin}`).digest('hex');

test('맞는 PIN만 통과한다', () => {
  const salt = randomUUID();
  const stored = hash('1234', salt);

  assert.equal(hash('1234', salt), stored);
  assert.notEqual(hash('1235', salt), stored);
  assert.notEqual(hash('123', salt), stored);
  assert.notEqual(hash('', salt), stored);
});

test('소금이 다르면 같은 PIN이라도 저장값이 다르다', () => {
  // 아이폰과 아이패드의 키체인 값을 맞대어 볼 수 없어야 한다.
  assert.notEqual(hash('1234', randomUUID()), hash('1234', randomUUID()));
});

test('평문은 어디에도 남지 않는다', () => {
  const stored = hash('1234', randomUUID());
  assert.equal(stored.includes('1234'), false);
  assert.equal(stored.length, 64);
});

test('소금과 PIN의 경계가 모호하지 않다', () => {
  // 길이를 앞에 붙이지 않으면 'x:123' + '4' 와 'x' + '123:4' 가 같은 값이 된다.
  assert.notEqual(hash('4', 'x:123'), hash('123:4', 'x'));
});
