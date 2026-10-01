# اختبارات المتصفح (E2E)

تشغّل التطبيقات الثلاثة الحقيقية في Chromium ضد محاكي Firebase مع قواعد `firestore.rules`.

```bash
# المستودعات الثلاثة بجانب بعض: ./sora3a-admin ./sora3a-rest2 ./sora3a-captain
cd sora3a-admin/firebase/test/e2e
npm i firebase@10.7.1 esbuild playwright-core @firebase/rules-unit-testing
npx playwright install chromium   # أو حدّد CHROME_PATH
# نسخة SDK محلية موصولة بالمحاكي (تُبنى مرة واحدة)
for m in app auth firestore messaging; do npx esbuild sdk-src/$m.js --bundle --format=esm --outfile=sdk/firebase-$m.js $([ $m != app ] && echo --external:@firebase/app); done
sed -i 's#from "@firebase/app"#from "./firebase-app.js"#g; s#import "@firebase/app";#import "./firebase-app.js";#' sdk/firebase-auth.js sdk/firebase-firestore.js
npx firebase emulators:start --only auth,firestore --project sora3a-system &   # من مجلد firebase
for t in captain admin rest pos; do node --test --test-concurrency=1 $t.e2e.mjs; done
```
