# 🔔 سيرفر إشعارات الكابتن — مجاني (بدون خطة Blaze)

يرن تلفون الكابتن بطلب الدلفري **حتى والتطبيق مسكّر أو الشاشة مطفية**.
الكاشير يبلّغ هذا السيرفر بكل طلب دلفري، والسيرفر يدز إشعار للكابتن عن طريق خدمة إشعارات Google (مجانية).

- **مجاني:** Cloudflare Workers يعطي 100,000 طلب **باليوم** مجاناً، بدون رصيد يخلص.
- **آمن:** يقبل بس من حساب مسجّل دخول، ولطلبات مطعمه فقط، ويرسل مرة وحدة لكل كابتن.
- إذا توقف السيرفر، كلشي يبقى يشتغل عادي، بس ينقص الإشعار والتطبيق مسكّر.

## خطوات التفعيل (مرة وحدة، تقريباً 10 دقائق، من المتصفح)

### 1) انشر قواعد الحماية الجديدة
Firebase ← Firestore Database ← Rules ← الصق محتوى `firebase/firestore.rules` ← **Publish**.

### 2) نزّل مفتاح حساب الخدمة من فايربيس
https://console.firebase.google.com/project/sora3a-system/settings/serviceaccounts/adminsdk
← **Generate new private key** ← **Generate key** ← ينزل ملف ‎`.json`. (سري: لا تبعثه لأحد)

### 3) سوّي حساب Cloudflare وانشر الـ Worker
1. https://dash.cloudflare.com/sign-up ← سجّل بإيميلك وفعّله من رسالة التأكيد.
2. من القائمة: **Workers & Pages** (أو **Compute ← Workers**) ← **Create** ← **Create Worker** (أو **Start with Hello World**).
3. الاسم: `sora3a-push` ← **Deploy**.
4. اضغط **Edit code** ← امسح كل الكود الموجود ← افتح الرابط هذا وانسخ كل محتواه والصقه:
   https://raw.githubusercontent.com/qaesartools-web/sora3a-admin/main/push/cloudflare-worker.js
5. اضغط **Deploy**.
6. ارجع لصفحة الـ Worker ← **Settings** ← **Variables and Secrets** ← **Add**:
   - **Type:** Secret
   - **Variable name:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** افتح ملف الـ json، وانسخ **كل** محتواه والصقه ← **Deploy / Save**.
7. انسخ رابط الـ Worker، مثل `https://sora3a-push.xxxx.workers.dev`.

### 4) الصق الرابط بلوحة الإدارة
لوحة الإدارة (المدير الأعلى) ← 🛡️ **الأمان** ← **🔔 سيرفر إشعارات الكابتن** ← الصق الرابط ← **💾 حفظ** ← **🧪 فحص السيرفر**.
لازم يطلع: **✅ السيرفر شغّال ومضبوط**.

### 5) الكابتن
يفتح التطبيق ← **تفعيل الإشعارات** ← **سماح**. (آيفون: لازم يضيف التطبيق للشاشة الرئيسية أولاً.)

**جرّب:** سكّر تطبيق الكابتن، وأرسل طلب دلفري من الكاشير ← لازم يرن خلال ثواني.

## للمطورين
- `cloudflare-worker.js`: ملف واحد بدون مكتبات. يتحقق من توكن فايربيس (توقيع Google)، ويقرا ويكتب Firestore عبر REST، ويرسل عبر FCM HTTP v1.
- `netlify/functions/notify.mts`: نفس المنطق لـ Netlify (بديل).
