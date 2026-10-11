<div dir="rtl">

# דוח רישיונות של חבילות צד שלישי

> **קובץ שנוצר אוטומטית** על ידי `npm run licenses` (‏`scripts/licenses.mjs`). לא לערוך ידנית.
> הרצה מחדש אחרי כל שינוי בתלויות. `npm run licenses -- --check` נכשל כשהקובץ לא מעודכן.

**מה נבדק:** סגור התלויות של **Production** בלבד (בלי devDependencies) של `apps/mobile` ושל `apps/server`, לפי `package-lock.json`, כפי ש־Node פותר אותן.
הרישיון נקרא מהשדה `license` ב־`package.json` של כל חבילה מותקנת (ואם היא לא מותקנת במחשב הזה, מה־lock).

**הסתייגות:** סגור התלויות של `expo` כולל גם כלי בנייה (‏Metro, ‏Babel, ‏@expo/cli) שלא נכנסים לקובץ האפליקציה. הרשימה רחבה מהנדרש, וזה בכוונה.

## סיכום

- חבילות באפליקציה (mobile): **671**
- חבילות בשרת (server): **141**
- סה״כ שונות (שם@גרסה): **754**
- **מסומנות לבדיקה: 1**
- דורשות תשומת לב (ייחוס / copyleft חלש): 15

| רישיון | חבילות |
|---|---|
| MIT | 589 |
| Apache-2.0 | 70 |
| ISC | 28 |
| BSD-3-Clause | 22 |
| MPL-2.0 | 12 |
| BSD-2-Clause | 11 |
| BlueOak-1.0.0 | 6 |
| Unlicense | 3 |
| (MIT OR CC0-1.0) | 2 |
| 0BSD | 2 |
| MIT AND OFL-1.1 | 2 |
| (BSD-3-Clause OR GPL-2.0) | 1 |
| (MIT OR Apache-2.0) | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| FSL-1.1-Apache-2.0 | 1 |
| MIT AND Apache-2.0 | 1 |
| Python-2.0 | 1 |

## מסומנות לבדיקה (GPL / AGPL / LGPL / בלי רישיון / UNLICENSED / לא מוכר)

| חבילה | גרסה | רישיון | סוג | איפה | איך נכנסה | הערה |
|---|---|---|---|---|---|---|
| sentry | 0.45.0 | FSL-1.1-Apache-2.0 | לא מוכר / מותאם | server | sentry ← @sentry/bundler-plugins ← @sentry/node ← apps/server | Functional Source License: מותר כל שימוש חוץ מבניית מוצר שמתחרה ב־Sentry, והופך ל־Apache-2.0 שנתיים אחרי כל גרסה. רק בשרת, לא מופץ באפליקציה. **תקין לשימוש שלנו.** |

## דורשות תשומת לב

| חבילה | גרסה | רישיון | סוג | איפה | הערה |
|---|---|---|---|---|---|
| @expo-google-fonts/rubik | 0.4.2 | MIT AND OFL-1.1 | ייחוס (Attribution) | mobile | הגופנים (OFL-1.1): הודעת זכויות היוצרים והרישיון מוצגים במסך "רישיונות" באפליקציה. |
| @expo-google-fonts/teko | 0.4.1 | MIT AND OFL-1.1 | ייחוס (Attribution) | mobile | הגופנים (OFL-1.1): הודעת זכויות היוצרים והרישיון מוצגים במסך "רישיונות" באפליקציה. |
| caniuse-lite | 1.0.30001815 | CC-BY-4.0 | ייחוס (Attribution) | mobile | נתונים לכלי הבנייה (browserslist). לא נכנס לקובץ האפליקציה. |
| lightningcss | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | Copyleft חלש | mobile | כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו. |

## רישיון כפול (OR): נבחרה האפשרות המתירנית

| חבילה | גרסה | רישיון | איפה |
|---|---|---|---|
| fb-dotslash | 0.5.8 | (MIT OR Apache-2.0) | mobile |
| node-forge | 1.4.0 | (BSD-3-Clause OR GPL-2.0) | mobile |
| type-fest | 0.21.3 | (MIT OR CC0-1.0) | mobile |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) | mobile |

## כל החבילות

