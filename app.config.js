const fs = require('fs');
const path = require('path');

/**
 * iCloud 동기화는 빌드에 **선택적으로** 들어간다.
 *
 * 동기화를 켜면 앱에 iCloud entitlement가 붙는데, 이 권한은 유료 Apple Developer
 * 계정에서만 발급된다. 무료 Apple ID로 빌드하면서 이게 붙어 있으면 코드 서명
 * 단계에서 빌드가 실패한다 — 동기화 하나 때문에 앱 전체를 설치하지 못하게 된다.
 *
 * 그래서 기본은 꺼짐이다. 무료 계정에서는 동기화만 빠지고 나머지 기능은 전부
 * 그대로 동작한다.
 *
 *   npx expo prebuild --clean                        동기화 없음 (무료 계정)
 *   EXPO_ICLOUD_SYNC=1 npx expo prebuild --clean     동기화 포함 (유료 계정)
 *
 * 나머지 설정은 전부 app.json에 있다. 이 파일은 그 위에 얹기만 한다.
 */

/**
 * 이미 만들어진 네이티브 프로젝트가 iCloud 권한을 갖고 있는가.
 *
 * 앱이 동기화를 쓸 수 있는지는 **권한 파일**이 정한다. 동기화 라이브러리는 무료
 * 빌드에도 그대로 들어가서, 모듈이 있다는 것만으로는 알 수 없다 — 예전에는 그걸로
 * 판단해서, 무료 빌드에서 'iCloud에 로그인하세요'라고 엉뚱하게 안내하거나 매번
 * 동기화를 시도하다 실패해 홈 화면에 '못 맞춤'을 띄웠다.
 *
 * 환경 변수만 보지 않는 이유: 이 설정은 prebuild 때 한 번, 그리고 **빌드할 때마다**
 * 다시 읽힌다(앱에 심어 두는 설정을 그때 만든다). 매 빌드마다 변수를 붙이라고 하면
 * 한 번 잊는 순간 동기화가 조용히 꺼진다.
 */
const nativeProjectHasICloud = () => {
  const iosDir = path.join(__dirname, 'ios');
  try {
    for (const entry of fs.readdirSync(iosDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'Pods' || entry.name === 'build') continue;
      const dir = path.join(iosDir, entry.name);
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.entitlements')) continue;
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        if (text.includes('com.apple.developer.icloud-container-identifiers')) return true;
      }
    }
  } catch {
    // ios 폴더가 아직 없다 (prebuild 전, 또는 웹).
  }
  return false;
};

module.exports = ({ config }) => {
  const requested = process.env.EXPO_ICLOUD_SYNC === '1';

  const withFlag = {
    ...config,
    extra: {
      ...config.extra,
      // 앱이 읽는 값 (src/sync/transport.ts). true일 때만 동기화를 시도한다.
      icloudSync: requested || nativeProjectHasICloud(),
    },
  };

  if (!requested) return withFlag;

  return {
    ...withFlag,
    plugins: [
      ...(config.plugins ?? []),
      [
        'react-native-cloud-storage',
        {
          // 컨테이너 이름을 따로 주지 않으면 iCloud.<번들ID>가 된다.
          iCloudContainerEnvironment: 'Production',
        },
      ],
    ],
  };
};
