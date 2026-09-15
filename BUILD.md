# مصاري 0.26.0 — إزاي توصّلها لتليفونك

## الطريقة السريعة: تحديث عادي (من غير تسطيب)

كل التصليحات في النسخة دي **جافاسكريبت صافي** — مفيش مكتبات جديدة ومفيش
صلاحيات جديدة. يعني بتوصل بالتحديث العادي زي كل مرة.

### خطوة 1 — شوف رقم النسخة المسطبة عندك

افتح مصاري على التليفون، وبص **تحت خالص في الصفحة الرئيسية**. هتلاقي رقم
صغير زي كده:

```
v0.25.0
```

احفظ الرقم ده.

### خطوة 2 — اكتب أمرين بس

في الـ terminal جوه الفولدر:

```bash
npm install

# حط الرقم اللي شفته في التطبيق مكان 0.25.0
npm run pin-runtime 0.25.0

npx eas-cli update --branch preview --message "تصليح حسابات الهدف والحد اليومي"
```

خلاص. افتح التطبيق، اقفله، افتحه تاني — هيلاقي التحديث.

### إزاي تتأكد إنه وصل

بص تحت في الرئيسية تاني. لازم يكون الرقم اتغير لـ **v0.26.0**.

---

## ليه لازم خطوة `pin-runtime`؟

عشان الفخ اللي وقعت فيه قبل كده لما قلت «التحديث مش وصلني رغم إني عملت زي
كل مرة».

كان في إعداد اسمه `policy: appVersion` بيربط رقم النسخة الظاهر برقم
التوافق. يعني أول ما نرفع الرقم من 0.25 لـ 0.26، تليفونك يبقى «نسخة تانية»
في نظر التحديث — فالتحديث بينشر، بيقول **نجح**، وميوصلش.

`pin-runtime` بيفصل الرقمين عن بعض:

- **رقم التوافق** يفضل ثابت على رقم النسخة المسطبة عندك → التحديث يوصل
- **الرقم الظاهر** يتحرك عادي (0.26، 0.27...) → تعرف إن التحديث وصل

بعد كده أي تعديل جاي، أمر واحد بس:

```bash
npx eas-cli update --branch preview --message "وصف التعديل"
```

---

## إمتى تحتاج تسطب APK جديد فعلاً؟

بس لو أضفنا **مكتبة native جديدة** أو **صلاحية جديدة** (زي الكاميرا أو
الموقع). ساعتها بس:

```bash
npm run pin-runtime 0.27.0   # الرقم الجديد
npx eas-cli build --platform android --profile preview
```

النسخة دي **مش** من دول — مفيش فيها ولا واحدة من الاتنين.

---

## قبل ما تحدّث، لو حبيت تتأكد إن كل حاجة سليمة

```bash
npm test          # لازم يقول 632 passed
npm run typecheck # لازم يخرج من غير كلام
```

---

## ملاحظة على الملفات

في ملف **جديد** اسمه `babel.config.js` لازم يكون موجود. لو بتنسخ الملفات
بإيدك متنساهوش — هو اللي بيصلّح مشكلة كانت بتخلي نسخة الويب تطلع صفحة فاضية.

---

# English summary

Everything in 0.26.0 is pure JavaScript — no new native dependencies, no new
permissions — so it ships over the air.

1. Open the app, read the version at the bottom of Home (e.g. `v0.25.0`).
2. `npm install`
3. `npm run pin-runtime 0.25.0` — using the number you just read.
4. `npx eas-cli update --branch preview --message "..."`

`pin-runtime` decouples the runtime version from the display version. Under
the old `policy: appVersion`, bumping the display version changed the runtime
version too, so updates published "successfully" and reached nobody. Pinning
it to the installed build's number means the update lands, while the display
version still moves so you can confirm it arrived.

A new APK is only needed when a native dependency or permission is added.
This release adds neither.
