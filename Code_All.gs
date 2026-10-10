// ============================================================
//  نظام الحضور والانصراف + الرواتب + الصلاحيات (ملف واحد)
// ============================================================
const CONFIG = {
  TZ: 'Africa/Cairo', MAX_ACCURACY_M: 50, DEFAULT_RADIUS_M: 100, DEFAULT_GRACE_MIN: 15, DEFAULT_WORK_HOURS: 8,
  WEEKEND_DAYS: [5, 6],   // 0=الأحد ... 5=الجمعة، 6=السبت
  LATE_FACTOR: 1,         // معامل خصم التأخير والانصراف المبكر
  OT_MULT: 1.5,           // معامل الإضافي الافتراضي (يتغير لكل موظف من عمود otRate)
  TOKEN_DAYS: 30,
  PENDING: 'قيد المراجعة', APPROVED: 'مقبول', REJECTED: 'مرفوض', TASK_DONE: 'مكتملة', RESET_TYPE: 'إعادة تعيين الرقم السري',
  SHEET_ID_PROP: 'SHEET_ID', SECRET_PROP: 'SECRET'
};
const PERMS = ['reports', 'approve', 'payroll', 'employees', 'tasks', 'perms'];
const NUMS = ['workHours', 'graceMin', 'radius', 'latitude', 'longitude', 'baseSalary', 'otRate'];
const SHEETS = {
  Employees: ['id', 'name', 'code', 'pin', 'avatar', 'latitude', 'longitude', 'radius', 'shiftStart', 'workHours',
    'graceMin', 'deviceId', 'deviceModel', 'active', 'role', 'perms', 'baseSalary', 'otRate', 'mustChange'],
  Attendance: ['date', 'time', 'employeeId', 'name', 'type', 'latitude', 'longitude', 'accuracy', 'distance',
    'deviceModel', 'lateMinutes', 'earlyMinutes', 'status'],
  Requests: ['id', 'employeeId', 'type', 'details', 'status', 'createdAt', 'fromDate', 'toDate', 'decidedBy', 'decidedAt', 'note'],
  Tasks: ['id', 'employeeId', 'title', 'status', 'dueDate']
};

