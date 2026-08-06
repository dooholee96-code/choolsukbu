import 'styled-components/native';
import type { Theme } from '../constants/theme';

/**
 * styled 템플릿 안에서 쓰는 ({ theme }) 의 타입을 우리 테마로 확정한다.
 *
 * 주의: 반드시 'styled-components/native' 를 대상으로 증강해야 한다.
 * bare 'styled-components' 는 node_modules/styled-components/dist/ 아래의,
 * '/native' 는 node_modules/styled-components/native/dist/ 아래의
 * 서로 다른 DefaultTheme 선언으로 해석되기 때문에 대상을 잘못 잡으면
 * 증강이 조용히 무시된다.
 */
declare module 'styled-components/native' {
  export interface DefaultTheme extends Theme {}
}
