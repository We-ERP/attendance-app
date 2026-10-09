// ===== الحالة =====
let emp = JSON.parse(localStorage.getItem('emp') || 'null');
let attState = 'NONE';

const VIEWS = ['login', 'home', 'attendance', 'requests', 'tasks', 'profile'];
const LOADERS = {
  home: () => { loadStatus(); loadSummary(); },
  attendance: loadAttendance,
  requests: loadRequests,
  tasks: loadTasks,
  profile: renderProfile
};

function renderUser() {
  if (!emp) return;
  $('#empName').textContent = emp.name;
  $('#avatar').innerHTML = avatarHTML(emp);
  $('#dAvatar').innerHTML = avatarHTML(emp);
  $('#dName').textContent = emp.name;
  $('#dCode').textContent = 'كود: ' + emp.code;
}

function show(v) {
  if (!emp) v = 'login';
  VIEWS.forEach(x => $('#v-' + x).classList.toggle('active', x === v));
  $('#app').classList.toggle('guest', !emp);
  closeDrawer();
  window.scrollTo({ top: 0 });
  LOADERS[v]?.();
}

function openDrawer() {
  $('#drawer').classList.add('open');
  $('#overlay').classList.add('show');
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#overlay').classList.remove('show');
}
function openSheet() { $('#sheetWrap').classList.add('show'); }
function closeSheet() { $('#sheetWrap').classList.remove('show'); }

const NAV_ACTIONS = {
  profile: () => show('profile'),
  language: () => toast('اللغة العربية هي المتاحة حالياً'),
  attendance: () => show('attendance'),
  requests: () => show('requests'),
  tasks: () => show('tasks'),
  leaves: () => toast('قريباً: إجازاتك'),
  payroll: () => toast('قريباً: مسير الراتب'),
  logout
};

// ===== تسجيل الدخول والخروج =====
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  busy(true, 'جاري تسجيل الدخول...');
  try {
    const r = await api('login', {
      code: $('#code').value.trim(),
      pin: $('#pin').value.trim()
    });
    if (!r.ok) throw new Error(r.error);
    emp = r.employee;
    localStorage.setItem('emp', JSON.stringify(emp));
    e.target.reset();
    renderUser();
    show('home');
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy(false);
  }
});

function logout() {
  localStorage.removeItem('emp');
  emp = null;
  show('login');
}

