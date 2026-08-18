/**
 * iCloud 동기화는 빌드에 **선택적으로** 들어간다.
 *
 * 동기화를 켜면 앱에 iCloud entitlement가 붙는데, 이 권한은 유료 Apple Developer
 * 계정에서만 발급된다. 무료 Apple ID로 빌드하면서 이게 붙어 있으면 코드 서명
 * 단계에서 빌드가 실패한다 — 동기화 하나 때문에 앱 전체를 설치하지 못하게 된다.
 *
 * 그래서 기본은 꺼짐이다. 무료 계정에서는 동기화만 빠지고 나머지 기능은 전부
 * 그대로 동작한다. 앱 안에서도 iCloud를 못 쓰는 상태를 감지해 그 사유를 띄운다.
 *
 *   npx expo prebuild --clean                        동기화 없음 (무료 계정)
 *   EXPO_ICLOUD_SYNC=1 npx expo prebuild --clean     동기화 포함 (유료 계정)
 *
 * 나머지 설정은 전부 app.json에 있다. 이 파일은 그 위에 얹기만 한다.
 */
module.exports = ({ config }) => {
  if (process.env.EXPO_ICLOUD_SYNC !== '1') return config;

  return {
    ...config,
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
