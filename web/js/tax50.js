/**
 * tax50.js — หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร (เงินได้ตามมาตรา 40(1))
 * App.tax50Html(list, payer, year, { autoPrint }) → เอกสาร HTML (1 คน = 1 หน้า A4) พิมพ์ / บันทึก PDF ได้
 * App.bahtText(1234.5) → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
 */
(function () {
  var DIG = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function words(n) {
    if (n >= 1000000) return words(Math.floor(n / 1000000)) + 'ล้าน' + (n % 1000000 ? words(n % 1000000) : '');
    var s = String(n), out = '';
    for (var i = 0; i < s.length; i++) {
      var d = +s[i], pos = s.length - i - 1;
      if (!d) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && n >= 10) out += 'เอ็ด';
      else out += DIG[d] + POS[pos];
    }
    return out;
  }
  App.bahtText = function (x) {
    x = Math.round((+x || 0) * 100) / 100;
    var baht = Math.floor(x), satang = Math.round((x - baht) * 100);
    if (!baht && !satang) return 'ศูนย์บาทถ้วน';
    return (baht ? words(baht) + 'บาท' : '') + (satang ? words(satang) + 'สตางค์' : 'ถ้วน');
  };
  function m2(x) { return (+x || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function idBoxes(id) {
    var d = String(id || '').replace(/\D/g, '');
    if (d.length !== 13) return '<span class="blank">' + (d || '_____________') + '</span>';
    return [d[0], d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d[12]].join(' - ');
  }

  App.tax50Html = function (list, payer, year, opts) {
    opts = opts || {};
    var esc = App.esc, be = +year + 543;
    var page = function (o) {
      return '<section class="page">' +
        '<div class="hd"><div class="copy">ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)<br>ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</div>' +
          '<div class="no">เล่มที่ ' + be + ' &nbsp; เลขที่ ' + ('000' + o.seq).slice(-3) + '</div></div>' +
        '<h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1><div class="sub2">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>' +
        '<div class="box"><div class="lbl">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</div>' +
          '<div class="row"><span>ชื่อ <b>' + esc(payer.name) + '</b></span><span>เลขประจำตัวผู้เสียภาษีอากร <b>' + idBoxes(payer.taxId) + '</b></span></div>' +
          '<div>ที่อยู่ ' + esc(payer.address || '-') + '</div></div>' +
        '<div class="box"><div class="lbl">ผู้ถูกหักภาษี ณ ที่จ่าย :</div>' +
          '<div class="row"><span>ชื่อ <b>' + esc(o.name) + '</b></span><span>เลขประจำตัวประชาชน <b>' + idBoxes(o.nationalId) + '</b></span></div>' +
          '<div>ที่อยู่ ' + esc(o.address || '-') + '</div>' +
          '<div style="margin-top:4px">ลำดับที่ <b>' + o.seq + '</b> ในแบบ &nbsp; ☑ ภ.ง.ด.1ก &nbsp; ☐ ภ.ง.ด.1ก พิเศษ &nbsp; ☐ ภ.ง.ด.2 &nbsp; ☐ ภ.ง.ด.3 &nbsp; ☐ ภ.ง.ด.53</div></div>' +
        '<table class="t"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th>วัน เดือน<br>หรือปีภาษี ที่จ่าย</th><th>จำนวนเงินที่จ่าย</th><th>ภาษีที่หัก<br>และนำส่งไว้</th></tr></thead><tbody>' +
          '<tr><td>1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)</td><td class="c">ปีภาษี ' + be + '<br><span class="sm">(' + o.months.length + ' เดือน)</span></td><td class="n">' + m2(o.income) + '</td><td class="n">' + m2(o.tax) + '</td></tr>' +
          '<tr><td>2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)</td><td></td><td></td><td></td></tr>' +
          '<tr><td>3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)</td><td></td><td></td><td></td></tr>' +
          '<tr><td>4. ดอกเบี้ย เงินปันผล ฯลฯ ตามมาตรา 40 (4)</td><td></td><td></td><td></td></tr>' +
          '<tr><td>5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากร</td><td></td><td></td><td></td></tr>' +
          '<tr><td>6. อื่น ๆ (ระบุ)</td><td></td><td></td><td></td></tr>' +
          '<tr class="tot"><td colspan="2" class="r">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td class="n">' + m2(o.income) + '</td><td class="n">' + m2(o.tax) + '</td></tr></tbody></table>' +
        '<div class="box">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) <b>(' + App.bahtText(o.tax) + ')</b></div>' +
        '<div class="box">เงินที่จ่ายเข้า &nbsp; กองทุนประกันสังคม <b>' + m2(o.sso) + '</b> บาท &nbsp;·&nbsp; กองทุนสำรองเลี้ยงชีพ <b>' + m2(o.pvd) + '</b> บาท</div>' +
        '<div class="box">ผู้จ่ายเงิน &nbsp; ☑ (1) หัก ณ ที่จ่าย &nbsp; ☐ (2) ออกให้ตลอดไป &nbsp; ☐ (3) ออกให้ครั้งเดียว &nbsp; ☐ (4) อื่น ๆ</div>' +
        '<div class="sign"><div class="warn">คำเตือน: ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>' +
          '<div class="who">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ<br><br>ลงชื่อ ......................................................... ผู้จ่ายเงิน<br>' +
          '(.........................................................)<br>วันที่ ........ / ........ / ............ (วันที่ออกหนังสือรับรอง)<div class="stamp">ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)</div></div></div>' +
        '<details class="detail"><summary>รายละเอียดรายเดือน (ไม่ต้องพิมพ์)</summary><table class="t m"><tr><th>เดือน</th><th>เงินได้</th><th>ภาษี</th><th>ประกันสังคม</th></tr>' +
          o.months.map(function (x) { return '<tr><td>' + App.monthTH(x.month) + '</td><td class="n">' + m2(x.income) + '</td><td class="n">' + m2(x.tax) + '</td><td class="n">' + m2(x.sso) + '</td></tr>'; }).join('') + '</table></details>' +
        '</section>';
    };
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>50 ทวิ ปี ' + be + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@400;600;700&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:10mm}body{font:12px/1.5 "IBM Plex Sans Thai Looped",sans-serif;color:#111;margin:0;background:#fff}.page{max-width:760px;margin:0 auto;padding:16px 18px;page-break-after:always}' +
      '.page:last-child{page-break-after:auto}.hd{display:flex;justify-content:space-between;font-size:10.5px;color:#444}h1{text-align:center;font-size:19px;margin:10px 0 0}.sub2{text-align:center;font-size:12.5px;margin-bottom:8px}' +
      '.box{border:1px solid #333;border-radius:6px;padding:6px 10px;margin:6px 0}.lbl{font-weight:700}.row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.blank{color:#b42318}' +
      '.t{width:100%;border-collapse:collapse;margin:6px 0}.t th,.t td{border:1px solid #333;padding:4px 6px;vertical-align:top}.t th{background:#f2f2f2;font-size:11.5px}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.c{text-align:center;white-space:nowrap}.r{text-align:right}.tot td{font-weight:700}.sm{font-size:10.5px;color:#555}.sign{display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-top:8px}' +
      '.warn{border:1px solid #333;border-radius:6px;padding:6px 10px;font-size:10.5px}.who{border:1px solid #333;border-radius:6px;padding:6px 10px;text-align:center;position:relative;min-height:120px}' +
      '.stamp{position:absolute;right:10px;bottom:10px;width:64px;height:64px;border:1px dashed #999;border-radius:50%;font-size:9px;color:#999;display:flex;align-items:center;justify-content:center;text-align:center}' +
      '.detail{margin-top:8px;font-size:11px;color:#555}.t.m td,.t.m th{padding:2px 6px}@media print{.detail{display:none}}</style></head><body>' +
      list.map(page).join('') +
      (opts.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>' : '') + '</body></html>';
  };

  App.openTax50 = function (list, payer, year) {
    var w = window.open('', '_blank');
    if (!w) return App.toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', true);
    w.document.write(App.tax50Html(list, payer, year, { autoPrint: true })); w.document.close();
  };
})();