// ============================ Utils ============================
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail(m, x) { return Object.assign({ ok: false, error: m }, x || {}); }
function fmt(d, p) { return Utilities.formatDate(d, CONFIG.TZ, p); }
function now() { return fmt(new Date(), 'yyyy-MM-dd HH:mm:ss'); }
function today() { return fmt(new Date(), 'yyyy-MM-dd'); }
function monthStart() { return today().slice(0, 8) + '01'; }
function normDate(v) {
  if (v instanceof Date) return fmt(v, 'yyyy-MM-dd');
  const s = String(v || '').trim(), m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);   // 11-10-2026 → 2026-10-11
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : s.slice(0, 10);
}
function toMinutes(v) {
  if (v instanceof Date) v = fmt(v, 'HH:mm');
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function nowMinutes() { return toMinutes(fmt(new Date(), 'HH:mm')); }
function normTime(v) {
  const m = toMinutes(v);
  return m === null ? '' : String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
// وقت أو مدة (8:00 / 0:05:00 / 15) → دقائق
function minOf(v, def) {
  if (v === '' || v === null || v === undefined) return def;
  const s = String(v).trim();
  if (s.includes(':')) { const m = toMinutes(s); return m === null ? def : m; }
  const n = Number(s);
  return isFinite(n) ? n : def;
}
function hoursOf(v) {
  if (v === '' || v === null || v === undefined) return CONFIG.DEFAULT_WORK_HOURS;
  const s = String(v).trim();
  if (s.includes(':')) { const m = toMinutes(s); return m ? m / 60 : CONFIG.DEFAULT_WORK_HOURS; }
  const n = Number(s);
  return n > 0 ? n : CONFIG.DEFAULT_WORK_HOURS;
}
// الموظف نشط إلا لو مكتوب FALSE / 0 / لا / موقوف (الخانة الفاضية = نشط)
function isActive(v) { return !['FALSE', '0', 'NO', 'لا', 'موقوف'].includes(String(v).trim().toUpperCase()); }
function numOr(v, def) {
  if (v === '' || v === null || v === undefined) return def;
  const n = Number(v);
  return isFinite(n) ? n : def;
}
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase(); }
function haversine(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180, dLat = r(c - a), dLon = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function shiftOf(e) {
  const startMin = minOf(e.shiftStart, 480), wh = hoursOf(e.workHours);
  return { startMin, endMin: startMin + wh * 60, graceMin: minOf(e.graceMin, CONFIG.DEFAULT_GRACE_MIN), workHours: wh };
}
function locked(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(15000)) return fail('النظام مشغول، حاول مرة أخرى');
  try { return fn(); } finally { l.releaseLock(); }
}

// ============================ الشيتات (مع كاش لسرعة الاستجابة) ============================
// القراءة: الموظفين/الطلبات/المهام بتتخزن في كاش، وأي كتابة (من الويب أو من إيدك في الشيت) بتلغي الكاش فوراً.
// الحضور بيتقرا بالتاريخ بس (آخر الشيت) عشان يفضل سريع مهما كبر.
let _ss = null;
const MEMO = {}, SHEETH = {}, HDR = {};
function cacheSvc() { return CacheService.getScriptCache(); }
function db() {
  if (_ss) return _ss;
  const id = PropertiesService.getScriptProperties().getProperty(CONFIG.SHEET_ID_PROP);
  if (id) return (_ss = SpreadsheetApp.openById(id));
  const a = SpreadsheetApp.getActiveSpreadsheet();
  if (a) return (_ss = a);
  throw new Error('شغّل setupAll() من المحرر أولاً');
}
// بيعمل الشيت ويضيف أي أعمدة ناقصة تلقائياً (من غير ما يمسح بياناتك)، والفحص بيتعمل مرة كل فترة مش في كل طلب
function ensureSheet(name) {
  if (SHEETH[name]) return SHEETH[name];
  const ss = db(), c = cacheSvc();
  let sh = ss.getSheetByName(name), fresh = false;
  if (!sh) { sh = ss.insertSheet(name); fresh = true; }
  if (fresh || !c.get('ok:' + name)) {
    const lc = sh.getLastColumn();
    const have = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
    const missing = SHEETS[name].filter(h => !have.includes(h));
    if (missing.length) {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      sh.getRange(1, have.length + 1, sh.getMaxRows(), missing.length).setNumberFormat('@');
      sh.setFrozenRows(1);
    }
    c.put('ok:' + name, '1', 21600);
  }
  return (SHEETH[name] = sh);
}
function touch(name) { delete MEMO[name]; cacheSvc().put('w:' + name, String(Date.now()), 21600); }
// الصف → object. التواريخ الحقيقية بتتحول لنص، والأوقات/المدد بتتقرا زي ما هي معروضة في الشيت
function toObjs(h, data, startRow, rng, off) {
  let d = null; const out = [];
  data.forEach((row, i) => {
    if (row.every(c => c === '')) return;
    const o = { _row: startRow + i };
    h.forEach((k, j) => {
      let x = row[j];
      if (x instanceof Date) {
        if (x.getFullYear() >= 1950) x = fmt(x, 'yyyy-MM-dd');
        else { d = d || rng.getDisplayValues(); x = d[i + off][j]; }
      }
      o[k] = x;
    });
    out.push(o);
  });
  return out;
}
function records(name) {
  if (MEMO[name]) return MEMO[name];
  const c = cacheSvc(), got = c.getAll(['c:' + name, 'w:' + name]);
  if (got['c:' + name]) {
    const hit = JSON.parse(got['c:' + name]);
    if (hit.t > Number(got['w:' + name] || 0)) return (MEMO[name] = hit.rows);
  }
  const t0 = Date.now(), rng = ensureSheet(name).getDataRange(), v = rng.getValues();
  const rows = v.length < 2 ? [] : toObjs(v[0].map(String), v.slice(1), 2, rng, 1);
  try { const j = JSON.stringify({ t: t0, rows }); if (j.length < 90000) c.put('c:' + name, j, 120); } catch (e) {}
  return (MEMO[name] = rows);
}
function attHeaders(sh, lc) {
  if (HDR.att && HDR.att.length === lc) return HDR.att;
  const c = cacheSvc(), hit = c.get('h:Attendance');
  if (hit) { const h = JSON.parse(hit); if (h.length === lc) return (HDR.att = h); }
  const h = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
  c.put('h:Attendance', JSON.stringify(h), 600);
  return (HDR.att = h);
}
// صفوف الحضور من تاريخ معين لحد الآخر (بيمشي من آخر الشيت لفوق، فمهما كبر الشيت بيفضل سريع)
function attRows(since) {
  const sh = ensureSheet('Attendance'), n = sh.getLastRow(), lc = sh.getLastColumn();
  if (n < 2) return [];
  const h = attHeaders(sh, lc), dc = h.indexOf('date') + 1;
  const dates = sh.getRange(2, dc, n - 1, 1).getValues();
  let first = n - 1;
  for (let i = n - 2; i >= 0; i--) { const d = normDate(dates[i][0]); if (d && d < since) break; first = i; }
  if (first > n - 2) return [];
  const rng = sh.getRange(first + 2, 1, n - 1 - first, lc);
  return toObjs(h, rng.getValues(), first + 2, rng, 0);
}
function sheetHeaders(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
function appendRecord(name, obj) {
  const sh = ensureSheet(name), h = name === 'Attendance' ? attHeaders(sh, sh.getLastColumn()) : sheetHeaders(sh);
  sh.appendRow(h.map(k => obj[k] === undefined || obj[k] === null ? '' : obj[k]));
  touch(name);
}
// تعديل أكتر من خانة في نفس الصف (بيقرا العناوين مرة واحدة)
function setFields(name, row, obj) {
  const sh = ensureSheet(name), h = sheetHeaders(sh);
  Object.keys(obj).forEach(k => {
    const c = h.indexOf(k);
    if (c < 0) throw new Error('عمود غير موجود: ' + k);
    sh.getRange(row, c + 1).setValue(obj[k]);
  });
  touch(name);
}
function setField(name, row, field, value) { setFields(name, row, { [field]: value }); }
// بيتشغل تلقائي لما تعدّل الشيت بإيدك، عشان الويب يشوف التعديل فوراً
function onEdit(e) {
  try {
    const n = e.range.getSheet().getName(), c = cacheSvc();
    c.put('w:' + n, String(Date.now()), 21600);
    if (e.range.getRow() === 1) c.removeAll(['h:' + n, 'ok:' + n]);
  } catch (err) {}
}

// ============================ الجلسات والصلاحيات ============================
function secret() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty(CONFIG.SECRET_PROP);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(CONFIG.SECRET_PROP, s); }
  return s;
}
function sign(t) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(t, secret())).slice(0, 22); }
function makeToken(id) { const b = id + '.' + (Date.now() + CONFIG.TOKEN_DAYS * 864e5); return b + '.' + sign(b); }
function readToken(t) {
  const a = String(t || '').split('.');
  if (a.length !== 3 || sign(a[0] + '.' + a[1]) !== a[2] || Date.now() > Number(a[1])) throw new Error('SESSION');
  return a[0];
}
function roleOf(e) { const r = String(e.role || '').trim().toLowerCase(); return r === 'admin' || r === 'manager' ? r : 'employee'; }
function permsOf(e) {
  if (roleOf(e) === 'admin') return PERMS.slice();
  return String(e.perms || '').split(',').map(s => s.trim()).filter(p => PERMS.includes(p));
}
function me(p) {
  const id = readToken(p.token);
  const e = records('Employees').find(x => String(x.id) === id && isActive(x.active));
  if (!e) throw new Error('SESSION');
  return e;
}
function authEmployee(p) { const e = me(p); checkDevice(e, p.deviceId, p.deviceModel); return e; }
function authAdmin(p, perm) {
  const e = me(p);
  if (perm && !permsOf(e).includes(perm)) throw new Error('ليس لديك صلاحية لهذا الإجراء');
  return e;
}
function checkDevice(emp, deviceId, deviceModel) {
  if (!deviceId) throw new Error('تعذر التعرف على الجهاز');
  const model = String(deviceModel || '');
  if (!emp.deviceId) {
    setFields('Employees', emp._row, { deviceId: String(deviceId), deviceModel: model });
    emp.deviceId = String(deviceId); emp.deviceModel = model;
    return;
  }
  if (String(emp.deviceId) !== String(deviceId) || String(emp.deviceModel) !== model)
    throw new Error('هذا الحساب مسجل على جهاز آخر، تواصل مع الإدارة لفك الربط');
}
function publicEmployee(e) {
  const s = shiftOf(e);
  return {
    id: String(e.id), name: String(e.name), code: String(e.code), avatar: String(e.avatar || ''),
    shiftStart: normTime(e.shiftStart), workHours: s.workHours, graceMin: s.graceMin,
    deviceModel: String(e.deviceModel || ''), role: roleOf(e), perms: permsOf(e), mustChange: String(e.mustChange).toUpperCase() === 'TRUE'
  };
}
function login(p) {
  const code = String(p.code || '').trim(), pin = String(p.pin || '').trim();
  if (!code || !pin) return fail('اكتب الكود والرقم السري');
  const cache = CacheService.getScriptCache(), k = 'f:' + code;
  if (Number(cache.get(k) || 0) >= 5) return fail('محاولات كتير غلط، جرّب بعد 15 دقيقة');
  const emp = records('Employees').find(e =>
    String(e.code).trim() === code && String(e.pin).trim() === pin && isActive(e.active));
  if (!emp) { cache.put(k, String(Number(cache.get(k) || 0) + 1), 900); return fail('الكود أو الرقم السري غير صحيح'); }
  cache.remove(k);
  if (roleOf(emp) === 'employee') checkDevice(emp, p.deviceId, p.deviceModel);
  return { ok: true, employee: publicEmployee(emp), token: makeToken(emp.id) };
}

