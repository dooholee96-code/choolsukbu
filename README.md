# 출석부 (choolsukbu)

학원·공부방용 **오프라인 출결 관리 앱**. 서버 없이 기기 안 SQLite에만 저장한다.

원생마다 정규 수업 요일과 시간대를 등록해 두면, 앱이 오늘 요일에 해당하는 학생만 골라 보여준다. 체크인 시점에 등원 유형을 자동으로 판정한다.

| 조건 | 기록되는 상태 |
|---|---|
| 지정 요일 + 지정 시간대 안 | `scheduled` (정상 출석) |
| 지정 요일이지만 시간대 밖 | `unexpected` (예외) |
| 지정 요일이 아닌 날 | `unexpected` (예외) |

**대상 기기**: iPhone(세로 고정), iPad Pro 13"(전방향, Stage Manager·Split View 지원)

---

## 요구사항

- Node.js 20 이상
- iPad에 설치하려면 **macOS + Xcode**
- 무료 Apple ID로 충분하다 (유료 개발자 계정 불필요)

## 개발 중 실행

```bash
npm install

npm start        # Expo Go로 실행 (QR 스캔)
npm run web      # 브라우저에서 실행. 반응형 확인이 가장 빠르다
npm run typecheck
```

`npm run web`으로 열고 창 너비를 조절하면 1→2→3열 전환을 바로 볼 수 있다.

> Expo Go에서는 **iPad 화면 방향 설정이 적용되지 않는다.** `ios.infoPlist`는 빌드 시점에 Info.plist로 들어가는데 Expo Go는 자체 Info.plist를 쓰기 때문이다. 방향 동작을 확인하려면 아래 네이티브 빌드가 필요하다.

## iPad에 설치하기

Mac에 iPad를 케이블로 연결하고:

```bash
npx expo run:ios --device --configuration Release
```

연결된 기기 목록이 뜨면 iPad를 고른다.

`--configuration Release`가 중요하다. JS 번들이 앱 안에 포함되어 **개발 서버 없이 독립 실행**된다. 이걸 빼면 Mac이 꺼져 있을 때 앱이 뜨지 않는다.

### 최초 1회만 필요한 설정

**서명 팀 선택** — 빌드가 코드 서명에서 멈추면 `ios/app.xcworkspace`를 Xcode로 열고 `app` 타깃 → Signing & Capabilities → Team에서 본인 Apple ID를 고른다. 계정이 없으면 Xcode → Settings → Accounts에서 Apple ID를 추가한다.

**iPad에서 개발자 신뢰** — 설치 후 처음 실행할 때 "신뢰하지 않은 개발자" 경고가 뜬다. iPad에서 설정 → 일반 → VPN 및 기기 관리 → 본인 Apple ID → 신뢰.

### 7일마다 재설치

무료 Apple ID는 서명 유효기간이 **7일**이다. 만료되면 앱은 홈 화면에 남아 있지만 실행되지 않는다. 같은 명령을 다시 돌리면 된다.

```bash
npx expo run:ios --device --configuration Release
```

**데이터는 지워지지 않는다.** 같은 번들 ID로 덮어쓰는 업그레이드 설치라 SQLite 파일이 그대로 유지된다. 단, 앱을 손으로 삭제하면 데이터도 함께 사라진다.

무료 계정에는 기기당 앱 3개, 주당 App ID 10개 제한도 있다.

## 설정 바꾸기

`app.json`이 유일한 소스다. `ios/`와 `android/`는 `expo prebuild`가 만드는 산출물이라 커밋하지 않는다.

| 값 | 위치 | 비고 |
|---|---|---|
| 홈 화면 이름 | `expo.name` | 현재 `출석부` |
| 번들 ID | `expo.ios.bundleIdentifier` | 현재 `com.dooholee96.choolsukbu`. App Store 제출 전까지는 자유롭게 변경 가능 |
| 화면 방향 | `expo.ios.infoPlist` | iPhone 세로 / iPad 전방향으로 분기 |

`app.json`을 고친 뒤에는 `npx expo prebuild --clean`으로 네이티브 프로젝트를 다시 만든다.

## 구조

```
App.tsx                     루트. DB 초기화 게이트 + 네비게이터
src/
  screens/                  Home(오늘) · Students(원생) · Makeup(보충) · StudentFormModal
  components/
    StudentCard.tsx · MakeupCard.tsx · ErrorBoundary.tsx
    common/                 Screen(반응형 셸) · GridRow(그리드 한 행) · Button · Chip
  hooks/
    useData.tsx             SQLite 접근 + 전역 상태
    useResponsive.ts        창 폭 기준 사이즈 클래스
  db/index.ts               스키마 · 마이그레이션 앵커
  utils/                    date · id · array · csv · dialog · logger
  constants/theme.ts        색·글꼴·간격·브레이크포인트
assets/fonts/               고운돋움 · 고운바탕 Bold (약 15MB)
```

## 숲속 테마

