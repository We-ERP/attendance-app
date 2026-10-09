// كل طلب بيبعت معاه معرّف الجهاز والموديل تلقائياً
async function api(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('deviceId', getDeviceId());
  url.searchParams.set('deviceModel', getDeviceModel());
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('تعذر الاتصال بالسيرفر، تأكد من الإنترنت');
  }
  if (!res.ok) throw new Error('السيرفر بيرجع خطأ');
  return res.json();
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع'));
    navigator.geolocation.getCurrentPosition(
      p => resolve(p.coords),
      err => reject(new Error(
        err.code === 1 ? 'يرجى السماح بصلاحية الموقع للمتصفح' :
        err.code === 2 ? 'تعذر تحديد موقعك، تأكد إن GPS مفعّل' :
        'انتهت مهلة تحديد الموقع، حاول مرة أخرى'
      )),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}