// ============================ الحضور ============================
function todayRecords(id) {
  const t = today();
  return attRows(t).filter(r => String(r.employeeId) === String(id) && normDate(r.date) === t);
}
function pendingCounts(id) {
  const tasks = records('Tasks').filter(r => String(r.employeeId) === String(id) && String(r.status) !== CONFIG.TASK_DONE).length;
  const requests = records('Requests').filter(r => String(r.employeeId) === String(id) && String(r.status) === CONFIG.PENDING).length;
  return { tasks, requests };
}
function statusOf(emp, recs) {
  const lastIn = [...recs].reverse().find(r => r.type === 'IN'), lastOut = [...recs].reverse().find(r => r.type === 'OUT');
  const last = recs[recs.length - 1], c = pendingCounts(emp.id);
  const pa = permsOf(emp).includes('approve')
    ? records('Requests').filter(r => r.status === CONFIG.PENDING && String(r.employeeId) !== String(emp.id)).length : 0;
  return {
    ok: true, employee: publicEmployee(emp), state: last ? last.type : 'NONE',
    inTime: lastIn ? normTime(lastIn.time) : '', outTime: lastOut ? normTime(lastOut.time) : '',
    lateMinutes: lastIn ? numOr(lastIn.lateMinutes, 0) : 0, pendingTasks: c.tasks, pendingRequests: c.requests, pendingApprovals: pa
  };
}
function status(p) { const emp = authEmployee(p); return statusOf(emp, todayRecords(emp.id)); }
// الشاشة الرئيسية كلها في طلب واحد: الحالة + ملخص الشهر
function home(p) {
  const emp = authEmployee(p), ix = attIndex(monthStart());
  const recs = (ix[String(emp.id)] || {})[today()] || [];
  return Object.assign(statusOf(emp, recs), { summary: summaryFor(emp, '', '', ix, records('Requests')) });
}
function punch(p) {
  const emp = authEmployee(p), type = p.type === 'OUT' ? 'OUT' : 'IN', label = type === 'IN' ? 'الحضور' : 'الانصراف';
  const lat = Number(p.lat), lng = Number(p.lng), acc = Number(p.accuracy);
  if (!isFinite(lat) || !isFinite(lng)) return fail('تعذر تحديد موقعك');
  if (!isFinite(acc) || acc > CONFIG.MAX_ACCURACY_M)
    return fail(`دقة الموقع ضعيفة (${isFinite(acc) ? Math.round(acc) : '؟'} م)، حاول في مكان مفتوح`);
  const dist = haversine(lat, lng, Number(emp.latitude), Number(emp.longitude));
  if (!isFinite(dist)) return fail('لم يتم تحديد موقع عمل لهذا الموظف، تواصل مع الإدارة');
  if (dist > numOr(emp.radius, CONFIG.DEFAULT_RADIUS_M))
    return fail(`عذراً، أنت خارج نطاق العمل المسموح به لتسجيل ${label}`, { distance: Math.round(dist) });
  // القفل بيحمي بس خطوة (فحص الترتيب + الكتابة) عشان 10+ موظفين يسجلوا في نفس اللحظة من غير ما يستنوا بعض
  return locked(() => {
    const last = todayRecords(emp.id).pop();
    if (type === 'IN' && last && last.type === 'IN') return fail('تم تسجيل الحضور بالفعل');
    if (type === 'OUT' && (!last || last.type === 'OUT')) return fail('يجب تسجيل الحضور أولاً');
    const sh = shiftOf(emp), nm = nowMinutes();
    const lateMinutes = type === 'IN' ? Math.max(0, nm - sh.startMin - sh.graceMin) : 0;
    const earlyMinutes = type === 'OUT' ? Math.max(0, sh.endMin - nm) : 0;
    const time = fmt(new Date(), 'HH:mm:ss'), d = Math.round(dist);
    appendRecord('Attendance', {
      date: today(), time, employeeId: String(emp.id), name: String(emp.name), type, latitude: lat, longitude: lng,
      accuracy: Math.round(acc), distance: d, deviceModel: String(emp.deviceModel || ''), lateMinutes, earlyMinutes, status: 'OK'
    });
    return { ok: true, type, time: time.slice(0, 5), distance: d, lateMinutes, earlyMinutes };
  });
}
function attendance(p) {
  const emp = authEmployee(p), since = fmt(new Date(Date.now() - 60 * 864e5), 'yyyy-MM-dd');
  const items = attRows(since).filter(r => String(r.employeeId) === String(emp.id)).slice(-60).reverse().map(r => ({
    date: normDate(r.date), time: normTime(r.time), type: String(r.type), distance: numOr(r.distance, 0),
    lateMinutes: numOr(r.lateMinutes, 0), earlyMinutes: numOr(r.earlyMinutes, 0)
  }));
  return { ok: true, items };
}

