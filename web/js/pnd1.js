/**
 * pnd1.js — ส่งออก ภ.ง.ด.1 รายเดือน (เงินได้ตามมาตรา 40(1))
 * App.pnd1Csv(d)   → ดาวน์โหลด CSV ตามช่องในใบแนบ ภ.ง.ด.1 (ใช้กรอกในโปรแกรม RD Prep / ส่งสำนักงานบัญชี)
 * App.pnd1Print(d) → เปิดหน้าใบสรุป + ใบแนบ ภ.ง.ด.1 พร้อมพิมพ์ (A4 แนวนอน)
 */
(function () {
  function m2(x) { return (+x || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function beDate(d) { var p = String(d).split('-'); return p[2] + '/' + p[1] + '/' + (+p[0] + 543); }
  function fmtId(id) { var d = String(id || ''); return d.length === 13 ? [d[0], d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d[12]].join('-') : d; }

  App.pnd1Csv = function (d) {
    var rows = [['ลำดับที่', 'เลขประจำตัวผู้เสียภาษีอากร (ผู้มีเงินได้)', 'คำนำหน้าชื่อ', 'ชื่อ', 'ชื่อสกุล', 'วันเดือนปีที่จ่าย', 'จำนวนเงินได้ที่จ่ายในครั้งนี้', 'จำนวนเงินภาษีที่หักและนำส่งในครั้งนี้', 'เงื่อนไข', 'รหัสพนักงาน']];
    d.list.forEach(function (x) {
      rows.push([x.seq, x.taxId ? '="' + x.taxId + '"' : '', x.prefix, x.firstName, x.lastName, beDate(x.payDate || d.payDate), x.income.toFixed(2), x.tax.toFixed(2), x.condition, x.empId]);
    });
    rows.push([]);
    rows.push(['รวม', '', '', d.count + ' ราย', '', '', d.totalIncome.toFixed(2), d.totalTax.toFixed(2)]);
    rows.push(['ผู้มีหน้าที่หักภาษี', d.payer.name, 'เลขประจำตัวผู้เสียภาษี', d.payer.taxId ? '="' + d.payer.taxId + '"' : '', 'เดือนที่จ่าย', App.monthTH(d.month)]);
    rows.push(['เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว']);
    App.downloadCSV('PND1_' + d.month + '_TheSparrow.csv', rows);
  };

  // ---------------------------------------------------------------- ภ.ง.ด.1ก รายปี
  App.pnd1aCsv = function (d) {
    var rows = [['ลำดับที่', 'เลขประจำตัวผู้เสียภาษีอากร (ผู้มีเงินได้)', 'คำนำหน้าชื่อ', 'ชื่อ', 'ชื่อสกุล', 'ที่อยู่ผู้มีเงินได้', 'จำนวนเงินได้ที่จ่ายทั้งปี', 'จำนวนเงินภาษีที่หักและนำส่งทั้งปี', 'เงื่อนไข', 'รหัสพนักงาน', 'จำนวนเดือนที่จ่าย']];
    d.list.forEach(function (x) {
      rows.push([x.seq, x.taxId ? '="' + x.taxId + '"' : '', x.prefix, x.firstName, x.lastName, x.address, x.income.toFixed(2), x.tax.toFixed(2), x.condition, x.empId, x.months]);
    });
    rows.push([]);
    rows.push(['รวม', '', '', d.count + ' ราย', '', '', d.totalIncome.toFixed(2), d.totalTax.toFixed(2)]);
    rows.push(['ผู้มีหน้าที่หักภาษี', d.payer.name, 'เลขประจำตัวผู้เสียภาษี', d.payer.taxId ? '="' + d.payer.taxId + '"' : '', 'ปีภาษี', 'พ.ศ. ' + (+d.year + 543)]);
    rows.push(['เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว']);
    App.downloadCSV('PND1A_' + d.year + '_TheSparrow.csv', rows);
  };

  App.pnd1aPrint = function (d) {
    var esc = App.esc, be = +d.year + 543;
    var pageRows = [], per = 7;                                                   // ใบแนบหน้าละ 7 ราย
    for (var i = 0; i < d.list.length; i += per) pageRows.push(d.list.slice(i, i + per));
    if (!pageRows.length) pageRows.push([]);
    var cover = '<section class="page"><h1>สรุปการยื่น ภ.ง.ด.1ก — แบบยื่นรายการภาษีเงินได้หัก ณ ที่จ่าย (รายปี)</h1>' +
      '<div class="sub">ตามมาตรา 58 (2) แห่งประมวลรัษฎากร · สำหรับการแสดงรายการเงินได้พึงประเมินตามมาตรา 40 (1) (2) ที่จ่ายในปีภาษี</div>' +
      '<div class="box">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย: <b>' + esc(d.payer.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร <b>' + (d.payer.taxId ? fmtId(d.payer.taxId) : '<span class="blank">ยังไม่ได้ใส่</span>') + '</b><br>' +
        'ที่อยู่ ' + esc(d.payer.address || '-') + '<br>ปีภาษี: <b>พ.ศ. ' + be + '</b> · ☑ ยื่นปกติ</div>' +
      '<table class="t"><thead><tr><th>ประเภทเงินได้</th><th>จำนวนราย</th><th>เงินได้ทั้งสิ้น</th><th>ภาษีที่นำส่งทั้งสิ้น</th></tr></thead><tbody>' +
        '<tr><td>1. เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ กรณีทั่วไป</td><td class="n">' + d.count + '</td><td class="n">' + m2(d.totalIncome) + '</td><td class="n">' + m2(d.totalTax) + '</td></tr>' +
        '<tr><td>2. เงินได้ตามมาตรา 40 (1) กรณีได้รับอนุมัติจากกรมสรรพากรให้หักอัตรา 3%</td><td></td><td></td><td></td></tr>' +
        '<tr><td>3. เงินได้ตามมาตรา 40 (1) (2) กรณีนายจ้างจ่ายให้ครั้งเดียวเพราะเหตุออกจากงาน</td><td></td><td></td><td></td></tr>' +
        '<tr><td>4. เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้เป็นผู้อยู่ในประเทศไทย</td><td></td><td></td><td></td></tr>' +
        '<tr><td>5. เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้มิได้เป็นผู้อยู่ในประเทศไทย</td><td></td><td></td><td></td></tr>' +
        '<tr class="tot"><td>รวม</td><td class="n">' + d.count + '</td><td class="n">' + m2(d.totalIncome) + '</td><td class="n">' + m2(d.totalTax) + '</td></tr></tbody></table>' +
      '<div class="box">มีใบแนบ ภ.ง.ด.1ก จำนวน <b>' + pageRows.length + '</b> แผ่น รวม <b>' + d.count + '</b> ราย · กำหนดยื่น: ภายในวันที่ ' + beDate(d.dueDate) + ' (ยื่นทางอินเทอร์เน็ตอาจได้ขยายเวลาตามประกาศกรมสรรพากร)</div>' +
      '<div class="sign">ลงชื่อ ......................................................... ผู้จ่ายเงิน<br>(.........................................................)<br>ตำแหน่ง ......................................... ยื่นวันที่ ........ / ........ / ............</div>' +
      (d.monthsMissing.length ? '<p class="warn">⚠️ ยังไม่มีสลิปที่ส่งแล้วของเดือน ' + d.monthsMissing.map(App.monthTH).join(', ') + ' — ยอดรวมทั้งปีจะยังไม่ครบ</p>' : '') + '</section>';
    var attach = pageRows.map(function (rows, pi) {
      var sub = rows.reduce(function (a, x) { a.i += x.income; a.t += x.tax; return a; }, { i: 0, t: 0 });
      return '<section class="page"><div class="row"><h1 style="flex:1">ใบแนบ ภ.ง.ด.1ก</h1><div>แผ่นที่ ' + (pi + 1) + ' ในจำนวน ' + pageRows.length + ' แผ่น</div></div>' +
        '<div class="sub">ผู้มีหน้าที่หักภาษี: <b>' + esc(d.payer.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + (d.payer.taxId ? fmtId(d.payer.taxId) : '-') + ' · สาขาที่ 00000 (สำนักงานใหญ่) · ปีภาษี พ.ศ. ' + be + ' · ประเภทเงินได้ ☑ (1) 40(1) กรณีทั่วไป</div>' +
        '<table class="t"><thead><tr><th>ลำดับที่</th><th>เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีเงินได้)</th><th>ชื่อผู้มีเงินได้</th><th>ที่อยู่ของผู้มีเงินได้</th><th>จำนวนเงินได้ที่จ่ายทั้งปี</th><th>จำนวนเงินภาษีที่หักและนำส่งทั้งปี</th><th>เงื่อนไข</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td class="c">' + x.seq + '</td><td class="c">' + (x.taxId ? fmtId(x.taxId) : '<span class="blank">ยังไม่มีเลขบัตร</span>') + '</td><td>' + esc(x.prefix + x.firstName + ' ' + x.lastName) + '</td>' +
            '<td class="addr">' + (x.address ? esc(x.address) : '<span class="blank">ยังไม่มีที่อยู่</span>') + '</td><td class="n">' + m2(x.income) + '</td><td class="n">' + m2(x.tax) + '</td><td class="c">' + x.condition + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td colspan="4" class="r">รวมยอดเงินได้และภาษีที่นำส่ง (นำไปรวมกับใบแนบ ภ.ง.ด.1ก แผ่นอื่น ถ้ามี)</td><td class="n">' + m2(sub.i) + '</td><td class="n">' + m2(sub.t) + '</td><td></td></tr></tbody></table>' +
        '<div class="note">เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว</div>' +
        '<div class="sign">ลงชื่อ ......................................................... ผู้จ่ายเงิน</div></section>';
    }).join('');
    openPrint('ภ.ง.ด.1ก ' + d.year, cover + attach);
  };

  function openPrint(title, body) {
    var html = '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>' + App.esc(title) + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4 landscape;margin:10mm}body{font:12px/1.5 "IBM Plex Sans Thai Looped",sans-serif;color:#111;margin:0}.page{padding:12px 16px;page-break-after:always}.page:last-child{page-break-after:auto}' +
      'h1{font-size:17px;margin:0 0 2px}.sub{font-size:11.5px;color:#333;margin-bottom:8px}.row{display:flex;align-items:baseline;gap:12px}.box{border:1px solid #333;border-radius:6px;padding:6px 10px;margin:6px 0}' +
      '.t{width:100%;border-collapse:collapse;margin:6px 0}.t th,.t td{border:1px solid #333;padding:5px 6px}.t th{background:#f2f2f2;font-size:11px}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.c{text-align:center;white-space:nowrap}.r{text-align:right}.addr{font-size:11px;max-width:300px}.tot td{font-weight:700}.blank{color:#b42318}.sign{margin-top:18px;text-align:right;line-height:2}.note{font-size:10.5px;color:#444}.warn{color:#b26a00}</style></head><body>' +
      body + '<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) return App.toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', true);
    w.document.write(html); w.document.close();
  }

  App.pnd1Print = function (d) {
    var esc = App.esc;
    var pageRows = [], per = 8;                                                   // ใบแนบหน้าละ 8 ราย
    for (var i = 0; i < d.list.length; i += per) pageRows.push(d.list.slice(i, i + per));
    if (!pageRows.length) pageRows.push([]);
    var cover = '<section class="page"><h1>สรุปการยื่น ภ.ง.ด.1 — แบบยื่นรายการภาษีเงินได้หัก ณ ที่จ่าย</h1>' +
      '<div class="sub">ตามมาตรา 58 (1) แห่งประมวลรัษฎากร · สำหรับการหักภาษี ณ ที่จ่าย ตามมาตรา 50 (1) กรณีการจ่ายเงินได้พึงประเมินตามมาตรา 40 (1)</div>' +
      '<div class="box">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย: <b>' + esc(d.payer.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร <b>' + (d.payer.taxId ? fmtId(d.payer.taxId) : '<span class="blank">ยังไม่ได้ใส่</span>') + '</b><br>' +
        'ที่อยู่ ' + esc(d.payer.address || '-') + '<br>เดือนที่จ่ายเงินได้พึงประเมิน: <b>' + App.monthTH(d.month) + '</b> · ☑ ยื่นปกติ</div>' +
      '<table class="t"><thead><tr><th>ประเภทเงินได้</th><th>จำนวนราย</th><th>เงินได้ทั้งสิ้น</th><th>ภาษีที่นำส่งทั้งสิ้น</th></tr></thead><tbody>' +
        '<tr><td>1. เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ กรณีทั่วไป</td><td class="n">' + d.count + '</td><td class="n">' + m2(d.totalIncome) + '</td><td class="n">' + m2(d.totalTax) + '</td></tr>' +
        '<tr><td>2. เงินได้ตามมาตรา 40 (1) กรณีได้รับอนุมัติจากกรมสรรพากรให้หักอัตรา 3%</td><td></td><td></td><td></td></tr>' +
        '<tr><td>3. เงินได้ตามมาตรา 40 (1) (2) กรณีนายจ้างจ่ายให้ครั้งเดียวเพราะเหตุออกจากงาน</td><td></td><td></td><td></td></tr>' +
        '<tr><td>4. เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้เป็นผู้อยู่ในประเทศไทย</td><td></td><td></td><td></td></tr>' +
        '<tr><td>5. เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้มิได้เป็นผู้อยู่ในประเทศไทย</td><td></td><td></td><td></td></tr>' +
        '<tr class="tot"><td>รวม</td><td class="n">' + d.count + '</td><td class="n">' + m2(d.totalIncome) + '</td><td class="n">' + m2(d.totalTax) + '</td></tr></tbody></table>' +
      '<div class="box">ภาษีที่นำส่งทั้งสิ้น (ตัวอักษร) <b>(' + (App.bahtText ? App.bahtText(d.totalTax) : m2(d.totalTax)) + ')</b> · มีใบแนบ ภ.ง.ด.1 จำนวน <b>' + pageRows.length + '</b> แผ่น รวม <b>' + d.count + '</b> ราย</div>' +
      '<div class="box">กำหนดยื่น: ภายในวันที่ 7 ของเดือนถัดไป (ยื่นทางอินเทอร์เน็ตได้ถึงวันที่ 15)</div>' +
      '<div class="sign">ลงชื่อ ......................................................... ผู้จ่ายเงิน<br>(.........................................................)<br>ตำแหน่ง ......................................... ยื่นวันที่ ........ / ........ / ............</div>' +
      (d.source === 'live' ? '<p class="warn">⚠️ เดือนนี้ยังไม่ได้ส่งสลิป ตัวเลขมาจากการคำนวณปัจจุบัน — ควรส่งสลิปให้เรียบร้อยก่อนยื่นจริง</p>' : '') + '</section>';
    var attach = pageRows.map(function (rows, pi) {
      var sub = rows.reduce(function (a, x) { a.i += x.income; a.t += x.tax; return a; }, { i: 0, t: 0 });
      return '<section class="page"><div class="row"><h1 style="flex:1">ใบแนบ ภ.ง.ด.1</h1><div>แผ่นที่ ' + (pi + 1) + ' ในจำนวน ' + pageRows.length + ' แผ่น</div></div>' +
        '<div class="sub">ผู้มีหน้าที่หักภาษี: <b>' + esc(d.payer.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + (d.payer.taxId ? fmtId(d.payer.taxId) : '-') + ' · สาขาที่ 00000 (สำนักงานใหญ่) · ประเภทเงินได้ ☑ (1) 40(1) กรณีทั่วไป</div>' +
        '<table class="t"><thead><tr><th>ลำดับที่</th><th>เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีเงินได้)</th><th>ชื่อผู้มีเงินได้</th><th>วัน เดือน ปี ที่จ่าย</th><th>จำนวนเงินได้ที่จ่ายในครั้งนี้</th><th>จำนวนเงินภาษีที่หักและนำส่งในครั้งนี้</th><th>เงื่อนไข</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td class="c">' + x.seq + '</td><td class="c">' + (x.taxId ? fmtId(x.taxId) : '<span class="blank">ยังไม่มีเลขบัตร</span>') + '</td><td>' + esc(x.prefix + x.firstName + ' ' + x.lastName) + '</td>' +
            '<td class="c">' + beDate(x.payDate || d.payDate) + '</td><td class="n">' + m2(x.income) + '</td><td class="n">' + m2(x.tax) + '</td><td class="c">' + x.condition + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td colspan="4" class="r">รวมยอดเงินได้และภาษีที่นำส่ง (นำไปรวมกับใบแนบ ภ.ง.ด.1 แผ่นอื่น ถ้ามี)</td><td class="n">' + m2(sub.i) + '</td><td class="n">' + m2(sub.t) + '</td><td></td></tr></tbody></table>' +
        '<div class="note">เงื่อนไข: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว</div>' +
        '<div class="sign">ลงชื่อ ......................................................... ผู้จ่ายเงิน</div></section>';
    }).join('');
    var html = '<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ภ.ง.ด.1 ' + d.month + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4 landscape;margin:10mm}body{font:12px/1.5 "IBM Plex Sans Thai Looped",sans-serif;color:#111;margin:0}.page{padding:12px 16px;page-break-after:always}.page:last-child{page-break-after:auto}' +
      'h1{font-size:17px;margin:0 0 2px}.sub{font-size:11.5px;color:#333;margin-bottom:8px}.row{display:flex;align-items:baseline;gap:12px}.box{border:1px solid #333;border-radius:6px;padding:6px 10px;margin:6px 0}' +
      '.t{width:100%;border-collapse:collapse;margin:6px 0}.t th,.t td{border:1px solid #333;padding:5px 6px}.t th{background:#f2f2f2;font-size:11px}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.c{text-align:center;white-space:nowrap}.r{text-align:right}.tot td{font-weight:700}.blank{color:#b42318}.sign{margin-top:18px;text-align:right;line-height:2}.note{font-size:10.5px;color:#444}.warn{color:#b26a00}</style></head><body>' +
      cover + attach + '<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) return App.toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', true);
    w.document.write(html); w.document.close();
  };
})();
