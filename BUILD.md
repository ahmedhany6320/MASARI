# مصاري — إزاي توصّل أي تعديل لتليفونك

## أمر واحد بس

```bash
npm run send-update "وصف التعديل"
```

خلاص. مفيش أرقام، مفيش نسخ، مفيش حاجة تبص عليها.

---

## بعد كده على التليفون

اقفل مصاري **قفل كامل** (مش تصغير — اسحبه من قايمة التطبيقات المفتوحة)،
وافتحه، واقفله، وافتحه تاني.

**ليه مرتين؟** لأن التطبيق بينزّل التحديث في الخلفية أول مرة، وبيشغّله
المرة اللي بعدها. ده عشان ميعطّلكش وانت فاتحه.

## إزاي تعرف إنه وصل

تحت خالص في الصفحة الرئيسية هتلاقي سطر صغير كده:

```
v0.26.0 · تحديث 19/9
```

التاريخ ده هو يوم ما نشرت التحديث. لو التاريخ بتاع النهاردة، يبقى وصل.

---

## الأمر ده بيعمل إيه بالظبط؟

قبل كده كان لازم تعرف رقم «التوافق» بتاع النسخة المسطبة على تليفونك
وتكتبه بإيدك. ولو غلطت فيه ولو برقم واحد، التحديث كان بيتنشر، يقولك
**نجح**، وميوصلش — من غير أي رسالة خطأ. ده اللي حصل معاك.

الأمر الجديد بيسأل EAS بنفسه: «إيه النسخ اللي اتبنت فعلاً؟» وبيبعت نفس
التحديث لكل واحدة فيهم. أنهي نسخة على تليفونك، التحديث موجّه ليها.

بعتة لنسخة محدش شغال عليها متكلفش حاجة — سطر في جدول محدش بيسأل عنه.

---

## قبل ما تنشر، لو حبيت تتأكد

```bash
npm test          # لازم يقول 632 passed
npm run typecheck # لازم يخرج من غير كلام
```

---

## إمتى تحتاج تبني APK جديد؟

بس لو ضفنا حاجة بتلمس التليفون نفسه — كاميرا، موقع، مكتبة جديدة. ساعتها:

```bash
npx eas-cli build --platform android --profile preview
```

التعديلات العادية (حسابات، شاشات، نصوص) **مش** محتاجة ده أبداً.

---

## لو حاجة مشيت غلط

**`npm run send-update` بيقول مش لاقي حاجة:**
```bash
npx eas-cli login
```
وجرّب تاني.

**التحديث اتبعت بس لسه مش ظاهر:**
- اتأكد إنك قافل التطبيق قفل كامل، مش بس صغّرته
- افتح واقفل مرتين
- اتأكد إن النت شغال على التليفون

---

# English

One command sends an update to the phone:

```bash
npm run send-update "what changed"
```

It asks EAS which runtime versions actually have finished builds and
publishes the same update to each, so whichever build is installed is
addressed. Publishing to a runtime nobody runs costs nothing.

This replaces having to read the installed build's runtime version off the
device and type it in exactly — where being wrong by one digit meant the
update published "successfully" and reached nobody, silently.

On the phone: fully close the app, open, close, open again. The first launch
downloads the update in the background; the second applies it. The stamp at
the bottom of Home shows the publish date so you can confirm it landed.

A new APK is only needed when a native dependency or permission is added.
