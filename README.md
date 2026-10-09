# نظام الحضور والانصراف

## الهيكل
```
attendance-project/
├── backend/          ملفات Google Apps Script (.gs)
│   ├── Code.gs  Config.gs  Utils.gs  Auth.gs
│   ├── Attendance.gs  Reports.gs  Records.gs  Admin.gs  Setup.gs
└── frontend/         ملفات الواجهة (GitHub Pages)
    ├── index.html  admin.html
    ├── css/style.css
    └── js/config.js  device.js  api.js  ui.js  app.js
```

## 1) الباك إند (Google Apps Script)
1. افتح script.google.com ← **New project**، وسمّيه `Attendance Backend`.
2. امسح الكود الافتراضي، واعمل ملف لكل `.gs` في الفولدر `backend` بنفس الاسم، وانسخ محتواه.
3. من القائمة الجانبية (Services) مفيش حاجة مطلوبة؛ الكود بيستخدم SpreadsheetApp وLockService بس.
4. اختار الدالة **setupAll** من القائمة فوق واضغط **Run**، ووافق على الصلاحيات.
   - دي بتعمل Google Sheet جديد باسم `Attendance DB` لوحدها، وتحفظ الـ ID، وتعمل كل الشيتات، وتضيف موظف تجريبي، وتطبع مفتاح الإدارة.
5. من **View ← Logs** (أو Execution log) هتلاقي:
   - لينك الشيت.
   - **مفتاح الإدارة** (احفظه، ده اللي بتدخله في لوحة admin.html).
6. **Deploy ← New deployment ← Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. انسخ الـ URL وحطه في `frontend/js/config.js`.
8. جرّب: `الـ_URL?action=ping` لازم يرجع `{"ok":true,...}`.

**مهم:** كل ما تعدّل الكود لازم **Deploy ← Manage deployments ← Edit ← New version** وإلا التعديل مش هيتطبق.

### تعديل الموظفين
من شيت `Employees` في الـ Google Sheet:
- `shiftStart` ميعاد الحضور، مثلاً `09:00`.
- `workHours` عدد ساعات الشغل.
- `graceMin` فترة السماح بالدقايق.
- `radius` نصف القطر بالمتر.
- `latitude` و`longitude` مكان الشغل (من Google Maps كليك يمين).
- `active` = `TRUE`.
- `deviceId` و`deviceModel` سيبهم فاضيين، بيتملوا أول تسجيل دخول.

## 2) الواجهة (GitHub Pages)
1. اعمل Repository جديد على GitHub اسمه `attendance-web` واختار **Public**.
2. ارفع محتويات مجلد `frontend` بالظبط (مع فولدرات `css` و`js`).
   - في GitHub: **Add file ← Upload files**، واسحب الملفات والفولدرات.
3. **Settings ← Pages ← Deploy from a branch ← main ← /root ← Save**.
4. اللينكات:
   - الموظفين: `https://اسمك.github.io/attendance-web/`
   - الإدارة: `https://اسمك.github.io/attendance-web/admin.html`

## ملاحظات
- الـ PIN بيتخزن نص عادي في الشيت، والتطبيق ده للتجربة. متخزنش مرتبات حقيقية قبل ما نأمّن الموضوع.
- ربط الجهاز بيعتمد على معرّف المتصفح + موديل الموبايل؛ لو مسح بيانات المتصفح محتاج فك ربط من لوحة الإدارة.
- الـ Apps Script مش بيشتغل من ملف `index.html` مفتوح من الجهاز مباشرة؛ لازم يكون على GitHub Pages (HTTPS) عشان الموقع والـ fetch يشتغلوا.
