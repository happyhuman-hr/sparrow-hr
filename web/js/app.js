/**
 * app.js — ส่วนกลางของทุกหน้า: เข้าสู่ระบบ LINE (LIFF), เรียก API, แถบเมนู, ตัวช่วยแสดงผล
 * ถ้ายังไม่ได้ตั้งค่า API_URL ใน config.js หรือเปิดด้วย ?demo=1 จะเข้าโหมดตัวอย่าง (ข้อมูลจำลองในเบราว์เซอร์)
 */
(function () {
  var CFG = window.HRIS_CONFIG || {};
  var params = new URLSearchParams(location.search);
  // โหมดตัวอย่างเฉพาะตอนยังไม่ได้ตั้งค่า API_URL (ระบบจริงเปิดโหมดตัวอย่างด้วย ?demo=1 ไม่ได้ กันพนักงานสับสน)
  var DEMO = !CFG.API_URL;
  var ROLE_RANK = { employee: 0, manager: 1, hr: 2, owner: 3 };
  var state = { me: null };

  // ---------------------------------------------------------------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  var TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var TH_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  var TH_DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  function dParts(d) { var p = String(d).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function dateTH(d, opts) {
    if (!d) return '-';
    var p = dParts(d), wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return (opts && opts.dow ? TH_DOW_FULL[wd] + ' ' : '') + p.d + ' ' + TH_MONTH[p.m - 1] + (opts && opts.noYear ? '' : ' ' + String(p.y + 543).slice(-2));
  }
  function monthTH(m) { var p = String(m).split('-'); return TH_MONTH_FULL[+p[1] - 1] + ' ' + (+p[0] + 543); }
  function t5(t) { return t ? String(t).slice(0, 5) : '-'; }
  /** แสดงระยะเวลา: ต่ำกว่า 1 ชม. → "28 นาที" · ตั้งแต่ 1 ชม. → "1 ชม. 15 น." */
  function fmtMin(m) {
    m = Math.round(m || 0); if (!m) return '-';
    if (m < 60) return m + ' นาที';
    var h = Math.floor(m / 60), r = m % 60; return h + ' ชม.' + (r ? ' ' + r + ' น.' : '');
  }
  function num(n, d) { return (+n || 0).toLocaleString('th-TH', { maximumFractionDigits: d === undefined ? 0 : d }); }
  function addMonths(m, n) { var p = m.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)); return d.toISOString().slice(0, 7); }
  function addDays(d, n) { var p = dParts(d), x = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return x.toISOString().slice(0, 10); }
  function weekStart(d) { var p = dParts(d), wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); return addDays(d, -((wd + 6) % 7)); } // จันทร์

  var STATUS = {
    present: ['ตรงเวลา', 'present'], late: ['มาสาย', 'late'], absent: ['ขาดงาน', 'absent'], incomplete: ['ไม่ได้ออกงาน', 'incomplete'],
    leave: ['ลา', 'leave'], off: ['วันหยุด', 'off'], holiday_work: ['ทำงานวันหยุด', 'holiday_work'], holiday_working: ['ทำงานวันหยุด', 'holiday_work'],
    working: ['กำลังทำงาน', 'working'], not_in: ['ยังไม่เข้างาน', 'not_in'], upcoming: ['', 'upcoming'], unscheduled: ['ไม่มีกะ', 'off'], unscheduled_work: ['มาทำงาน (ไม่มีกะ)', 'late']
  };
  function statusBadge(st) { var s = STATUS[st] || [st, 'off']; return s[0] ? '<span class="badge b-' + s[1] + '">' + esc(s[0]) + '</span>' : ''; }
  var REQ_STATUS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
  function reqBadge(st) { return '<span class="badge b-' + st + '">' + (REQ_STATUS[st] || st) + '</span>'; }

  function toast(msg, bad) {
    var t = h('<div class="toast' + (bad ? ' bad' : '') + '">' + esc(msg) + '</div>');
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200);
  }
  function loading(el, text) { el.innerHTML = '<div class="loading"><span class="spin"></span>' + esc(text || 'กำลังโหลด…') + '</div>'; }
  function modal(title, bodyHtml, opts) {
    var bg = h('<div class="modal-bg"><div class="modal"><div class="mh"><h2>' + esc(title) + '</h2><button class="sm" data-x>ปิด</button></div><div class="mb"></div></div></div>');
    $('.mb', bg).innerHTML = bodyHtml;
    function close() { bg.remove(); if (opts && opts.onClose) opts.onClose(); }
    bg.addEventListener('click', function (e) { if (e.target === bg || e.target.hasAttribute('data-x')) close(); });
    document.body.appendChild(bg);
    return { el: $('.mb', bg), close: close };
  }
  function fileToBase64(file, maxDim) {
    return new Promise(function (resolve, reject) {
      if (!file) return resolve(null);
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var dataUrl = reader.result;
        if (!/^image\//.test(file.type) || !maxDim) return resolve({ name: file.name, mime: file.type, data: dataUrl.split(',')[1] });
        var img = new Image();
        img.onload = function () {                       // ย่อรูปให้ไม่เกิน maxDim เพื่อส่งเร็ว
          var s = Math.min(1, maxDim / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        img.onerror = reject; img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }
  function downloadCSV(name, rows) {
    var cell = function (c) {
      if (c === null || c === undefined) return '';
      if (typeof c !== 'number') {
        c = String(c);
        // กันสูตรแฝงใน Excel (CSV injection) จากข้อความที่ผู้ใช้พิมพ์ เช่น ชื่อ/หมายเหตุขึ้นต้นด้วย = + - @ · ยกเว้น ="เลขบัตร" ที่ระบบใส่เองเพื่อคงเลข 0 นำหน้า
        if (/^[=+\-@\t\r]/.test(c) && !/^="[0-9-]*"$/.test(c)) c = "'" + c;
      }
      c = String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    };
    var csv = '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
  }

  // ---------------------------------------------------------------- API
  function api(action, payload) {
    if (DEMO) return window.HRIS_DEMO.call(action, payload);
    var token = window.liff && liff.getIDToken ? liff.getIDToken() : null;
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, idToken: token, payload: payload || {} }) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok && /เข้าสู่ระบบ LINE ไม่สำเร็จ/.test(res.error || '') && window.liff && !sessionStorage.getItem('relogin')) {
          sessionStorage.setItem('relogin', '1'); liff.logout(); liff.login({ redirectUri: location.href }); return new Promise(function () {});
        }
        sessionStorage.removeItem('relogin');
        return res;
      })
      .catch(function () { return { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }; });
  }
  /** เรียก API แล้วคืนเฉพาะ data (ถ้า error แสดง toast และ throw) */
  function call(action, payload) {
    return api(action, payload).then(function (res) {
      if (!res.ok) { if (res.needBind) showBind(); else toast(res.error, true); throw new Error(res.error); }
      return res.data;
    });
  }

  // ---------------------------------------------------------------- LIFF login
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  function initAuth() {
    if (DEMO) {
      var base = '../apps-script/';
      return ['Calc.gs', 'Schema.gs', 'Api.gs'].reduce(function (p, f) { return p.then(function () { return loadScript(base + f); }); }, Promise.resolve())
        .then(function () { return loadScript('js/demo.js'); })
        .then(function () { return window.HRIS_DEMO.init(); });
    }
    return loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js').then(function () {
      return liff.init({ liffId: CFG.LIFF_ID });
    }).then(function () {
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return new Promise(function () {}); }
    });
  }
  function showBind() {
    var main = $('#main');
    main.innerHTML = splash('ยินดีต้อนรับสู่ The Sparrow') + '<div class="wrap narrow"><div class="playcard"><h2>เข้าใช้งานครั้งแรก</h2>' +
      '<p class="sub">กรอกรหัส 6 หลักที่ได้รับจาก HR (ใช้ครั้งเดียว)</p><div class="field"><input id="bindCode" inputmode="numeric" maxlength="6" placeholder="เช่น 482913" style="font-size:22px;letter-spacing:.2em;text-align:center"></div>' +
      '<button class="accent" id="bindBtn" style="width:100%">ยืนยัน</button><div id="bindErr"></div></div></div>';
    main.appendChild(credit());
    $('#bindBtn').onclick = function () {
      var code = $('#bindCode').value.trim();
      $('#bindBtn').disabled = true;
      api('bind', { code: code }).then(function (res) {
        $('#bindBtn').disabled = false;
        if (!res.ok) { $('#bindErr').innerHTML = '<div class="errbox">' + esc(res.error) + '</div>'; return; }
        toast('ยินดีต้อนรับ ' + res.data.name); setTimeout(function () { location.reload(); }, 800);
      });
    };
  }

  // ---------------------------------------------------------------- layout
  // ไอคอนเส้นบาง ใช้สีตามธีม (currentColor)
  function svg(d) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var ICON = {
    clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.3" fill="currentColor"/>'),
    note: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    check: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 12.5l3 3 5-6"/>'),
    grid: svg('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M3.5 15h17M9.5 4v16"/>'),
    people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.8c2.4.2 4 1.8 4.5 4.7"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    money: svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>'),
    news: svg('<path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1z"/><path d="M15 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>'),
    bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    chart: svg('<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="6" width="3" height="12" rx="1"/><rect x="15.5" y="13" width="3" height="5" rx="1"/>')
  };
  var PAGES = [
    { href: 'checkin.html', ic: ICON.clock, label: 'ลงเวลา', role: 'employee' },
    { href: 'news.html', ic: ICON.news, label: 'ข่าวสาร', role: 'employee' },
    { href: 'my.html', ic: ICON.cal, label: 'ปฏิทิน', role: 'employee' },
    { href: 'leave.html', ic: ICON.note, label: 'ขอลา/OT', role: 'employee' },
    { href: 'payslip.html', ic: ICON.money, label: 'สลิป', role: 'employee' },
    { href: 'approve.html', ic: ICON.check, label: 'อนุมัติ', role: 'manager' },
    { href: 'schedule.html', ic: ICON.grid, label: 'ตารางกะ', role: 'manager' },
    { href: 'employees.html', ic: ICON.people, label: 'พนักงาน', role: 'manager' },
    { href: 'dashboard.html', ic: ICON.chart, label: 'Dashboard', role: 'manager' },
    { href: 'settings.html', ic: ICON.gear, label: 'ตั้งค่า', role: 'hr' }
  ];
  function can(role) { return state.me && ROLE_RANK[state.me.user.role || 'employee'] >= ROLE_RANK[role]; }
  function link(href) { return href + (DEMO && params.get('demo') ? '?demo=1' : ''); }
  function renderChrome(page) {
    var me = state.me, u = me.user;
    var top = h('<header class="top"><div class="wrap"><a class="brand" href="' + link('checkin.html') + '"><img src="img/sparrow-mark-wine.png" alt="">' +
      '<span class="name">The Sparrow<small>People · HR</small></span></a>' +
      '<button class="bell" id="bell" title="แจ้งเตือน" aria-label="แจ้งเตือน">' + ICON.bell + '</button>' +
      (can('hr') ? '<a class="bell gear' + (page === 'payroll' ? ' on' : '') + '" href="' + link('payroll.html') + '" title="รายงานเงินเดือน" aria-label="รายงานเงินเดือน">' + ICON.money + '</a>' : '') +
      (can('hr') ? '<a class="bell gear' + (page === 'settings' ? ' on' : '') + '" href="' + link('settings.html') + '" title="ตั้งค่าระบบ" aria-label="ตั้งค่าระบบ">' + ICON.gear + '</a>' : '') +
      '<div class="who"><b>' + esc(u.nickname || u.firstName) + '</b><br><span class="muted">' + esc(u.position || '') + '</span></div></div></header>');
    document.body.insertBefore(top, document.body.firstChild);
    if (DEMO) document.body.insertBefore(window.HRIS_DEMO.bar(), document.body.firstChild);
    var nav = h('<nav class="nav"></nav>');
    PAGES.filter(function (p) { return can(p.role) && p.href !== 'settings.html'; }).forEach(function (p) {   // ตั้งค่า อยู่ที่ไอคอนเฟืองด้านบน
      nav.appendChild(h('<a href="' + link(p.href) + '" class="' + (p.href === page + '.html' ? 'on' : '') + '"><span class="ic">' + p.ic + '</span>' + p.label + '</a>'));
    });
    document.body.appendChild(nav);
    document.body.insertBefore(credit(), nav);
    $('#bell').onclick = toggleNotif;
    pollNotif(); setInterval(pollNotif, 60000);
  }

  // ---------------------------------------------------------------- แจ้งเตือนในเว็บ
  var notifData = null;
  function seenIds() { try { return JSON.parse(localStorage.getItem('hris-seen') || '[]'); } catch (e) { return []; } }
  function setSeen(ids) { try { localStorage.setItem('hris-seen', JSON.stringify(ids.slice(-200))); } catch (e) { /* ignore */ } }
  function pollNotif() {
    api('notifications').then(function (res) {
      if (!res.ok) return;
      var d = res.data, seen = seenIds(), all = d.items.concat(d.results).concat(d.news || []);
      var fresh = all.filter(function (x) { return seen.indexOf(x.id + x.kind + (x.status || '')) < 0; });
      notifData = d; notifData.fresh = fresh.map(function (x) { return x.id + x.kind + (x.status || ''); });
      var bell = $('#bell'); if (!bell) return;
      var old = $('.dot', bell); if (old) old.remove();
      if (fresh.length) { bell.appendChild(h('<span class="dot">' + (fresh.length > 9 ? '9+' : fresh.length) + '</span>')); bell.classList.add('ring'); setTimeout(function () { bell.classList.remove('ring'); }, 2100); }
      // badge จำนวนที่รออนุมัติบนเมนู "อนุมัติ"
      var ap = document.querySelector('.nav a[href^="approve.html"]');
      if (ap) { var od = $('.dot', ap); if (od) od.remove(); if (d.pending) ap.appendChild(h('<span class="dot">' + d.pending + '</span>')); }
      if (fresh.length && !sessionStorage.getItem('hris-toasted-' + notifData.fresh.join())) {
        sessionStorage.setItem('hris-toasted-' + notifData.fresh.join(), '1');
        var f = fresh[0]; toast((fresh.length > 1 ? 'มีแจ้งเตือนใหม่ ' + fresh.length + ' รายการ · ' : '🔔 ') + f.title);
      }
    });
  }
  function toggleNotif() {
    var old = $('#notif'); if (old) { old.remove(); return; }
    var d = notifData || { items: [], results: [], news: [], fresh: [] }, isNew = function (x) { return d.fresh.indexOf(x.id + x.kind + (x.status || '')) >= 0; };
    function row(x) {
      var href = x.kind === 'slip' ? link('payslip.html') + (link('payslip.html').indexOf('?') > 0 ? '&' : '?') + 'month=' + x.slipMonth : x.kind === 'news' ? link('news.html') + '#' + x.newsId : x.kind === 'result' ? link('my.html') : link('approve.html') + (link('approve.html').indexOf('?') > 0 ? '&' : '?') + 'id=' + x.id;
      return '<a class="ni' + (isNew(x) ? ' new' : '') + '" href="' + href + '"><span class="ic">' + (x.kind === 'slip' ? '💰' : x.kind === 'news' ? '📣' : x.kind === 'leave' ? '📝' : x.kind === 'ot' ? '⏱' : x.status === 'approved' ? '✓' : '✕') + '</span>' +
        '<span style="flex:1;min-width:0"><b>' + esc(x.title) + '</b><div class="sub">' + esc(x.detail) + (x.warn ? ' · ⚠️ มีคำเตือน' : '') + '</div><div class="sub">' + esc(String(x.at || '').slice(0, 16)) + '</div></span></a>';
    }
    var panel = h('<div class="notif" id="notif"><div class="nh"><b style="flex:1">แจ้งเตือน</b>' + (can('manager') ? '<a class="sub" href="' + link('approve.html') + '">ไปหน้าอนุมัติ</a>' : '') + '</div>' +
      (can('manager') ? '<div class="sec">รอคุณอนุมัติ (' + d.pending + ')</div>' + (d.items.length ? d.items.map(row).join('') : '<div class="empty" style="padding:14px">ไม่มีคำขอค้าง</div>') : '') +
      '<div class="sec">ข่าวสาร</div>' + ((d.news || []).length ? d.news.slice(0, 5).map(row).join('') + '<a class="ni" href="' + link('news.html') + '" style="justify-content:center;color:var(--wine)">ดูข่าวทั้งหมด</a>' : '<div class="sub" style="padding:8px 14px">-</div>') +
      '<div class="sec">ผลคำขอของฉัน (7 วันล่าสุด)</div>' + (d.results.length ? d.results.map(row).join('') : '<div class="sub" style="padding:8px 14px 14px">-</div>') + '</div>');
    document.body.appendChild(panel);
    setSeen(seenIds().concat(d.fresh)); d.fresh = [];
    var dot = $('.dot', $('#bell')); if (dot) dot.remove();
    setTimeout(function () { document.addEventListener('click', function close(e) { if (!panel.contains(e.target) && e.target.closest('#bell') === null) { panel.remove(); document.removeEventListener('click', close); } }); }, 0);
  }
  function credit() { return h('<footer class="credit">crafted by <img src="img/happy-human-ink.png" alt="Happy Human — เรื่องคน ต้องให้คนทำ"></footer>'); }
  function splash(text) {
    return '<div class="splash"><img src="img/sparrow-logo-wine.png" alt="The Sparrow"><div class="sub" style="margin-top:14px">' + esc(text) + '</div></div>';
  }
  /** โปรยลูกพิซซ่า ✦ เล็ก ๆ ตอนลงเวลาสำเร็จ */
  function confetti(n) {
    for (var i = 0; i < (n || 18); i++) {
      var c = h('<i class="confetti"></i>');
      c.style.left = (Math.random() * 100) + 'vw'; c.style.animationDelay = (Math.random() * 0.5) + 's';
      var sz = 8 + Math.random() * 8; c.style.width = c.style.height = sz + 'px';
      if (Math.random() < 0.3) c.style.background = '#c9384a';
      document.body.appendChild(c); setTimeout(function (el) { el.remove(); }.bind(null, c), 2400);
    }
  }

  /** เริ่มหน้า: opts = { page, role, ready(me) } */
  // ---- เก็บข้อมูลผู้ใช้ (me) ไว้ในแท็บนี้ 10 นาที — เปลี่ยนหน้าแล้วไม่ต้องรอเซิร์ฟเวอร์อีกรอบ (หน้าลงเวลาดึงสดเสมอ)
  var ME_KEY = 'hris-me', ME_TTL = 10 * 60 * 1000;
  function lineSub() { try { return (window.liff && liff.getDecodedIDToken && liff.getDecodedIDToken() || {}).sub || ''; } catch (e) { return ''; } }
  function meSave(me) { if (DEMO) return; try { sessionStorage.setItem(ME_KEY, JSON.stringify({ at: Date.now(), sub: lineSub(), me: me })); } catch (e) { /* ignore */ } }
  function meCached() {
    if (DEMO) return null;
    try {
      var o = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null');
      if (!o || !o.me || Date.now() - o.at > ME_TTL || !o.sub || o.sub !== lineSub()) return null;
      // เลื่อนเวลาเซิร์ฟเวอร์ (เวลาไทย) ไปตามเวลาที่ผ่านไป
      var t = new Date(Date.parse(o.me.now.date + 'T' + o.me.now.time + '+07:00') + (Date.now() - o.at) + 7 * 3600e3).toISOString();
      o.me.now = { date: t.slice(0, 10), time: t.slice(11, 19) };
      return o.me;
    } catch (e) { return null; }
  }
  function boot(opts) {
    var main = $('#main');
    main.innerHTML = splash('กำลังเข้าสู่ระบบ…');
    function start(me) {
      state.me = me;
      renderChrome(opts.page);
      if (opts.role && !can(opts.role)) { main.innerHTML = '<div class="wrap narrow"><div class="card empty">หน้านี้สำหรับหัวหน้างาน / HR / ผู้บริหาร</div></div>'; return; }
      main.innerHTML = '';
      opts.ready(state.me);
    }
    initAuth().then(function () {
      var cached = opts.page !== 'checkin' && meCached();
      if (cached) {
        start(cached);
        api('me').then(function (res) { if (res.ok) { meSave(res.data); state.me = res.data; } });   // อัปเดตเบื้องหลัง
        return;
      }
      return api('me').then(function (res) {
        if (!res.ok) { if (res.needBind) return showBind(); main.innerHTML = '<div class="wrap narrow"><div class="errbox">' + esc(res.error) + '</div></div>'; return; }
        if (!res.data || !res.data.user) {   // เซิร์ฟเวอร์ตอบกลับไม่ใช่ข้อมูลผู้ใช้ (เช่น การตั้งค่า Deploy ผิด) — แสดงสิ่งที่ได้รับเพื่อหาสาเหตุ
          main.innerHTML = '<div class="wrap narrow"><div class="errbox">เซิร์ฟเวอร์ตอบกลับไม่ครบ กรุณาตรวจการตั้งค่า Deploy (Execute as: Me · Who has access: Anyone)<br><small>' +
            esc(JSON.stringify(res).slice(0, 200)) + '</small></div></div>';
          return;
        }
        meSave(res.data);
        start(res.data);
      });
    }).catch(function (e) {
      main.innerHTML = '<div class="wrap narrow"><div class="errbox">เปิดระบบไม่สำเร็จ: ' + esc(e && e.message || e) + '</div></div>';
    });
  }

  window.App = {
    DEMO: DEMO, params: params, boot: boot, api: api, call: call, can: can, link: link, state: state,
    $: $, $$: $$, esc: esc, h: h, toast: toast, confetti: confetti, loading: loading, modal: modal, fileToBase64: fileToBase64, downloadCSV: downloadCSV,
    dateTH: dateTH, monthTH: monthTH, t5: t5, fmtMin: fmtMin, num: num, addMonths: addMonths, addDays: addDays, weekStart: weekStart, dParts: dParts,
    statusBadge: statusBadge, reqBadge: reqBadge, STATUS: STATUS, TH_DOW: TH_DOW, TH_DOW_FULL: TH_DOW_FULL, TH_MONTH: TH_MONTH
  };
})();
