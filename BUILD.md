# مصاري — دليل التحميل والتحديث

النسخة: **1.0.0**

---

# الجزء الأول: تحميل التطبيق على التليفون

ده بتعمله **مرة واحدة** بس (أو لما نغيّر حاجة في شكل التطبيق نفسه زي اللوجو).

## خطوة 1 — جهّز الفولدر

فك الملف المضغوط فوق `D:\Masari` (سيبه يستبدل الملفات القديمة).

بعدين افتح **Command Prompt** جوه الفولدر:
- افتح الفولدر في File Explorer
- اكتب `cmd` في شريط العنوان فوق واضغط Enter

## خطوة 2 — نزّل المكتبات

```bash
npm install
```

ياخد دقيقتين تلاتة. طبيعي يطلع تحذيرات صفرا — متقلقش منها.

## خطوة 3 — اتأكد إن كل حاجة سليمة

```bash
npm test
```

المفروض يقول **632 passed**. لو قال أي رقم تاني أو fail، قوللي قبل ما تكمل.

## خطوة 4 — سجّل دخول (لو مش مسجل)

```bash
npx eas-cli login
```

لو قالك إنك مسجل خلاص، عدّي الخطوة دي.

## خطوة 5 — ابني الـ APK

```bash
npx eas-cli build --platform android --profile preview
```

**اللي هيحصل:**
1. هيسألك أسئلة أول مرة بس — وافق على الافتراضي
2. هيرفع الكود على سيرفرات Expo
3. هيقف في الطابور شوية
4. هيبني (من 10 لـ 25 دقيقة عادة)
5. في الآخر هيديك **لينك** و **QR كود**

سيب الشاشة مفتوحة لحد ما يخلص.

## خطوة 6 — نزّل وركّب

**من التليفون مباشرة:**
- صوّر الـ QR كود بالكاميرا
- هيفتح صفحة فيها زرار Download
- نزّل الملف واضغط عليه

**لو أندرويد منعك:**
- هيقولك «التثبيت من مصادر غير معروفة»
- اضغط **Settings** → فعّل السماح للمتصفح
- ارجع واضغط Install تاني

## خطوة 7 — البداية من الصفر

انت طلبت التطبيق يبدأ فاضي. فيه طريقتين:

**الطريقة المضمونة (الأنضف):**
احذف مصاري القديم من التليفون **قبل** ما تركّب الجديد. كده مفيش أي بيانات قديمة تفضل.

**لو ركّبته فوق القديم:**
افتح التطبيق → **المزيد** → انزل تحت → **حذف كل البيانات** → أكّد.

ده بيمسح:
- كل الحركات والالتزامات والأهداف
- الإشعارات المجدولة (عشان ميفضلش يبعتلك أرقام قديمة)
- تسجيل الدخول للسحابة (عشان أي مزامنة مترجّعش البيانات تاني)

وبعدها هيوديك لشاشة البداية على طول.

---

# الجزء التاني: أي تعديل بعد كده

هنا الجزء المهم. **مش محتاج تبني APK تاني.**

## أمر واحد

```bash
npm run send-update "وصف التعديل"
```

خلاص. ياخد دقيقة أو اتنين.

## بعدين على التليفون

1. اقفل مصاري **قفل كامل** — اسحبه من قايمة التطبيقات المفتوحة، مش بس تضغط Home
2. افتحه (بينزّل التحديث في الخلفية، مش هتشوف حاجة)
3. اقفله تاني
4. افتحه (دلوقتي التحديث اشتغل)

## إزاي تتأكد إنه وصل

تحت خالص في الصفحة الرئيسية:

```
v1.0.0 · تحديث 20/9
```

**بص على التاريخ، مش الرقم.** لو تاريخ النهاردة — وصل.

## ليه مرتين؟

عشان التطبيق ميعطّلكش وهو فاتح. بينزّل في الخلفية المرة الأولى، وبيشغّل النسخة الجديدة المرة اللي بعدها.

---

# إمتى تحتاج تبني APK تاني؟

**بس** في الحالات دي:

| الحالة | محتاج build؟ |
|---|---|
| تغيير في الحسابات أو الأرقام | ❌ لأ — `send-update` |
| شاشة جديدة أو تعديل شكل | ❌ لأ — `send-update` |
| تغيير نصوص أو ترجمة | ❌ لأ — `send-update` |
| **تغيير اللوجو أو أيقونة التطبيق** | ✅ أيوه |
| **إضافة صلاحية** (كاميرا، موقع...) | ✅ أيوه |
| **إضافة مكتبة بتلمس التليفون** | ✅ أيوه |

99% من التعديلات من النوع الأول.

**لو احتجت build جديد، ارفع الرقم الأول:**

```bash
npm run pin-runtime 1.1.0
npx eas-cli build --platform android --profile preview
```

---

# لو حاجة مشيت غلط

### `npm run send-update` بيقول «not linked to your EAS project»

```bash
npx eas-cli init
```
اختار **masari** الموجود. ❌ متختارش «create a new project».

### بيقول «not logged in»

```bash
npx eas-cli login
```

### التحديث اتبعت بس مش ظاهر على التليفون

1. اتأكد إنك قافل التطبيق **قفل كامل**، مش مصغّره
2. افتح واقفل مرتين
3. اتأكد إن النت شغال
4. شوف اتبعت لأنهي نسخة:
   ```bash
   npx eas-cli update:list --branch preview
   ```
   الرقم في `Runtime Version` لازم يساوي الرقم اللي في تطبيقك

### عايز تبعت لنسخة معينة بنفسك

```bash
npm run send-update "وصف التعديل" 1.0.0
```

### الـ build فشل

اقرا آخر سطر أحمر في الشاشة وابعتهولي. أغلب الأسباب: مساحة، أو نت قطع وسط الرفع.

---

# ملخص سريع

```bash
# أول مرة بس
npm install
npx eas-cli build --platform android --profile preview

# كل مرة بعد كده
npm run send-update "وصف التعديل"
```

---

# English quick reference

**First install (once):**
```bash
npm install
npm test                 # expect 632 passed
npx eas-cli login
npx eas-cli build --platform android --profile preview
```
Scan the QR, download, install. To start empty, uninstall the old app first,
or use More → Erase all data (which also cancels scheduled notifications and
signs out of the cloud, so neither can resurrect the old state).

**Every change after that:**
```bash
npm run send-update "what changed"
```
Then on the phone: fully close, open, close, open. The stamp at the bottom of
Home shows the publish date — check the date, not the version.

A new APK is only needed for icon changes, new permissions, or new native
dependencies. Bump first with `npm run pin-runtime <next>`.
