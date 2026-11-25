/**
 * Main.gs — ส่วนที่ผูกกับ Google (Sheet, Drive, LINE API) + จุดรับคำสั่งจากหน้าเว็บ
 *
 * วิธีติดตั้งโดยย่อ (ดูละเอียดใน คู่มือติดตั้ง.md)
 *   1) เปิด Google Sheet ใหม่ → ส่วนขยาย → Apps Script → วางไฟล์ Calc.gs, Schema.gs, Api.gs, Main.gs
 *   2) เลือกฟังก์ชัน setup แล้วกด Run (ครั้งแรกต้องกดอนุญาตสิทธิ์)
 *   3) Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone
 */

// ---------------------------------------------------------------- DB บน Google Sheet
var DB = (function () {
  var cache = {};
  var TIME_COLS = { inTime: 1, outTime: 1, start: 1, end: 1, breakStart: 1, breakEnd: 1 };

  function sheet(name) {
    var sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh) throw new Error('ไม่พบแท็บ ' + name + ' — กรุณารัน setup()');
    return sh;
  }
  function norm(v, key) {
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', TIME_COLS[key] ? 'HH:mm:ss' : 'yyyy-MM-dd');
    return v;
  }
  function load(name) {
    if (cache[name]) return cache[name];
    var sh = sheet(name), values = sh.getDataRange().getValues();
    var headers = values.shift().map(String), rows = [], at = [];
    values.forEach(function (r, i) {
      if (r.join('') === '') return;                                  // ข้ามแถวว่าง แต่จำเลขแถวจริงไว้ (กันแก้/ลบผิดแถว)
      var o = {}; headers.forEach(function (h, j) { o[h] = norm(r[j], h); });
      rows.push(o); at.push(i + 2);
    });
    cache[name] = { sh: sh, headers: headers, rows: rows, at: at };
    return cache[name];
  }
  function rowArray(headers, obj) { return headers.map(function (h) { return obj[h] === undefined || obj[h] === null ? '' : obj[h]; }); }
  /** ทุกการเขียนทำภายใต้ล็อกเดียวกัน (กันสองคนบันทึกพร้อมกันแล้วทับ/ลบผิดแถว) */
  function locked(fn) { return PLATFORM.lock(fn); }

  return {
    clear: function () { cache = {}; },
    all: function (name) { return load(name).rows.slice(); },
    insert: function (name, obj) {
      locked(function () {
        var t = load(name), row = Math.max(t.sh.getLastRow(), 1) + 1;
        if (row > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 200);
        // ตั้งเป็นข้อความก่อนเขียน — กัน Google Sheet แปลงวันที่/เวลา (เช่น 10:27:00) จนเวลาเพี้ยน และกันเลข 0 นำหน้าหาย
        t.sh.getRange(row, 1, 1, t.headers.length).setNumberFormat('@').setValues([rowArray(t.headers, obj)]);
        delete cache[name];
      });
    },
    update: function (name, match, patch) {
      return locked(function () {
        var t = load(name), n = 0;
        t.rows.forEach(function (r, i) {
          if (!match(r)) return;
          for (var k in patch) if (patch[k] !== undefined && t.headers.indexOf(k) >= 0) r[k] = patch[k];
          t.sh.getRange(t.at[i], 1, 1, t.headers.length).setValues([rowArray(t.headers, r)]);
          n++;
        });
        delete cache[name];
        return n;
      });
    },
    remove: function (name, match) {
      locked(function () {
        var t = load(name);
        for (var i = t.rows.length - 1; i >= 0; i--) if (match(t.rows[i])) t.sh.deleteRow(t.at[i]);   // ลบจากล่างขึ้นบน เลขแถวด้านบนไม่เลื่อน
        delete cache[name];
      });
    }
  };
})();