// ============================ التقارير والرواتب ============================
function daysBetween(a, b) {
  const out = [], end = new Date(b + 'T12:00:00Z');
  let d = new Date(a + 'T12:00:00Z');
  while (d <= end && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 864e5); }
  return out;
}
function isWeekend(s) { return CONFIG.WEEKEND_DAYS.includes(new Date(s + 'T12:00:00Z').getUTCDay()); }
function attIndex(since) {
  const ix = {};
  attRows(since || monthStart()).forEach(r => {
    const e = String(r.employeeId), d = normDate(r.date);
    ((ix[e] = ix[e] || {})[d] = ix[e][d] || []).push(r);
  });
  return ix;
}
// الإجازات المقبولة (leave) والأذونات المقبولة (perm) كتواريخ
function excuses(id, reqs) {
  const ex = { leave: new Set(), perm: new Set() };
  reqs.filter(r => String(r.employeeId) === String(id) && r.status === CONFIG.APPROVED && r.fromDate).forEach(r => {
    const a = normDate(r.fromDate); let b = normDate(r.toDate) || a; if (b < a) b = a;
    daysBetween(a, b).forEach(d => (r.type === 'إجازة' ? ex.leave : ex.perm).add(d));
  });
  return ex;
}
function analyze(emp, start, end, ix, ex) {
  const t = today(), byDate = ix[String(emp.id)] || {}, exp = shiftOf(emp).workHours * 60;
  const r = { scheduled: 0, present: 0, absent: 0, paidLeave: 0, lateDays: 0, lateMin: 0, earlyMin: 0, workedMin: 0, otMin: 0, missingOut: 0 };
  daysBetween(start, end).forEach(d => {
    if (d > t || isWeekend(d)) return;
    const list = byDate[d] || [], ins = list.filter(x => x.type === 'IN');
    if (!ins.length) {
      if (d === t) return;
      r.scheduled++; ex.leave.has(d) ? r.paidLeave++ : r.absent++;
      return;
    }
    r.scheduled++; r.present++;
    const excused = ex.perm.has(d); let open = null, worked = 0, closed = false;
    list.forEach(x => {
      const m = toMinutes(x.time);
      if (x.type === 'IN') open = m;
      else if (open !== null && m !== null) { worked += m - open; open = null; closed = true; if (!excused) r.earlyMin += numOr(x.earlyMinutes, 0); }
    });
    const late = excused ? 0 : numOr(ins[0].lateMinutes, 0);
    if (late > 0) { r.lateDays++; r.lateMin += late; }
    if (!closed && d < t) r.missingOut++;
    r.workedMin += worked; if (worked > exp) r.otMin += worked - exp;
  });
  return r;
}
function summaryFor(emp, from, to, ix, reqs) {
  const start = normDate(from) || monthStart(), end = normDate(to) || today();
  const a = analyze(emp, start, end, ix, excuses(emp.id, reqs));
  return {
    from: start, to: end, scheduledDays: a.scheduled, presentDays: a.present, absentDays: a.absent, paidLeaveDays: a.paidLeave,
    attendancePct: a.scheduled ? Math.round((a.present + a.paidLeave) / a.scheduled * 100) : 0,
    lateDays: a.lateDays, lateMinutes: a.lateMin, earlyMinutes: a.earlyMin,
    workedHours: Math.round(a.workedMin / 60 * 10) / 10, expectedHours: a.scheduled * shiftOf(emp).workHours
  };
}
function payrollFor(emp, month, ix, reqs) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : today().slice(0, 7), first = m + '-01';
  const dt = new Date(first + 'T12:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + 1, 0);
  const last = dt.toISOString().slice(0, 10);
  const days = daysBetween(first, last).filter(d => !isWeekend(d)).length || 1;
  const sh = shiftOf(emp), base = numOr(emp.baseSalary, 0), daily = base / days, perMin = daily / sh.workHours / 60;
  const a = analyze(emp, first, last, ix, excuses(emp.id, reqs)), mult = numOr(emp.otRate, CONFIG.OT_MULT);
  const r2 = x => Math.round(x * 100) / 100;
  const absentAmt = a.absent * daily, lateAmt = a.lateMin * perMin * CONFIG.LATE_FACTOR;
  const earlyAmt = a.earlyMin * perMin * CONFIG.LATE_FACTOR, otAmt = a.otMin * perMin * mult;
  return {
    id: String(emp.id), name: String(emp.name), month: m, base, workingDays: days, daily: r2(daily),
    scheduled: a.scheduled, present: a.present, absent: a.absent, paidLeave: a.paidLeave,
    lateMin: a.lateMin, earlyMin: a.earlyMin, missingOut: a.missingOut,
    workedHours: r2(a.workedMin / 60), otHours: r2(a.otMin / 60),
    absentAmt: r2(absentAmt), lateAmt: r2(lateAmt), earlyAmt: r2(earlyAmt), otAmt: r2(otAmt),
    net: r2(Math.max(0, base - absentAmt - lateAmt - earlyAmt + otAmt)), partial: last > today()
  };
}
function monthFirst(m) { return (/^\d{4}-\d{2}$/.test(m || '') ? m : today().slice(0, 7)) + '-01'; }
function summary(p) {
  const emp = authEmployee(p);
  return { ok: true, summary: summaryFor(emp, p.from, p.to, attIndex(normDate(p.from) || monthStart()), records('Requests')) };
}
function myPayroll(p) {
  const emp = authEmployee(p);
  return { ok: true, payroll: payrollFor(emp, p.month, attIndex(monthFirst(p.month)), records('Requests')) };
}

