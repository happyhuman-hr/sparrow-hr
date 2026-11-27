/**
 * slip.js — หน้าตาสลิปเงินเดือน ใช้ร่วมกันระหว่างหน้ารายงานเงินเดือน (เจ้าของร้าน/HR) และหน้าสลิปของพนักงาน
 * App.slipHtml(row, month, shopName, { autoPrint, note }) → เอกสาร HTML ทั้งหน้า (ขนาด A4 พิมพ์/บันทึก PDF ได้)
 */
(function () {
  function m2(x) { return (+x || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  App.slipHtml = function (r, month, shopName, opts) {
    opts = opts || {};
    var esc = App.esc;
    var d1 = function (x) { return (+x || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 }); };
    var line = function (l, v, neg) { return '<tr><td>' + l + '</td><td class="n">' + (neg && v ? '−' : '') + m2(v) + '</td></tr>'; };
    var inc = [['ค่าจ้าง' + (r.payType === 'daily' ? ' (' + Math.round((r.workedDays + r.paidLeaveDays + r.paidHolidayDays) * 100) / 100 + ' วัน × ' + App.num(r.wage) + ')' : ''), r.base], ['ค่าตำแหน่ง', r.positionAllowance],
               ['ค่าโทรศัพท์/เดินทางประจำ', r.fixedAllowance], ['ค่าล่วงเวลา (' + App.fmtMin(r.otMin + r.holidayWorkMin + r.holidayOtMin) + ')', r.otPay], ['เบี้ยขยัน', r.attBonus], ['ค่าอาหาร', r.meal],
               ['Service charge', r.serviceCharge], ['ทิป', r.tips], ['โบนัส / คอมมิชชั่น', r.bonus], ['รายได้อื่น', r.otherIncome]];
    var ded = [['หักขาดงาน / ลาไม่รับค่าจ้าง', r.absenceDeduct], ['หักมาสาย / กลับก่อน (' + (r.lateMin + r.earlyMin) + ' นาที)', r.lateDeduct], ['ประกันสังคม', r.sso], ['ภาษีหัก ณ ที่จ่าย', r.tax],
               ['กองทุนสำรองเลี้ยงชีพ', r.pvd], ['เบิกเงินล่วงหน้า', r.advance], ['เงินกู้ กยศ. / สหกรณ์', r.loan], ['หักอื่น ๆ', r.otherDeduct]];
    var ti = r.taxInfo || {};
    var taxSteps = r.taxManual ? '<p class="sub">ภาษีเดือนนี้กำหนดโดย HR</p>' : '<table class="tax">' +
      [['① เงินได้ทั้งปี (ประมาณการ)', ti.income], ['② หักค่าใช้จ่าย', -ti.expense], ['③ ลดหย่อนส่วนตัว', -ti.personal], ['④ ลดหย่อนคู่สมรส', -ti.spouse], ['⑤ ลดหย่อนบุตร', -ti.child],
       ['⑥ ประกันสังคม', -ti.sso], ['⑦ กองทุนสำรองฯ', -ti.pvd], ['⑧ เบี้ยประกันชีวิต', -ti.insurance], ['⑨ เงินได้สุทธิ', ti.net], ['⑩ ภาษีทั้งปี', ti.tax]]
        .filter(function (x) { return x[1]; }).map(function (x) { return '<tr><td>' + x[0] + '</td><td class="n">' + m2(x[1]) + '</td></tr>'; }).join('') +
      '<tr><td><b>ภาษีหักเดือนนี้</b>' + (r.bonus ? ' (รวมภาษีโบนัส)' : ' (⑩ ÷ 12)') + '</td><td class="n"><b>' + m2(r.tax) + '</b></td></tr></table>';
    var imgBase = location.href.replace(/[^/]*$/, '');
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>สลิปเงินเดือน ' + esc(r.name) + ' ' + month + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&family=EB+Garamond:wght@500&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:12mm}body{font:12.5px/1.5 "IBM Plex Sans Thai Looped",sans-serif;color:#231b1b;margin:0;padding:18px;max-width:760px;background:#fff}h1{font:500 24px "EB Garamond",serif;color:#7a1c2b;margin:0}' +
      '.top{display:flex;align-items:center;gap:12px;border-bottom:2px solid #7a1c2b;padding-bottom:10px;margin-bottom:12px}.top img{height:48px}.sub{color:#8d8079;font-size:11.5px}' +
      'table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #eee}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:8px}h3{margin:12px 0 4px;font-size:13px;color:#7a1c2b}' +
      '.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}.net{margin-top:14px;padding:10px 12px;background:#f5e6e4;border-radius:10px;display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:16px;color:#7a1c2b}' +
      '.sig{display:flex;justify-content:space-between;margin-top:36px;font-size:12px}.sig div{width:40%;text-align:center;border-top:1px solid #999;padding-top:4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px}' +
      '.tax td{font-size:11.5px;color:#4d4040}@media(max-width:560px){.cols,.meta{grid-template-columns:1fr;gap:0}body{padding:12px}}</style></head><body>' +
      '<div class="top"><img src="' + imgBase + 'img/sparrow-mark-wine.png" alt=""><div><h1>' + esc(shopName) + '</h1><div class="sub">สลิปเงินเดือน · ' + App.monthTH(month) + (opts.payDate ? ' · จ่ายวันที่ ' + App.dateTH(opts.payDate) : '') + '</div></div></div>' +
      '<div class="meta"><div>ชื่อ: <b>' + esc(r.name) + '</b></div><div>รหัส: ' + r.empId + '</div><div>ตำแหน่ง: ' + esc(r.position) + (r.department ? ' · ' + esc(r.department) : '') + '</div>' +
      '<div>ประเภท: ' + (r.payType === 'daily' ? 'รายวัน' : 'รายเดือน') + ' (' + App.num(r.wage) + ' บาท)</div><div>มาทำงาน: ' + d1(r.workedDays) + ' / ' + r.workDays + ' วัน · ลา ' + (r.paidLeaveDays + r.unpaidLeaveDays) + ' · ขาด ' + r.absentDays + '</div>' +
      '<div>' + (r.bankName ? 'โอนเข้า: ' + esc(r.bankName) + (r.bankAccount ? ' ' + esc(r.bankAccount) : '') : '') + '</div></div>' +
      '<div class="cols"><div><h3>รายได้</h3><table>' + inc.filter(function (x) { return +x[1]; }).map(function (x) { return line(x[0], x[1]); }).join('') + line('<b>รวมรายได้</b>', r.income) + '</table></div>' +
      '<div><h3>รายการหัก</h3><table>' + ded.filter(function (x) { return +x[1]; }).map(function (x) { return line(x[0], x[1], true); }).join('') + line('<b>รวมรายการหัก</b>', r.deductions, true) + '</table></div></div>' +
      '<div class="net"><span>เงินได้สุทธิ (โอนเข้าบัญชี)</span><span>' + m2(r.net) + ' บาท</span></div>' + (r.note ? '<p class="sub">หมายเหตุ: ' + esc(r.note) + '</p>' : '') +
      '<h3>วิธีคำนวณภาษีหัก ณ ที่จ่าย (ประมาณการทั้งปี)</h3>' + taxSteps +
      '<div class="sig"><div>ผู้จ่ายเงิน</div><div>ผู้รับเงิน</div></div>' +
      '<p class="sub" style="margin-top:18px;text-align:center">เอกสารนี้ออกโดยระบบ The Sparrow HR' + (opts.note ? ' · ' + esc(opts.note) : '') + '</p>' +
      (opts.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>' : '') + '</body></html>';
  };

  /** สลิป Service charge & ทิป (จ่ายแยกรอบ วันที่ 10 ของเดือนถัดไป) — ไม่แสดงยอดรวมของร้าน */
  App.scSlipHtml = function (r, month, shopName, payDate, opts) {
    opts = opts || {};
    var esc = App.esc, ti = r.taxInfo || null;
    var line = function (l, v, neg) { return '<tr><td>' + l + '</td><td class="n">' + (neg && v ? '−' : '') + m2(v) + '</td></tr>'; };
    var imgBase = location.href.replace(/[^/]*$/, '');
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>สลิป Service charge & ทิป ' + esc(r.name) + ' ' + month + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&family=EB+Garamond:wght@500&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:12mm}body{font:12.5px/1.5 "IBM Plex Sans Thai Looped",sans-serif;color:#231b1b;margin:0;padding:18px;max-width:760px;background:#fff}h1{font:500 24px "EB Garamond",serif;color:#7a1c2b;margin:0}' +
      '.top{display:flex;align-items:center;gap:12px;border-bottom:2px solid #7a1c2b;padding-bottom:10px;margin-bottom:12px}.top img{height:48px}.sub{color:#8d8079;font-size:11.5px}' +
      'table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #eee}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:8px}h3{margin:12px 0 4px;font-size:13px;color:#7a1c2b}' +
      '.net{margin-top:14px;padding:10px 12px;background:#f5e6e4;border-radius:10px;display:flex;justify-content:space-between;gap:8px;font-weight:700;font-size:16px;color:#7a1c2b}' +
      '.sig{display:flex;justify-content:space-between;margin-top:36px;font-size:12px}.sig div{width:40%;text-align:center;border-top:1px solid #999;padding-top:4px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px}' +
      '@media(max-width:560px){.meta{grid-template-columns:1fr}body{padding:12px}}</style></head><body>' +
      '<div class="top"><img src="' + imgBase + 'img/sparrow-mark-wine.png" alt=""><div><h1>' + esc(shopName) + '</h1><div class="sub">สลิป Service charge & ทิป · งวด ' + App.monthTH(month) + ' · จ่ายวันที่ ' + App.dateTH(payDate) + '</div></div></div>' +
      '<div class="meta"><div>ชื่อ: <b>' + esc(r.name) + '</b></div><div>รหัส: ' + r.empId + '</div><div>ตำแหน่ง: ' + esc(r.position || '') + (r.department ? ' · ' + esc(r.department) : '') + '</div>' +
      '<div>มาทำงานในงวดนี้: ' + (+r.workedDays || 0).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + ' วัน</div>' +
      '<div>' + (r.bankName ? 'โอนเข้า: ' + esc(r.bankName) + (r.bankAccount ? ' ' + esc(r.bankAccount) : '') : '') + '</div></div>' +
      '<h3>รายได้</h3><table>' + (+r.serviceCharge ? line('Service charge', r.serviceCharge) : '') + (+r.tips ? line('ทิป', r.tips) : '') + line('<b>รวม</b>', r.income) + '</table>' +
      '<h3>รายการหัก</h3><table>' + line('ภาษีหัก ณ ที่จ่าย', r.tax, true) + '</table>' +
      '<div class="net"><span>เงินได้สุทธิ (โอนเข้าบัญชี)</span><span>' + m2(r.net) + ' บาท</span></div>' +
      '<p class="sub">ส่วนแบ่งคิดตามจำนวนวันที่มาทำงานจริงในงวด · Service charge และทิปไม่นับเป็นค่าจ้าง จึงไม่หักประกันสังคม แต่เป็นเงินได้ที่ต้องเสียภาษี' +
        (ti ? ' · ภาษีที่หัก = (ภาษีทั้งปีเมื่อรวม SC/ทิป ' + m2(ti.taxAfter) + ' − ภาษีทั้งปีจากเงินเดือนอย่างเดียว ' + m2(ti.taxBefore) + ') ÷ 12' : '') + '</p>' +
      '<div class="sig"><div>ผู้จ่ายเงิน</div><div>ผู้รับเงิน</div></div>' +
      '<p class="sub" style="margin-top:18px;text-align:center">เอกสารนี้ออกโดยระบบ The Sparrow HR' + (opts.note ? ' · ' + esc(opts.note) : '') + '</p>' +
      (opts.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>' : '') + '</body></html>';
  };

  /** เปิดสลิปในหน้าต่างใหม่แล้วสั่งพิมพ์ (หน้ารายงานเงินเดือน) */
  App.openSlip = function (r, month, shopName) {
    var w = window.open('', '_blank');
    if (!w) return App.toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', true);
    w.document.write(App.slipHtml(r, month, shopName, { autoPrint: true })); w.document.close();
  };
})();
