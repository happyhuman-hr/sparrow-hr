/**
 * demo.js — โหมดตัวอย่าง: จำลอง Google Sheet ไว้ในเบราว์เซอร์ และใช้โค้ดฝั่งเซิร์ฟเวอร์ตัวจริง (Api.gs / Calc.gs)
 * ข้อมูลเป็นตัวอย่างทั้งหมด ไม่ส่งออกไปไหน เก็บไว้ใน localStorage ของเครื่องนี้เท่านั้น
 */
(function () {
  var KEY = 'hris-demo-v13';
  var tables = null;
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

  function bkkNow() {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(new Date()).reduce(function (o, p) { o[p.type] = p.value; return o; }, {});
    var t = (parts.hour === '24' ? '00' : parts.hour) + ':' + parts.minute + ':' + parts.second;
    var fake = LS.get(KEY + '-time');                    // ตั้งเวลาจำลองได้จากแถบด้านบน
    return { date: parts.year + '-' + parts.month + '-' + parts.day, time: fake || t };
  }

  // ---------------------------------------------------------------- seed
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  function seed() {
    var now = bkkNow(), today = now.date, R = rng(20261124), t = {};
    Object.keys(SCHEMA).forEach(function (k) { t[k] = []; });
    t.ShiftTypes = SEED.ShiftTypes.map(clone);
    t.LeavePolicy = SEED.LeavePolicy.map(clone);
    t.Config = SEED.Config.map(clone);
    setCfg(t, 'shopLat', 13.72215); setCfg(t, 'shopLng', 100.58743); setCfg(t, 'liffId', 'demo');
    var y = +today.slice(0, 4);
    t.Holidays = seedHolidays(y).concat(seedHolidays(y + 1));
    t.Holidays.forEach(function (h) { if (h.date === y + '-12-05') { h.mode = 'substitute'; h.substituteDate = y + '-12-09'; h.note = 'ร้านเปิด ไปหยุดชดเชยวันพุธ'; } });

    var E = [
      ['E001', 'คุณ', 'ภัทรา', 'ศรีสุข', 'แพร', 'หญิง', 'บริหาร', 'เจ้าของร้าน', '2023-03-01', 'permanent', 'monthly', 60000, '', 'owner', 'B'],
      ['E002', 'นางสาว', 'มณีรัตน์', 'ใจดี', 'มณี', 'หญิง', 'หน้าร้าน (FOH)', 'ผู้จัดการร้าน / HR', '2023-05-15', 'permanent', 'monthly', 32000, 'E001', 'hr', 'B'],
      ['E003', 'นาย', 'ธนากร', 'วงศ์ทอง', 'ต้น', 'ชาย', 'ครัว (BOH)', 'หัวหน้าเชฟ', '2023-04-01', 'permanent', 'monthly', 38000, 'E001', 'manager', 'A'],
      ['E004', 'นาย', 'กิตติ', 'แสงจันทร์', 'กิต', 'ชาย', 'ครัว (BOH)', 'ผู้ช่วยเชฟพิซซ่า', '2026-09-10', 'probation', 'daily', 500, 'E003', 'employee', 'A'],
      ['E005', 'นางสาว', 'สุดารัตน์', 'พรหมมา', 'ดาว', 'หญิง', 'หน้าร้าน (FOH)', 'พนักงานบริการ', '2024-08-01', 'permanent', 'monthly', 16500, 'E002', 'employee', 'C'],
      ['E006', 'นาย', 'วรเชษฐ์', 'บุญมา', 'เชษฐ์', 'ชาย', 'หน้าร้าน (FOH)', 'บาริสต้า', '2025-11-20', 'permanent', 'daily', 480, 'E002', 'employee', 'B'],
      ['E007', 'นาง', 'บุญเรือน', 'คำแก้ว', 'ป้าเรือน', 'หญิง', 'แม่บ้าน', 'แม่บ้าน', '2025-02-03', 'temporary', 'daily', 420, 'E002', 'employee', 'C']
    ];
    var offDay = { E001: 3, E002: 2, E003: 4, E004: 2, E005: 3, E006: 4, E007: 2 }; // วันหยุดที่ 2 (อังคาร–พฤหัส)
    E.forEach(function (r, i) {
      t.Employees.push({ id: r[0], prefix: r[1], firstName: r[2], lastName: r[3], nickname: r[4], gender: r[5], birthDate: (1985 + i * 2) + '-0' + (1 + i) + '-1' + i,
        ethnicity: 'ไทย', nationality: 'ไทย', religion: 'พุทธ', maritalStatus: i % 3 ? 'โสด' : 'สมรส', militaryStatus: r[5] === 'ชาย' ? 'ผ่านการเกณฑ์ทหารแล้ว' : 'ไม่เกี่ยวข้อง',
        bloodType: ['A', 'B', 'O', 'AB'][i % 4], weightKg: 50 + i * 4, heightCm: 155 + i * 3, phone: '08' + (1234567 + i * 1111111).toString().slice(0, 8), email: '', address: 'กรุงเทพมหานคร',
        emergencyContact: '', department: r[6], position: r[7], startDate: r[8], probationEnd: r[9] === 'probation' ? '2027-01-07' : '', status: r[9], payType: r[10], wage: r[11],
        supervisorId: r[12], role: r[13], endDate: '', note: '', lineUserId: 'U-demo-' + r[0], bindCode: '',
        defaultShift: r[14], offDays: r[0] === 'E007' ? '1' : '1,' + offDay[r[0]], halfDayOn: r[0] === 'E007' ? 4 : '',   // แม่บ้าน 5.5 วัน: หยุดจันทร์ + ครึ่งวันพฤหัส
        positionAllowance: { owner: 0, hr: 3000, manager: 5000 }[r[13]] || 0, fixedAllowance: r[13] === 'employee' ? 0 : 500,
        pvdPercent: r[10] === 'monthly' && r[13] !== 'owner' ? 3 : 0, scPoints: r[13] === 'owner' ? 0 : '',   // เจ้าของร้านไม่ร่วมรับ Service charge / ทิป
        bankName: ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ'][i % 3] });
      t.Sensitive.push({ id: r[0], nationalId: '1' + String(1000000000000 + i * 7919131).slice(1), passportNo: '', criminalCheck: 'clear', criminalCheckDate: r[8], criminalNote: '', docUrl: '', bankAccount: '0' + (123456789 + i * 1111111) });

    });
    t.Employees.push({ id: 'E008', prefix: 'นางสาว', firstName: 'ปิยะนุช', lastName: 'ทองดี', nickname: 'นุช', gender: 'หญิง', department: 'หน้าร้าน (FOH)', position: 'พนักงานบริการ',
      startDate: addDays(today, 3), status: 'probation', payType: 'daily', wage: 450, supervisorId: 'E002', role: 'employee', lineUserId: '', bindCode: '527391', nationality: 'ไทย',
      defaultShift: 'C', offDays: '1,4' });
    // ตัวอย่างการแก้รายวัน: ดาวสลับไปกะเช้าวันเสาร์หน้า · เชษฐ์ขอหยุดวันศุกร์หน้า
    var nextDow = function (w) { var d = addDays(today, 1); while (Calc.weekday(d) !== w) d = addDays(d, 1); return d; };
    t.Schedule.push({ date: nextDow(6), empId: 'E005', shift: 'A' }, { date: nextDow(5), empId: 'E006', shift: 'OFF' });

    // บันทึกเวลาย้อนหลัง
    var shifts = {}; t.ShiftTypes.forEach(function (s) { shifts[s.code] = s; });
    var defs = {}; t.Employees.forEach(function (e) { defs[e.id] = { shift: e.defaultShift, off: Calc.parseOffDays(e.offDays), half: e.halfDayOn, from: e.startDate }; });
    var days = [];
    t.Employees.forEach(function (e) {
      for (var d = addDays(today, -40); d <= today; d = addDays(d, 1)) {
        var sc = Calc.shiftCodeFor(e.id, d, { schedule: {}, defaults: defs });
        if (sc.code && sc.code !== 'OFF') days.push({ date: d, empId: e.id, shift: sc.code });
      }
    });
    days.forEach(function (s) {
      if (s.shift === 'OFF' || s.date > today) return;
      var sh = shifts[s.shift], st = Calc.toMin(sh.start), en = Calc.toMin(sh.end), x = R();
      if (s.date === today) {
        var nm = Calc.toMin(now.time);
        if (nm < st - 30 || x < 0.15) return;
        t.Attendance.push(att(s.date, s.empId, st - 5 - Math.floor(R() * 20), null));
        return;
      }
      if (x < 0.03) return;                                       // ขาดงาน
      var inM = x < 0.15 ? st + 3 + Math.floor(R() * 35) : st - 2 - Math.floor(R() * 25);
      var y2 = R(), outM = y2 < 0.07 ? en - 20 - Math.floor(R() * 60) : y2 < 0.25 ? en + 50 + Math.floor(R() * 80) : en + Math.floor(R() * 12);
      outM = Math.min(outM, 23 * 60 + 50);                       // ไม่ให้เลยเที่ยงคืน
      var a = att(s.date, s.empId, inM, x > 0.985 ? null : outM);
      t.Attendance.push(a);
      if (outM - en >= 60 && R() < 0.6)
        t.OTRequests.push({ id: 'O' + s.empId + s.date.replace(/-/g, ''), empId: s.empId, date: s.date, kind: 'ot', hours: Math.floor((outM - en) / 60), approvedHours: Math.floor((outM - en) / 60),
          reason: 'ลูกค้าแน่น', status: 'approved', approver: 'E002', decidedAt: s.date + ' 21:00:00', createdAt: s.date + ' 17:00:00', source: 'before' });
    });
    function att(date, empId, inM, outM) {
      var sec = function () { var s = Math.floor(R() * 60); return ':' + (s < 10 ? '0' : '') + s; };
      return { date: date, empId: empId, inTime: Calc.hhmm(inM) + sec(), outTime: outM === null ? '' : Calc.hhmm(outM) + sec(), inLat: 13.72221, inLng: 100.58748, inDist: 8 + Math.floor(R() * 40),
               inAcc: 12, outLat: outM === null ? '' : 13.7222, outLng: outM === null ? '' : 100.5875, outDist: outM === null ? '' : 10 + Math.floor(R() * 30), outAcc: outM === null ? '' : 15, note: '' };
    }

    // ใบลา / OT ตัวอย่าง
    var L = function (id, emp, type, s, e, half, days, reason, status, approver) {
      t.LeaveRequests.push({ id: id, empId: emp, type: type, startDate: s, endDate: e, half: half, days: days, reason: reason, fileUrl: '', status: status, approver: approver || '',
        decidedAt: status === 'pending' ? '' : addDays(s, -3) + ' 10:00:00', createdAt: addDays(s, -8) + ' 09:00:00', warnings: '', note: '' });
    };
    var past = function (n) { var d = addDays(today, -n); while (Calc.weekday(d) === 1) d = addDays(d, -1); return d; };
    L('L001', 'E005', 'sick', past(12), past(12), 'none', 1, 'ไข้หวัด', 'approved', 'E002');
    L('L002', 'E006', 'personal', past(6), past(6), 'am', 0.5, 'ติดต่ออำเภอ', 'approved', 'E002');
    L('L003', 'E004', 'personal', addDays(today, 9), addDays(today, 9), 'none', 1, 'งานแต่งพี่สาว', 'pending');
    L('L004', 'E005', 'annual', addDays(today, 15), addDays(today, 16), 'none', 2, 'กลับบ้านต่างจังหวัด', 'pending');
    L('L005', 'E007', 'sick', addDays(today, 2), addDays(today, 4), 'none', 2, 'ผ่าตัดเล็ก', 'pending');
    // วันที่ลาทั้งวันแล้ว ไม่ควรมีบันทึกเข้างาน
    t.Attendance = t.Attendance.filter(function (a) {
      return !t.LeaveRequests.some(function (l) { return l.status === 'approved' && l.half === 'none' && l.empId === a.empId && l.startDate <= a.date && a.date <= l.endDate; });
    });
    t.News.push({ id: 'N001', title: 'ปิดร้านวันพ่อแห่งชาติ — สลับไปหยุดวันพุธที่ 9 ธ.ค.', body: 'วันที่ 5 ธ.ค. ร้านเปิดตามปกติ เพราะมีจองโต๊ะเต็ม\nทุกคนจะได้หยุดชดเชยวันพุธที่ 9 ธ.ค. แทน (ดูในปฏิทินของฉัน)\n\nขอบคุณทุกคนที่ช่วยกันนะคะ 🙏', category: 'schedule', pinned: 'yes', audience: 'all', startDate: addDays(today, -2), endDate: y + '-12-10', createdBy: 'E002', createdAt: addDays(today, -2) + ' 10:00:00', updatedAt: addDays(today, -2) + ' 10:00:00' });
    t.News.push({ id: 'N002', title: 'เมนูใหม่: Burrata & Roasted Tomato Pizza', body: 'เริ่มขายวันศุกร์นี้ ทีมครัวทดลองทำได้ตั้งแต่บ่าย 3 โมงพรุ่งนี้\nหน้าร้านกรุณาอ่านข้อมูลสารก่อภูมิแพ้ (นม) ก่อนรับออร์เดอร์ทุกครั้ง', category: 'general', pinned: 'no', audience: 'all', startDate: today, endDate: '', createdBy: 'E001', createdAt: today + ' 09:00:00', updatedAt: today + ' 09:00:00' });
    t.OTRequests.push({ id: 'OP1', empId: 'E006', date: addDays(today, 4), kind: 'ot', hours: 2, approvedHours: '', reason: 'มีจัดเลี้ยงกลุ่ม 30 ท่าน', status: 'pending', approver: '', decidedAt: '', createdAt: today + ' 09:10:00', source: 'before' });
    return { seededFor: today, tables: t };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setCfg(t, k, v) { t.Config.forEach(function (r) { if (r.key === k) r.value = v; }); }
  function addDays(d, n) { return Calc.addDays(d, n); }

  function save() { LS.set(KEY, JSON.stringify({ seededFor: bkkNow().date, tables: tables })); }
  function load() {
    var raw = LS.get(KEY), today = bkkNow().date;
    try { raw = raw && JSON.parse(raw); } catch (e) { raw = null; }
    if (raw && raw.seededFor === today && raw.tables) tables = raw.tables;
    else { tables = seed().tables; save(); }
    Object.keys(SCHEMA).forEach(function (k) { if (!tables[k]) tables[k] = []; });   // แท็บใหม่ที่ข้อมูลเก่ายังไม่มี
  }

  // ---------------------------------------------------------------- DB / PLATFORM จำลอง
  window.DB = {
    all: function (name) { return (tables[name] || []).map(function (r) { return Object.assign({}, r); }); },
    insert: function (name, obj) { var o = {}; SCHEMA[name].forEach(function (h) { o[h] = obj[h] === undefined ? '' : obj[h]; }); tables[name].push(o); save(); },
    update: function (name, match, patch) {
      var n = 0;
      tables[name].forEach(function (r) { if (match(Object.assign({}, r))) { for (var k in patch) if (patch[k] !== undefined) r[k] = patch[k]; n++; } });
      save(); return n;
    },
    remove: function (name, match) { tables[name] = tables[name].filter(function (r) { return !match(Object.assign({}, r)); }); save(); },
    clear: function () {}
  };
  window.PLATFORM = {
    now: bkkNow,
    uuid: function () { return Math.random().toString(36).slice(2, 12); },
    lock: function (fn) { return fn(); },
    verifyIdToken: function (tok) { return String(tok || '').replace(/^demo:/, ''); },
    saveFile: function (name) { return '#ไฟล์ตัวอย่าง-' + encodeURIComponent(name); }
  };

  function currentUser() { return LS.get(KEY + '-user') || 'E001'; }
  function where() { return LS.get(KEY + '-where') || 'shop'; }

  window.HRIS_DEMO = {
    init: function () { load(); return Promise.resolve(); },
    call: function (action, payload) {
      var emp = tables.Employees.filter(function (e) { return e.id === currentUser(); })[0];
      var res = Api.handle({ action: action, idToken: 'demo:' + (emp ? emp.lineUserId : 'U-new'), payload: clone(payload || {}) });
      return new Promise(function (ok) { setTimeout(function () { ok(clone(res)); }, 120); });
    },
    /** ตำแหน่งจำลอง: ที่ร้าน (ห่าง ~20 ม.) หรือ นอกร้าน (ห่าง ~650 ม.) */
    position: function () {
      var c = {}; tables.Config.forEach(function (r) { c[r.key] = r.value; });
      var off = where() === 'shop' ? 0.00018 : 0.0059;
      return Promise.resolve({ coords: { latitude: +c.shopLat + off, longitude: +c.shopLng, accuracy: 14 } });
    },
    bar: function () {
      var users = tables.Employees.filter(function (e) { return e.lineUserId; });
      var roleTH = { owner: 'เจ้าของร้าน', hr: 'HR', manager: 'หัวหน้า', employee: 'พนักงาน' };
      var el = document.createElement('div'); el.className = 'demo-bar';
      el.innerHTML = '<div class="wrap"><b>โหมดตัวอย่าง</b> ข้อมูลจำลอง ไม่บันทึกจริง · ดูในฐานะ ' +
        '<select id="demoUser">' + users.map(function (u) { return '<option value="' + u.id + '"' + (u.id === currentUser() ? ' selected' : '') + '>' + u.nickname + ' — ' + roleTH[u.role] + '</option>'; }).join('') + '</select>' +
        ' ตำแหน่ง <select id="demoWhere"><option value="shop">อยู่ที่ร้าน</option><option value="far"' + (where() === 'far' ? ' selected' : '') + '>อยู่นอกร้าน</option></select>' +
        ' เวลา <input id="demoTime" type="time" step="60" style="width:auto;padding:2px 6px" value="' + (LS.get(KEY + '-time') || '').slice(0, 5) + '" title="เว้นว่าง = เวลาจริง">' +
        ' <button class="sm" id="demoReset">ล้างข้อมูลตัวอย่าง</button></div>';
      el.querySelector('#demoUser').onchange = function () { LS.set(KEY + '-user', this.value); location.reload(); };
      el.querySelector('#demoWhere').onchange = function () { LS.set(KEY + '-where', this.value); };
      el.querySelector('#demoTime').onchange = function () { LS.set(KEY + '-time', this.value ? this.value + ':00' : ''); location.reload(); };
      el.querySelector('#demoReset').onclick = function () { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-time'); } catch (e) { /* ignore */ } location.reload(); };
      return el;
    }
  };
})();