// ============================ الطلبات والمهام ============================
function listFor(name, p) {
  const emp = authEmployee(p);
  return { ok: true, items: records(name).filter(r => String(r.employeeId) === String(emp.id)).reverse().map(({ _row, ...x }) => x) };
}
function addRequest(p) {
  const emp = authEmployee(p), details = String(p.details || '').trim().slice(0, 1000);
  if (!details) return fail('اكتب تفاصيل الطلب');
  const type = String(p.type || 'طلب عام'), from = normDate(p.fromDate);
  let to = normDate(p.toDate) || from; if (to < from) to = from;
  if (type === 'إجازة' && !from) return fail('حدد تاريخ بداية الإجازة');
  const id = uid('R');
  appendRecord('Requests', { id, employeeId: String(emp.id), type, details, status: CONFIG.PENDING, createdAt: now(), fromDate: from, toDate: to });
  return { ok: true, id };
}

// ============================ لوحة الإدارة ============================
function adminReport(p) {
  authAdmin(p, 'reports');
  const ix = attIndex(normDate(p.from) || monthStart()), reqs = records('Requests');
  const items = records('Employees').filter(e => isActive(e.active) && roleOf(e) !== 'admin').map(e => ({
    id: String(e.id), name: String(e.name), code: String(e.code), deviceModel: String(e.deviceModel || ''),
    summary: summaryFor(e, p.from, p.to, ix, reqs)
  }));
  return { ok: true, items };
}
function adminRequests(p) {
  authAdmin(p, 'approve');
  const names = {}; records('Employees').forEach(e => names[String(e.id)] = String(e.name));
  const items = records('Requests').slice().reverse().map(({ _row, ...r }) => Object.assign(r, { name: names[String(r.employeeId)] || r.employeeId }));
  return { ok: true, items };
}
function decideRequest(p) {
  return locked(() => {
    const admin = authAdmin(p, 'approve');
    const req = records('Requests').find(r => String(r.id) === String(p.id));
    if (!req) return fail('الطلب غير موجود');
    if (String(req.employeeId) === String(admin.id) && roleOf(admin) !== 'admin') return fail('لا يمكنك البت في طلبك أنت');
    const st = p.decision === 'approve' ? CONFIG.APPROVED : p.decision === 'reject' ? CONFIG.REJECTED : null;
    if (!st) return fail('قرار غير صحيح');
    let newPin = '';
    if (req.type === CONFIG.RESET_TYPE && st === CONFIG.APPROVED) {   // قبول طلب نسيان الرقم السري = إعادة تعيين
      if (!permsOf(admin).includes('employees')) return fail('إعادة التعيين تحتاج صلاحية "الموظفين"');
      const tgt = records('Employees').find(e => String(e.id) === String(req.employeeId));
      if (!tgt) return fail('الموظف غير موجود');
      newPin = String(Math.floor(100000 + Math.random() * 900000));
      setFields('Employees', tgt._row, { pin: newPin, mustChange: 'TRUE' });
      CacheService.getScriptCache().remove('f:' + String(tgt.code).trim());
    }
    setFields('Requests', req._row, { status: st, decidedBy: String(admin.name), decidedAt: now(), note: String(p.note || '').slice(0, 300) });
    return { ok: true, status: st, newPin };
  });
}
function payroll(p) {
  authAdmin(p, 'payroll');
  const ix = attIndex(monthFirst(p.month)), reqs = records('Requests');
  const items = records('Employees').filter(e => isActive(e.active) && roleOf(e) !== 'admin').map(e => payrollFor(e, p.month, ix, reqs));
  return { ok: true, items };
}
function adminEmployees(p) {
  authAdmin(p, 'employees');
  const items = records('Employees').map(e => ({
    id: String(e.id), name: String(e.name), code: String(e.code), active: isActive(e.active), role: roleOf(e),
    perms: String(e.perms || '').split(',').map(s => s.trim()).filter(Boolean),
    baseSalary: e.baseSalary, otRate: e.otRate, shiftStart: normTime(e.shiftStart), workHours: hoursOf(e.workHours),
    graceMin: shiftOf(e).graceMin, radius: e.radius, latitude: e.latitude, longitude: e.longitude,
    deviceModel: String(e.deviceModel || ''), bound: !!e.deviceId
  }));
  return { ok: true, items };
}
function updateEmployee(p) {
  return locked(() => {
    const admin = authAdmin(p, 'employees');
    const emp = records('Employees').find(e => String(e.id) === String(p.targetId));
    if (!emp) return fail('الموظف غير موجود');
    const plain = ['name', 'code', 'pin', 'shiftStart', 'workHours', 'graceMin', 'radius', 'latitude', 'longitude', 'baseSalary', 'otRate', 'active', 'avatar'];
    const nums = NUMS;
    const sec = ['role', 'perms'].filter(k => k in p);
    if (sec.length && !permsOf(admin).includes('perms')) return fail('ليس لديك صلاحية تعديل الأدوار والصلاحيات');
    for (const k of nums) if (k in p && p[k] !== '' && !isFinite(Number(p[k]))) return fail('قيمة غير صحيحة: ' + k);
    if ('code' in p) {
      const c = String(p.code).trim();
      if (!c) return fail('الكود مطلوب');
      if (records('Employees').some(e => String(e.id) !== String(emp.id) && String(e.code).trim() === c)) return fail('الكود مستخدم لموظف آخر');
    }
    if (String(emp.id) === String(admin.id) && ('active' in p && !isActive(p.active) || p.role && p.role !== 'admin' && roleOf(admin) === 'admin'))
      return fail('لا يمكنك إيقاف أو تخفيض حسابك أنت');
    const upd = {};
    plain.forEach(k => { if (k in p && !(k === 'pin' && !String(p.pin).trim())) upd[k] = String(p[k]).trim(); });
    if ('role' in p) upd.role = ['admin', 'manager'].includes(p.role) ? p.role : 'employee';
    if ('perms' in p) upd.perms = String(p.perms).split(',').filter(x => PERMS.includes(x)).join(',');
    setFields('Employees', emp._row, upd);
    return { ok: true };
  });
}
function resetDevice(p) {
  return locked(() => {
    authAdmin(p, 'employees');
    const emp = records('Employees').find(e => String(e.id) === String(p.targetId));
    if (!emp) return fail('الموظف غير موجود');
    setFields('Employees', emp._row, { deviceId: '', deviceModel: '' });
    return { ok: true };
  });
}