// ===== الرئيسية =====
async function loadStatus() {
  try {
    const r = await api('status', { employeeId: emp.id });
    if (!r.ok) throw new Error(r.error);

    if (r.employee) {
      emp = { ...emp, ...r.employee };
      localStorage.setItem('emp', JSON.stringify(emp));
      renderUser();
    }

    attState = r.state;
    const chip = $('#chip');
    chip.className = 'chip ' + (attState === 'IN' ? 'in' : attState === 'OUT' ? 'out' : '');
    chip.textContent = attState === 'IN' ? 'أنت الآن في العمل' : attState === 'OUT' ? 'تم الانصراف اليوم' : 'لم يتم تسجيل الحضور بعد';
    $('#hintIn').textContent = r.inTime
      ? `تم تسجيل الحضور في ${r.inTime}` + (r.lateMinutes ? ` (تأخير ${r.lateMinutes} د)` : '')
      : 'لم يتم تسجيل الحضور بعد';
    $('#hintOut').textContent = r.outTime ? `تم تسجيل الانصراف في ${r.outTime}` : '';
    $('#inBtn').disabled = attState === 'IN';
    $('#outBtn').disabled = attState !== 'IN';

    setBadge('#badgeTasks', r.pendingTasks);
    setBadge('#badgeReq', r.pendingRequests);
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadSummary() {
  const box = $('#stats');
  try {
    const r = await api('summary', { employeeId: emp.id });
    if (!r.ok) throw new Error(r.error);
    const s = r.summary;
    $('#ringTxt').textContent = s.attendancePct + '%';
    requestAnimationFrame(() => $('#ringFg').style.strokeDashoffset = 264 - 264 * s.attendancePct / 100);
    box.innerHTML = [
      stat(s.lateDays, 'أيام تأخير', s.lateMinutes + ' دقيقة'),
      stat(s.absentDays, 'أيام غياب'),
      stat(s.workedHours, 'ساعات العمل', 'من ' + s.expectedHours + ' ساعة')
    ].join('');
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

async function punch(type) {
  if (!emp) return;
  busy(true, 'جاري تحديد موقعك...');
  try {
    const c = await getPosition();
    busy(true, type === 'IN' ? 'جاري تسجيل الحضور...' : 'جاري تسجيل الانصراف...');

    const r = await api('punch', {
      employeeId: emp.id,
      type,
      lat: c.latitude,
      lng: c.longitude,
      accuracy: c.accuracy
    });
    if (!r.ok) {
      throw new Error(r.error + (r.distance ? ` (أنت تبعد ${r.distance} متر)` : ''));
    }

    let msg = type === 'IN' ? `تم تسجيل الحضور في ${r.time}` : `تم تسجيل الانصراف في ${r.time}`;
    if (r.lateMinutes) msg += ` — تأخير ${r.lateMinutes} دقيقة`;
    if (r.earlyMinutes) msg += ` — انصراف مبكر ${r.earlyMinutes} دقيقة`;
    toast(msg);

    await loadStatus();
    loadSummary();
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy(false);
  }
}

// ===== القوائم =====
async function fill(action, sel, render, emptyMsg) {
  const box = $(sel);
  box.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try {
    const r = await api(action, { employeeId: emp.id });
    if (!r.ok) throw new Error(r.error);
    box.innerHTML = r.items.length
      ? r.items.map(render).join('')
      : `<div class="empty">${emptyMsg}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

const loadAttendance = () => fill('attendance', '#attList',
  r => r.type === 'IN'
    ? row('login', 'حضور', `${r.date} • ${r.time}`,
        r.lateMinutes ? `تأخير ${r.lateMinutes} د` : 'في الوقت', '', r.lateMinutes ? 'warn' : '')
    : row('logout', 'انصراف', `${r.date} • ${r.time}`,
        r.earlyMinutes ? `مبكر ${r.earlyMinutes} د` : 'في الوقت', 'out', r.earlyMinutes ? 'warn' : ''),
  'لا يوجد سجل حضور بعد');

const loadRequests = () => fill('requests', '#reqList',
  r => row('doc', r.type, r.details, r.status, '', r.status === CONFIG.STATUS_PENDING ? 'warn' : ''),
  'لا توجد طلبات');

const loadTasks = () => fill('tasks', '#taskList',
  r => row('task', r.title, `الموعد: ${r.dueDate}`, r.status, '', r.status === CONFIG.TASK_DONE ? '' : 'warn'),
  'لا توجد مهام');

function renderProfile() {
  $('#profileBox').innerHTML = `
    <div style="text-align:center">
      <div class="avatar big">${avatarHTML(emp)}</div>
      <h3>${esc(emp.name)}</h3>
      <p class="muted">كود الموظف: ${esc(emp.code)}</p>
    </div>
    <div class="info">
      <div><span>موعد الحضور</span><b>${esc(emp.shiftStart || '--')}</b></div>
      <div><span>ساعات الشغل</span><b>${esc(emp.workHours ?? '--')} ساعة</b></div>
      <div><span>فترة السماح</span><b>${esc(emp.graceMin ?? '--')} دقيقة</b></div>
      <div><span>الجهاز المسجل</span><b>${esc(emp.deviceModel || '--')}</b></div>
    </div>`;
}

// ===== الطلبات =====
$('#reqForm').addEventListener('submit', async e => {
  e.preventDefault();
  busy(true, 'جاري إرسال الطلب...');
  try {
    const r = await api('addRequest', {
      employeeId: emp.id,
      type: $('#reqType').value,
      details: $('#reqDetails').value.trim()
    });
    if (!r.ok) throw new Error(r.error);
    toast('تم إرسال الطلب بنجاح');
    e.target.reset();
    closeSheet();
    loadRequests();
    loadStatus();
  } catch (err) {
    toast(err.message, true);
  } finally {
    busy(false);
  }
});

// ===== الأحداث =====
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) return show(go.dataset.go);

  const nav = e.target.closest('[data-nav]');
  if (nav) return NAV_ACTIONS[nav.dataset.nav]?.();

  if (e.target.closest('[data-back]')) return show('home');
});

$('#inBtn').addEventListener('click', () => punch('IN'));
$('#outBtn').addEventListener('click', () => punch('OUT'));
$('#bellBtn').addEventListener('click', () => toast('لا توجد إشعارات جديدة'));
$('#menuBtn').addEventListener('click', openDrawer);
$('#overlay').addEventListener('click', closeDrawer);
$('#homeBtn').addEventListener('click', () => show('home'));
$('#fabBtn').addEventListener('click', () => emp && openSheet());
$('#newReqBtn').addEventListener('click', openSheet);
$('#reqCancel').addEventListener('click', closeSheet);

// ===== التشغيل =====
paintIcons();
renderUser();
show(emp ? 'home' : 'login');

// ===== ساعة حية + تأثير الضغط =====
function tick() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('en-GB');
  $('#today').textContent = d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
tick(); setInterval(tick, 1000);

document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn, .qcard');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) / 2;
  const el = document.createElement('span');
  el.className = 'ripple';
  el.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(el);
  setTimeout(() => el.remove(), 600);
});
