#!/usr/bin/env bash
#
# 미리 컴파일된 Expo 모듈들이 이 설치의 ExpoModulesCore와 맞는지 본다.
#
# SDK 57이 만드는 iOS 프로젝트는 Expo 모듈을 소스로 빌드하지 않고 각 npm 패키지에
# 들어 있는 미리 컴파일된 xcframework를 쓴다 (Podfile의 EXPO_USE_PRECOMPILED_MODULES).
# 그 파일은 패키지를 올린 시점의 ExpoModulesCore에 맞춰 만들어져서, 패키지 버전이
# 서로 어긋나면 빌드는 멀쩡히 끝나는데 **앱이 켜지자마자 dyld가 죽인다**
# ('Symbol not found: ...ExpoModulesCore...'). 실제로 expo-file-system 57.0.2와
# expo-modules-core 57.0.3 조합이 그랬다 — willDestroy가 없어 아이패드에서 켜지지 않았다.
#
# 그래서 각 모듈이 ExpoModulesCore에서 **가져다 쓰는** 기호가 전부 코어가 **내보내는**
# 기호 안에 있는지 대조한다. dyld가 앱을 켤 때 하는 일과 같다.
# 의존성을 올린 뒤, 아이패드에 올리기 전에 돌린다.
#
#   npm run check:native
set -euo pipefail

NM_DIR="$(cd "${1:-node_modules}" && pwd)"

NM_TOOL=""
for candidate in llvm-nm "xcrun llvm-nm"; do
  if $candidate --version >/dev/null 2>&1; then NM_TOOL="$candidate"; break; fi
done
if [ -z "$NM_TOOL" ]; then
  echo "llvm-nm을 찾지 못했습니다 (Linux: llvm 패키지, macOS: Xcode 명령줄 도구)." >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

binary_of() { # <tarball> <product>
  local dir="$WORK/x/$2"
  mkdir -p "$dir"
  tar xzf "$1" -C "$dir" 2>/dev/null
  ls "$dir"/*.xcframework/ios-arm64/*.framework/"$2" 2>/dev/null | head -1
}

version_of() { node -p "require('$NM_DIR/$1/package.json').version"; }

CORE_TGZ="$NM_DIR/expo-modules-core/prebuilds/output/release/xcframeworks/ExpoModulesCore.tar.gz"
if [ ! -f "$CORE_TGZ" ]; then
  echo "미리 컴파일된 ExpoModulesCore가 없습니다. 소스로 빌드하는 설정이면 이 검사는 필요 없습니다."
  exit 0
fi

CORE_BIN="$(binary_of "$CORE_TGZ" ExpoModulesCore)"
$NM_TOOL --extern-only --defined-only --format=just-symbols "$CORE_BIN" | sort -u > "$WORK/core.exports"
echo "expo-modules-core $(version_of expo-modules-core)"

missing_total=0
while IFS= read -r tarball; do
  product="$(basename "$tarball" .tar.gz)"
  [ "$product" = ExpoModulesCore ] && continue
  pkg="$(echo "$tarball" | sed -E 's#.*'"$NM_DIR"'/((@[^/]+/)?[^/]+)/prebuilds.*#\1#')"

  bin="$(binary_of "$tarball" "$product")"
  if [ -z "$bin" ]; then
    echo "  ?  $pkg: $product 바이너리를 찾지 못했습니다"
    continue
  fi

  $NM_TOOL --undefined-only --format=just-symbols "$bin" \
    | grep '^_\$s15ExpoModulesCore' | sort -u > "$WORK/imports" || true
  missing="$(comm -23 "$WORK/imports" "$WORK/core.exports" | wc -l | tr -d ' ')"
  missing_total=$((missing_total + missing))

  if [ "$missing" -eq 0 ]; then
    echo "  ok $pkg@$(version_of "$pkg") ($product)"
  else
    echo "  !! $pkg@$(version_of "$pkg") ($product): 코어에 없는 기호 $missing개"
    comm -23 "$WORK/imports" "$WORK/core.exports" | head -3 | sed 's/^/       /'
  fi
done < <(find -L "$NM_DIR" -path '*/prebuilds/output/release/xcframeworks/*.tar.gz' | sort)

if [ "$missing_total" -gt 0 ]; then
  echo
  echo "맞지 않습니다. 이대로 빌드하면 앱이 켜지자마자 꺼집니다."
  echo "Expo 패키지를 같은 SDK의 최신 패치로 함께 올리세요 (npx expo install --fix)."
  exit 1
fi
echo "모두 맞습니다."
