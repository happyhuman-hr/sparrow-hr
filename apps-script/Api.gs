/**
 * Api.gs — คำสั่งทั้งหมดที่หน้าเว็บเรียกได้
 * ไม่แตะ SpreadsheetApp โดยตรง ใช้ผ่าน DB และ PLATFORM (กำหนดใน Main.gs) เพื่อให้ทดสอบในเบราว์เซอร์ได้
 *
 * DB:       all(sheet) · insert(sheet, obj) · update(sheet, matchFn, patch) · remove(sheet, matchFn)
 * PLATFORM: verifyIdToken(token) → lineUserId · now() → {date, time} · saveFile(name, mime, b64) → url
 *           lock(fn) · uuid()
 * ระบบไม่ส่งข้อความ LINE ใด ๆ (ไม่มีค่าใช้จ่าย) ใช้ LINE เพื่อเข้าสู่ระบบเท่านั้น แจ้งเตือนทั้งหมดอยู่ในเว็บ (กระดิ่ง)
 */
var Api = (function () {

  var ROLE_RANK = { employee: 0, manager: 1, hr: 2, owner: 3 };
  var LEAVE_STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };

  function err(msg) { var e = new Error(msg); e.userFacing = true; return e; }
  /** รายการเงินเดือนที่ร้านเลือกใช้ (หน้าตั้งค่า) · ปิด = ไม่คำนวณ ไม่แสดง */
  var PAY_ITEMS = { usePositionAllowance: ['positionAllowance'], useFixedAllowance: ['fixedAllowance'], useAttBonus: [], usePvd: ['pvdPercent'],
                    useOtherIncome: ['otherIncome'], useAdvance: ['advance'], useLoan: ['loan'],
                    // รายการหลัก (ค่าตั้งต้น = ใช้) · OT ค่าอาหาร หักขาด ภาษี คิดใน Calc · หักสาย = payDeductLate · ประกันสังคม = ssoEnabled
                    useOT: [], useMeal: [], useServiceCharge: ['serviceCharge'], useTips: ['tips'], useBonus: ['bonus'], useAbsenceDeduct: [],
                    payDeductLate: [], ssoEnabled: [], useTax: ['tax'], useOtherDeduct: ['otherDeduct'] };
  var MAIN_ITEMS = ['useOT', 'useMeal', 'useServiceCharge', 'useTips', 'useBonus', 'useAbsenceDeduct', 'payDeductLate', 'ssoEnabled', 'useTax', 'useOtherDeduct'];
  function payItems(c) {
    var o = {};
    Object.keys(PAY_ITEMS).forEach(function (k) { o[k] = MAIN_ITEMS.indexOf(k) >= 0 ? String(c[k] || 'yes') !== 'no' : String(c[k] || 'no') === 'yes'; });
    return o;
  }
  function cfg() { var c = {}; DB.all('Config').forEach(function (r) { c[r.key] = r.value; }); return c; }
  function isAtLeast(user, role) { return ROLE_RANK[user.role || 'employee'] >= ROLE_RANK[role]; }
  function need(user, role) { if (!isAtLeast(user, role)) throw err('ไม่มีสิทธิ์ใช้งานส่วนนี้'); }
  function empById(id) { return DB.all('Employees').filter(function (e) { return String(e.id) === String(id); })[0] || null; }
  function fullName(e) { return e ? ((e.firstName || '') + ' ' + (e.lastName || '')).trim() + (e.nickname ? ' (' + e.nickname + ')' : '') : ''; }
  function active(e) { return e.status !== 'resigned'; }

  /** ผู้ใช้ดูข้อมูลพนักงานคนนี้ได้ไหม: ตัวเอง / หัวหน้าโดยตรง / hr / owner */
  function canSee(user, emp) {
    if (!emp) return false;
    if (String(user.id) === String(emp.id) || isAtLeast(user, 'hr')) return true;
    return user.role === 'manager' && String(emp.supervisorId) === String(user.id);
  }
  function teamOf(user) {
    return DB.all('Employees').filter(function (e) { return active(e) && (isAtLeast(user, 'hr') || String(e.supervisorId) === String(user.id) || String(e.id) === String(user.id)); });
  }

  // ---------------------------------------------------------------- context สำหรับ Calc
  function buildCtx() {
    var schedule = {}, holidays = {}, shifts = {};
    DB.all('Schedule').forEach(function (r) { schedule[r.empId + '|' + r.date] = r.shift; });
    DB.all('Holidays').forEach(function (r) { holidays[r.date] = { name: r.name, mode: r.mode || 'dayoff', substituteDate: r.substituteDate || '' }; });
    DB.all('ShiftTypes').forEach(function (r) { shifts[r.code] = r; });
    var defaults = {};   // กะประจำของแต่ละคน (ใช้เมื่อวันนั้นไม่ได้แก้รายวัน)
    DB.all('Employees').forEach(function (e) {
      if (e.status === 'resigned' && !e.endDate) return;
      if (e.defaultShift || e.offDays) defaults[e.id] = { shift: e.defaultShift, off: Calc.parseOffDays(e.offDays), half: e.halfDayOn, from: e.startDate, to: e.endDate };
    });
    return { schedule: schedule, defaults: defaults, holidays: holidays, shifts: shifts, swaps: DB.all('HolidaySwaps'),
             leaves: DB.all('LeaveRequests').filter(function (l) { return l.status === 'approved'; }) };
  }
  /** แนบชั่วโมงทำงานต่อวันจากกะประจำ (ข้อบังคับฯ) ไว้คิดค่าจ้างต่อชั่วโมง */
  function payEmp(e, ctx) {
    var sh = e.defaultShift && ctx.shifts[e.defaultShift];
    return Object.assign({}, e, { shiftHours: sh ? Calc.shiftHours(sh) : '' });
  }
  function attMap() { var m = {}; DB.all('Attendance').forEach(function (a) { m[a.empId + '|' + a.date] = a; }); return m; }
  /** เก็บชั่วโมง OT ละเอียดถึงนาที: นาที → ชั่วโมง (ทศนิยม 4 ตำแหน่ง) และกลับ */
  function toHours(min) { return Math.round(Math.max(0, Math.round(+min || 0)) / 60 * 10000) / 10000; }
  function hrsText(h) { return Calc.fmtMin(Math.round((+h || 0) * 60)); }
  /** อยู่เกินกะกี่นาทีขึ้นไปจึงสร้างคำขอ OT / แจ้งผู้อนุมัติ (กันแจ้งเตือนทุกครั้งที่ออกช้า 1–2 นาที) */
  function overstayMin(c) { return c.overstayNotifyMin === undefined || c.overstayNotifyMin === '' ? 15 : +c.overstayNotifyMin || 1; }

  function otMap() {
    var m = {};
    DB.all('OTRequests').forEach(function (o) { if (o.status === 'approved') { var k = o.empId + '|' + o.date; m[k] = (m[k] || 0) + Math.round((+o.approvedHours || +o.hours || 0) * 60); } });
    return m;
  }
  function evalRange(emp, start, end, ctx, att, ot, now, c) {
    return Calc.eachDay(start, end).map(function (d) {
      var info = Calc.dayInfo(emp.id, d, ctx), a = att[emp.id + '|' + d] || null;
      return { date: d, info: info, att: a ? { inTime: a.inTime, outTime: a.outTime, inDist: a.inDist, outDist: a.outDist } : null,
               result: Calc.evaluateDay(info, a, ot[emp.id + '|' + d] || 0, now, c) };
    });
  }
  function monthRange(month) {
    var start = month + '-01', y = +month.slice(0, 4), m = +month.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: start, end: month + '-' + (last < 10 ? '0' : '') + last };
  }
  function publicEmp(e, withSensitive) {
    var o = {}; for (var k in e) if (k !== 'bindCode' && k !== 'lineUserId') o[k] = e[k];
    o.name = fullName(e);
    if (withSensitive) o.bindCode = e.bindCode || '';
    return o;
  }

  // ---------------------------------------------------------------- ผู้ใช้ / ผูกบัญชี
  function me(user) {
    var now = PLATFORM.now(), c = cfg(), ctx = buildCtx();
    var info = Calc.dayInfo(user.id, now.date, ctx);
    var a = attMap()[user.id + '|' + now.date] || null;
    return { user: publicEmp(user), now: now, today: { info: info, att: a, result: Calc.evaluateDay(info, a, otMap()[user.id + '|' + now.date] || 0, now, c) },
             tenure: Calc.tenure(user.startDate, now.date), shop: { lat: +c.shopLat, lng: +c.shopLng, radiusM: +c.radiusM || 100, name: c.shopName || 'The Sparrow' } };
  }

  /** แจ้งเตือนในเว็บสำหรับหัวหน้า/เจ้าของร้าน: คำขอที่รอเราอนุมัติ (ใบลา + OT + อยู่เกินกะ) และผลคำขอของตัวเอง */
  function notifications(user) {
    var items = [];
    if (isAtLeast(user, 'manager')) {
      var team = {}; teamOf(user).forEach(function (e) { team[e.id] = e; });
      var mine = function (r) { return team[r.empId] && (String(r.empId) !== String(user.id) || isAtLeast(user, 'owner')) && r.status === 'pending'; };
      DB.all('LeaveRequests').filter(mine).forEach(function (l) {
        items.push({ id: l.id, kind: 'leave', at: l.createdAt, title: (team[l.empId].nickname || team[l.empId].firstName) + ' ขอ' + policyName(l.type), detail: rangeText(l), warn: !!l.warnings });
      });
      DB.all('OTRequests').filter(mine).forEach(function (o) {
        var n = team[o.empId].nickname || team[o.empId].firstName;
        items.push({ id: o.id, kind: 'ot', at: o.createdAt, title: n + (o.source === 'overstay' ? ' อยู่เกินกะ ขอ OT' : o.kind === 'holiday' ? ' ขอทำงานวันหยุด' : ' ขอ OT'), detail: o.date + ' · ' + hrsText(o.hours) });
      });
    }
    // ผลคำขอของตัวเองใน 7 วันล่าสุด
    var since = Calc.addDays(PLATFORM.now().date, -7), own = [];
    DB.all('LeaveRequests').concat(DB.all('OTRequests')).forEach(function (r) {
      if (String(r.empId) === String(user.id) && (r.status === 'approved' || r.status === 'rejected') && String(r.decidedAt).slice(0, 10) >= since)
        own.push({ id: r.id, kind: 'result', at: r.decidedAt, status: r.status, title: (r.status === 'approved' ? '✅ อนุมัติ ' : '❌ ไม่อนุมัติ ') + (r.type ? policyName(r.type) : r.kind === 'holiday' ? 'ทำงานวันหยุด' : 'OT'), detail: r.type ? rangeText(r) : r.date + ' · ' + hrsText(r.approvedHours || r.hours) });
    });
    items.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    own.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    var newsItems = visibleNews(user).slice(0, 10).map(function (n) {
      return { id: n.id + (n.updatedAt || ''), newsId: n.id, kind: 'news', at: n.updatedAt || n.createdAt, title: (n.category === 'urgent' ? '📣 ด่วน: ' : '📣 ') + n.title, detail: String(n.body).replace(/\s+/g, ' ').slice(0, 80) };
    });
    DB.all('Payslips').forEach(function (x) {
      if (String(x.empId) === String(user.id) && !x.seenAt) own.unshift({ id: 'slip' + x.month + x.publishedAt, kind: 'slip', slipMonth: x.month, at: x.publishedAt, title: '💰 สลิปเงินเดือนพร้อมแล้ว', detail: 'เดือน ' + x.month + ' · กดเพื่อดู' });
    });
    return { pending: items.length, items: items.slice(0, 20), results: own.slice(0, 10), news: newsItems };
  }

  function bind(lineUserId, payload) {
    var code = String(payload.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw err('รหัสต้องเป็นตัวเลข 6 หลัก');
    return PLATFORM.lock(function () {
      var emp = DB.all('Employees').filter(function (e) { return String(e.bindCode) === code && active(e); })[0];
      if (!emp) throw err('ไม่พบรหัสนี้ หรือรหัสถูกใช้ไปแล้ว กรุณาติดต่อ HR');
      if (DB.all('Employees').some(function (e) { return e.lineUserId === lineUserId; })) throw err('บัญชี LINE นี้ผูกกับพนักงานคนอื่นแล้ว');
      DB.update('Employees', function (e) { return String(e.id) === String(emp.id); }, { lineUserId: lineUserId, bindCode: '' });
      return { ok: true, name: fullName(emp) };
    });
  }

  // ---------------------------------------------------------------- เข้างาน / ออกงาน
  function clock(user, p) {
    var c = cfg();
    var geo = Calc.checkGeofence(+p.lat, +p.lng, +p.acc, c);
    if (!geo.ok) return { ok: false, reason: geo.reason, distance: geo.distance };

    return PLATFORM.lock(function () {
      var now = PLATFORM.now(), ctx = buildCtx();
      var info = Calc.dayInfo(user.id, now.date, ctx);
      var rows = DB.all('Attendance'), key = function (a) { return String(a.empId) === String(user.id) && a.date === now.date; };
      var cur = rows.filter(key)[0];
      var nowMin = Calc.toMin(now.time), w = Calc.expectedWindow(info);
      var shiftText = info.shift ? 'กะ ' + info.shift.start + '–' + info.shift.end : (info.holiday ? info.holiday.name : 'วันนี้ไม่มีกะ');

      if (p.action === 'in') {
        // กดเข้างานซ้ำ: ถามยืนยันก่อน แล้วค่อยเปลี่ยนเวลาเข้างานเป็นเวลานี้ (บันทึกค่าเดิมไว้ใน AttendanceLog)
        if (cur && cur.inTime && !p.confirm) return { ok: false, needConfirm: true, time: cur.inTime.slice(0, 5), now: now.time.slice(0, 5),
          reason: 'บันทึกเข้างานแล้วเมื่อ ' + cur.inTime.slice(0, 5) + ' น.',
          detail: 'ต้องการเข้างานใหม่เป็นเวลา ' + now.time.slice(0, 5) + ' น. ใช่หรือไม่' + (cur.outTime ? ' (เวลาออกงาน ' + cur.outTime.slice(0, 5) + ' เดิมจะถูกล้าง)' : '') };
        var earliest = +c.earliestCheckinMin || 60;
        if (cur && cur.inTime) {
          ['inTime', 'outTime'].forEach(function (f) { if (cur[f]) DB.insert('AttendanceLog', { at: now.date + ' ' + now.time, by: user.id, empId: user.id, date: now.date, field: f, oldValue: cur[f], newValue: f === 'inTime' ? now.time : '', reason: 'พนักงานกดเข้างานซ้ำและยืนยันเวลาใหม่' }); });
        }
        if (w && nowMin < w.start - earliest) return { ok: false, reason: 'เข้างานได้ตั้งแต่ ' + Calc.hhmm(w.start - earliest) + ' น. (' + earliest + ' นาทีก่อนเริ่มกะ)' };
        var rec = { date: now.date, empId: user.id, inTime: now.time, outTime: '', inLat: p.lat, inLng: p.lng, inDist: geo.distance, inAcc: Math.round(+p.acc || 0),
                    outLat: '', outLng: '', outDist: '', outAcc: '', note: '' };
        if (cur) DB.update('Attendance', key, rec); else DB.insert('Attendance', rec);
        var late = w ? Math.max(0, Math.floor((Calc.toSec(now.time) - w.start * 60) / 60) - w.grace) : 0;
        var warn = !w ? (info.kind === 'unscheduled' ? 'วันนี้ไม่มีกะในตาราง' : 'วันนี้เป็นวันหยุด — นับเงินเฉพาะเมื่อหัวหน้าอนุมัติ') : '';
        return { ok: true, time: now.time.slice(0, 5), shiftText: shiftText, lateMin: late, warning: warn,
                 message: late ? 'สาย ' + Calc.fmtMin(late) : (w ? 'ตรงเวลา' : '') };
      }

      // ---- ออกงาน
      if (!cur || !cur.inTime) return { ok: false, reason: 'ยังไม่ได้บันทึกเข้างานวันนี้' };
      if (cur.outTime && !p.confirm) return { ok: false, needConfirm: true, time: cur.outTime.slice(0, 5), now: now.time.slice(0, 5),
        reason: 'บันทึกออกงานแล้วเมื่อ ' + cur.outTime.slice(0, 5) + ' น.', detail: 'ต้องการออกงานใหม่เป็นเวลา ' + now.time.slice(0, 5) + ' น. ใช่หรือไม่ · OT ยังคิดตามที่หัวหน้าอนุมัติเท่านั้น' };
      if (cur.outTime) DB.insert('AttendanceLog', { at: now.date + ' ' + now.time, by: user.id, empId: user.id, date: now.date, field: 'outTime', oldValue: cur.outTime, newValue: now.time, reason: 'พนักงานกดออกงานซ้ำ' });
      DB.update('Attendance', key, { outTime: now.time, outLat: p.lat, outLng: p.lng, outDist: geo.distance, outAcc: Math.round(+p.acc || 0) });

      var res = Calc.evaluateDay(info, { inTime: cur.inTime, outTime: now.time }, otMap()[user.id + '|' + now.date] || 0, now, c);
      var msg = [];
      if (res.earlyMin) msg.push('กลับก่อน ' + Calc.fmtMin(res.earlyMin));
      if (res.otMin || res.holidayOtMin) msg.push('OT ที่อนุมัติ ' + Calc.fmtMin(res.otMin + res.holidayOtMin));
      if (res.unapprovedMin >= overstayMin(c)) {
        msg.push('อยู่เกินเวลา ' + Calc.fmtMin(res.unapprovedMin) + ' ยังไม่ได้อนุมัติ OT — ส่งคำขอให้หัวหน้าอนุมัติในระบบแล้ว');
        overstayRequest(user, now, info, res, c);
      }
      return { ok: true, time: now.time.slice(0, 5), shiftText: shiftText, message: msg.join(' · ') || 'ขอบคุณที่ทำงานวันนี้' };
    });
  }

  function newToken() { return PLATFORM.uuid() + PLATFORM.uuid(); }

  /** ออกงานเกินกะโดยยังไม่มี OT อนุมัติ → สร้างคำขอ OT รออนุมัติ (1 รายการต่อวัน) แล้วส่งการ์ด */
  function overstayRequest(emp, now, info, res, c) {
    var hrs = toHours(res.unapprovedMin);                 // คิดละเอียดถึงนาที เช่น อยู่เกิน 28 นาที = 28 นาที
    var m = function (o) { return String(o.empId) === String(emp.id) && o.date === now.date && o.source === 'overstay' && o.status === 'pending'; };
    var cur = DB.all('OTRequests').filter(m)[0];
    var patch = { hours: hrs, reason: 'อยู่เกินกะ ' + Calc.fmtMin(res.unapprovedMin) + ' (ออกงาน ' + now.time.slice(0, 5) + ')', token: newToken() };
    var row;
    if (cur) { DB.update('OTRequests', m, patch); row = Object.assign(cur, patch); }
    else {
      row = { id: 'O' + PLATFORM.uuid(), empId: emp.id, date: now.date, kind: info.kind === 'work' ? 'ot' : 'holiday', hours: hrs, approvedHours: '', reason: patch.reason,
              status: 'pending', approver: '', decidedAt: '', createdAt: now.date + ' ' + now.time, source: 'overstay', token: patch.token, note: '' };
      DB.insert('OTRequests', row);
    }
  }

  // ---------------------------------------------------------------- ปฏิทินของฉัน
  function month(user, p) {
    var target = p.empId ? empById(p.empId) : user;
    if (!canSee(user, target)) throw err('ไม่มีสิทธิ์ดูข้อมูลของพนักงานคนนี้');
    var now = PLATFORM.now(), c = cfg(), r = monthRange(p.month || now.date.slice(0, 7));
    var days = evalRange(target, r.start, r.end, buildCtx(), attMap(), otMap(), now, c);
    var leaves = DB.all('LeaveRequests');
    var yearStart = now.date.slice(0, 4) + '-01-01';
    var yearLate = evalRange(target, yearStart, now.date, buildCtx(), attMap(), otMap(), now, c).filter(function (d) { return d.result.lateMin > 0; }).length;
    return {
      emp: publicEmp(target), month: r.start.slice(0, 7), days: days, summary: Calc.summarize(days, payEmp(target, buildCtx()), c), lateCountYear: yearLate,
      balance: Calc.leaveBalance(target, DB.all('LeavePolicy'), leaves, now.date),
      myLeaves: leaves.filter(function (l) { return String(l.empId) === String(target.id); }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 30),
      pendingLeaves: leaves.filter(function (l) { return String(l.empId) === String(target.id) && l.status === 'pending'; }),
      myOT: DB.all('OTRequests').filter(function (o) { return String(o.empId) === String(target.id); }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).slice(0, 30),
      shifts: DB.all('ShiftTypes')
    };
  }

  // ---------------------------------------------------------------- ขอลา / ขอ OT
  function leavePolicies() { return DB.all('LeavePolicy'); }
  /** สิทธิ์วันลาปีนี้ของผู้ใช้: สิทธิ์ / ใช้ไปแล้ว / รออนุมัติ / คงเหลือ แยกตามประเภท */
  function leaveBalances(user) { return Calc.leaveBalance(user, DB.all('LeavePolicy'), DB.all('LeaveRequests'), PLATFORM.now().date); }

  function leavePreview(user, p) {
    var now = PLATFORM.now(), pol = DB.all('LeavePolicy').filter(function (x) { return x.type === p.type; })[0];
    var days = Calc.leaveDays(user.id, p.startDate, p.endDate || p.startDate, p.half, buildCtx());
    var bal = Calc.leaveBalance(user, pol ? [pol] : [], DB.all('LeaveRequests'), now.date)[0];
    var req = { type: p.type, startDate: p.startDate, endDate: p.endDate || p.startDate, half: p.half || 'none', days: days, hasFile: !!p.hasFile };
    return { days: days, warnings: Calc.validateLeave(req, user, pol, bal, now.date), balance: bal };
  }

  function leaveCreate(user, p) {
    if (!p.type || !p.startDate) throw err('กรุณาเลือกประเภทและวันที่ลา');
    var pre = leavePreview(user, p);
    if (!pre.days) throw err('ช่วงวันที่เลือกไม่มีวันทำงาน');
    var now = PLATFORM.now(), fileUrl = '';
    if (p.file && p.file.data) fileUrl = PLATFORM.saveFile('ลา_' + user.id + '_' + p.startDate + '_' + p.file.name, p.file.mime, p.file.data);
    var row = { id: 'L' + PLATFORM.uuid(), empId: user.id, type: p.type, startDate: p.startDate, endDate: p.endDate || p.startDate, half: p.half || 'none',
                days: pre.days, reason: p.reason || '', fileUrl: fileUrl, status: 'pending', approver: '', decidedAt: '', createdAt: now.date + ' ' + now.time,
                warnings: pre.warnings.join(' | '), note: '', token: newToken() };
    DB.insert('LeaveRequests', row);
    return { ok: true, id: row.id, warnings: pre.warnings };
  }

  function leaveCancel(user, p) {
    var l = DB.all('LeaveRequests').filter(function (x) { return x.id === p.id; })[0];
    if (!l || String(l.empId) !== String(user.id)) throw err('ไม่พบใบลา');
    if (l.status !== 'pending') throw err('ยกเลิกได้เฉพาะใบลาที่รออนุมัติ');
    DB.update('LeaveRequests', function (x) { return x.id === p.id; }, { status: 'cancelled' });
    return { ok: true };
  }

  function otCreate(user, p) {
    var hrs = toHours(Math.round((+p.hours || 0) * 60));   // ขอ OT ได้ละเอียดถึงนาที
    if (!p.date || hrs <= 0 || hrs > 12) throw err('กรุณาระบุวันที่และจำนวนชั่วโมง (ครั้งละไม่เกิน 12 ชม.)');
    var now = PLATFORM.now();
    var target = p.empId && isAtLeast(user, 'manager') ? empById(p.empId) : user;
    if (!canSee(user, target)) throw err('ไม่มีสิทธิ์');
    var byManager = target !== user;
    var row = { id: 'O' + PLATFORM.uuid(), empId: target.id, date: p.date, kind: p.kind || 'ot', hours: hrs, approvedHours: byManager ? hrs : '', reason: p.reason || '',
                status: byManager ? 'approved' : 'pending', approver: byManager ? user.id : '', decidedAt: byManager ? now.date + ' ' + now.time : '',
                createdAt: now.date + ' ' + now.time, source: p.date < now.date ? 'after' : 'before', token: byManager ? '' : newToken() };
    DB.insert('OTRequests', row);
    return { ok: true, id: row.id };
  }

  function policyName(type) { var p = DB.all('LeavePolicy').filter(function (x) { return x.type === type; })[0]; return p ? p.name : type; }
  function rangeText(l) { return l.startDate + (l.endDate !== l.startDate ? ' ถึง ' + l.endDate : '') + (l.half === 'am' ? ' (ครึ่งเช้า)' : l.half === 'pm' ? ' (ครึ่งบ่าย)' : '') + ' (' + l.days + ' วัน)'; }

  // ---------------------------------------------------------------- อนุมัติ
  function pending(user, p) {
    need(user, 'manager');
    var team = {}; teamOf(user).forEach(function (e) { team[e.id] = e; });
    var c = cfg(), now = PLATFORM.now(), ctx = buildCtx(), att = attMap(), ot = otMap();
    var leaves = DB.all('LeaveRequests').filter(function (l) { return team[l.empId] && String(l.empId) !== String(user.id) || (team[l.empId] && isAtLeast(user, 'owner')); });
    var ots = DB.all('OTRequests').filter(function (o) { return team[o.empId] && (String(o.empId) !== String(user.id) || isAtLeast(user, 'owner')); });
    // คนที่อยู่เกินกะแต่ยังไม่มีใบ OT (7 วันล่าสุด) → ให้หัวหน้าอนุมัติย้อนหลังได้
    var overstay = [];
    Object.keys(team).forEach(function (id) {
      if (String(id) === String(user.id) && !isAtLeast(user, 'owner')) return;
      evalRange(team[id], Calc.addDays(now.date, -7), now.date, ctx, att, ot, now, c).forEach(function (d) {
        var hasReq = ots.some(function (o) { return String(o.empId) === String(id) && o.date === d.date && o.status === 'pending'; });
        if (d.result.unapprovedMin >= 1 && !hasReq)
          overstay.push({ empId: id, name: fullName(team[id]), date: d.date, minutes: d.result.unapprovedMin, outTime: d.att && d.att.outTime, shift: d.info.shift ? d.info.shift.start + '–' + d.info.shift.end : (d.info.holiday ? d.info.holiday.name : 'วันหยุด'), holiday: d.info.kind !== 'work' });
      });
    });
    function decorate(x) { x.name = fullName(team[x.empId]); return x; }
    return {
      leaves: leaves.filter(function (l) { return l.status === 'pending' || l.id === p.id; }).map(decorate),
      ots: ots.filter(function (o) { return o.status === 'pending' || o.id === p.id; }).map(decorate),
      overstay: overstay, policies: DB.all('LeavePolicy'),
      history: leaves.filter(function (l) { return l.status !== 'pending'; }).concat(ots.filter(function (o) { return o.status !== 'pending'; }))
        .sort(function (a, b) { return (a.decidedAt || '') < (b.decidedAt || '') ? 1 : -1; }).slice(0, 20).map(decorate)
    };
  }

  function decide(user, p) {
    need(user, 'manager');
    var sheet = p.kind === 'leave' ? 'LeaveRequests' : 'OTRequests';
    var row = DB.all(sheet).filter(function (x) { return x.id === p.id; })[0];
    if (!row) throw err('ไม่พบรายการ');
    applyDecision(user, sheet, row, !!p.approve, p.hours, p.note);
    return { ok: true };
  }

  /** ตรวจสิทธิ์ + บันทึกผลอนุมัติ (พนักงานเห็นผลที่กระดิ่งในเว็บ) คืนข้อความสรุป */
  function applyDecision(user, sheet, row, approve, hours, note) {
    var emp = empById(row.empId), now = PLATFORM.now();
    if (!emp || !canSee(user, emp)) throw err('คุณไม่ได้เป็นผู้อนุมัติของพนักงานคนนี้');
    if (String(row.empId) === String(user.id) && !isAtLeast(user, 'owner')) throw err('อนุมัติรายการของตัวเองไม่ได้');
    if (row.status !== 'pending') {
      var by = empById(row.approver);
      throw err('รายการนี้' + (LEAVE_STATUS_TH[row.status] || row.status) + 'ไปแล้ว' + (by ? ' โดย ' + (by.nickname || by.firstName) : '') + (row.decidedAt ? ' เมื่อ ' + row.decidedAt.slice(0, 16) : ''));
    }
    if (row.source === 'overstay' && approve && Calc.diffDays(row.date, now.date) > 1 && !isAtLeast(user, 'hr'))
      throw err('หัวหน้าอนุมัติ OT ย้อนหลังได้ภายใน 24 ชม. เกินกว่านั้นให้ HR หรือเจ้าของร้านอนุมัติ');
    var patch = { status: approve ? 'approved' : 'rejected', approver: user.id, decidedAt: now.date + ' ' + now.time, note: note || '' };
    if (sheet === 'OTRequests' && approve) patch.approvedHours = hours ? Math.min(+row.hours, toHours(Math.round(+hours * 60))) : row.hours;
    DB.update(sheet, function (x) { return x.id === row.id; }, patch);
    var what = sheet === 'LeaveRequests' ? policyName(row.type) + ' ' + rangeText(row) : (row.kind === 'holiday' ? 'ทำงานวันหยุด ' : 'OT ') + row.date + ' ' + hrsText(patch.approvedHours || row.hours);
    return (approve ? '✅ อนุมัติ ' : '❌ ไม่อนุมัติ ') + what + ' ของ ' + fullName(emp) + ' แล้ว · แจ้งพนักงานทาง LINE แล้ว';
  }

  /** หัวหน้าอนุมัติ OT ย้อนหลังจากเวลาที่อยู่เกิน (ไม่มีใบขอ) */
  function approveOverstay(user, p) {
    need(user, 'manager');
    var emp = empById(p.empId);
    if (!canSee(user, emp) || String(emp.id) === String(user.id) && !isAtLeast(user, 'owner')) throw err('ไม่มีสิทธิ์');
    var now = PLATFORM.now();
    if (Calc.diffDays(p.date, now.date) > 1 && !isAtLeast(user, 'hr')) throw err('หัวหน้าอนุมัติย้อนหลังได้ภายใน 24 ชม. เกินกว่านั้นให้ HR เป็นผู้อนุมัติ');
    var hrs = toHours(Math.round((+p.hours || 0) * 60));
    if (hrs <= 0) throw err('จำนวนเวลาไม่ถูกต้อง');
    DB.insert('OTRequests', { id: 'O' + PLATFORM.uuid(), empId: emp.id, date: p.date, kind: p.holiday ? 'holiday' : 'ot', hours: hrs, approvedHours: hrs,
      reason: 'อนุมัติย้อนหลังจากเวลาที่อยู่เกิน', status: 'approved', approver: user.id, decidedAt: now.date + ' ' + now.time, createdAt: now.date + ' ' + now.time, source: 'after' });
    return { ok: true };
  }

  // ---------------------------------------------------------------- แฟ้มพนักงาน
  var EMP_FIELDS = ['prefix', 'firstName', 'lastName', 'nickname', 'gender', 'birthDate', 'ethnicity', 'nationality', 'religion', 'maritalStatus', 'militaryStatus',
    'bloodType', 'weightKg', 'heightCm', 'phone', 'email', 'address', 'emergencyContact', 'department', 'position', 'startDate', 'probationEnd', 'status', 'payType', 'wage',
    'supervisorId', 'role', 'endDate', 'note', 'defaultShift', 'offDays', 'halfDayOn', 'positionAllowance', 'fixedAllowance', 'pvdPercent', 'bankName', 'scPoints'];
  var SENS_FIELDS = ['nationalId', 'passportNo', 'criminalCheck', 'criminalCheckDate', 'criminalNote', 'docUrl', 'bankAccount'];

  function employees(user) {
    need(user, 'manager');
    var now = PLATFORM.now(), hr = isAtLeast(user, 'hr');
    return {
      list: (hr ? DB.all('Employees') : teamOf(user)).map(function (e) { var o = publicEmp(e, hr); o.tenure = Calc.tenure(e.startDate, now.date); if (!hr) stripPay(o); return o; }),
      shifts: DB.all('ShiftTypes'), canEdit: hr, canSensitive: hr, payItems: hr ? payItems(cfg()) : {}
    };
  }
  /** ข้อมูลค่าจ้าง/ภาษีเห็นเฉพาะ HR และเจ้าของร้าน */
  function stripPay(o) { ['wage', 'positionAllowance', 'fixedAllowance', 'pvdPercent', 'bankName', 'scPoints'].forEach(function (k) { delete o[k]; }); return o; }
  function employeeGet(user, p) {
    var e = empById(p.id);
    if (!canSee(user, e)) throw err('ไม่มีสิทธิ์');
    var hr = isAtLeast(user, 'hr'), o = publicEmp(e, hr);
    o.tenure = Calc.tenure(e.startDate, PLATFORM.now().date);
    if (hr) o.sensitive = DB.all('Sensitive').filter(function (s) { return String(s.id) === String(e.id); })[0] || {};
    else stripPay(o);
    return o;
  }
  function employeeSave(user, p) {
    need(user, 'hr');
    var d = p.data || {};
    if (!d.firstName || !d.startDate) throw err('กรุณากรอกชื่อและวันเริ่มงาน');
    if (d.role === 'owner' && !isAtLeast(user, 'owner')) throw err('เฉพาะเจ้าของร้านที่ตั้งสิทธิ์ owner ได้');
    return PLATFORM.lock(function () {
      var row = {}; EMP_FIELDS.forEach(function (k) { if (k in d) row[k] = d[k] === null ? '' : d[k]; });
      var id = p.id;
      if (id) DB.update('Employees', function (e) { return String(e.id) === String(id); }, row);
      else {
        var ids = DB.all('Employees').map(function (e) { return +String(e.id).replace(/\D/g, '') || 0; });
        id = 'E' + ('000' + (Math.max.apply(null, ids.concat([0])) + 1)).slice(-3);
        row.id = id; row.role = row.role || 'employee'; row.status = row.status || 'probation'; row.lineUserId = ''; row.bindCode = newCode();
        DB.insert('Employees', row);
      }
      if (p.sensitive && isAtLeast(user, 'hr')) {
        var s = { id: id }; SENS_FIELDS.forEach(function (k) { if (k in p.sensitive) s[k] = p.sensitive[k]; });
        if (s.nationalId && !/^\d{13}$/.test(String(s.nationalId).replace(/\D/g, ''))) throw err('เลขบัตรประชาชนต้องมี 13 หลัก');
        var exists = DB.all('Sensitive').some(function (x) { return String(x.id) === String(id); });
        if (exists) DB.update('Sensitive', function (x) { return String(x.id) === String(id); }, s); else DB.insert('Sensitive', s);
      }
      return { ok: true, id: id };
    });
  }
  function newCode() {
    var used = {}; DB.all('Employees').forEach(function (e) { if (e.bindCode) used[e.bindCode] = 1; });
    var c; do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (used[c]); return c;
  }
  function employeeNewCode(user, p) {
    need(user, 'hr');
    var code = newCode();
    DB.update('Employees', function (e) { return String(e.id) === String(p.id); }, { bindCode: code, lineUserId: p.unbind ? '' : undefined });
    return { ok: true, code: code };
  }

  // ---------------------------------------------------------------- ตารางกะ / วันหยุด
  function schedule(user, p) {
    need(user, 'manager');
    var start = p.weekStart, days = Calc.eachDay(start, Calc.addDays(start, 6)), cells = {};
    var team = teamOf(user).filter(active);
    DB.all('Schedule').forEach(function (r) { if (r.date >= days[0] && r.date <= days[6]) cells[r.empId + '|' + r.date] = r.shift; });
    var ctx = buildCtx(), info = {};
    var pend = DB.all('LeaveRequests').filter(function (l) { return l.status === 'pending'; });
    team.forEach(function (e) { days.forEach(function (d) {
      var i = Calc.dayInfo(e.id, d, ctx);
      if (i.kind === 'holiday' || i.kind === 'sub_off' || i.kind === 'leave' || i.halfLeave || i.holiday) info[e.id + '|' + d] = { kind: i.kind, holiday: i.holiday, leave: i.leave ? policyName(i.leave.type) + (i.halfLeave ? ' (ครึ่งวัน)' : '') : '' };
      var pl = pend.filter(function (l) { return String(l.empId) === String(e.id) && l.startDate <= d && d <= l.endDate; })[0];
      if (pl && !(info[e.id + '|' + d] || {}).leave) info[e.id + '|' + d] = Object.assign(info[e.id + '|' + d] || { kind: i.kind }, { pending: 'รออนุมัติ ' + policyName(pl.type) });
    }); });
    var defs = {};
    team.forEach(function (e) { days.forEach(function (d) { var sc = Calc.shiftCodeFor(e.id, d, Object.assign({}, ctx, { schedule: {} })); defs[e.id + '|' + d] = sc.code || ''; }); });
    return { days: days, defaults: defs, canEditDefault: isAtLeast(user, 'hr'),
             employees: team.map(function (e) { return { id: e.id, name: fullName(e), department: e.department, position: e.position, defaultShift: e.defaultShift || '', offDays: e.offDays || '', halfDayOn: e.halfDayOn === undefined ? '' : String(e.halfDayOn) }; }),
             cells: cells, info: info, shifts: DB.all('ShiftTypes'), holidays: DB.all('Holidays').filter(function (h) { return h.date >= days[0] && h.date <= days[6]; }) };
  }
  /** ตั้งกะประจำ + วันหยุดประจำสัปดาห์ของพนักงาน (เจ้าของร้าน / HR) — วันที่แก้รายวันไว้แล้วจะไม่ถูกเปลี่ยน */
  function defaultShiftSave(user, p) {
    need(user, 'hr');
    var emp = empById(p.empId); if (!emp) throw err('ไม่พบพนักงาน');
    var codes = {}; DB.all('ShiftTypes').forEach(function (s) { codes[s.code] = 1; });
    if (p.shift && !codes[p.shift]) throw err('ไม่พบกะ ' + p.shift);
    var off = Calc.parseOffDays(p.offDays);
    if (off.length > 3) throw err('วันหยุดประจำสัปดาห์เลือกได้ไม่เกิน 3 วัน');
    var half = p.halfDayOn === undefined || p.halfDayOn === null ? emp.halfDayOn : String(p.halfDayOn);
    if (half !== '' && half !== undefined && off.indexOf(+half) >= 0) throw err('วันทำงานครึ่งวันต้องไม่ตรงกับวันหยุด');
    DB.update('Employees', function (e) { return String(e.id) === String(emp.id); }, { defaultShift: p.shift || '', offDays: off.join(','), halfDayOn: half === undefined ? '' : half });
    return { ok: true };
  }
  function scheduleSet(user, p) {
    need(user, 'manager');
    var team = {}; teamOf(user).forEach(function (e) { team[e.id] = 1; });
    return PLATFORM.lock(function () {
      (p.changes || []).forEach(function (ch) {
        if (!team[ch.empId]) throw err('ไม่มีสิทธิ์จัดกะให้ ' + ch.empId);
        var m = function (r) { return String(r.empId) === String(ch.empId) && r.date === ch.date; };
        if (!ch.shift) DB.remove('Schedule', m);
        else if (DB.all('Schedule').some(m)) DB.update('Schedule', m, { shift: ch.shift });
        else DB.insert('Schedule', { date: ch.date, empId: ch.empId, shift: ch.shift });
      });
      return { ok: true };
    });
  }
  function scheduleCopyWeek(user, p) {
    need(user, 'manager');
    var from = Calc.addDays(p.weekStart, -7), changes = [];
    var team = {}; teamOf(user).forEach(function (e) { team[e.id] = 1; });
    DB.all('Schedule').forEach(function (r) {
      if (r.date >= from && r.date < p.weekStart && team[r.empId]) changes.push({ empId: r.empId, date: Calc.addDays(r.date, 7), shift: r.shift });
    });
    scheduleSet(user, { changes: changes });
    return { ok: true, count: changes.length };
  }

  function holidays(user, p) {
    var y = String(p.year || PLATFORM.now().date.slice(0, 4));
    var emps = {}; DB.all('Employees').forEach(function (e) { emps[e.id] = fullName(e); });
    return { year: y, holidays: DB.all('Holidays').filter(function (h) { return String(h.date).slice(0, 4) === y; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
             swaps: DB.all('HolidaySwaps').filter(function (s) { return String(s.holidayDate).slice(0, 4) === y; }).map(function (s) { s.name = s.empId === '*' ? 'ทุกคน' : emps[s.empId] || s.empId; return s; }),
             employees: DB.all('Employees').filter(active).map(function (e) { return { id: e.id, name: fullName(e) }; }),
             canEdit: isAtLeast(user, 'hr') };
  }
  function holidaySave(user, p) {
    need(user, 'hr');
    var h = p.holiday || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date || '') || !h.name) throw err('กรุณาระบุวันที่และชื่อวันหยุด');
    if (h.mode === 'substitute' && !h.substituteDate) throw err('กรุณาเลือกวันหยุดชดเชย');
    var row = { date: h.date, name: h.name, mode: h.mode || 'dayoff', substituteDate: h.mode === 'substitute' ? h.substituteDate : '', note: h.note || '' };
    var m = function (x) { return x.date === (p.originalDate || h.date); };
    if (DB.all('Holidays').some(m)) DB.update('Holidays', m, row); else DB.insert('Holidays', row);
    return { ok: true, warning: noticeWarning(h.date, row.mode, row.substituteDate) };
  }
  function holidayDelete(user, p) {
    need(user, 'hr');
    DB.remove('Holidays', function (x) { return x.date === p.date; });
    DB.remove('HolidaySwaps', function (x) { return x.holidayDate === p.date; });
    return { ok: true };
  }
  function swapSave(user, p) {
    need(user, 'hr');
    var s = p.swap || {};
    if (!s.holidayDate || !s.empId || !s.mode) throw err('ข้อมูลไม่ครบ');
    if (s.mode === 'substitute' && !s.substituteDate) throw err('กรุณาเลือกวันหยุดชดเชย');
    var now = PLATFORM.now();
    var row = { holidayDate: s.holidayDate, empId: s.empId, mode: s.mode, substituteDate: s.mode === 'substitute' ? s.substituteDate : '', approvedBy: user.id, createdAt: now.date + ' ' + now.time };
    var m = function (x) { return x.holidayDate === s.holidayDate && String(x.empId) === String(s.empId); };
    if (DB.all('HolidaySwaps').some(m)) DB.update('HolidaySwaps', m, row); else DB.insert('HolidaySwaps', row);
    return { ok: true, warning: noticeWarning(s.holidayDate, row.mode, row.substituteDate) };
  }
  function swapDelete(user, p) {
    need(user, 'hr');
    DB.remove('HolidaySwaps', function (x) { return x.holidayDate === p.holidayDate && String(x.empId) === String(p.empId); });
    return { ok: true };
  }
  function noticeWarning(date, mode, sub) {
    if (mode === 'dayoff') return '';
    var today = PLATFORM.now().date, first = sub && sub < date ? sub : date;
    var n = Calc.diffDays(today, first);
    return n < 7 ? 'ข้อบังคับฯ กำหนดให้ตกลงสลับวันหยุดล่วงหน้าอย่างน้อย 7 วันทำการ (ครั้งนี้ ' + Math.max(0, n) + ' วัน) ควรมีความยินยอมเป็นหนังสือจากพนักงาน' : '';
  }

  // ---------------------------------------------------------------- dashboard
  function dashboard(user, p) {
    need(user, 'manager');
    var now = PLATFORM.now(), c = cfg(), ctx = buildCtx(), att = attMap(), ot = otMap();
    var r = monthRange(p.month || now.date.slice(0, 7)), end = r.end < now.date ? r.end : (r.start > now.date ? r.start : now.date);
    var team = teamOf(user).filter(active), hr = isAtLeast(user, 'hr');
    var yearStart = now.date.slice(0, 4) + '-01-01';
    var today = { present: 0, late: 0, working: 0, notIn: 0, absent: 0, leave: 0, off: 0, list: [] };
    var trend = {}; Calc.eachDay(r.start, r.end).forEach(function (d) { trend[d] = { date: d, present: 0, late: 0, absent: 0, leave: 0 }; });

    var rows = team.map(function (e) {
      var days = evalRange(e, r.start, end, ctx, att, ot, now, c);
      var s = Calc.summarize(days, payEmp(e, ctx), c);
      days.forEach(function (d) {
        var t = trend[d.date]; if (!t) return;
        if (d.result.status === 'late') t.late++; else if (d.result.status === 'present') t.present++;
        else if (d.result.status === 'absent') t.absent++; else if (d.info.kind === 'leave') t.leave++;
      });
      var lateYear = evalRange(e, yearStart, now.date, ctx, att, ot, now, c).filter(function (d) { return d.result.lateMin > 0; }).length;
      var td = evalRange(e, now.date, now.date, ctx, att, ot, now, c)[0];
      var st = td.result.status;
      if (td.result.lateMin > 0) today.late++; else if (st === 'present' || st === 'working') today.present++;
      else if (st === 'not_in') today.notIn++; else if (st === 'absent') today.absent++; else if (st === 'leave') today.leave++; else today.off++;
      today.list.push({ empId: e.id, name: fullName(e), status: st, inTime: td.att && td.att.inTime, outTime: td.att && td.att.outTime, lateMin: td.result.lateMin,
                        shift: td.info.shift ? td.info.shift.start + '–' + td.info.shift.end : '', note: td.info.holiday ? td.info.holiday.name : td.info.leave ? policyName(td.info.leave.type) : '' });
      if (!hr) s.otPay = null;
      return { empId: e.id, name: fullName(e), department: e.department, position: e.position, payType: e.payType, status: e.status, summary: s, lateYear: lateYear,
               tenure: Calc.tenure(e.startDate, now.date) };
    });
    return { month: r.start.slice(0, 7), today: today, rows: rows, trend: Object.keys(trend).sort().map(function (k) { return trend[k]; }),
             lateLimit: +c.lateLimitPerYear || 3, policies: DB.all('LeavePolicy'), now: now, showPay: hr };
  }

  function attendanceEdit(user, p) {
    need(user, 'hr');
    if (!p.reason) throw err('กรุณาระบุเหตุผลการแก้ไข');
    if (['inTime', 'outTime'].indexOf(p.field) < 0) throw err('แก้ได้เฉพาะเวลาเข้า/ออก');
    if (p.value && !/^\d{2}:\d{2}(:\d{2})?$/.test(p.value)) throw err('รูปแบบเวลาต้องเป็น HH:mm');
    var now = PLATFORM.now(), v = p.value ? (p.value.length === 5 ? p.value + ':00' : p.value) : '';
    return PLATFORM.lock(function () {
      var m = function (a) { return String(a.empId) === String(p.empId) && a.date === p.date; };
      var cur = DB.all('Attendance').filter(m)[0];
      var patch = {}; patch[p.field] = v; patch.note = 'แก้โดย HR: ' + p.reason;
      if (cur) DB.update('Attendance', m, patch);
      else { var rec = { date: p.date, empId: p.empId, inTime: '', outTime: '', note: patch.note }; rec[p.field] = v; DB.insert('Attendance', rec); }
      DB.insert('AttendanceLog', { at: now.date + ' ' + now.time, by: user.id, empId: p.empId, date: p.date, field: p.field, oldValue: cur ? cur[p.field] : '', newValue: v, reason: p.reason });
      return { ok: true };
    });
  }

  function attendanceLog(user, p) {
    need(user, 'hr');
    return DB.all('AttendanceLog').filter(function (l) { return !p.empId || String(l.empId) === String(p.empId); }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 100);
  }

  // ---------------------------------------------------------------- รายงานเงินเดือน (เจ้าของร้าน / HR)
  /**
   * คำนวณเงินเดือนทุกคนของเดือนที่เลือก
   * วันลา: นับสิทธิ์สะสมตั้งแต่ 1 ม.ค. — ส่วนที่เกินสิทธิ์ที่จ่ายเงิน (เช่น ลาคลอดเกิน 60 วัน, ลาป่วยเกิน 30 วัน) เป็นลาไม่รับค่าจ้าง
   */
  function payroll(user, p) {
    need(user, 'hr');
    var now = PLATFORM.now(), c = cfg(), mon = p.month || now.date.slice(0, 7), r = monthRange(mon);
    var ctx = buildCtx(), att = attMap(), ot = otMap(), pols = {}, adjs = {}, payOn = payItems(c);
    if (!payOn.useAttBonus) c.attBonus = 0;
    /** ล้างค่าของรายการที่ร้านปิดไว้ (ทั้งค่าจากแฟ้มพนักงานและที่กรอกรายเดือน) */
    var off = function (o) { o = Object.assign({}, o); Object.keys(PAY_ITEMS).forEach(function (k) { if (!payOn[k]) PAY_ITEMS[k].forEach(function (f) { o[f] = ''; }); }); return o; };
    DB.all('LeavePolicy').forEach(function (x) { pols[x.type] = x; });
    DB.all('PayrollAdjust').forEach(function (a) { if (a.month === mon) adjs[a.empId] = a; });
    var yearStart = mon.slice(0, 4) + '-01-01';
    var emps = DB.all('Employees').filter(function (e) {
      if (e.status === 'resigned' && !e.endDate) return false;
      return (!e.startDate || e.startDate <= r.end) && (!e.endDate || e.endDate >= r.start);
    });
    // ---- คำนวณรอบแรก (หาวันทำงานจริงไว้แบ่ง Service charge / ทิป)
    var items = emps.map(function (e) {
      var used = {}, days = [];
      Calc.eachDay(yearStart, r.end).forEach(function (d) {
        var info = Calc.dayInfo(e.id, d, ctx), lv = info.leave, amt = lv ? (info.halfLeave ? 0.5 : 1) : 0, paid = 0, unpaid = 0;
        if (lv) {
          var lim = Calc.paidLeaveLimit(pols[lv.type]), before = used[lv.type] || 0;
          used[lv.type] = before + amt; paid = Math.max(0, Math.min(amt, lim - before)); unpaid = amt - paid;
        }
        if (d >= r.start) days.push({ date: d, info: info, result: Calc.evaluateDay(info, att[e.id + '|' + d] || null, ot[e.id + '|' + d] || 0, now, c), paidLeave: paid, unpaidLeave: unpaid });
      });
      // วันทำงานตามกะทั้งเดือน (ไม่สนวันเริ่ม/ออก) ใช้แบ่งสัดส่วนกรณีทำงานไม่ครบเดือน
      var full = Object.assign({}, ctx, { defaults: Object.assign({}, ctx.defaults) });
      if (full.defaults[e.id]) full.defaults[e.id] = Object.assign({}, full.defaults[e.id], { from: '', to: '' });
      var monthWorkDays = Calc.eachDay(r.start, r.end).filter(function (d) { var k = Calc.dayInfo(e.id, d, full).kind; return k === 'work' || k === 'leave'; }).length;
      var it = { e: e, pe: off(payEmp(e, ctx)), days: days, monthWorkDays: monthWorkDays, a: off(adjs[e.id] || {}) };
      it.first = Calc.payroll({ emp: it.pe, days: days, cfg: c, adjust: it.a, monthWorkDays: monthWorkDays });
      return it;
    });
    // ---- Service charge / ทิป: ร้านรวบรวมยอดจริงของเดือน แล้วแบ่งตามสัดส่วนวันที่มาทำงานจริง (scPoints = 0 → ไม่ได้รับ)
    var pool = DB.all('ServicePool').filter(function (x) { return x.month === mon; })[0] || null;
    var weights = items.map(function (it) {
      var gets = String(it.e.scPoints) !== '0' && +it.e.wage > 0;
      return gets ? it.first.workedDays : 0;
    });
    var scShare = Calc.allocatePool(pool && payOn.useServiceCharge ? pool.serviceCharge : 0, weights), tipShare = Calc.allocatePool(pool && payOn.useTips ? pool.tips : 0, weights);
    var rows = items.map(function (it, i) {
      var e = it.e, a = Object.assign({}, it.a, { serviceCharge: scShare[i], tips: tipShare[i] });
      var res = Calc.payroll({ emp: it.pe, month: mon, days: it.days, cfg: c, adjust: a, monthWorkDays: it.monthWorkDays });
      res.shiftHours = it.pe.shiftHours || +c.hoursPerDay || 9; res.monthWorkDays = it.monthWorkDays; res.scWeight = weights[i];
      res.empId = e.id; res.name = fullName(e); res.position = e.position || ''; res.department = e.department || ''; res.payType = e.payType || 'monthly';
      res.wage = +e.wage || 0; res.status = e.status; res.note = it.a.note || ''; res.noWage = !(+e.wage);
      var sens = DB.all('Sensitive').filter(function (s) { return String(s.id) === String(e.id); })[0] || {};
      res.nationalId = sens.nationalId || ''; res.bankAccount = sens.bankAccount || ''; res.bankName = e.bankName || '';
      return res;
    });
    var sent = DB.all('Payslips').filter(function (x) { return x.month === mon; });
    var published = sent.length ? { at: sent[0].publishedAt, by: (empById(sent[0].publishedBy) || {}).nickname || '', count: sent.length,
                                    seen: sent.filter(function (x) { return x.seenAt; }).length, acked: sent.filter(function (x) { return x.ackAt; }).length } : null;
    var slipOf = {}; sent.forEach(function (x) { slipOf[x.empId] = x; });
    rows.forEach(function (r) { var x = slipOf[r.empId]; r.slip = x ? { seenAt: x.seenAt || '', ackAt: x.ackAt || '' } : null; });
    return { month: mon, rows: rows, pool: pool, published: published, partial: r.end >= now.date, asOf: r.end < now.date ? r.end : now.date, shopName: c.shopName || 'The Sparrow',
             settings: { items: payOn, attBonus: +c.attBonus || 0, taxAuto: c.taxAuto || 'yes', mealAllowance: +c.mealAllowance || 0, payDeductLate: c.payDeductLate || 'yes', ssoRate: c.ssoRate === undefined || c.ssoRate === '' ? 5 : +c.ssoRate, ssoMin: +c.ssoMin || 1650, ssoCap: +c.ssoCap || 17500, ssoEnabled: c.ssoEnabled || 'yes', hoursPerDay: +c.hoursPerDay || 9 } };
  }

  /** บันทึกยอด Service charge / ทิป ที่ร้านเก็บได้จริงของเดือน และวิธีแบ่ง (แบ่งตามวันที่มาทำงานจริง) */
  function servicePoolSave(user, p) {
    need(user, 'hr');
    if (!/^\d{4}-\d{2}$/.test(p.month || '')) throw err('ข้อมูลไม่ครบ');
    var n = function (v) { v = String(v === undefined || v === null ? '' : v).replace(/,/g, '').trim(); if (v !== '' && (!isFinite(+v) || +v < 0)) throw err('ยอดเงินต้องเป็นตัวเลขไม่ติดลบ'); return v === '' ? 0 : Math.round(+v * 100) / 100; };
    var now = PLATFORM.now();
    var row = { month: p.month, serviceCharge: n(p.serviceCharge), tips: n(p.tips), method: 'days', note: String(p.note || '').slice(0, 200), updatedBy: user.id, updatedAt: now.date + ' ' + now.time };
    return PLATFORM.lock(function () {
      var m = function (x) { return x.month === p.month; };
      if (DB.all('ServicePool').some(m)) DB.update('ServicePool', m, row); else DB.insert('ServicePool', row);
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- ส่งสลิปให้พนักงาน
  /**
   * เจ้าของร้าน / HR กด "ส่งสลิป" → เก็บสลิปของเดือนนั้นแบบตายตัว (snapshot) ให้พนักงานแต่ละคนเปิดดูของตัวเองได้
   * ส่งซ้ำได้ (แทนที่ของเดิม เช่น หลังแก้ตัวเลข) · ยกเลิกการส่งได้
   */
  function payrollPublish(user, p) {
    need(user, 'hr');
    var rep = payroll(user, { month: p.month }), now = PLATFORM.now(), stamp = now.date + ' ' + now.time;
    var rows = rep.rows.filter(function (r) { return !r.noWage && (p.empIds ? p.empIds.indexOf(r.empId) >= 0 : true); });
    if (!rows.length) throw err('ไม่มีพนักงานที่มีค่าจ้างในเดือนนี้');
    return PLATFORM.lock(function () {
      DB.remove('Payslips', function (x) { return x.month === rep.month && (!p.empIds || p.empIds.indexOf(x.empId) >= 0); });
      rows.forEach(function (r) {
        var snap = Object.assign({}, r, { nationalId: '', bankAccount: r.bankAccount ? 'xxx-' + String(r.bankAccount).replace(/\D/g, '').slice(-4) : '' });
        DB.insert('Payslips', { month: rep.month, empId: r.empId, data: JSON.stringify({ row: snap, shopName: rep.shopName, month: rep.month }), publishedBy: user.id, publishedAt: stamp, seenAt: '', ackAt: '' });
      });
      return { ok: true, count: rows.length };
    });
  }
  function payrollUnpublish(user, p) {
    need(user, 'hr');
    DB.remove('Payslips', function (x) { return x.month === p.month; });
    return { ok: true };
  }
  /** พนักงานดูรายการสลิปของตัวเอง (เฉพาะเดือนที่ส่งแล้ว) */
  function mySlips(user) {
    return DB.all('Payslips').filter(function (x) { return String(x.empId) === String(user.id); }).map(function (x) {
      var d = {}; try { d = JSON.parse(x.data); } catch (e) { /* ignore */ }
      return { month: x.month, publishedAt: x.publishedAt, seen: !!x.seenAt, ackAt: x.ackAt || '', net: d.row ? d.row.net : 0 };
    }).sort(function (a, b) { return a.month < b.month ? 1 : -1; });
  }
  function mySlip(user, p) {
    var x = DB.all('Payslips').filter(function (s) { return String(s.empId) === String(user.id) && s.month === p.month; })[0];
    if (!x) throw err('ยังไม่มีสลิปของเดือนนี้');
    if (!x.seenAt) { var now = PLATFORM.now(); DB.update('Payslips', function (s) { return String(s.empId) === String(user.id) && s.month === p.month; }, { seenAt: now.date + ' ' + now.time }); }
    var d = JSON.parse(x.data); d.publishedAt = x.publishedAt; d.ackAt = x.ackAt || '';
    return d;
  }
  /** พนักงานกด "รับทราบสลิป" */
  function slipAck(user, p) {
    var m = function (s) { return String(s.empId) === String(user.id) && s.month === p.month; };
    var x = DB.all('Payslips').filter(m)[0];
    if (!x) throw err('ไม่พบสลิปของเดือนนี้');
    if (x.ackAt) return { ok: true, ackAt: x.ackAt };
    var now = PLATFORM.now(), at = now.date + ' ' + now.time;
    DB.update('Payslips', m, { ackAt: at, seenAt: x.seenAt || at });
    return { ok: true, ackAt: at };
  }

  // ---------------------------------------------------------------- ภ.ง.ด.1 รายเดือน
  /**
   * ข้อมูลยื่น ภ.ง.ด.1 ของเดือน (เงินได้ตามมาตรา 40(1)) — ใช้สลิปที่ส่งแล้ว ถ้ายังไม่ส่งใช้ตัวเลขที่คำนวณปัจจุบัน
   * เงินได้ที่จ่าย = รวมรายได้ − หักขาด/ลา/สาย · วันที่จ่าย = วันที่ 25 ของเดือน (ข้อบังคับฯ)
   */
  function pnd1(user, p) {
    need(user, 'hr');
    var mon = p.month || PLATFORM.now().date.slice(0, 7), c = cfg();
    var sent = DB.all('Payslips').filter(function (x) { return x.month === mon; }), rows, source;
    if (sent.length) {
      source = 'published';
      rows = sent.map(function (x) { try { return JSON.parse(x.data).row; } catch (e) { return null; } }).filter(Boolean);
    } else {
      source = 'live';
      rows = payroll(user, { month: mon }).rows.filter(function (r) { return !r.noWage; });
    }
    var sens = {}; DB.all('Sensitive').forEach(function (s) { sens[s.id] = s; });
    var list = rows.map(function (r) {
      var e = empById(r.empId) || {};
      return { empId: r.empId, taxId: String((sens[r.empId] || {}).nationalId || '').replace(/\D/g, ''), prefix: e.prefix || '', firstName: e.firstName || '', lastName: e.lastName || '',
               income: Math.round(((+r.income || 0) - (+r.absenceDeduct || 0) - (+r.lateDeduct || 0)) * 100) / 100, tax: Math.round((+r.tax || 0) * 100) / 100, condition: 1 };
    }).filter(function (x) { return x.income > 0; }).sort(function (a, b) { return a.empId < b.empId ? -1 : 1; });
    list.forEach(function (x, i) { x.seq = i + 1; });
    var tot = list.reduce(function (a, x) { a.income += x.income; a.tax += x.tax; return a; }, { income: 0, tax: 0 });
    return { month: mon, payDate: mon + '-25', source: source, list: list, count: list.length,
             totalIncome: Math.round(tot.income * 100) / 100, totalTax: Math.round(tot.tax * 100) / 100,
             payer: { name: c.payerName || c.shopName || 'The Sparrow', taxId: c.payerTaxId || '', address: c.payerAddress || '' } };
  }

  // ---------------------------------------------------------------- ภ.ง.ด.1ก รายปี
  /**
   * สรุปเงินได้ตามมาตรา 40(1) ทั้งปีของพนักงาน "ทุกคน" ที่ได้รับเงินในปีนั้น (รวมคนที่ไม่ถูกหักภาษีและคนที่ลาออกระหว่างปี)
   * ใช้สลิปที่ส่งแล้ว (ชุดเดียวกับ 50 ทวิ) · กำหนดยื่นภายในเดือนกุมภาพันธ์ของปีถัดไป
   */
  function pnd1a(user, p) {
    need(user, 'hr');
    var t = tax50(user, { year: p.year });
    var list = t.list.filter(function (o) { return o.income > 0; }).map(function (o, i) {
      var e = empById(o.empId) || {};
      return { seq: i + 1, empId: o.empId, taxId: String(o.nationalId || '').replace(/\D/g, ''), prefix: e.prefix || '', firstName: e.firstName || '', lastName: e.lastName || '',
               address: String(e.address || '').replace(/\s+/g, ' ').trim(), income: o.income, tax: o.tax, condition: 1,
               months: o.months.length, left: e.status === 'resigned' || e.status === 'terminated' };
    });
    var tot = list.reduce(function (a, x) { a.income += x.income; a.tax += x.tax; return a; }, { income: 0, tax: 0 });
    var y = +t.year, nowMon = PLATFORM.now().date.slice(0, 7), lastMon = String(y) + '-12' < nowMon ? 12 : +nowMon.slice(5, 7);
    var missing = [];
    for (var m = 1; m <= lastMon && String(y) <= nowMon.slice(0, 4); m++) { var k = y + '-' + (m < 10 ? '0' : '') + m; if (t.monthsSent.indexOf(k) < 0) missing.push(k); }
    return { year: t.year, list: list, count: list.length, totalIncome: Math.round(tot.income * 100) / 100, totalTax: Math.round(tot.tax * 100) / 100,
             monthsSent: t.monthsSent, monthsMissing: missing, dueDate: (y + 1) + '-02-' + (((y + 1) % 4 === 0 && ((y + 1) % 100 !== 0 || (y + 1) % 400 === 0)) ? '29' : '28'),
             payer: t.payer };
  }

  // ---------------------------------------------------------------- หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
  /**
   * รวมยอดทั้งปีจาก "สลิปที่ส่งแล้ว" (ตรงกับที่พนักงานได้รับจริง)
   * HR / เจ้าของร้าน: ทุกคน (หรือระบุ empId) · พนักงาน: เฉพาะของตัวเอง
   * เงินได้ที่จ่าย = รวมรายได้ − หักขาด/ลา/สาย (เงินได้ตามมาตรา 40(1))
   */
  function tax50(user, p) {
    var hr = isAtLeast(user, 'hr'), year = String(p.year || PLATFORM.now().date.slice(0, 4)), c = cfg();
    var target = hr ? (p.empId || '') : String(user.id);
    var by = {};
    DB.all('Payslips').forEach(function (x) {
      if (String(x.month).slice(0, 4) !== year || (target && String(x.empId) !== target)) return;
      var d; try { d = JSON.parse(x.data); } catch (e) { return; }
      var r = d.row || {}, o = by[x.empId] = by[x.empId] || { empId: x.empId, months: [], income: 0, tax: 0, sso: 0, pvd: 0 };
      var paid = Math.round(((+r.income || 0) - (+r.absenceDeduct || 0) - (+r.lateDeduct || 0)) * 100) / 100;
      o.months.push({ month: x.month, income: paid, tax: +r.tax || 0, sso: +r.sso || 0, pvd: +r.pvd || 0 });
      o.income += paid; o.tax += +r.tax || 0; o.sso += +r.sso || 0; o.pvd += +r.pvd || 0;
    });
    var sens = {}; DB.all('Sensitive').forEach(function (s) { sens[s.id] = s; });
    var list = Object.keys(by).map(function (id) {
      var o = by[id], e = empById(id) || {};
      ['income', 'tax', 'sso', 'pvd'].forEach(function (k) { o[k] = Math.round(o[k] * 100) / 100; });
      o.months.sort(function (a, b) { return a.month < b.month ? -1 : 1; });
      o.name = ((e.prefix || '') + (e.firstName || '') + ' ' + (e.lastName || '')).trim(); o.position = e.position || '';
      o.nationalId = (sens[id] || {}).nationalId || ''; o.address = e.address || '';
      return o;
    }).sort(function (a, b) { return a.empId < b.empId ? -1 : 1; });
    list.forEach(function (o, i) { o.seq = i + 1; });
    var monthsSent = {}; DB.all('Payslips').forEach(function (x) { if (String(x.month).slice(0, 4) === year) monthsSent[x.month] = 1; });
    return { year: year, list: list, monthsSent: Object.keys(monthsSent).sort(), isHR: hr,
             payer: { name: c.payerName || c.shopName || 'The Sparrow', taxId: c.payerTaxId || '', address: c.payerAddress || '' } };
  }

  /** บันทึกรายการที่กรอกเองรายเดือน: Service charge / ทิป, โบนัส, รายได้อื่น, ภาษีหัก ณ ที่จ่าย, หักอื่น, หมายเหตุ */
  function payrollAdjust(user, p) {
    need(user, 'hr');
    if (!/^\d{4}-\d{2}$/.test(p.month || '') || !empById(p.empId)) throw err('ข้อมูลไม่ครบ');
    var row = { month: p.month, empId: p.empId };
    var prev = DB.all('PayrollAdjust').filter(function (x) { return x.month === p.month && String(x.empId) === String(p.empId); })[0] || {};
    ['serviceCharge', 'bonus', 'otherIncome', 'tax', 'otherDeduct', 'advance', 'loan'].forEach(function (k) {
      // ช่องที่ไม่ได้ส่งมา (เช่น รายการที่ปิดอยู่ในหน้าตั้งค่า) เก็บค่าเดิมไว้
      var v = p.values && p.values[k] !== undefined ? String(p.values[k]).replace(/,/g, '').trim() : String(prev[k] === undefined ? '' : prev[k]);
      if (v !== '' && (!isFinite(+v) || +v < 0)) throw err('จำนวนเงินต้องเป็นตัวเลขไม่ติดลบ');
      row[k] = v === '' ? '' : Math.round(+v * 100) / 100;
    });
    row.note = String((p.values && p.values.note) || '').slice(0, 200);
    var now = PLATFORM.now(); row.updatedBy = user.id; row.updatedAt = now.date + ' ' + now.time;
    return PLATFORM.lock(function () {
      var m = function (x) { return x.month === p.month && String(x.empId) === String(p.empId); };
      if (DB.all('PayrollAdjust').some(m)) DB.update('PayrollAdjust', m, row); else DB.insert('PayrollAdjust', row);
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- ข่าวสาร / ประกาศ
  var NEWS_CAT = { general: 'ทั่วไป', urgent: 'ด่วน', policy: 'ระเบียบ / ข้อบังคับ', event: 'กิจกรรม', schedule: 'ตารางงาน / วันหยุด' };
  /** ข่าวที่ผู้ใช้คนนี้เห็นได้: อยู่ในช่วงวันที่ และตรงแผนก (all = ทุกคน) */
  function visibleNews(user) {
    var today = PLATFORM.now().date;
    return DB.all('News').filter(function (n) {
      if (n.startDate && n.startDate > today) return false;
      if (n.endDate && n.endDate < today) return false;
      return !n.audience || n.audience === 'all' || n.audience === user.department || isAtLeast(user, 'hr');
    }).sort(function (a, b) {
      if ((a.pinned === 'yes') !== (b.pinned === 'yes')) return a.pinned === 'yes' ? -1 : 1;
      return (b.startDate || b.createdAt) > (a.startDate || a.createdAt) ? 1 : -1;
    });
  }
  function news(user) {
    var emps = {}; DB.all('Employees').forEach(function (e) { emps[e.id] = e.nickname || e.firstName; });
    return { items: visibleNews(user).map(function (n) { n.author = emps[n.createdBy] || ''; n.categoryName = NEWS_CAT[n.category] || 'ทั่วไป'; return n; }), categories: NEWS_CAT };
  }
  function newsAdmin(user) {
    need(user, 'hr');
    var depts = {}; DB.all('Employees').forEach(function (e) { if (e.department && active(e)) depts[e.department] = 1; });
    return { items: DB.all('News').sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }), categories: NEWS_CAT, departments: Object.keys(depts), today: PLATFORM.now().date };
  }
  function newsSave(user, p) {
    need(user, 'hr');
    var n = p.item || {}, now = PLATFORM.now(), stamp = now.date + ' ' + now.time;
    if (!String(n.title || '').trim()) throw err('กรุณาใส่หัวข้อข่าว');
    if (!String(n.body || '').trim()) throw err('กรุณาใส่เนื้อหาข่าว');
    if (n.endDate && n.startDate && n.endDate < n.startDate) throw err('วันสิ้นสุดต้องไม่ก่อนวันเริ่มแสดง');
    var row = { title: String(n.title).trim().slice(0, 150), body: String(n.body).trim().slice(0, 5000), category: NEWS_CAT[n.category] ? n.category : 'general',
                pinned: n.pinned === 'yes' ? 'yes' : 'no', audience: n.audience || 'all', startDate: n.startDate || now.date, endDate: n.endDate || '', updatedAt: stamp };
    return PLATFORM.lock(function () {
      if (n.id && DB.all('News').some(function (x) { return x.id === n.id; })) { DB.update('News', function (x) { return x.id === n.id; }, row); return { ok: true, id: n.id }; }
      row.id = 'N' + PLATFORM.uuid(); row.createdBy = user.id; row.createdAt = stamp;
      DB.insert('News', row);
      return { ok: true, id: row.id };
    });
  }
  function newsDelete(user, p) {
    need(user, 'hr');
    DB.remove('News', function (x) { return x.id === p.id; });
    return { ok: true };
  }

  // ---------------------------------------------------------------- ตั้งค่าระบบ (เจ้าของร้าน / HR)
  var CONFIG_EDITABLE = ['shopName', 'payerName', 'payerTaxId', 'payerAddress', 'shopLat', 'shopLng', 'radiusM', 'maxAccuracyM', 'earliestCheckinMin', 'hoursPerDay', 'otRoundMin', 'overstayNotifyMin', 'lateLimitPerYear',
    'mealAllowance', 'payDeductLate', 'ssoEnabled', 'ssoRate', 'ssoMin', 'ssoCap', 'attBonus', 'attBonusLateMax', 'taxAuto',
    'taxPersonal', 'taxExpenseRate', 'taxExpenseCap',
    'usePositionAllowance', 'useFixedAllowance', 'useAttBonus', 'usePvd', 'useOtherIncome', 'useAdvance', 'useLoan',
    'useOT', 'useMeal', 'useServiceCharge', 'useTips', 'useBonus', 'useAbsenceDeduct', 'useTax', 'useOtherDeduct',
    'liffId', 'lineLoginChannelId'];
  var NUM_KEYS = { shopLat: [-90, 90], shopLng: [-180, 180], radiusM: [20, 2000], maxAccuracyM: [10, 2000], earliestCheckinMin: [0, 240], hoursPerDay: [1, 12],
    otRoundMin: [1, 60], overstayNotifyMin: [1, 120], lateLimitPerYear: [0, 50], mealAllowance: [0, 20000], ssoRate: [0, 20], ssoMin: [0, 100000], ssoCap: [0, 1000000],
    attBonus: [0, 100000], attBonusLateMax: [0, 600], taxPersonal: [0, 1000000], taxExpenseRate: [0, 100], taxExpenseCap: [0, 1000000] };

  function settings(user) {
    need(user, 'hr');
    var used = {}; DB.all('Schedule').forEach(function (r) { used[r.shift] = (used[r.shift] || 0) + 1; });
    var c = {}; DB.all('Config').forEach(function (r) { c[r.key] = { value: r.value, note: r.note }; });
    return { config: c, shifts: DB.all('ShiftTypes').map(function (s) { s.used = used[s.code] || 0; return s; }), policies: DB.all('LeavePolicy'),
             counts: { employees: DB.all('Employees').filter(active).length, holidays: DB.all('Holidays').length },
             };
  }

  function settingsSave(user, p) {
    need(user, 'hr');
    var cfgIn = p.config || {}, errs = [];
    Object.keys(cfgIn).forEach(function (k) {
      if (CONFIG_EDITABLE.indexOf(k) < 0) { errs.push('แก้ค่า ' + k + ' ไม่ได้'); return; }
      var v = String(cfgIn[k] === null || cfgIn[k] === undefined ? '' : cfgIn[k]).trim();
      if (NUM_KEYS[k] && v !== '') { var n = +v; if (!isFinite(n) || n < NUM_KEYS[k][0] || n > NUM_KEYS[k][1]) errs.push(k + ' ต้องเป็นตัวเลขระหว่าง ' + NUM_KEYS[k][0] + '–' + NUM_KEYS[k][1]); }
      if (k === 'payerTaxId' && v !== '' && !/^\d{13}$/.test(v.replace(/\D/g, ''))) errs.push('เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
      if ((k === 'payDeductLate' || k === 'ssoEnabled' || k === 'taxAuto' || PAY_ITEMS[k]) && v !== 'yes' && v !== 'no') errs.push(k + ' ต้องเป็น yes หรือ no');
      cfgIn[k] = v;
    });
    var shifts = p.shifts, policies = p.policies, codes = {};
    if (shifts) shifts.forEach(function (s, i) {
      s.code = String(s.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,4}$/.test(s.code) || s.code === 'OFF') errs.push('กะแถว ' + (i + 1) + ': รหัสกะใช้ตัวอักษร/ตัวเลข 1–4 ตัว และห้ามใช้ OFF');
      if (codes[s.code]) errs.push('รหัสกะ ' + s.code + ' ซ้ำ'); codes[s.code] = 1;
      var HM = /^([01]\d|2[0-3]):[0-5]\d$/;
      ['start', 'end'].forEach(function (f) { if (!HM.test(s[f] || '')) errs.push('กะ ' + s.code + ': เวลา' + (f === 'start' ? 'เข้า' : 'ออก') + 'ต้องเป็น HH:mm'); });
      ['breakStart', 'breakEnd'].forEach(function (f) { if (s[f] && !HM.test(s[f])) errs.push('กะ ' + s.code + ': เวลาพักต้องเป็น HH:mm'); });
      if (s.start && s.end && s.end <= s.start) errs.push('กะ ' + s.code + ': เวลาออกต้องหลังเวลาเข้า');
    });
    if (shifts) {
      var used = {}; DB.all('Schedule').forEach(function (r) { used[r.shift] = 1; });
      Object.keys(used).forEach(function (code) { if (code !== 'OFF' && !codes[code]) errs.push('ลบกะ ' + code + ' ไม่ได้ เพราะยังมีในตารางกะ (เปลี่ยนตารางกะก่อน)'); });
    }
    var types = {};
    if (policies) policies.forEach(function (pl, i) {
      if (!pl.type || !pl.name) errs.push('ประเภทลาแถว ' + (i + 1) + ': กรอกรหัสและชื่อ');
      if (types[pl.type]) errs.push('รหัสประเภทลา ' + pl.type + ' ซ้ำ'); types[pl.type] = 1;
    });
    if (errs.length) throw err(errs.join('\n'));
    return PLATFORM.lock(function () {
      Object.keys(cfgIn).forEach(function (k) {
        var m = function (r) { return r.key === k; };
        if (DB.all('Config').some(m)) DB.update('Config', m, { value: cfgIn[k] }); else DB.insert('Config', { key: k, value: cfgIn[k], note: '' });
      });
      if (shifts) { DB.remove('ShiftTypes', function () { return true; }); shifts.forEach(function (s) { DB.insert('ShiftTypes', { code: s.code, name: s.name || '', start: s.start, end: s.end, breakStart: s.breakStart || '', breakEnd: s.breakEnd || '', graceMin: +s.graceMin || 0 }); }); }
      if (policies) { DB.remove('LeavePolicy', function () { return true; }); policies.forEach(function (pl) { DB.insert('LeavePolicy', pl); }); }
      var now = PLATFORM.now();
      DB.insert('AttendanceLog', { at: now.date + ' ' + now.time, by: user.id, empId: '', date: now.date, field: 'settings', oldValue: '', newValue: Object.keys(cfgIn).concat(shifts ? ['ShiftTypes'] : [], policies ? ['LeavePolicy'] : []).join(', '), reason: 'แก้ไขหน้าตั้งค่า' });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- dispatcher
  var PUBLIC = { bind: true };
  var ROUTES = {
    me: me, notifications: notifications, payroll: payroll, payrollAdjust: payrollAdjust, payrollPublish: payrollPublish, servicePoolSave: servicePoolSave, payrollUnpublish: payrollUnpublish, mySlips: mySlips, mySlip: mySlip, slipAck: slipAck, tax50: tax50, pnd1: pnd1, pnd1a: pnd1a, news: news, newsAdmin: newsAdmin, newsSave: newsSave, newsDelete: newsDelete, settings: settings, settingsSave: settingsSave, clock: clock, month: month, leavePolicies: leavePolicies, leaveBalances: leaveBalances, leavePreview: leavePreview, leaveCreate: leaveCreate, leaveCancel: leaveCancel,
    otCreate: otCreate, pending: pending, decide: decide, approveOverstay: approveOverstay,
    employees: employees, employeeGet: employeeGet, employeeSave: employeeSave, employeeNewCode: employeeNewCode,
    schedule: schedule, scheduleSet: scheduleSet, defaultShiftSave: defaultShiftSave, scheduleCopyWeek: scheduleCopyWeek,
    holidays: holidays, holidaySave: holidaySave, holidayDelete: holidayDelete, swapSave: swapSave, swapDelete: swapDelete,
    dashboard: dashboard, attendanceEdit: attendanceEdit, attendanceLog: attendanceLog
  };

  /** req = { action, idToken, payload } → { ok, data } หรือ { ok:false, error, needBind } */
  function handle(req) {
    try {
      var fn = ROUTES[req.action];
      if (!fn && !PUBLIC[req.action]) throw err('ไม่รู้จักคำสั่ง ' + req.action);
      var lineUserId = PLATFORM.verifyIdToken(req.idToken);
      if (!lineUserId) throw err('เข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาเปิดจาก LINE ใหม่อีกครั้ง');
      if (req.action === 'bind') return { ok: true, data: bind(lineUserId, req.payload || {}) };
      var user = DB.all('Employees').filter(function (e) { return e.lineUserId === lineUserId && active(e); })[0];
      if (!user) return { ok: false, needBind: true, error: 'ยังไม่ได้ลงทะเบียนเข้าใช้งาน กรุณากรอกรหัสเข้าใช้งานครั้งแรก' };
      return { ok: true, data: fn(user, req.payload || {}) };
    } catch (e) {
      return { ok: false, error: e.userFacing ? e.message : 'เกิดข้อผิดพลาด: ' + e.message };
    }
  }

  return { handle: handle, LEAVE_STATUS_TH: LEAVE_STATUS_TH };
})();

if (typeof module !== 'undefined') module.exports = Api;