// ============================ كلمة السر ============================
function changePassword(p) {
  return locked(() => {
    const e = me(p);
    if (roleOf(e) === 'employee') checkDevice(e, p.deviceId, p.deviceModel);
    const oldp = String(p.oldPin || '').trim(), np = String(p.newPin || '').trim();
    if (String(e.pin).trim() !== oldp) return fail('الرقم السري الحالي غير صحيح');
    if (np.length < 4) return fail('الرقم السري الجديد لازم يكون 4 خانات على الأقل');
    if (np === oldp) return fail('الرقم الجديد لازم يختلف عن القديم');
    setFields('Employees', e._row, { pin: np, mustChange: 'FALSE' });
    return { ok: true };
  });
}
// نسيت الرقم السري: بيتبعت طلب للإدارة (من غير ما يتأكد إن الكود موجود)
function forgot(p) {
  const code = String(p.code || '').trim();
  if (!code) return fail('اكتب كود الموظف');
  const c = CacheService.getScriptCache(), k = 'r:' + code;
  if (c.get(k)) return fail('تم إرسال طلب بالفعل، استنى الإدارة');
  c.put(k, '1', 600);
  const e = records('Employees').find(x => String(x.code).trim() === code && isActive(x.active));
  if (e && !records('Requests').some(r => String(r.employeeId) === String(e.id) && r.type === CONFIG.RESET_TYPE && r.status === CONFIG.PENDING))
    appendRecord('Requests', { id: uid('R'), employeeId: String(e.id), type: CONFIG.RESET_TYPE, details: 'طلب إعادة تعيين الرقم السري', status: CONFIG.PENDING, createdAt: now() });
  return { ok: true, message: 'لو الكود صحيح، الطلب وصل للإدارة وهتبلّغك بالرقم الجديد' };
}

