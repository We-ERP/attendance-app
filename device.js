// معرّف ثابت للمتصفح على الجهاز ده (بيتخزن في localStorage)
function getDeviceId() {
  let id = localStorage.getItem('deviceId');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('deviceId', id);
  }
  return id;
}

// موديل الموبايل من الـ User-Agent (مثال: SM-S918B)
function getDeviceModel() {
  const ua = navigator.userAgent;
  const m = ua.match(/Android[^;]*;\s*([^;)]+?)\s*(?:Build|\))/i);
  if (m && m[1] && m[1] !== 'K') return m[1].trim();
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  return 'Unknown';
}