// ---------------------------------------------------------------- PLATFORM
var PLATFORM = {
  now: function () {
    var d = new Date();
    return { date: Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd'), time: Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm:ss') };
  },
  uuid: function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); },
  /** ล็อกระดับสคริปต์ (ซ้อนกันได้: ถ้าถืออยู่แล้วจะทำงานต่อทันที) · เข้าล็อกครั้งแรกจะล้าง cache เพื่ออ่านข้อมูลล่าสุด */
  _depth: 0,
  lock: function (fn) {
    if (PLATFORM._depth > 0) return fn();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    PLATFORM._depth++;
    try { DB.clear(); return fn(); } finally { PLATFORM._depth--; SpreadsheetApp.flush(); lock.releaseLock(); }
  },
  /** ตรวจ ID token กับ LINE แล้วคืน LINE userId (เก็บผลไว้ใน cache 10 นาที) */
  verifyIdToken: function (token) {
    if (!token) return null;
    var cache = CacheService.getScriptCache();
    var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
    var hit = cache.get(key);
    if (hit) return hit;
    var channelId = cfgValue('lineLoginChannelId');
    if (!channelId) throw new Error('ยังไม่ได้ตั้งค่า lineLoginChannelId ในแท็บ Config');
    var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post', payload: { id_token: token, client_id: String(channelId) }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var sub = JSON.parse(res.getContentText()).sub;
    if (sub) cache.put(key, sub, 600);
    return sub;
  },
  saveFile: function (name, mime, b64) {
    var bytes = Utilities.base64Decode(b64);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 8 MB');
    var folder = DriveApp.getFolderById(cfgValue('driveFolderId'));
    return folder.createFile(Utilities.newBlob(bytes, mime, name)).getUrl();
  }
};

function cfgValue(key) {
  var r = DB.all('Config').filter(function (x) { return x.key === key; })[0];
  return r ? r.value : '';
}

// ---------------------------------------------------------------- Web App
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { body = {}; }
  var out = Api.handle(body);
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'The Sparrow HRIS', time: PLATFORM.now() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- ติดตั้งครั้งแรก
/** สร้างแท็บทั้งหมด ใส่ค่าตั้งต้น และสร้างรหัสเข้าใช้งานครั้งแรกให้เจ้าของร้าน (รันซ้ำได้ ไม่ลบข้อมูลเดิม) */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Bangkok');
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SCHEMA[name];
    var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    headers.forEach(function (h) { if (cur.indexOf(h) < 0) cur.push(h); });       // เพิ่มคอลัมน์ใหม่ต่อท้าย ไม่ย้ายของเดิม
    if (sh.getMaxColumns() < cur.length) sh.insertColumnsAfter(sh.getMaxColumns(), cur.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cur.length).setValues([cur]).setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    sh.getRange(1, 1, sh.getMaxRows(), cur.length).setNumberFormat('@');          // เก็บทุกอย่างเป็นข้อความ กันวันที่/เวลาเพี้ยน
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  DB.clear();

  function seedIfEmpty(name, rows) { if (!DB.all(name).length) rows.forEach(function (r) { DB.insert(name, r); }); }
  seedIfEmpty('ShiftTypes', SEED.ShiftTypes);
  seedIfEmpty('LeavePolicy', SEED.LeavePolicy);
  var keys = DB.all('Config').map(function (r) { return r.key; });
  SEED.Config.forEach(function (r) { if (keys.indexOf(r.key) < 0) DB.insert('Config', r); });
  if (!DB.all('Holidays').length) {
    var y = +PLATFORM.now().date.slice(0, 4);
    seedHolidays(y).concat(seedHolidays(y + 1)).forEach(function (h) { DB.insert('Holidays', h); });
  }
  if (!cfgValue('driveFolderId')) {
    var folder = DriveApp.createFolder('The Sparrow HRIS — เอกสารการลา');
    DB.update('Config', function (r) { return r.key === 'driveFolderId'; }, { value: folder.getId() });
  }
  var owner = DB.all('Employees').filter(function (e) { return e.role === 'owner'; })[0];
  if (!owner) {
    var code = String(Math.floor(100000 + Math.random() * 900000));
    DB.insert('Employees', { id: 'E001', firstName: 'เจ้าของร้าน', lastName: '', startDate: PLATFORM.now().date, status: 'permanent', payType: 'monthly',
                             role: 'owner', department: 'บริหาร', position: 'เจ้าของร้าน', bindCode: code });
    owner = { bindCode: code };
  }
  var sens = ss.getSheetByName('Sensitive');
  sens.setTabColor('#b42318');
  var msg = 'ติดตั้งเสร็จแล้ว\n\nขั้นต่อไป:\n1) ใส่ shopLat / shopLng / liffId / lineLoginChannelId ในแท็บ Config\n' +
            '2) Deploy เป็น Web app\n\n' +
            'รหัสเข้าใช้งานครั้งแรกของเจ้าของร้าน: ' + (owner.bindCode || '(ใช้ไปแล้ว)');
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* รันจาก editor ไม่มี UI */ }
}

/** เมนูใน Google Sheet */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('HRIS')
    .addItem('ติดตั้ง / อัปเดตโครงสร้างแท็บ', 'setup')
    .addToUi();
}

