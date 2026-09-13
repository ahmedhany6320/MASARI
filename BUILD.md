# بناء مصاري — النسخة 0.26.0

## المهم في النسخة دي

في ملف **جديد** لازم يكون موجود عشان البناء يظبط: `babel.config.js`.
لو نسخت الملفات يدوي، متنساهوش. هو اللي بيصلّح مشكلة كانت بتخلي نسخة
الويب تطلع صفحة فاضية.

وكمان `runtimeVersion` في `app.json` بقى رقم ثابت `"0.26.0"` بدل
`policy: appVersion`. معنى ده إن **النسخة دي محتاجة بناء جديد كامل، مش
تحديث OTA** — لكن من بعد كده أي تعديل في الجافاسكريبت بس هيوصل للتليفون
أوتوماتيك من غير بناء.

---

## الخطوات

```bash
# 1) نزّل المكتبات
npm install

# 2) اتأكد إن كل حاجة تمام قبل ما تبني
npm test          # 632 اختبار
npm run typecheck # لازم يخرج من غير أخطاء

# 3) ابني APK
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

لما البناء يخلص هيديك لينك تحميل الـ APK أو QR كود. نزّله على التليفون
واعمله install فوق النسخة القديمة عادي — بياناتك مش هتروح.

---

## التحديثات اللي بعد كده

أي تعديل في الجافاسكريبت أو الشاشات:

```bash
npx eas-cli update --branch preview --message "وصف التعديل"
```

بيوصل التليفون لوحده. **بس** لو أضفت مكتبة native جديدة أو صلاحية
جديدة، ساعتها لازم بناء جديد، وقبله:

```bash
npm run pin-runtime 0.27.0   # الرقم الجديد
```

---

## Building Masari 0.26.0 (English)

A **new file** is required for the build to work: `babel.config.js`. It fixes
the web bundle, which was serving a blank page. Don't skip it if you are
copying files by hand.

`runtimeVersion` in `app.json` is now the literal `"0.26.0"` instead of
`policy: appVersion`. This release therefore needs a **full rebuild, not an
OTA** — but every JS-only change after it will reach the phone over the air.

```bash
npm install
npm test            # 632 tests
npm run typecheck
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

For later JS-only changes: `npx eas-cli update --branch preview --message "..."`.
After adding a native dependency or permission, bump first with
`npm run pin-runtime 0.27.0` and build again.
