# 🔔 سيرفر إشعارات الكابتن — مجاني (بدون خطة Blaze)

يرن تلفون الكابتن بطلب الدلفري **حتى والتطبيق مسكّر أو الشاشة مطفية**.
الكاشير يبلّغ هذا السيرفر بكل طلب دلفري، والسيرفر يدز إشعار للكابتن عن طريق خدمة إشعارات Google (مجانية).

- مجاني: Netlify يعطي 125,000 تشغيل بالشهر، وكل طلب = تشغيل واحد.
- آمن: يقبل بس من حساب مسجّل دخول، ولطلبات مطعمه فقط، ويرسل مرة وحدة لكل كابتن.
- إذا توقف السيرفر، كلشي يبقى يشتغل عادي، بس ينقص الإشعار والتطبيق مسكّر.

## خطوات التفعيل (مرة وحدة، تقريباً 10 دقائق)

### 1) انشر قواعد الحماية الجديدة
Firebase ← Firestore Database ← Rules ← الصق محتوى `firebase/firestore.rules` ← **Publish**.

### 2) نزّل مفتاح حساب الخدمة من فايربيس
1. https://console.firebase.google.com/project/sora3a-system/settings/serviceaccounts/adminsdk
2. اضغط **Generate new private key** ← **Generate key** ← ينزل ملف ‎`.json`.
3. ⚠️ هذا الملف سري: لا تبعثه لأحد ولا ترفعه على GitHub.

### 3) انشر السيرفر على Netlify
1. https://app.netlify.com ← **Add new project** ← **Import an existing project** ← **GitHub**.
2. اختر المستودع **sora3a-admin**.
3. بالإعدادات:
   - **Branch:** `main`
   - **Base directory:** `push`
   - **Build command:** اتركه فارغ
   - **Publish directory:** `public`
4. اضغط **Add environment variables** ← **Add a variable**:
   - **Key:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** افتح ملف الـ json اللي نزّلته، وانسخ **كل** محتواه والصقه هنا.
   - فعّل **Contains secret values**.
5. اضغط **Deploy**، وانتظر لحد ما يصير **Published**.
6. انسخ رابط الموقع، مثلاً `https://xxxx.netlify.app`

### 4) الصق الرابط بلوحة الإدارة
لوحة الإدارة (المدير الأعلى) ← 🛡️ **الأمان** ← **🔔 سيرفر إشعارات الكابتن**:
- الصق: `https://xxxx.netlify.app/api/notify`
- اضغط **💾 حفظ** ثم **🧪 فحص السيرفر** ← لازم يطلع **✅ السيرفر شغّال ومضبوط**.

### 5) الكابتن
يفتح التطبيق ← يضغط **تفعيل الإشعارات** ← **سماح**. (آيفون: لازم يضيف التطبيق للشاشة الرئيسية أولاً.)

**جرّب:** سكّر تطبيق الكابتن، وأرسل طلب دلفري من الكاشير. لازم يوصل إشعار ويرن خلال ثواني.

## للمطورين
- الكود: `netlify/functions/notify.mts` (المسار `/api/notify`).
- يقرأ الطلب ويتأكد من الصلاحية بـ firebase-admin، ويرسل بـ FCM لتوكنات `pushTokens` للكابتن.
- يعلّم الطلب بـ `pushedFor` حتى ما يكرر الإرسال.
