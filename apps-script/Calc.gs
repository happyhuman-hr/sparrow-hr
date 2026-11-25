/**
 * Calc.gs — กติกาคำนวณเวลาทำงาน / OT / วันลา ของ The Sparrow
 * เป็น pure function ทั้งหมด (ไม่แตะ Sheet) ใช้ได้ทั้งใน Apps Script และในเบราว์เซอร์ (ไฟล์ทดสอบ/โหมดตัวอย่าง)
 *
 * รูปแบบข้อมูล: วันที่ 'yyyy-MM-dd' · เวลา 'HH:mm' หรือ 'HH:mm:ss' (เวลาไทย)
 */
var Calc = (function () {

  // ---------------------------------------------------------------- helpers
  function toSec(t) {
    if (t === null || t === undefined || t === '') return null;
    var p = String(t).split(':');
    return (+p[0]) * 3600 + (+p[1] || 0) * 60 + (+p[2] || 0);
  }
  function toMin(t) { var s = toSec(t); return s === null ? null : Math.floor(s / 60); }
  function fmtMin(m) {               // 135 -> "2 ชม. 15 นาที"
    m = Math.round(m || 0);
    if (!m) return '0';
    var h = Math.floor(m / 60), r = m % 60;
    return (h ? h + ' ชม.' : '') + (h && r ? ' ' : '') + (r ? r + ' นาที' : '');
  }
  function hhmm(min) { var h = Math.floor(min / 60), m = min % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  function parseDate(d) { var p = String(d).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(d, n) { var x = parseDate(d); x.setUTCDate(x.getUTCDate() + n); return fmtDate(x); }
  function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); } // b - a
  function weekday(d) { return parseDate(d).getUTCDay(); } // 0=อาทิตย์ 1=จันทร์
  function eachDay(start, end) { var out = []; for (var d = start; d <= end; d = addDays(d, 1)) out.push(d); return out; }
  function floorTo(m, step) { return Math.floor(m / step) * step; }

  /** ระยะทางระหว่าง 2 พิกัด (เมตร) — สูตร haversine */
  function distanceM(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** ตรวจจุด check-in: ต้องอยู่ในรัศมี และ GPS ต้องแม่นพอ */
  function checkGeofence(lat, lng, acc, cfg) {
    var shopLat = +cfg.shopLat, shopLng = +cfg.shopLng, radius = +cfg.radiusM || 100;
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, reason: 'ไม่ได้รับตำแหน่ง GPS กรุณาเปิดการเข้าถึงตำแหน่ง' };
    var d = Math.round(distanceM(+lat, +lng, shopLat, shopLng));
    var maxAcc = +cfg.maxAccuracyM || radius;
    if (acc && +acc > maxAcc) return { ok: false, distance: d, reason: 'สัญญาณ GPS ไม่แม่นพอ (±' + Math.round(acc) + ' ม.) ลองออกไปที่โล่งแล้วกดใหม่' };
    if (d > radius) return { ok: false, distance: d, reason: 'อยู่ห่างจากร้าน ' + d + ' ม. (ต้องไม่เกิน ' + radius + ' ม.)' };
    return { ok: true, distance: d };
  }

  // ---------------------------------------------------------------- อายุงาน / อัตราค่าจ้าง
  function tenure(startDate, today) {
    if (!startDate) return null;
    var s = parseDate(startDate), t = parseDate(today);
    if (t < s) return { y: 0, m: 0, d: 0, days: 0, text: 'ยังไม่เริ่มงาน' };
    var y = t.getUTCFullYear() - s.getUTCFullYear(), m = t.getUTCMonth() - s.getUTCMonth(), d = t.getUTCDate() - s.getUTCDate();
    if (d < 0) { m--; d += new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).getUTCDate(); }
    if (m < 0) { y--; m += 12; }
    var parts = [];
    if (y) parts.push(y + ' ปี'); if (m) parts.push(m + ' เดือน'); if (d || !parts.length) parts.push(d + ' วัน');
    return { y: y, m: m, d: d, days: diffDays(startDate, today), text: parts.join(' ') };
  }

  /** ค่าจ้างต่อชั่วโมง: รายเดือน = เงินเดือน/30/ชม.ต่อวัน · รายวัน = ค่าจ้างรายวัน/ชม.ต่อวัน */
  /**
   * ค่าจ้างต่อชั่วโมง (ใช้คิด OT และหักสาย) ตามข้อบังคับฯ: ชั่วโมงทำงานจริงของกะประจำ (เวลาเลิก − เวลาเข้า − เวลาพัก เช่น 10:30–20:30 พัก 1 ชม. = 9 ชม.)
   * รายเดือน = เงินเดือน ÷ 30 ÷ ชม.ต่อวัน · รายวัน = ค่าแรงรายวัน ÷ ชม.ต่อวัน · ถ้าไม่มีกะประจำใช้ค่า hoursPerDay ในหน้าตั้งค่า
   */
  function shiftHours(s) {
    if (!s || !s.start || !s.end) return 0;
    var m = toMin(s.end) - toMin(s.start);
    if (s.breakStart && s.breakEnd) m -= toMin(s.breakEnd) - toMin(s.breakStart);
    return m > 0 ? m / 60 : 0;
  }
  function hourlyRate(emp, cfg) {
    var h = +emp.shiftHours || +cfg.hoursPerDay || 9, w = +emp.wage || 0;
    return emp.payType === 'daily' ? w / h : w / 30 / h;
  }

  // ---------------------------------------------------------------- สถานะของวัน
  /**
   * ctx = { schedule: {empId|date: code}, holidays: {date: {name, mode, substituteDate}},
   *         swaps: [{holidayDate, empId, mode, substituteDate}], leaves: [approved leave rows], shifts: {code: shiftRow} }
   * คืนค่า { kind, shift, holiday, holidayPay, leave, halfLeave }
   *   kind: work | weekly_off | holiday | sub_off | leave | unscheduled
   */
  function holidayModeFor(empId, date, ctx) {
    var h = ctx.holidays[date];
    if (!h) return null;
    var own = null, all = null;
    (ctx.swaps || []).forEach(function (s) {
      if (s.holidayDate !== date) return;
      if (String(s.empId) === String(empId)) own = s; else if (s.empId === '*' || s.empId === '') all = s;
    });
    var s = own || all;
    return { name: h.name, mode: s ? s.mode : (h.mode || 'dayoff'), substituteDate: s ? s.substituteDate : h.substituteDate };
  }

  function isSubstituteOff(empId, date, ctx) {
    // วันนี้เป็นวันหยุดชดเชยของวันหยุดตามประเพณีวันใดหรือไม่
    for (var hd in ctx.holidays) {
      var m = holidayModeFor(empId, hd, ctx);
      if (m && m.mode === 'substitute' && m.substituteDate === date) return { holidayDate: hd, name: m.name };
    }
    return null;
  }

  function leaveOn(empId, date, ctx) {
    var list = ctx.leaves || [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (String(l.empId) === String(empId) && l.status === 'approved' && l.startDate <= date && date <= l.endDate) return l;
    }
    return null;
  }

  /**
   * กะของวัน: ถ้ามีการแก้รายวันในตาราง (Schedule) ใช้ค่านั้น ไม่มีก็ใช้ "กะประจำ" ของพนักงาน
   * ctx.defaults[empId] = { shift: 'B', off: [1, 3], from: วันเริ่มงาน, to: วันพ้นสภาพ }  (off: 0=อาทิตย์ … 6=เสาร์)
   */
  function shiftCodeFor(empId, date, ctx) {
    var code = ctx.schedule[empId + '|' + date];
    if (code !== undefined && code !== '') return { code: code, manual: true };
    var d = ctx.defaults && ctx.defaults[empId];
    if (!d || (d.from && date < d.from) || (d.to && date > d.to)) return { code: undefined, manual: false };
    if ((d.off || []).indexOf(weekday(date)) >= 0) return { code: 'OFF', manual: false };
    // แม่บ้านทำงาน 5.5 วัน/สัปดาห์: วันทำงานครึ่งวัน 1 วัน (กะครึ่งวัน 15:00–22:00)
    if (d.half !== undefined && d.half !== null && d.half !== '' && +d.half === weekday(date)) return { code: d.halfShift || 'H', manual: false };
    return { code: d.shift || undefined, manual: false };
  }
  function parseOffDays(v) { return String(v || '').split(/[,\s]+/).filter(function (x) { return x !== ''; }).map(Number).filter(function (n) { return n >= 0 && n <= 6; }); }

  function dayInfo(empId, date, ctx) {
    var sc = shiftCodeFor(empId, date, ctx), code = sc.code;
    var shift = code && code !== 'OFF' ? (ctx.shifts[code] || null) : null;
    var info = { date: date, kind: 'unscheduled', shift: shift, shiftCode: code || '', manual: sc.manual, holiday: null, holidayPay: false, leave: null, halfLeave: '' };

    var lv = leaveOn(empId, date, ctx);
    var hm = holidayModeFor(empId, date, ctx);
    var sub = isSubstituteOff(empId, date, ctx);

    if (hm) info.holiday = hm;
    if (hm && hm.mode === 'dayoff') { info.kind = 'holiday'; return info; }
    if (sub) { info.kind = 'sub_off'; info.holiday = { name: 'หยุดชดเชย ' + sub.name, mode: 'sub_off', from: sub.holidayDate }; return info; }
    if (code === 'OFF') { info.kind = 'weekly_off'; return info; }
    if (lv) {
      if (lv.half && lv.half !== 'none' && lv.startDate === lv.endDate) { info.halfLeave = lv.half; info.leave = lv; }
      else { info.kind = 'leave'; info.leave = lv; return info; }
    }
    if (shift) { info.kind = 'work'; info.holidayPay = !!(hm && hm.mode === 'paid'); }
    return info;
  }

  // ---------------------------------------------------------------- ประเมินวันทำงาน
  /** ช่วงเวลาที่ต้องอยู่ทำงาน (นาที) ปรับตามลาครึ่งวัน */
  function expectedWindow(info) {
    var s = info.shift; if (!s) return null;
    var start = toMin(s.start), end = toMin(s.end);
    var bS = toMin(s.breakStart), bE = toMin(s.breakEnd);
    if (info.halfLeave === 'am' && bE !== null) start = bE;   // ลาช่วงเช้า เข้างานหลังพัก
    if (info.halfLeave === 'pm' && bS !== null) end = bS;     // ลาช่วงบ่าย เลิกงานตอนพัก
    var breakMin = (bS !== null && bE !== null && start <= bS && bE <= end) ? (bE - bS) : 0;
    return { start: start, end: end, breakMin: breakMin, grace: +s.graceMin || 0 };
  }

  /**
   * att = {inTime, outTime} · otMin = นาทีที่อนุมัติ OT/ทำงานวันหยุดของวันนั้น
   * now = {date, time} ใช้แยกวันที่ยังมาไม่ถึง/วันนี้
   * คืนค่า { status, lateMin, earlyMin, overstayMin, unapprovedMin, otMin, holidayWorkMin, holidayOtMin, workedMin, flags }
   */
  function evaluateDay(info, att, approvedMin, now, cfg) {
    cfg = cfg || {};
    var step = +cfg.otRoundMin || 1, normalMin = (+cfg.hoursPerDay || 9) * 60;
    var r = { status: '', lateMin: 0, earlyMin: 0, overstayMin: 0, unapprovedMin: 0, otMin: 0, holidayWorkMin: 0, holidayOtMin: 0, workedMin: 0, countedIn: '', countedOut: '', flags: [] };
    var inM = att && att.inTime ? toMin(att.inTime) : null, outM = att && att.outTime ? toMin(att.outTime) : null;
    var future = info.date > now.date, isToday = info.date === now.date;
    approvedMin = +approvedMin || 0;

    // ---- วันหยุด (ประจำสัปดาห์ / ตามประเพณี / ชดเชย)
    if (info.kind === 'weekly_off' || info.kind === 'holiday' || info.kind === 'sub_off') {
      r.status = 'off';
      if (inM !== null) {
        if (outM === null) { r.status = isToday ? 'holiday_working' : 'incomplete'; r.flags.push(isToday ? '' : 'ไม่ได้บันทึกออกงาน'); return r; }
        var worked = Math.max(0, outM - inM - (outM - inM > 300 ? 60 : 0)); // ทำงานเกิน 5 ชม. หักพัก 1 ชม.
        r.workedMin = worked;
        var paid = floorTo(Math.min(worked, approvedMin), step);
        r.holidayWorkMin = Math.min(paid, normalMin);
        r.holidayOtMin = Math.max(0, paid - normalMin);
        r.unapprovedMin = Math.max(0, worked - paid);
        r.status = 'holiday_work';
        if (!approvedMin) r.flags.push('มาทำงานวันหยุดโดยไม่มีคำสั่ง/อนุมัติ');
      }
      return r;
    }
    if (info.kind === 'leave') { r.status = 'leave'; return r; }
    if (info.kind === 'unscheduled') {
      r.status = inM !== null ? 'unscheduled_work' : 'unscheduled';
      if (inM !== null) r.flags.push('ไม่มีกะในตาราง');
      return r;
    }

    // ---- วันทำงาน
    var w = expectedWindow(info);
    if (inM === null) {
      if (future) r.status = 'upcoming';
      else if (isToday) r.status = toMin(now.time) > w.end ? 'absent' : 'not_in';
      else r.status = 'absent';
      return r;
    }
    var inSec = toSec(att.inTime);
    r.lateMin = Math.max(0, Math.floor((inSec - w.start * 60) / 60) - w.grace);
    var cIn = Math.max(inM, w.start);
    r.countedIn = hhmm(cIn);

    if (outM === null) {
      r.status = isToday ? 'working' : 'incomplete';
      if (!isToday) r.flags.push('ไม่ได้บันทึกออกงาน — ไม่คิด OT จนกว่า HR จะแก้ไข');
      return r;
    }
    r.earlyMin = Math.max(0, w.end - outM);
    r.overstayMin = Math.max(0, outM - w.end);
    var cOut = Math.min(outM, w.end);
    r.countedOut = hhmm(cOut);
    r.workedMin = Math.max(0, cOut - cIn - w.breakMin);

    // OT = min(ชม.ที่อนุมัติ, เวลาที่อยู่เกินจริง) ปัดลงทีละ step
    var ot = floorTo(Math.min(r.overstayMin, approvedMin), step);
    if (info.holidayPay) { r.holidayOtMin = ot; r.holidayWorkMin = r.workedMin; } else r.otMin = ot;
    r.unapprovedMin = r.overstayMin - ot;

    r.status = r.lateMin > 0 ? 'late' : 'present';
    if (r.earlyMin > 0) r.flags.push('กลับก่อน ' + fmtMin(r.earlyMin));
    if (r.unapprovedMin >= Math.max(step, 1)) r.flags.push('อยู่เกินเวลา ' + fmtMin(r.unapprovedMin) + ' (ไม่ได้อนุมัติ OT)');
    return r;
  }

  /** เงิน OT/ทำงานวันหยุดโดยประมาณ */
  function otPay(res, emp, cfg) {
    var rate = hourlyRate(emp, cfg);
    var holidayX = emp.payType === 'daily' ? 2 : 1;
    return Math.round((res.otMin / 60 * rate * 1.5 + res.holidayWorkMin / 60 * rate * holidayX + res.holidayOtMin / 60 * rate * 3) * 100) / 100;
  }

  // ---------------------------------------------------------------- วันลา
  /** นับจำนวนวันลา (นับเฉพาะวันที่ต้องทำงาน) */
  function leaveDays(empId, startDate, endDate, half, ctx) {
    if (half && half !== 'none') return 0.5;
    var n = 0;
    eachDay(startDate, endDate).forEach(function (d) {
      var info = dayInfo(empId, d, Object.assign({}, ctx, { leaves: [] }));
      if (info.kind === 'work') n++;
      else if (info.kind === 'unscheduled' && weekday(d) !== 1) n++; // ยังไม่จัดกะ: นับทุกวันยกเว้นวันจันทร์ (วันหยุดประจำ)
    });
    return n;
  }

  /** ปีของสิทธิ์ลา = ปีปฏิทิน */
  function leaveBalance(emp, policies, leaves, today) {
    var year = today.slice(0, 4), ten = tenure(emp.startDate, today);
    return policies.map(function (p) {
      var used = 0, pending = 0;
      leaves.forEach(function (l) {
        if (String(l.empId) !== String(emp.id) || l.type !== p.type || String(l.startDate).slice(0, 4) !== year) return;
        if (l.status === 'approved') used += +l.days || 0;
        if (l.status === 'pending') pending += +l.days || 0;
      });
      var eligible = !p.minServiceDays || (ten && ten.days >= +p.minServiceDays);
      var quota = +p.daysPerYear || 0;
      return { type: p.type, name: p.name, quota: eligible ? quota : 0, used: used, pending: pending,
               remaining: eligible ? Math.max(0, quota - used) : 0, eligible: eligible, paid: p.paid,
               note: eligible ? '' : 'ใช้สิทธิ์ได้เมื่อทำงานครบ ' + Math.round(+p.minServiceDays / 365 * 10) / 10 + ' ปี' };
    });
  }

  /** ตรวจใบลาตามข้อบังคับฯ คืนรายการคำเตือน (ไม่บล็อก ให้หัวหน้าตัดสินใจ) */
  function validateLeave(req, emp, policy, balance, today) {
    var w = [];
    if (!policy) return ['ไม่พบประเภทการลานี้'];
    if (req.endDate < req.startDate) return ['วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'];
    var notice = diffDays(today, req.startDate);
    if (+policy.noticeDays && notice < +policy.noticeDays && req.type !== 'sick')
      w.push('ต้องแจ้งล่วงหน้าอย่างน้อย ' + policy.noticeDays + ' วัน (แจ้งล่วงหน้า ' + Math.max(0, notice) + ' วัน)');
    if (+policy.maxConsecutive && req.days > +policy.maxConsecutive)
      w.push(policy.name + ' ลาติดต่อกันได้ไม่เกิน ' + policy.maxConsecutive + ' วัน');
    if (+policy.docAfterDays && req.days >= +policy.docAfterDays && !req.fileUrl && !req.hasFile)
      w.push('ลา ' + policy.docAfterDays + ' วันขึ้นไปต้องแนบเอกสาร/ใบรับรองแพทย์');
    if (balance) {
      if (!balance.eligible) w.push(balance.note);
      else if (+balance.quota && req.days > balance.remaining - (balance.pending || 0))
        w.push('เกินสิทธิ์คงเหลือ (เหลือ ' + balance.remaining + ' วัน, รออนุมัติ ' + (balance.pending || 0) + ' วัน) ส่วนเกินอาจไม่ได้รับค่าจ้าง');
    }
    if (req.type === 'annual' && req.half === 'none' && req.days < 0.5) w.push('ลาพักร้อนขั้นต่ำครั้งละครึ่งวัน');
    return w;
  }

  // ---------------------------------------------------------------- เงินเดือน
  function r2(x) { return Math.round((+x || 0) * 100) / 100; }
  /** วันลาประเภทนี้จ่ายค่าจ้างได้สูงสุดกี่วันต่อปี: "ไม่ได้รับ…" = 0 · "ได้รับค่าจ้าง 60 วัน" = 60 · อื่น ๆ = สิทธิ์ต่อปี (0 = ไม่จำกัด) */
  function paidLeaveLimit(policy) {
    if (!policy) return 0;
    var t = String(policy.paid || '');
    if (/ไม่ได้รับ/.test(t)) return 0;
    var m = t.match(/(\d+)\s*วัน/);
    if (m) return +m[1];
    return +policy.daysPerYear > 0 ? +policy.daysPerYear : Infinity;
  }

  /**
   * แบ่งเงินกองกลาง (Service charge / ทิป) ตามน้ำหนัก ให้ผลรวมตรงยอดจริงทุกสตางค์
   * weights: [วันที่มาทำงานจริงของแต่ละคน ...] · คืนจำนวนเงินต่อคน (ทศนิยม 2 ตำแหน่ง)
   */
  function allocatePool(total, weights) {
    total = Math.round((+total || 0) * 100);
    var sumW = weights.reduce(function (a, w) { return a + Math.max(0, +w || 0); }, 0);
    if (!total || !sumW) return weights.map(function () { return 0; });
    var raw = weights.map(function (w) { return Math.max(0, +w || 0) / sumW * total; });
    var cents = raw.map(Math.floor), left = total - cents.reduce(function (a, c) { return a + c; }, 0);
    raw.map(function (r, i) { return [r - Math.floor(r), i]; }).sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; })
      .slice(0, left).forEach(function (x) { cents[x[1]]++; });               // เศษสตางค์ให้คนที่มีเศษมากที่สุดก่อน
    return cents.map(function (c) { return c / 100; });
  }

  // ---- ภาษีเงินได้บุคคลธรรมดา (ขั้นบันได) · ตรวจกับประกาศกรมสรรพากรปีปัจจุบัน
  var TAX_BRACKETS = [[0, 0], [150000, 0.05], [300000, 0.10], [500000, 0.15], [750000, 0.20], [1000000, 0.25], [2000000, 0.30], [5000000, 0.35]];
  function num(v, d) { return v === undefined || v === null || v === '' ? d : +v; }
  function taxOnNet(net) {
    var t = 0;
    for (var i = 0; i < TAX_BRACKETS.length; i++) {
      var lo = TAX_BRACKETS[i][0], hi = i + 1 < TAX_BRACKETS.length ? TAX_BRACKETS[i + 1][0] : Infinity;
      if (net > lo) t += (Math.min(net, hi) - lo) * TAX_BRACKETS[i][1];
    }
    return t;
  }
  /**
   * ภาษีทั้งปีแบบประมาณการ (ภ.ง.ด.1) เบื้องต้น: เงินได้ทั้งปี − ค่าใช้จ่าย 50% (สูงสุด 100,000) − ลดหย่อนส่วนตัว 60,000 − ประกันสังคม → เงินได้สุทธิ → ขั้นบันได
   * คืนรายละเอียดทุกขั้น เพื่อแสดงในสลิป
   */
  function incomeTax(annual, emp, ssoAnnual, pvdAnnual, cfg) {
    cfg = cfg || {};
    var d = {};
    d.income = annual;
    d.expense = Math.min(annual * num(cfg.taxExpenseRate, 50) / 100, num(cfg.taxExpenseCap, 100000));
    d.personal = num(cfg.taxPersonal, 60000);
    // ภาษีเบื้องต้น: หักค่าใช้จ่าย + ลดหย่อนส่วนตัว + ประกันสังคมเท่านั้น (ไม่คำนวณลดหย่อนอื่น — พนักงานใช้สิทธิ์เองตอนยื่น ภ.ง.ด.90/91)
    d.spouse = 0; d.child = 0;
    d.sso = Math.min(ssoAnnual, num(cfg.ssoTaxCap, num(cfg.ssoCap, 17500) * num(cfg.ssoRate, 5) / 100 * 12));
    d.pvd = 0; d.insurance = 0;
    d.totalDeduct = d.expense + d.personal + d.spouse + d.child + d.sso + d.pvd + d.insurance;
    d.net = Math.max(0, annual - d.totalDeduct);
    d.tax = r2(taxOnNet(d.net));
    return d;
  }

  /**
   * คำนวณเงินเดือน 1 คน 1 เดือน (แนวเดียวกับไฟล์ตัวอย่าง Payroll_Training_Sample)
   * input = { emp, days: [{date, info, result, paidLeave, unpaidLeave}] (ทุกวันของเดือน), cfg,
   *           adjust: {serviceCharge, bonus, otherIncome, tax, otherDeduct, advance, loan} }
   * emp: wage, payType, positionAllowance, fixedAllowance, pvdPercent, shiftHours
   */
  function payroll(input) {
    var emp = input.emp, cfg = input.cfg || {}, adj = input.adjust || {}, days = input.days;
    var monthDays = days.length, daily = emp.payType === 'daily', wage = +emp.wage || 0;
    var dayRate = daily ? wage : wage / 30, hourRate = hourlyRate(emp, cfg);
    var inJob = function (d) { return (!emp.startDate || d >= emp.startDate) && (!emp.endDate || d <= emp.endDate); };
    var p = { employedDays: 0, workDays: 0, workDaysSoFar: 0, workedDays: 0, absentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, paidHolidayDays: 0,
              lateMin: 0, earlyMin: 0, otMin: 0, holidayWorkMin: 0, holidayOtMin: 0 };
    days.forEach(function (d) {
      if (!inJob(d.date)) return;
      var r = d.result, i = d.info;
      p.employedDays++;
      if (i.kind === 'work' || i.kind === 'leave') { p.workDays++; if (r.status !== 'upcoming' && r.status !== 'not_in') p.workDaysSoFar++; }
      var worked = r.status === 'present' || r.status === 'late' || r.status === 'working' || r.status === 'incomplete';
      // รายวัน: วันที่ทำกะสั้นกว่ากะประจำ (เช่น ครึ่งวัน 15:00–22:00 = 7 ชม. จาก 9 ชม.) คิดค่าแรงตามสัดส่วนชั่วโมง
      var dayW = 1;
      if (daily && +emp.shiftHours && i.shift) { var sh = shiftHours(i.shift); if (sh && sh < +emp.shiftHours) dayW = sh / +emp.shiftHours; }
      if (worked) p.workedDays += (i.halfLeave ? 0.5 : 1) * dayW;
      if (r.status === 'absent') p.absentDays++;
      p.paidLeaveDays += d.paidLeave || 0; p.unpaidLeaveDays += d.unpaidLeave || 0;
      if (i.kind === 'holiday' || i.kind === 'sub_off') p.paidHolidayDays++;
      p.lateMin += r.lateMin || 0; p.earlyMin += r.earlyMin || 0;
      p.otMin += r.otMin || 0; p.holidayWorkMin += r.holidayWorkMin || 0; p.holidayOtMin += r.holidayOtMin || 0;
    });
    // ทำงานไม่ครบเดือน: ข้อบังคับฯ "จ่ายเงินเดือนตามอัตราส่วนวันทำงานในเดือนนั้น ๆ" → วันทำงานตามกะที่อยู่ในช่วงจ้าง ÷ วันทำงานตามกะทั้งเดือน
    var share = !monthDays ? 0 : p.employedDays >= monthDays ? 1
              : (+input.monthWorkDays ? Math.min(1, p.workDays / +input.monthWorkDays) : p.employedDays / monthDays);
    // ---- รายได้
    var base = daily ? dayRate * (p.workedDays + p.paidLeaveDays + p.paidHolidayDays) : wage * share;
    var posAllow = (+emp.positionAllowance || 0) * share;                       // ค่าตำแหน่ง (นับเป็นฐานประกันสังคม)
    var fixAllow = (+emp.fixedAllowance || 0) * share;                          // ค่าโทรศัพท์/เดินทางประจำ (ไม่นับฐานประกันสังคม)
    var used = function (k) { return String(cfg[k] || 'yes') !== 'no'; };       // รายการหลักที่ร้านปิดได้ในหน้าตั้งค่า (ค่าตั้งต้น = ใช้)
    var otPayAmt = !used('useOT') ? 0 : p.otMin / 60 * hourRate * 1.5 + p.holidayWorkMin / 60 * hourRate * (daily ? 2 : 1) + p.holidayOtMin / 60 * hourRate * 3;
    var attB = +cfg.attBonus || 0;                                              // เบี้ยขยัน: ไม่ขาด ไม่ลาไม่รับเงิน สายไม่เกินเกณฑ์
    var attBonus = attB && p.employedDays && !p.absentDays && !p.unpaidLeaveDays && p.lateMin <= num(cfg.attBonusLateMax, 30) ? attB : 0;
    var meal = +cfg.mealAllowance || 0;                                         // ค่าอาหาร (ข้อบังคับฯ: ไม่ถือเป็นค่าจ้าง)
    var mealAmt = used('useMeal') && meal && p.workDaysSoFar ? meal * Math.min(1, p.workedDays / p.workDaysSoFar) : 0;
    // Service charge และทิป: เงินจากลูกค้าที่ร้านรวบรวมแล้วจัดสรรให้ (ข้อบังคับฯ: ไม่ถือเป็นค่าจ้าง → ไม่นับฐานประกันสังคม แต่เป็นเงินได้ที่ต้องเสียภาษี)
    var sc = +adj.serviceCharge || 0, tips = +adj.tips || 0, bonus = +adj.bonus || 0, other = +adj.otherIncome || 0;
    // ---- หักขาด / ลาไม่รับเงิน / สาย
    var absenceDeduct = daily || !used('useAbsenceDeduct') ? 0 : dayRate * (p.absentDays + p.unpaidLeaveDays);
    var lateDeduct = String(cfg.payDeductLate || 'yes') === 'yes' ? (p.lateMin + p.earlyMin) / 60 * hourRate : 0;
    var income = base + posAllow + fixAllow + otPayAmt + attBonus + mealAmt + sc + tips + bonus + other;   // รวมรายได้ (ก่อนหัก)
    // ---- ประกันสังคม: ค่าจ้าง + ค่าตำแหน่ง + OT + เบี้ยขยัน + โบนัส/คอมมิชชั่น − หักขาด/ลา/สาย
    var ssoWage = Math.max(0, base + posAllow + otPayAmt + attBonus + bonus - absenceDeduct - lateDeduct);
    var ssoRate = num(cfg.ssoRate, 5);
    var ssoBase = ssoWage > 0 ? Math.min(num(cfg.ssoCap, 17500), Math.max(num(cfg.ssoMin, 1650), ssoWage)) : 0;
    var sso = String(cfg.ssoEnabled || 'yes') === 'yes' ? Math.round(ssoBase * ssoRate / 100) : 0;
    // ---- กองทุนสำรองเลี้ยงชีพ (เฉพาะรายเดือน % ของเงินเดือน)
    var pvd = !daily && +emp.pvdPercent ? r2(wage * (+emp.pvdPercent) / 100) : 0;
    // ---- ภาษีหัก ณ ที่จ่าย: อัตโนมัติ (เงินได้ประจำ ×12 · โบนัสคิดเพิ่มเฉพาะเดือนที่จ่าย) หรือกรอกเอง
    var regular = income - bonus - absenceDeduct - lateDeduct;
    var taxInfo = incomeTax(regular * 12, emp, sso * 12, pvd * 12, cfg);
    var taxAuto = taxInfo.tax / 12;
    if (bonus) taxAuto += Math.max(0, incomeTax(regular * 12 + bonus, emp, sso * 12, pvd * 12, cfg).tax - taxInfo.tax);
    taxAuto = String(cfg.taxAuto || 'yes') === 'yes' ? r2(taxAuto) : 0;
    var manualTax = adj.tax !== undefined && adj.tax !== null && adj.tax !== '';
    if (!used('useTax')) { taxAuto = 0; manualTax = false; }
    var tax = manualTax ? +adj.tax : taxAuto;
    var advance = +adj.advance || 0, loan = +adj.loan || 0, otherDeduct = +adj.otherDeduct || 0;
    var deductions = absenceDeduct + lateDeduct + sso + tax + pvd + advance + loan + otherDeduct;
    return Object.assign(p, {
      dayRate: r2(dayRate), hourRate: r2(hourRate), base: r2(base), positionAllowance: r2(posAllow), fixedAllowance: r2(fixAllow), otPay: r2(otPayAmt),
      attBonus: attBonus, meal: r2(mealAmt), serviceCharge: sc, tips: tips, bonus: bonus, otherIncome: other, income: r2(income),
      absenceDeduct: r2(absenceDeduct), lateDeduct: r2(lateDeduct), ssoWage: r2(ssoWage), sso: sso, tax: r2(tax), taxAuto: taxAuto, taxManual: manualTax,
      taxInfo: taxInfo, pvd: pvd, advance: advance, loan: loan, otherDeduct: otherDeduct,
      // gross = รายได้หลังหักขาด/ลา/สาย (ใช้กับยอดรวมเดิม) · deductions = รายการหักทั้งหมด (รวมขาด/สาย)
      gross: r2(income - absenceDeduct - lateDeduct), wages: r2(ssoWage), deductions: r2(r2(absenceDeduct) + r2(lateDeduct) + sso + r2(tax) + pvd + advance + loan + otherDeduct),
      net: r2(r2(income) - r2(r2(absenceDeduct) + r2(lateDeduct) + sso + r2(tax) + pvd + advance + loan + otherDeduct))
    });
  }

  /** สรุปรายเดือนของพนักงาน 1 คน */
  function summarize(rows, emp, cfg) {
    var s = { workDays: 0, present: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, absent: 0, incomplete: 0, leaveDays: 0,
              otMin: 0, holidayWorkMin: 0, holidayOtMin: 0, unapprovedMin: 0, otPay: 0, byLeave: {} };
    rows.forEach(function (d) {
      var r = d.result;
      if (d.info.kind === 'work') s.workDays++;
      if (r.status === 'present' || r.status === 'late') s.present++;
      if (r.lateMin > 0) { s.late++; s.lateMin += r.lateMin; }
      if (r.earlyMin > 0) { s.early++; s.earlyMin += r.earlyMin; }
      if (r.status === 'absent') s.absent++;
      if (r.status === 'incomplete') s.incomplete++;
      if (d.info.leave) {
        var days = d.info.halfLeave ? 0.5 : 1; s.leaveDays += days;
        s.byLeave[d.info.leave.type] = (s.byLeave[d.info.leave.type] || 0) + days;
      }
      s.otMin += r.otMin; s.holidayWorkMin += r.holidayWorkMin; s.holidayOtMin += r.holidayOtMin; s.unapprovedMin += r.unapprovedMin;
      s.otPay += otPay(r, emp, cfg);
    });
    s.otPay = Math.round(s.otPay);
    return s;
  }

  return {
    toSec: toSec, toMin: toMin, fmtMin: fmtMin, hhmm: hhmm, addDays: addDays, diffDays: diffDays, weekday: weekday, eachDay: eachDay,
    distanceM: distanceM, checkGeofence: checkGeofence, tenure: tenure, hourlyRate: hourlyRate,
    holidayModeFor: holidayModeFor, dayInfo: dayInfo, shiftCodeFor: shiftCodeFor, parseOffDays: parseOffDays, expectedWindow: expectedWindow, evaluateDay: evaluateDay, otPay: otPay,
    leaveDays: leaveDays, leaveBalance: leaveBalance, validateLeave: validateLeave, summarize: summarize, shiftHours: shiftHours, allocatePool: allocatePool, payroll: payroll, paidLeaveLimit: paidLeaveLimit, incomeTax: incomeTax, taxOnNet: taxOnNet
  };
})();

if (typeof module !== 'undefined') module.exports = Calc;