// ============================ إضافة موظف والمهام ============================
function addEmployee(p) {
  return locked(() => {
    const admin = authAdmin(p, 'employees'), all = records('Employees');
    const name = String(p.name || '').trim(), code = String(p.code || '').trim(), pin = String(p.pin || '').trim();
    if (!name || !code) return fail('الاسم والكود مطلوبين');
    if (pin.length < 4) return fail('الرقم السري لازم يكون 4 خانات على الأقل');
    if (all.some(e => String(e.code).trim() === code)) return fail('الكود مستخدم لموظف آخر');
    for (const k of NUMS) if (p[k] !== undefined && p[k] !== '' && !isFinite(Number(p[k]))) return fail('قيمة غير صحيحة: ' + k);
    const max = all.reduce((m, e) => Math.max(m, Number(String(e.id).replace(/\D/g, '')) || 0), 0);
    const o = { id: 'E' + String(max + 1).padStart(3, '0'), name, code, pin, active: 'TRUE', role: 'employee', perms: '', mustChange: 'TRUE',
      shiftStart: String(p.shiftStart || '08:00') };
    NUMS.forEach(k => o[k] = p[k] === undefined ? '' : String(p[k]).trim());
    if (permsOf(admin).includes('perms')) {
      if (['admin', 'manager'].includes(p.role)) o.role = p.role;
      o.perms = String(p.perms || '').split(',').filter(x => PERMS.includes(x)).join(',');
    }
    appendRecord('Employees', o);
    return { ok: true, id: o.id };
  });
}
function adminTasks(p) {
  authAdmin(p, 'tasks');
  const emps = records('Employees').filter(e => isActive(e.active)), names = {};
  emps.forEach(e => names[String(e.id)] = String(e.name));
  const items = records('Tasks').slice().reverse().map(({ _row, ...t }) => Object.assign(t, { name: names[String(t.employeeId)] || t.employeeId }));
  return { ok: true, items, employees: emps.map(e => ({ id: String(e.id), name: String(e.name) })) };
}
function addTask(p) {
  return locked(() => {
    authAdmin(p, 'tasks');
    const emp = records('Employees').find(e => String(e.id) === String(p.targetId) && isActive(e.active));
    const title = String(p.title || '').trim().slice(0, 200);
    if (!emp) return fail('الموظف غير موجود'); if (!title) return fail('اكتب عنوان المهمة');
    appendRecord('Tasks', { id: uid('T'), employeeId: String(emp.id), title, status: 'جديدة', dueDate: normDate(p.dueDate) });
    return { ok: true };
  });
}
function setTask(p) {
  return locked(() => {
    authAdmin(p, 'tasks');
    const t = records('Tasks').find(x => String(x.id) === String(p.id));
    if (!t) return fail('المهمة غير موجودة');
    setField('Tasks', t._row, 'status', p.status === CONFIG.TASK_DONE ? CONFIG.TASK_DONE : 'جديدة');
    return { ok: true };
  });
}
function completeTask(p) {
  return locked(() => {
    const emp = authEmployee(p), t = records('Tasks').find(x => String(x.id) === String(p.id) && String(x.employeeId) === String(emp.id));
    if (!t) return fail('المهمة غير موجودة');
    setField('Tasks', t._row, 'status', CONFIG.TASK_DONE);
    return { ok: true };
  });
}