크림 배경에 호수 블루를 얹은 파스텔 팔레트. `Screen` 뒤에 `ForestBackground`가
깔린다. 배경은 폰 화면(390x844) 기준으로 그려서 `xMidYMax slice`로 채우므로,
넓은 창에서는 3.5배까지 확대된다. 그래서 compact가 아닌 사이즈 클래스에서는
불투명도를 낮춰 카드보다 뒤로 물러나게 한다.

### 색은 두 벌이다

| 용도 | 토큰 |
|---|---|
| 면·틴트 배경 | `primary` `secondary` `success` `danger` |
| 그 위에 얹히는 글씨·아이콘 | `primaryStrong` `secondaryStrong` `successStrong` `dangerStrong` |

파스텔 원색 위의 흰 글씨는 WCAG AA(4.5:1)에 크게 못 미친다 — 측정값으로
primary 2.46:1, secondary 1.90:1, success 2.10:1이었다. `Strong` 계열은 색조를
유지한 채 명도만 낮춰 흰 글씨 기준 4.5:1 이상을 확보한 값이다.
**버튼 배경, 상태 태그 글씨, 탭바 활성 색에는 반드시 `Strong` 쪽을 쓴다.**

### 글꼴

고운돋움(본문) / 고운바탕 Bold(강조). `App.tsx`에서 `useFonts`로 읽고 DB 초기화와
같은 게이트에서 기다린다. styled 템플릿에는 `font-weight` 대신
`font-family: ${({ theme }) => theme.fonts.bold}`를 쓴다 — 커스텀 폰트에
`font-weight`를 주면 합성 볼드로 뭉개진다.

로딩이 실패하면 `systemFontTheme`으로 갈아끼운다. 존재하지 않는 글꼴 이름이
`font-family`에 남으면 네이티브에서 글자가 그려지지 않기 때문이다.

### 반응형 규칙

기기 종류가 아니라 **현재 창 폭**으로 판정한다. iPad는 Stage Manager와 Split View에서 창 크기가 임의로 바뀌기 때문이다.

| 폭 | 사이즈 클래스 | 열 |
|---|---|---|
| < 700pt | compact | 1 |
| 700–1099pt | medium | 2 |
| ≥ 1100pt | expanded | 3 |

### 주의사항

`styled-components` 템플릿 안에서 `//` 주석을 쓰면 안 된다. 네이티브 파서는 블록 주석만 제거하기 때문에, `//` 뒤의 값 파싱이 다음 `:`까지 이어지면서 **바로 다음 선언 한 줄을 통째로 삼킨다.** 주석이 필요하면 템플릿 밖에 `/* */`로 쓴다.

`Alert`를 직접 쓰지 말고 `utils/dialog`의 `confirm`·`notify`를 쓴다. `react-native-web`의 `Alert.alert`는 `static alert() {}` 인 빈 스텁이라, 웹에서는 확인 대화상자로 감싼 동작이 아무 반응 없이 사라진다.

## 출결 흐름

```
등원 예정 ──[Check In]──▶ 출석 / 예외
        └──[결석]──▶ 결석 기록 + 보충 건 생성
                             │
                   [보충] 탭 ─┴─▶ 날짜 지정 ──▶ 완료
                                              (보충 수업 출결 기록)
```

결석과 보충 건은 항상 함께 생성·취소되도록 트랜잭션으로 묶여 있다.
잘못 누른 기록은 카드의 **취소**로 되돌릴 수 있다. 다만 이미 날짜를 잡았거나
완료한 보충은 별도 판단이 들어간 기록이라 취소해도 남는다.

## 원생 관리

`StudentFormModal` 하나가 등록과 수정을 겸한다. `studentId` 파라미터가 있으면 수정 모드다.
원생 탭에서 카드를 누르면 수정으로 들어가고, 그 안에서 삭제할 수 있다.

삭제는 출결 기록과 보충 건을 **함께 지운다.** `attendance`와 `makeup`이 `students`를
참조하는데 `ON DELETE CASCADE`가 없고 `PRAGMA foreign_keys`가 켜져 있어서,
자식 행을 먼저 지우지 않으면 기록이 하나라도 있는 원생은 제약 위반으로 삭제가 실패한다.
세 삭제는 한 트랜잭션으로 묶여 있다.

> 삭제는 되돌릴 수 없다. 퇴원생의 기록을 남겨야 한다면 삭제 대신 보관 상태를
> 두는 편이 맞지만, 아직 그런 개념은 없다.

## 아직 없는 기능

- 출결 이력 조회 (오늘 데이터만 표시)
- **데이터 백업·내보내기** — `utils/csv.ts`에 파서만 있고 UI가 없다. 앱을 삭제하면 데이터가 전부 사라지므로 실사용 전에 갖추는 것을 권한다.
- 앱 잠금 — 미성년자 이름·학년·수강료를 다루는데 기기를 든 사람 누구나 열람할 수 있다.