| חבילה | גרסה | רישיון | איפה |
|---|---|---|---|
| @babel/code-frame | 7.29.7 | MIT | mobile |
| @babel/compat-data | 7.29.7 | MIT | mobile |
| @babel/core | 7.29.7 | MIT | mobile |
| @babel/generator | 7.29.8 | MIT | mobile |
| @babel/helper-annotate-as-pure | 7.29.7 | MIT | mobile |
| @babel/helper-compilation-targets | 7.29.7 | MIT | mobile |
| @babel/helper-create-class-features-plugin | 7.29.7 | MIT | mobile |
| @babel/helper-create-regexp-features-plugin | 7.29.10 | MIT | mobile |
| @babel/helper-define-polyfill-provider | 0.6.8 | MIT | mobile |
| @babel/helper-globals | 7.29.7 | MIT | mobile |
| @babel/helper-member-expression-to-functions | 7.29.7 | MIT | mobile |
| @babel/helper-module-imports | 7.29.7 | MIT | mobile |
| @babel/helper-module-transforms | 7.29.7 | MIT | mobile |
| @babel/helper-optimise-call-expression | 7.29.7 | MIT | mobile |
| @babel/helper-plugin-utils | 7.29.7 | MIT | mobile |
| @babel/helper-remap-async-to-generator | 7.29.7 | MIT | mobile |
| @babel/helper-replace-supers | 7.29.7 | MIT | mobile |
| @babel/helper-skip-transparent-expression-wrappers | 7.29.7 | MIT | mobile |
| @babel/helper-string-parser | 7.29.7 | MIT | mobile |
| @babel/helper-validator-identifier | 7.29.7 | MIT | mobile |
| @babel/helper-validator-option | 7.29.7 | MIT | mobile |
| @babel/helper-wrap-function | 7.29.7 | MIT | mobile |
| @babel/helpers | 7.29.10 | MIT | mobile |
| @babel/parser | 7.29.9 | MIT | mobile |
| @babel/plugin-proposal-decorators | 7.29.7 | MIT | mobile |
| @babel/plugin-proposal-export-default-from | 7.29.7 | MIT | mobile |
| @babel/plugin-syntax-decorators | 7.29.7 | MIT | mobile |
| @babel/plugin-syntax-dynamic-import | 7.8.3 | MIT | mobile |
| @babel/plugin-syntax-export-default-from | 7.29.7 | MIT | mobile |
| @babel/plugin-syntax-flow | 7.29.7 | MIT | mobile |
| @babel/plugin-syntax-jsx | 7.29.7 | MIT | mobile |
| @babel/plugin-syntax-nullish-coalescing-operator | 7.8.3 | MIT | mobile |
| @babel/plugin-syntax-optional-chaining | 7.8.3 | MIT | mobile |
| @babel/plugin-syntax-typescript | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-arrow-functions | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-async-generator-functions | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-async-to-generator | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-block-scoping | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-class-properties | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-class-static-block | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-classes | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-destructuring | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-export-namespace-from | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-flow-strip-types | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-for-of | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-logical-assignment-operators | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-modules-commonjs | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-named-capturing-groups-regex | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-nullish-coalescing-operator | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-object-rest-spread | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-optional-catch-binding | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-optional-chaining | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-parameters | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-private-methods | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-private-property-in-object | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-display-name | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-jsx | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-jsx-development | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-react-pure-annotations | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-regenerator | 7.29.8 | MIT | mobile |
| @babel/plugin-transform-runtime | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-shorthand-properties | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-template-literals | 7.29.7 | MIT | mobile |
| @babel/plugin-transform-typescript | 7.29.9 | MIT | mobile |
| @babel/plugin-transform-unicode-regex | 7.29.7 | MIT | mobile |
| @babel/preset-typescript | 7.29.7 | MIT | mobile |
| @babel/runtime | 7.29.10 | MIT | mobile |
| @babel/template | 7.29.7 | MIT | mobile |
| @babel/traverse | 7.29.10 | MIT | mobile |
| @babel/types | 7.29.8 | MIT | mobile |
| @better-auth/utils | 0.3.1 | MIT | mobile, server |
| @better-fetch/fetch | 1.3.2 | MIT | mobile, server |
| @colyseus/better-call | 1.3.3 | MIT | mobile, server |
| @colyseus/clock | 2.0.3 | MIT | server |
| @colyseus/core | 0.18.18 | MIT | server |
| @colyseus/greeting-banner | 4.0.3 | MIT | server |
| @colyseus/schema | 5.0.36 | MIT | mobile, server |
| @colyseus/sdk | 0.18.5 | MIT | mobile |
| @colyseus/shared-types | 0.18.3 | MIT | mobile, server |
| @colyseus/timer | 2.0.3 | MIT | server |
| @colyseus/ws-transport | 0.18.4 | MIT | server |
| @egjs/hammerjs | 2.0.17 | MIT | mobile |
| @electric-sql/pglite | 0.5.8 | Apache-2.0 | server |
| @expo-google-fonts/material-symbols | 0.4.49 | MIT AND Apache-2.0 | mobile |
| @expo-google-fonts/rubik | 0.4.2 | MIT AND OFL-1.1 | mobile |
| @expo-google-fonts/teko | 0.4.1 | MIT AND OFL-1.1 | mobile |
| @expo/cli | 57.0.28 | MIT | mobile |
| @expo/code-signing-certificates | 0.0.6 | MIT | mobile |
| @expo/config | 57.0.10 | MIT | mobile |
| @expo/config-plugins | 57.0.10 | MIT | mobile |
| @expo/config-types | 57.0.2 | MIT | mobile |
| @expo/devcert | 1.2.2 | MIT | mobile |
| @expo/devtools | 57.0.1 | MIT | mobile |
| @expo/dom-webview | 57.0.1 | MIT | mobile |
| @expo/env | 2.4.3 | MIT | mobile |
| @expo/expo-modules-macros-plugin | 0.6.1 | MIT | mobile |
| @expo/fingerprint | 0.20.13 | MIT | mobile |
| @expo/image-utils | 0.11.6 | MIT | mobile |
| @expo/inline-modules | 0.1.7 | MIT | mobile |
| @expo/json-file | 11.0.1 | MIT | mobile |
| @expo/local-build-cache-provider | 57.0.8 | MIT | mobile |
| @expo/log-box | 57.0.4 | MIT | mobile |
| @expo/metro | 56.0.2 | MIT | mobile |
| @expo/metro-config | 57.0.13 | MIT | mobile |
| @expo/metro-file-map | 57.0.4 | MIT | mobile |
| @expo/metro-runtime | 57.0.16 | MIT | mobile |
| @expo/osascript | 2.7.1 | MIT | mobile |
| @expo/package-manager | 1.13.1 | MIT | mobile |
| @expo/plist | 0.8.1 | MIT | mobile |
| @expo/prebuild-config | 57.0.17 | MIT | mobile |
| @expo/require-utils | 57.0.6 | MIT | mobile |
| @expo/router-server | 57.0.12 | MIT | mobile |
| @expo/schema-utils | 57.0.2 | MIT | mobile |
| @expo/sdk-runtime-versions | 1.0.1 | MIT | mobile |
| @expo/spawn-async | 1.8.0 | MIT | mobile |
| @expo/sudo-prompt | 9.3.2 | MIT | mobile |
| @expo/ui | 57.0.22 | MIT | mobile |
| @expo/ws-tunnel | 2.0.1 | MIT | mobile |
| @expo/xcpretty | 4.4.6 | MIT | mobile |
| @firebase/ai | 2.14.0 | Apache-2.0 | mobile |
| @firebase/analytics | 0.10.23 | Apache-2.0 | mobile |
| @firebase/analytics-compat | 0.2.29 | Apache-2.0 | mobile |
| @firebase/analytics-types | 0.8.4 | Apache-2.0 | mobile |
| @firebase/app | 0.16.0 | Apache-2.0 | mobile |
| @firebase/app-check | 0.13.0 | Apache-2.0 | mobile |
| @firebase/app-check-compat | 0.4.6 | Apache-2.0 | mobile |
| @firebase/app-check-interop-types | 0.3.4 | Apache-2.0 | mobile |
| @firebase/app-check-types | 0.5.4 | Apache-2.0 | mobile |
| @firebase/app-compat | 0.5.16 | Apache-2.0 | mobile |
| @firebase/app-types | 0.9.5 | Apache-2.0 | mobile |
| @firebase/auth | 1.13.4 | Apache-2.0 | mobile |
| @firebase/auth-compat | 0.6.9 | Apache-2.0 | mobile |
| @firebase/auth-interop-types | 0.2.5 | Apache-2.0 | mobile |
| @firebase/auth-types | 0.13.1 | Apache-2.0 | mobile |
| @firebase/component | 0.7.4 | Apache-2.0 | mobile |
| @firebase/data-connect | 0.7.3 | Apache-2.0 | mobile |
| @firebase/database | 1.1.4 | Apache-2.0 | mobile |
| @firebase/database-compat | 2.1.6 | Apache-2.0 | mobile |
| @firebase/database-types | 1.0.21 | Apache-2.0 | mobile |
| @firebase/firestore | 4.17.0 | Apache-2.0 | mobile |
| @firebase/firestore-compat | 0.4.12 | Apache-2.0 | mobile |
| @firebase/firestore-types | 3.0.4 | Apache-2.0 | mobile |
| @firebase/functions | 0.13.6 | Apache-2.0 | mobile |
| @firebase/functions-compat | 0.4.6 | Apache-2.0 | mobile |
| @firebase/functions-types | 0.6.4 | Apache-2.0 | mobile |
| @firebase/installations | 0.6.23 | Apache-2.0 | mobile |
| @firebase/installations-compat | 0.2.23 | Apache-2.0 | mobile |
| @firebase/installations-types | 0.5.4 | Apache-2.0 | mobile |
| @firebase/logger | 0.5.1 | Apache-2.0 | mobile |
| @firebase/messaging | 0.13.1 | Apache-2.0 | mobile |
| @firebase/messaging-compat | 0.2.28 | Apache-2.0 | mobile |
| @firebase/messaging-interop-types | 0.2.5 | Apache-2.0 | mobile |
| @firebase/performance | 0.7.13 | Apache-2.0 | mobile |
| @firebase/performance-compat | 0.2.26 | Apache-2.0 | mobile |
| @firebase/performance-types | 0.2.4 | Apache-2.0 | mobile |
| @firebase/remote-config | 0.9.1 | Apache-2.0 | mobile |
| @firebase/remote-config-compat | 0.2.28 | Apache-2.0 | mobile |
| @firebase/remote-config-types | 0.5.1 | Apache-2.0 | mobile |
| @firebase/storage | 0.14.4 | Apache-2.0 | mobile |
| @firebase/storage-compat | 0.4.4 | Apache-2.0 | mobile |
| @firebase/storage-types | 0.8.4 | Apache-2.0 | mobile |
| @firebase/util | 1.15.2 | Apache-2.0 | mobile |
| @firebase/webchannel-wrapper | 1.0.6 | Apache-2.0 | mobile |
| @grpc/grpc-js | 1.9.16 | Apache-2.0 | mobile |
| @grpc/proto-loader | 0.7.15 | Apache-2.0 | mobile |
| @isaacs/ttlcache | 1.4.1 | ISC | mobile |
| @jest/schemas | 29.6.3 | MIT | mobile |
| @jest/types | 29.6.3 | MIT | mobile |
| @jridgewell/gen-mapping | 0.3.13 | MIT | mobile |
| @jridgewell/remapping | 2.3.5 | MIT | mobile |
| @jridgewell/resolve-uri | 3.1.2 | MIT | mobile |
| @jridgewell/source-map | 0.3.11 | MIT | mobile |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | mobile, server |
| @jridgewell/trace-mapping | 0.3.31 | MIT | mobile |
| @msgpackr-extract/msgpackr-extract-darwin-arm64 | 3.0.4 | MIT | mobile, server |
| @msgpackr-extract/msgpackr-extract-darwin-x64 | 3.0.4 | MIT | mobile, server |
| @msgpackr-extract/msgpackr-extract-linux-arm | 3.0.4 | MIT | mobile, server |
| @msgpackr-extract/msgpackr-extract-linux-arm64 | 3.0.4 | MIT | mobile, server |
| @msgpackr-extract/msgpackr-extract-linux-x64 | 3.0.4 | MIT | mobile, server |
| @msgpackr-extract/msgpackr-extract-win32-x64 | 3.0.4 | MIT | mobile, server |
| @opentelemetry/api | 1.9.1 | Apache-2.0 | server |
| @oxc-parser/binding-android-arm-eabi | 0.152.0 | MIT | server |
| @oxc-parser/binding-android-arm64 | 0.152.0 | MIT | server |
| @oxc-parser/binding-darwin-arm64 | 0.152.0 | MIT | server |
| @oxc-parser/binding-darwin-x64 | 0.152.0 | MIT | server |
| @oxc-parser/binding-freebsd-x64 | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-arm-gnueabihf | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-arm-musleabihf | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-arm64-gnu | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-arm64-musl | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-ppc64-gnu | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-riscv64-gnu | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-riscv64-musl | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-s390x-gnu | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-x64-gnu | 0.152.0 | MIT | server |
| @oxc-parser/binding-linux-x64-musl | 0.152.0 | MIT | server |
| @oxc-parser/binding-openharmony-arm64 | 0.152.0 | MIT | server |
| @oxc-parser/binding-win32-arm64-msvc | 0.152.0 | MIT | server |
| @oxc-parser/binding-win32-ia32-msvc | 0.152.0 | MIT | server |
| @oxc-parser/binding-win32-x64-msvc | 0.152.0 | MIT | server |
| @oxc-project/types | 0.152.0 | MIT | server |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | mobile |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | mobile |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | mobile |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | mobile |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | mobile |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | mobile |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | mobile |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | mobile |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | mobile |
| @radix-ui/primitive | 1.1.7 | MIT | mobile |
| @radix-ui/react-collection | 1.1.16 | MIT | mobile |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | mobile |
| @radix-ui/react-context | 1.2.2 | MIT | mobile |
| @radix-ui/react-dialog | 1.2.0 | MIT | mobile |
| @radix-ui/react-direction | 1.1.5 | MIT | mobile |
| @radix-ui/react-dismissable-layer | 1.1.20 | MIT | mobile |
| @radix-ui/react-focus-guards | 1.1.6 | MIT | mobile |
| @radix-ui/react-focus-scope | 1.2.0 | MIT | mobile |
| @radix-ui/react-id | 1.1.4 | MIT | mobile |
| @radix-ui/react-portal | 1.1.18 | MIT | mobile |
| @radix-ui/react-presence | 1.1.11 | MIT | mobile |
| @radix-ui/react-primitive | 2.1.11 | MIT | mobile |
| @radix-ui/react-roving-focus | 1.1.20 | MIT | mobile |
| @radix-ui/react-slot | 1.4.0 | MIT | mobile |
| @radix-ui/react-tabs | 1.1.22 | MIT | mobile |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | mobile |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | mobile |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | mobile |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | mobile |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | mobile |
| @react-native-firebase/analytics | 26.4.0 | Apache-2.0 | mobile |
| @react-native-firebase/app | 26.4.0 | Apache-2.0 | mobile |
| @react-native-firebase/auth | 26.4.0 | Apache-2.0 | mobile |
| @react-native-firebase/crashlytics | 26.4.0 | Apache-2.0 | mobile |
| @react-native-masked-view/masked-view | 0.3.2 | MIT | mobile |
| @react-native/assets-registry | 0.86.3 | MIT | mobile |
| @react-native/babel-plugin-codegen | 0.86.3 | MIT | mobile |
| @react-native/babel-preset | 0.86.3 | MIT | mobile |
| @react-native/codegen | 0.86.3 | MIT | mobile |
| @react-native/community-cli-plugin | 0.86.3 | MIT | mobile |
| @react-native/debugger-frontend | 0.86.3 | BSD-3-Clause | mobile |
| @react-native/debugger-shell | 0.86.3 | MIT | mobile |
| @react-native/dev-middleware | 0.86.3 | MIT | mobile |
| @react-native/gradle-plugin | 0.86.3 | MIT | mobile |
| @react-native/js-polyfills | 0.86.3 | MIT | mobile |
| @react-native/metro-babel-transformer | 0.86.3 | MIT | mobile |
| @react-native/metro-config | 0.86.3 | MIT | mobile |
| @react-native/normalize-colors | 0.86.3 | MIT | mobile |
| @react-native/virtualized-lists | 0.86.3 | MIT | mobile |
| @sentry/bundler-plugins | 11.6.0 | MIT | server |
| @sentry/conventions | 0.26.0 | MIT | server |
| @sentry/core | 11.6.0 | MIT | server |
| @sentry/node | 11.6.0 | MIT | server |
| @sentry/opentelemetry | 11.6.0 | MIT | server |
| @sentry/server-runtime-injection | 11.6.0 | MIT | server |
| @sentry/server-utils | 11.6.0 | MIT | server |
| @shopify/react-native-skia | 2.6.2 | MIT | mobile |
| @sinclair/typebox | 0.27.12 | MIT | mobile |
| @standard-schema/spec | 1.1.0 | MIT | mobile, server |
| @types/hammerjs | 2.0.46 | MIT | mobile |
| @types/istanbul-lib-coverage | 2.0.6 | MIT | mobile |
| @types/istanbul-lib-report | 3.0.3 | MIT | mobile |
| @types/istanbul-reports | 3.0.4 | MIT | mobile |
| @types/node | 24.19.1 | MIT | mobile, server |
| @types/react | 19.2.18 | MIT | mobile |
| @types/react-test-renderer | 19.3.0 | MIT | mobile |
| @types/ws | 8.18.2 | MIT | server |
| @types/yargs | 17.0.35 | MIT | mobile |
| @types/yargs-parser | 21.0.3 | MIT | mobile |
| @ungap/structured-clone | 1.4.0 | ISC | mobile |
| @webgpu/types | 0.1.21 | BSD-3-Clause | mobile |
| @xmldom/xmldom | 0.8.15 | MIT | mobile |
| @xmldom/xmldom | 0.9.12 | MIT | mobile |
| abort-controller | 3.0.0 | MIT | mobile |
| accepts | 1.3.8 | MIT | mobile |
| accepts | 2.0.0 | MIT | mobile, server |
| acorn | 8.19.0 | MIT | mobile |
| agent-base | 7.1.4 | MIT | mobile |
| agent-cli-detector | 0.1.7 | MIT | mobile |
| anser | 1.4.10 | MIT | mobile |
| ansi-escapes | 4.3.2 | MIT | mobile |
| ansi-regex | 4.1.1 | MIT | mobile |
| ansi-regex | 5.0.1 | MIT | mobile |
| ansi-styles | 3.2.1 | MIT | mobile |
| ansi-styles | 4.3.0 | MIT | mobile |
| ansi-styles | 5.2.0 | MIT | mobile |
| arg | 4.1.3 | MIT | mobile |
| arg | 5.0.2 | MIT | mobile |
| argparse | 2.0.1 | Python-2.0 | mobile |
| aria-hidden | 1.2.6 | MIT | mobile |
| asap | 2.0.6 | MIT | mobile |
| await-lock | 2.2.2 | MIT | mobile |
| babel-plugin-polyfill-corejs2 | 0.4.17 | MIT | mobile |
| babel-plugin-polyfill-corejs3 | 0.13.0 | MIT | mobile |
| babel-plugin-polyfill-regenerator | 0.6.8 | MIT | mobile |
| babel-plugin-react-compiler | 1.0.0 | MIT | mobile |
| babel-plugin-react-native-web | 0.21.4 | MIT | mobile |
| babel-plugin-syntax-hermes-parser | 0.36.0 | MIT | mobile |
| babel-plugin-transform-flow-enums | 0.0.2 | MIT | mobile |
| babel-preset-expo | 57.0.14 | MIT | mobile |
| balanced-match | 4.0.4 | MIT | mobile, server |
| base64-js | 1.5.1 | MIT | mobile |
| baseline-browser-mapping | 2.11.28 | Apache-2.0 | mobile |
| big-integer | 1.6.52 | Unlicense | mobile |
| body-parser | 2.3.0 | MIT | server |
| boolbase | 1.0.0 | ISC | mobile |
| bplist-creator | 0.1.0 | MIT | mobile |
| bplist-parser | 0.3.1 | MIT | mobile |
| brace-expansion | 5.0.12 | MIT | mobile, server |
| braces | 3.0.3 | MIT | mobile |
| browserslist | 4.29.3 | MIT | mobile |
| bser | 2.1.1 | Apache-2.0 | mobile |
| buffer-from | 1.1.2 | MIT | mobile |
| bytes | 3.1.2 | MIT | mobile, server |
| call-bind-apply-helpers | 1.0.2 | MIT | server |
| call-bound | 1.0.4 | MIT | server |
| camelcase | 6.3.0 | MIT | mobile |
| caniuse-lite | 1.0.30001815 | CC-BY-4.0 | mobile |
| canvaskit-wasm | 0.41.0 | BSD-3-Clause | mobile |
| chalk | 2.4.2 | MIT | mobile |
| chalk | 4.1.2 | MIT | mobile |
| chrome-launcher | 0.15.2 | Apache-2.0 | mobile |
| chromium-edge-launcher | 0.3.0 | Apache-2.0 | mobile |
| ci-info | 2.0.0 | MIT | mobile |
| ci-info | 3.9.0 | MIT | mobile |
| cli-cursor | 2.1.0 | MIT | mobile |
| cli-spinners | 2.9.2 | MIT | mobile |
| client-only | 0.0.1 | MIT | mobile |
| cliui | 8.0.1 | ISC | mobile |
| clone | 1.0.4 | MIT | mobile |
| color | 4.2.3 | MIT | mobile |
| color-convert | 1.9.3 | MIT | mobile |
| color-convert | 2.0.1 | MIT | mobile |
| color-name | 1.1.3 | MIT | mobile |
| color-name | 1.1.4 | MIT | mobile |
| color-string | 1.9.1 | MIT | mobile |
| commander | 12.1.0 | MIT | mobile |
| commander | 2.20.3 | MIT | mobile |
| commander | 7.2.0 | MIT | mobile |
| compressible | 2.0.18 | MIT | mobile |
| compression | 1.8.2 | MIT | mobile |
| connect | 3.7.0 | MIT | mobile |
| content-disposition | 1.1.0 | MIT | server |
| content-type | 1.0.5 | MIT | server |
| content-type | 2.1.0 | MIT | mobile, server |
| convert-source-map | 2.0.0 | MIT | mobile |
| cookie | 0.7.2 | MIT | server |
| cookie-signature | 1.2.2 | MIT | server |
| core-js-compat | 3.50.0 | MIT | mobile |
| cross-spawn | 7.0.6 | MIT | mobile |
| css-select | 5.2.2 | BSD-2-Clause | mobile |
| css-tree | 1.1.3 | MIT | mobile |
| css-what | 6.2.2 | BSD-2-Clause | mobile |
| csstype | 3.2.3 | MIT | mobile |
| debug | 2.6.9 | MIT | mobile |
| debug | 3.2.7 | MIT | mobile |
| debug | 4.4.3 | MIT | mobile, server |
| decode-uri-component | 0.2.2 | MIT | mobile |
| deepmerge | 4.3.1 | MIT | mobile |
| defaults | 1.0.4 | MIT | mobile |
| depd | 2.0.0 | MIT | mobile, server |
| destroy | 1.2.0 | MIT | mobile |
| detect-libc | 2.1.2 | Apache-2.0 | mobile, server |
| detect-node-es | 1.1.0 | MIT | mobile |
| dnssd-advertise | 1.1.6 | MIT | mobile |
| dom-serializer | 2.0.0 | MIT | mobile |
| domelementtype | 2.3.0 | BSD-2-Clause | mobile |
| domhandler | 5.0.3 | BSD-2-Clause | mobile |
| domutils | 3.2.2 | BSD-2-Clause | mobile |
| dotenv | 17.4.2 | BSD-2-Clause | server |
| drizzle-orm | 0.45.4 | Apache-2.0 | server |
| dunder-proto | 1.0.1 | MIT | server |
| ee-first | 1.1.1 | MIT | mobile, server |
| electron-to-chromium | 1.5.451 | ISC | mobile |
| emoji-regex | 8.0.0 | MIT | mobile |
| encodeurl | 1.0.2 | MIT | mobile |
| encodeurl | 2.0.0 | MIT | mobile, server |
| entities | 4.5.0 | BSD-2-Clause | mobile |
| error-stack-parser | 2.1.4 | MIT | mobile |
| es-define-property | 1.0.1 | MIT | server |
| es-errors | 1.3.0 | MIT | mobile, server |
| es-object-atoms | 1.1.2 | MIT | server |
| escalade | 3.2.0 | MIT | mobile |
| escape-html | 1.0.3 | MIT | mobile, server |
| escape-string-regexp | 1.0.5 | MIT | mobile |
| escape-string-regexp | 4.0.0 | MIT | mobile |
| etag | 1.8.1 | MIT | mobile, server |
| event-target-shim | 5.0.1 | MIT | mobile |
| expo | 57.0.27 | MIT | mobile |
| expo-asset | 57.0.19 | MIT | mobile |
| expo-audio | 57.0.5 | MIT | mobile |
| expo-build-properties | 57.0.22 | MIT | mobile |
| expo-constants | 57.0.21 | MIT | mobile |
| expo-dev-client | 57.0.19 | MIT | mobile |
| expo-dev-launcher | 57.0.20 | MIT | mobile |
| expo-dev-menu | 57.0.19 | MIT | mobile |
| expo-dev-menu-interface | 57.0.0 | MIT | mobile |
| expo-eas-client | 57.0.5 | MIT | mobile |
| expo-file-system | 57.0.7 | MIT | mobile |
| expo-font | 57.0.4 | MIT | mobile |
| expo-glass-effect | 57.0.4 | MIT | mobile |
| expo-haptics | 57.0.3 | MIT | mobile |
| expo-image | 57.0.5 | MIT | mobile |
| expo-json-utils | 57.0.2 | MIT | mobile |
| expo-keep-awake | 57.0.2 | MIT | mobile |
| expo-linking | 57.0.12 | MIT | mobile |
| expo-localization | 57.0.2 | MIT | mobile |
| expo-manifests | 57.0.2 | MIT | mobile |
| expo-modules-autolinking | 57.0.14 | MIT | mobile |
| expo-modules-core | 57.0.21 | MIT | mobile |
| expo-modules-jsi | 57.1.1 | MIT | mobile |
| expo-router | 57.0.25 | MIT | mobile |
| expo-server | 57.0.3 | MIT | mobile |
| expo-splash-screen | 57.0.9 | MIT | mobile |
| expo-sqlite | 57.0.4 | MIT | mobile |
| expo-status-bar | 57.0.1 | MIT | mobile |
| expo-structured-headers | 57.0.1 | MIT | mobile |
| expo-symbols | 57.0.3 | MIT | mobile |
| expo-system-ui | 57.0.4 | MIT | mobile |
| expo-updates | 57.0.25 | MIT | mobile |
| expo-updates-interface | 57.0.2 | MIT | mobile |
| exponential-backoff | 3.1.3 | Apache-2.0 | mobile |
| express | 5.2.1 | MIT | server |
| fast-deep-equal | 3.1.3 | MIT | mobile |
| faye-websocket | 0.11.4 | Apache-2.0 | mobile |
| fb-dotslash | 0.5.8 | (MIT OR Apache-2.0) | mobile |
| fb-watchman | 2.0.2 | Apache-2.0 | mobile |
| fdir | 6.5.0 | MIT | mobile |
| fetch-nodeshim | 0.4.10 | MIT | mobile |
| fill-range | 7.1.1 | MIT | mobile |
| filter-obj | 1.1.0 | MIT | mobile |
| finalhandler | 1.1.2 | MIT | mobile |
| finalhandler | 2.1.1 | MIT | server |
| firebase | 12.17.1 | Apache-2.0 | mobile |
| flow-enums-runtime | 0.0.6 | MIT | mobile |
| fontfaceobserver | 2.3.0 | BSD-2-Clause | mobile |
| forwarded | 0.2.0 | MIT | server |
| fresh | 0.5.2 | MIT | mobile |
| fresh | 2.0.0 | MIT | server |
| function-bind | 1.1.2 | MIT | mobile, server |
| gensync | 1.0.0-beta.2 | MIT | mobile |
| get-caller-file | 2.0.5 | ISC | mobile |
| get-intrinsic | 1.3.0 | MIT | server |
| get-nonce | 1.0.1 | MIT | mobile |
| get-proto | 1.0.1 | MIT | server |
| getenv | 2.0.0 | MIT | mobile |
| glob | 13.0.6 | BlueOak-1.0.0 | mobile, server |
| gopd | 1.2.0 | MIT | server |
| graceful-fs | 4.2.11 | ISC | mobile |
| has-flag | 3.0.0 | MIT | mobile |
| has-flag | 4.0.0 | MIT | mobile, server |
| has-symbols | 1.1.0 | MIT | server |
| hasown | 2.0.4 | MIT | mobile, server |
| hermes-compiler | 250829098.0.17 | MIT | mobile |
| hermes-estree | 0.35.0 | MIT | mobile |
| hermes-estree | 0.36.0 | MIT | mobile |
| hermes-parser | 0.35.0 | MIT | mobile |
| hermes-parser | 0.36.0 | MIT | mobile |
| hoist-non-react-statics | 3.3.2 | BSD-3-Clause | mobile |
| hosted-git-info | 7.0.2 | ISC | mobile |
| html-parse-stringify | 4.0.1 | MIT | mobile |
| http-errors | 2.0.1 | MIT | mobile, server |
| http-parser-js | 0.5.10 | MIT | mobile |
| https-proxy-agent | 7.0.6 | MIT | mobile |
| i18next | 26.4.2 | MIT | mobile |
| iconv-lite | 0.7.3 | MIT | server |
| idb | 7.1.1 | ISC | mobile |
| ignore | 5.3.2 | MIT | mobile |
| inherits | 2.0.4 | ISC | mobile, server |
| invariant | 2.2.4 | MIT | mobile |
| ipaddr.js | 1.9.1 | MIT | server |
| is-arrayish | 0.3.4 | MIT | mobile |
| is-core-module | 2.17.0 | MIT | mobile |
| is-docker | 2.2.1 | MIT | mobile |
| is-fullwidth-code-point | 3.0.0 | MIT | mobile |
| is-number | 7.0.0 | MIT | mobile |
| is-promise | 4.0.0 | MIT | server |
| is-wsl | 2.2.0 | MIT | mobile |
| isexe | 2.0.0 | ISC | mobile |
| jest-get-type | 29.6.3 | MIT | mobile |
| jest-util | 29.7.0 | MIT | mobile |
| jest-validate | 29.7.0 | MIT | mobile |
| jest-worker | 29.7.0 | MIT | mobile |
| jimp-compact | 0.16.1 | MIT | mobile |
| jose | 6.2.12 | MIT | server |
| js-tokens | 4.0.0 | MIT | mobile |
| js-yaml | 4.3.2 | MIT | mobile |
| jsc-safe-url | 0.2.4 | 0BSD | mobile |
| jsesc | 3.1.0 | MIT | mobile |
| json5 | 2.2.3 | MIT | mobile |
| kleur | 3.0.3 | MIT | mobile |
| lan-network | 0.2.1 | MIT | mobile |
| leven | 3.1.0 | MIT | mobile |
| lighthouse-logger | 1.4.2 | Apache-2.0 | mobile |
| lightningcss | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | mobile |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | mobile |
| lodash.camelcase | 4.3.0 | MIT | mobile |
| lodash.debounce | 4.0.8 | MIT | mobile |
| lodash.throttle | 4.1.1 | MIT | mobile |
| log-symbols | 2.2.0 | MIT | mobile |
| long | 5.3.2 | Apache-2.0 | mobile |
| loose-envify | 1.4.0 | MIT | mobile |
| lru-cache | 10.4.3 | ISC | mobile |
| lru-cache | 11.5.3 | BlueOak-1.0.0 | mobile, server |
| lru-cache | 5.1.1 | ISC | mobile |
| magic-string | 1.4.3 | MIT | server |
| makeerror | 1.0.12 | BSD-3-Clause | mobile |
| marky | 1.3.0 | Apache-2.0 | mobile |
| math-intrinsics | 1.1.0 | MIT | server |
| mdn-data | 2.0.14 | CC0-1.0 | mobile |
| media-typer | 1.1.1 | MIT | server |
| memoize-one | 5.2.1 | MIT | mobile |
| merge-descriptors | 2.0.0 | MIT | server |
| merge-stream | 2.0.0 | MIT | mobile |
| metro | 0.84.5 | MIT | mobile |
| metro-babel-transformer | 0.84.5 | MIT | mobile |
| metro-cache | 0.84.5 | MIT | mobile |
| metro-cache-key | 0.84.5 | MIT | mobile |
| metro-config | 0.84.5 | MIT | mobile |
| metro-core | 0.84.5 | MIT | mobile |
| metro-file-map | 0.84.5 | MIT | mobile |
| metro-minify-terser | 0.84.5 | MIT | mobile |
| metro-resolver | 0.84.5 | MIT | mobile |
| metro-runtime | 0.84.5 | MIT | mobile |
| metro-source-map | 0.84.5 | MIT | mobile |
| metro-symbolicate | 0.84.5 | MIT | mobile |
| metro-transform-plugins | 0.84.5 | MIT | mobile |
| metro-transform-worker | 0.84.5 | MIT | mobile |
| micromatch | 4.0.8 | MIT | mobile |
| mime | 1.6.0 | MIT | mobile |
| mime-db | 1.52.0 | MIT | mobile |
| mime-db | 1.54.0 | MIT | mobile, server |
| mime-types | 2.1.35 | MIT | mobile |
| mime-types | 3.0.2 | MIT | mobile, server |
| mimic-fn | 1.2.0 | MIT | mobile |
| minimatch | 10.2.6 | BlueOak-1.0.0 | mobile, server |
| minipass | 7.1.3 | BlueOak-1.0.0 | mobile, server |
| mkdirp | 1.0.4 | MIT | mobile |
| ms | 2.0.0 | MIT | mobile |
| ms | 2.1.3 | MIT | mobile, server |
| msgpackr | 2.1.0 | MIT | mobile, server |
| msgpackr-extract | 3.0.4 | MIT | mobile, server |
| multitars | 1.0.2 | MIT | mobile |
| nanoid | 3.3.20 | MIT | mobile, server |
| negotiator | 0.6.3 | MIT | mobile |
| negotiator | 0.6.4 | MIT | mobile |
| negotiator | 1.1.0 | MIT | mobile, server |
| node-forge | 1.4.0 | (BSD-3-Clause OR GPL-2.0) | mobile |
| node-gyp-build-optional-packages | 5.2.2 | MIT | mobile, server |
| node-int64 | 0.4.0 | MIT | mobile |
| node-releases | 2.0.58 | MIT | mobile |
| npm-package-arg | 11.0.3 | ISC | mobile |
| nth-check | 2.1.1 | BSD-2-Clause | mobile |
| nullthrows | 1.1.1 | MIT | mobile |
| ob1 | 0.84.5 | MIT | mobile |
| object-inspect | 1.13.4 | MIT | server |
| on-finished | 2.3.0 | MIT | mobile |
| on-finished | 2.4.1 | MIT | mobile, server |
| on-headers | 1.1.0 | MIT | mobile |
| once | 1.4.0 | ISC | server |
| onetime | 2.0.1 | MIT | mobile |
| open | 7.4.2 | MIT | mobile |
| ora | 3.4.0 | MIT | mobile |
| oxc-parser | 0.152.0 | MIT | server |
| parse-png | 2.1.0 | MIT | mobile |
| parseurl | 1.3.3 | MIT | mobile, server |
| path-key | 3.1.1 | MIT | mobile |
| path-parse | 1.0.7 | MIT | mobile |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | mobile, server |
| path-to-regexp | 8.4.2 | MIT | server |
| picocolors | 1.1.1 | ISC | mobile |
| picomatch | 2.3.2 | MIT | mobile |
| picomatch | 4.0.7 | MIT | mobile |
| plist | 3.1.1 | MIT | mobile |
| pngjs | 3.4.0 | MIT | mobile |
| postcss | 8.5.29 | MIT | mobile |
| postgres | 3.4.9 | Unlicense | server |
| pretty-format | 29.7.0 | MIT | mobile |
| proc-log | 4.2.0 | ISC | mobile |
| progress | 2.0.3 | MIT | mobile |
| promise | 8.3.0 | MIT | mobile |
| prompts | 2.4.2 | MIT | mobile |
| protobufjs | 7.6.6 | BSD-3-Clause | mobile |
| proxy-addr | 2.0.8 | MIT | server |
| qs | 6.16.0 | BSD-3-Clause | server |
| query-string | 7.1.3 | MIT | mobile |
| range-parser | 1.2.1 | MIT | mobile, server |
| raw-body | 3.0.2 | MIT | server |
| re2js | 2.8.6 | MIT | mobile |
| react | 19.2.3 | MIT | mobile |
| react-devtools-core | 6.1.5 | MIT | mobile |
| react-dom | 19.2.3 | MIT | mobile |
| react-fast-compare | 3.2.2 | MIT | mobile |
| react-freeze | 1.0.4 | MIT | mobile |
| react-i18next | 17.0.16 | MIT | mobile |
| react-is | 16.13.1 | MIT | mobile |
| react-is | 18.3.1 | MIT | mobile |
| react-is | 19.3.0 | MIT | mobile |
| react-native | 0.86.3 | MIT | mobile |
| react-native-drawer-layout | 4.2.11 | MIT | mobile |
| react-native-gesture-handler | 2.32.0 | MIT | mobile |
| react-native-is-edge-to-edge | 1.3.1 | MIT | mobile |
| react-native-reanimated | 4.5.1 | MIT | mobile |
| react-native-safe-area-context | 5.7.0 | MIT | mobile |
| react-native-screens | 4.26.2 | MIT | mobile |
| react-native-skia-android | 147.1.0 | MIT | mobile |
| react-native-skia-apple-ios | 147.1.0 | MIT | mobile |
| react-native-skia-apple-macos | 147.1.0 | MIT | mobile |
| react-native-skia-apple-tvos | 147.1.0 | MIT | mobile |
| react-native-svg | 15.15.4 | MIT | mobile |
| react-native-worklets | 0.10.1 | MIT | mobile |
| react-reconciler | 0.31.0 | MIT | mobile |
| react-refresh | 0.14.2 | MIT | mobile |
| react-remove-scroll | 2.7.2 | MIT | mobile |
| react-remove-scroll-bar | 2.3.8 | MIT | mobile |
| react-style-singleton | 2.2.3 | MIT | mobile |
| regenerate | 1.5.0 | MIT | mobile |
| regenerate-unicode-properties | 10.3.0 | MIT | mobile |
| regenerator-runtime | 0.13.11 | MIT | mobile |
| regexpu-core | 6.5.3 | MIT | mobile |
| regjsgen | 0.8.0 | MIT | mobile |
| regjsparser | 0.13.4 | BSD-2-Clause | mobile |
| require-directory | 2.1.1 | MIT | mobile |
| resolve | 1.22.13 | MIT | mobile |
| resolve-from | 5.0.0 | MIT | mobile |
| resolve-workspace-root | 2.0.1 | MIT | mobile |
| restore-cursor | 2.0.0 | MIT | mobile |
| rou3 | 0.7.12 | MIT | mobile, server |
| router | 2.2.0 | MIT | server |
| rtl-detect | 1.1.2 | BSD-3-Clause | mobile |
| safe-buffer | 5.2.1 | MIT | mobile |
| safer-buffer | 2.1.2 | MIT | server |
| sandbox-cli-detector | 0.2.0 | MIT | mobile |
| sax | 1.6.1 | BlueOak-1.0.0 | mobile |
| scheduler | 0.25.0 | MIT | mobile |
| scheduler | 0.27.0 | MIT | mobile |
| semver | 6.3.1 | ISC | mobile |
| semver | 7.8.5 | ISC | mobile |
| send | 0.19.2 | MIT | mobile |
| send | 1.2.1 | MIT | server |
| sentry | 0.45.0 | FSL-1.1-Apache-2.0 | server |
| serialize-error | 2.1.0 | MIT | mobile |
| serve-static | 1.16.3 | MIT | mobile |
| serve-static | 2.2.1 | MIT | server |
| server-only | 0.0.1 | MIT | mobile |
| set-cookie-parser | 3.1.3 | MIT | mobile, server |
| setprototypeof | 1.2.0 | ISC | mobile, server |
| sf-symbols-typescript | 2.2.0 | MIT | mobile |
| shallowequal | 1.1.0 | MIT | mobile |
| shebang-command | 2.0.0 | MIT | mobile |
| shebang-regex | 3.0.0 | MIT | mobile |
| shell-quote | 1.12.0 | MIT | mobile |
| side-channel | 1.1.1 | MIT | server |
| side-channel-list | 1.0.1 | MIT | server |
| side-channel-map | 1.0.1 | MIT | server |
| side-channel-weakmap | 1.0.2 | MIT | server |
| signal-exit | 3.0.7 | ISC | mobile |
| simple-plist | 1.3.1 | MIT | mobile |
| simple-swizzle | 0.2.4 | MIT | mobile |
| sisteransi | 1.0.5 | MIT | mobile |
| slugify | 1.6.9 | MIT | mobile |
| source-map | 0.5.6 | BSD-3-Clause | mobile |
| source-map | 0.5.7 | BSD-3-Clause | mobile |
| source-map | 0.6.1 | BSD-3-Clause | mobile |
| source-map-js | 1.2.2 | BSD-3-Clause | mobile |
| source-map-support | 0.5.21 | MIT | mobile |
| split-on-first | 1.1.0 | MIT | mobile |
| stack-generator | 2.0.10 | MIT | mobile |
| stackframe | 1.3.4 | MIT | mobile |
| stacktrace-gps | 3.1.2 | MIT | mobile |
| stacktrace-js | 2.0.2 | MIT | mobile |
| stacktrace-parser | 0.1.11 | MIT | mobile |
| standard-navigation | 0.0.5 | MIT | mobile |
| statuses | 1.5.0 | MIT | mobile |
| statuses | 2.0.2 | MIT | mobile, server |
| stream-buffers | 2.2.0 | Unlicense | mobile |
| strict-uri-encode | 2.0.0 | MIT | mobile |
| string-width | 4.2.3 | MIT | mobile |
| strip-ansi | 5.2.0 | MIT | mobile |
| strip-ansi | 6.0.1 | MIT | mobile |
| structured-headers | 0.4.1 | MIT | mobile |
| superstruct | 2.0.2 | MIT | mobile |
| supports-color | 5.5.0 | MIT | mobile |
| supports-color | 7.2.0 | MIT | mobile |
| supports-color | 8.1.1 | MIT | mobile, server |
| supports-hyperlinks | 2.3.0 | MIT | mobile |
| supports-preserve-symlinks-flag | 1.0.0 | MIT | mobile |
| terminal-link | 2.1.1 | MIT | mobile |
| terser | 5.51.2 | BSD-2-Clause | mobile |
| throat | 5.0.0 | MIT | mobile |
| tinyglobby | 0.2.17 | MIT | mobile |
| tmpl | 1.0.5 | BSD-3-Clause | mobile |
| to-regex-range | 5.0.1 | MIT | mobile |
| toidentifier | 1.0.1 | MIT | mobile, server |
| toqr | 0.1.1 | MIT | mobile |
| tslib | 2.8.1 | 0BSD | mobile |
| type-fest | 0.21.3 | (MIT OR CC0-1.0) | mobile |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) | mobile |
| type-is | 2.1.0 | MIT | server |
| undici-types | 7.24.6 | MIT | mobile, server |
| unicode-canonical-property-names-ecmascript | 2.0.1 | MIT | mobile |
| unicode-match-property-ecmascript | 2.0.0 | MIT | mobile |
| unicode-match-property-value-ecmascript | 2.2.1 | MIT | mobile |
| unicode-property-aliases-ecmascript | 2.2.0 | MIT | mobile |
| unpipe | 1.0.0 | MIT | mobile, server |
| update-browserslist-db | 1.3.4 | MIT | mobile |
| use-callback-ref | 1.3.3 | MIT | mobile |
| use-latest-callback | 0.2.6 | MIT | mobile |
| use-sidecar | 1.1.3 | MIT | mobile |
| use-sync-external-store | 1.7.0 | MIT | mobile |
| utils-merge | 1.0.1 | MIT | mobile |
| uuid | 7.0.3 | MIT | mobile |
| validate-npm-package-name | 5.0.1 | ISC | mobile |
| vary | 1.1.2 | MIT | mobile, server |
| vaul | 1.1.2 | MIT | mobile |
| vlq | 1.0.1 | MIT | mobile |
| walker | 1.0.8 | Apache-2.0 | mobile |
| warn-once | 0.1.1 | MIT | mobile |
| wcwidth | 1.0.1 | MIT | mobile |
| web-vitals | 4.2.4 | Apache-2.0 | mobile |
| websocket-driver | 0.7.5 | Apache-2.0 | mobile |
| websocket-extensions | 0.1.4 | Apache-2.0 | mobile |
| whatwg-fetch | 3.6.20 | MIT | mobile |
| whatwg-url-minimum | 0.1.2 | MIT | mobile |
| which | 2.0.2 | ISC | mobile |
| wrap-ansi | 7.0.0 | MIT | mobile |
| wrappy | 1.0.2 | ISC | server |
| ws | 7.5.13 | MIT | mobile |
| ws | 8.22.0 | MIT | mobile, server |
| xcode | 3.0.1 | Apache-2.0 | mobile |
| xml2js | 0.6.0 | MIT | mobile |
| xmlbuilder | 11.0.1 | MIT | mobile |
| xmlbuilder | 15.1.1 | MIT | mobile |
| y18n | 5.0.8 | ISC | mobile |
| yallist | 3.1.1 | ISC | mobile |
| yaml | 2.9.1 | ISC | mobile |
| yargs | 17.7.3 | MIT | mobile |
| yargs-parser | 21.1.1 | ISC | mobile |
| zod | 3.25.76 | MIT | mobile |
| zod | 4.6.5 | MIT | server |
| zustand | 5.0.15 | MIT | mobile |

</div>