// ============================ التجهيز (شغّلها مرة واحدة) ============================
function createDatabase() {
  const props = PropertiesService.getScriptProperties();
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = props.getProperty(CONFIG.SHEET_ID_PROP);
  if (!ss && id) ss = SpreadsheetApp.openById(id);
  else if (!ss) { ss = SpreadsheetApp.create('Attendance DB'); props.setProperty(CONFIG.SHEET_ID_PROP, ss.getId()); }
  ss.setSpreadsheetTimeZone(CONFIG.TZ);
  Object.keys(SHEETS).forEach(n => cacheSvc().removeAll(['ok:' + n, 'h:' + n, 'c:' + n]));
  Object.keys(SHEETS).forEach(ensureSheet);   // بيضيف الأعمدة الجديدة لو الشيت قديم
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  Logger.log('الشيت جاهز: ' + ss.getUrl());
}
function setupAdmin() {
  if (records('Employees').some(e => roleOf(e) === 'admin')) { Logger.log('فيه أدمن بالفعل (شوف عمود role في شيت Employees)'); return; }
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  appendRecord('Employees', { id: 'ADMIN', name: 'المدير', code: '9000', pin, mustChange: 'TRUE', role: 'admin', active: 'TRUE', radius: 100, shiftStart: '08:00', workHours: 8, graceMin: 15 });
  Logger.log('حساب الأدمن → الكود: 9000 | الرقم السري: ' + pin + '  (احفظه وغيّره من لوحة الإدارة)');
}
function seedDemo() {
  createDatabase();
  if (records('Employees').length) return;
  appendRecord('Employees', {
    id: 'E001', name: 'ماركو ملاك حناالله', code: '1001', pin: '1234', latitude: 30.1706, longitude: 31.2069, radius: 100,
    shiftStart: '08:00', workHours: 8, graceMin: 15, active: 'TRUE', baseSalary: 6000, otRate: 1.5
  });
}
function setupAll() { seedDemo(); setupAdmin(); }

// ============================ نقطة الدخول ============================
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const routes = {
      ping: () => ({ ok: true, time: now() }), login: () => login(p),
      me: () => ({ ok: true, employee: publicEmployee(me(p)) }),
      home: () => home(p), status: () => status(p), punch: () => punch(p), attendance: () => attendance(p), summary: () => summary(p),
      myPayroll: () => myPayroll(p), requests: () => listFor('Requests', p), tasks: () => listFor('Tasks', p),
      addRequest: () => addRequest(p),
      adminReport: () => adminReport(p), adminRequests: () => adminRequests(p), decideRequest: () => decideRequest(p),
      payroll: () => payroll(p), adminEmployees: () => adminEmployees(p), updateEmployee: () => updateEmployee(p),
      resetDevice: () => resetDevice(p), changePassword: () => changePassword(p), forgot: () => forgot(p),
      addEmployee: () => addEmployee(p), adminTasks: () => adminTasks(p), addTask: () => addTask(p), setTask: () => setTask(p),
      completeTask: () => completeTask(p)
    };
    return json(routes[p.action] ? routes[p.action]() : fail('إجراء غير معروف'));
  } catch (err) { return json(fail(err.message)); }
}
