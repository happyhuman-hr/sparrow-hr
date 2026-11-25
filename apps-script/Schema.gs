/**
 * Schema.gs — โครงสร้างแท็บใน Google Sheet และค่าตั้งต้นตามข้อบังคับเกี่ยวกับการทำงานของ The Sparrow
 * แก้ค่าตั้งต้นได้ที่นี่ก่อนรัน setup() หรือแก้ในแท็บของ Sheet ภายหลัง
 */
var SCHEMA = {
  Employees: ['id', 'prefix', 'firstName', 'lastName', 'nickname', 'gender', 'birthDate', 'ethnicity', 'nationality', 'religion', 'maritalStatus',
              'militaryStatus', 'bloodType', 'weightKg', 'heightCm', 'phone', 'email', 'address', 'emergencyContact', 'department', 'position',
              'startDate', 'probationEnd', 'status', 'payType', 'wage', 'supervisorId', 'role', 'endDate', 'note', 'lineUserId', 'bindCode',
              'defaultShift', 'offDays', 'halfDayOn', 'positionAllowance', 'fixedAllowance', 'pvdPercent', 'bankName', 'scPoints'],
  Sensitive: ['id', 'nationalId', 'passportNo', 'criminalCheck', 'criminalCheckDate', 'criminalNote', 'docUrl', 'bankAccount'],
  ShiftTypes: ['code', 'name', 'start', 'end', 'breakStart', 'breakEnd', 'graceMin'],
  Schedule: ['date', 'empId', 'shift'],
  Holidays: ['date', 'name', 'mode', 'substituteDate', 'note'],
  HolidaySwaps: ['holidayDate', 'empId', 'mode', 'substituteDate', 'approvedBy', 'createdAt'],
  Attendance: ['date', 'empId', 'inTime', 'outTime', 'inLat', 'inLng', 'inDist', 'inAcc', 'outLat', 'outLng', 'outDist', 'outAcc', 'note'],
  AttendanceLog: ['at', 'by', 'empId', 'date', 'field', 'oldValue', 'newValue', 'reason'],
  LeaveRequests: ['id', 'empId', 'type', 'startDate', 'endDate', 'half', 'days', 'reason', 'fileUrl', 'status', 'approver', 'decidedAt', 'createdAt', 'warnings', 'note', 'token'],
  OTRequests: ['id', 'empId', 'date', 'kind', 'hours', 'approvedHours', 'reason', 'status', 'approver', 'decidedAt', 'createdAt', 'source', 'note', 'token'],
  LeavePolicy: ['type', 'name', 'daysPerYear', 'paid', 'noticeDays', 'docAfterDays', 'minServiceDays', 'maxConsecutive', 'note'],
  PayrollAdjust: ['month', 'empId', 'serviceCharge', 'bonus', 'otherIncome', 'tax', 'otherDeduct', 'note', 'updatedBy', 'updatedAt', 'advance', 'loan'],
  ServicePool: ['month', 'serviceCharge', 'tips', 'method', 'note', 'updatedBy', 'updatedAt'],
  Payslips: ['month', 'empId', 'data', 'publishedBy', 'publishedAt', 'seenAt', 'ackAt'],
  News: ['id', 'title', 'body', 'category', 'pinned', 'audience', 'startDate', 'endDate', 'createdBy', 'createdAt', 'updatedAt'],
  Config: ['key', 'value', 'note']
};

var SEED = {
  // ข้อบังคับฯ หมวด 03: เวลาทำงานและเวลาพัก
  ShiftTypes: [
    { code: 'A', name: 'ครัว กะ 1', start: '10:30', end: '20:30', breakStart: '14:30', breakEnd: '15:30', graceMin: 0 },
    { code: 'B', name: 'ครัว กะ 2 / ต้อนรับ กะ 1', start: '11:00', end: '21:00', breakStart: '15:00', breakEnd: '16:00', graceMin: 0 },
    { code: 'C', name: 'ต้อนรับ กะ 2 / แม่บ้าน', start: '12:00', end: '22:00', breakStart: '16:00', breakEnd: '17:00', graceMin: 0 },
    { code: 'H', name: 'แม่บ้าน ครึ่งวัน (1 วัน/สัปดาห์)', start: '15:00', end: '22:00', breakStart: '', breakEnd: '', graceMin: 0 }
  ],
  // ข้อบังคับฯ หมวด 09: วันลาและหลักเกณฑ์การลา
  LeavePolicy: [
    { type: 'sick', name: 'ลาป่วย', daysPerYear: 30, paid: 'ได้รับค่าจ้าง', noticeDays: 0, docAfterDays: 3, minServiceDays: 0, maxConsecutive: 0, note: 'แจ้งหัวหน้าโดยเร็ว · 3 วันทำงานติดต่อกันขึ้นไปต้องมีใบรับรองแพทย์' },
    { type: 'personal', name: 'ลากิจ', daysPerYear: 3, paid: 'ได้รับค่าจ้าง', noticeDays: 7, docAfterDays: 0, minServiceDays: 0, maxConsecutive: 0, note: 'แต่งงาน งานศพครอบครัว ติดต่อราชการ · ต้องได้รับอนุมัติก่อน' },
    { type: 'annual', name: 'ลาพักร้อน', daysPerYear: 6, paid: 'ได้รับค่าจ้าง', noticeDays: 7, docAfterDays: 0, minServiceDays: 365, maxConsecutive: 2, note: 'ขั้นต่ำครั้งละครึ่งวัน · ไม่สะสมข้ามปี' },
    { type: 'maternity', name: 'ลาคลอด', daysPerYear: 120, paid: 'ได้รับค่าจ้าง 60 วัน', noticeDays: 0, docAfterDays: 1, minServiceDays: 0, maxConsecutive: 0, note: 'ต่อครรภ์ · เพิ่มได้ 15 วัน (50%) หากบุตรมีภาวะเจ็บป่วย' },
    { type: 'paternity', name: 'ลาช่วยภริยาคลอด', daysPerYear: 15, paid: 'ได้รับค่าจ้าง', noticeDays: 0, docAfterDays: 1, minServiceDays: 0, maxConsecutive: 0, note: 'ภายใน 90 วันหลังคลอด' },
    { type: 'military', name: 'ลารับราชการทหาร', daysPerYear: 60, paid: 'ได้รับค่าจ้าง', noticeDays: 0, docAfterDays: 1, minServiceDays: 0, maxConsecutive: 0, note: 'ส่งหลักฐานภายใน 7 วันหลังกลับ' },
    { type: 'sterilization', name: 'ลาทำหมัน', daysPerYear: 0, paid: 'ได้รับค่าจ้าง', noticeDays: 15, docAfterDays: 1, minServiceDays: 0, maxConsecutive: 0, note: 'ตามระยะเวลาที่แพทย์กำหนด' },
    { type: 'training', name: 'ลาฝึกอบรม', daysPerYear: 30, paid: 'ไม่ได้รับค่าจ้าง', noticeDays: 7, docAfterDays: 0, minServiceDays: 0, maxConsecutive: 0, note: 'ไม่เกิน 30 วัน หรือ 3 ครั้งต่อปี' },
    { type: 'unpaid', name: 'ลาไม่รับค่าจ้าง', daysPerYear: 0, paid: 'ไม่ได้รับค่าจ้าง', noticeDays: 7, docAfterDays: 0, minServiceDays: 0, maxConsecutive: 0, note: 'ขึ้นกับการพิจารณาของร้าน' }
  ],
  Config: [
    { key: 'shopName', value: 'The Sparrow Pizza Studio', note: '' },
    { key: 'payerName', value: 'The Sparrow Pizza Studio', note: 'ชื่อผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ชื่อร้าน/บริษัท ตามที่จดทะเบียนกับกรมสรรพากร) ใช้ในใบ 50 ทวิ' },
    { key: 'payerTaxId', value: '', note: 'เลขประจำตัวผู้เสียภาษีอากร 13 หลัก ของร้าน/เจ้าของ ใช้ในใบ 50 ทวิ' },
    { key: 'payerAddress', value: '28/12 ซอยสุขุมวิท 61 แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพมหานคร 10110', note: 'ที่อยู่ผู้มีหน้าที่หักภาษี ใช้ในใบ 50 ทวิ' },
    { key: 'shopLat', value: '', note: 'ละติจูดของร้าน (คลิกขวาที่หมุดร้านใน Google Maps แล้วคัดลอกตัวเลขแรก)' },
    { key: 'shopLng', value: '', note: 'ลองจิจูดของร้าน (ตัวเลขที่สอง)' },
    { key: 'radiusM', value: 100, note: 'รัศมีที่ check-in ได้ (เมตร)' },
    { key: 'maxAccuracyM', value: 100, note: 'ความคลาดเคลื่อน GPS สูงสุดที่ยอมรับ (เมตร)' },
    { key: 'earliestCheckinMin', value: 60, note: 'กดเข้างานได้ก่อนเริ่มกะไม่เกินกี่นาที' },
    { key: 'hoursPerDay', value: 9, note: 'ชั่วโมงทำงานต่อวัน ใช้เมื่อพนักงานไม่มีกะประจำ (ปกติคิดจากกะประจำตามข้อบังคับฯ: 10 ชม. − พัก 1 ชม. = 9 ชม.)' },
    { key: 'otRoundMin', value: 1, note: 'คิด OT ละเอียดทีละกี่นาที (1 = ทุกนาที เช่น อยู่เกิน 28 นาที นับ 28 นาที)' },
    { key: 'overstayNotifyMin', value: 15, note: 'ออกงานเกินกะกี่นาทีขึ้นไป จึงส่งคำขอ OT ให้ผู้อนุมัติอัตโนมัติ (น้อยกว่านี้ยังอนุมัติได้ในหน้าอนุมัติ)' },
    { key: 'mealAllowance', value: 1500, note: 'เงินช่วยเหลือค่าอาหารต่อเดือน (จ่ายตามสัดส่วนวันที่มาทำงานจริง) · 0 = ไม่จ่าย' },
    { key: 'payDeductLate', value: 'yes', note: 'หักเงินตามนาทีที่มาสาย/กลับก่อน (yes / no)' },
    { key: 'usePositionAllowance', value: 'no', note: 'ใช้ค่าตำแหน่ง (yes / no)' },
    { key: 'useFixedAllowance', value: 'no', note: 'ใช้ค่าโทรศัพท์/เดินทางประจำ (yes / no)' },
    { key: 'useAttBonus', value: 'no', note: 'ใช้เบี้ยขยัน (yes / no)' },
    { key: 'usePvd', value: 'no', note: 'ใช้กองทุนสำรองเลี้ยงชีพ (yes / no)' },
    { key: 'useOtherIncome', value: 'no', note: 'ใช้ช่องรายได้อื่น (yes / no)' },
    { key: 'useAdvance', value: 'no', note: 'ใช้ช่องเบิกเงินล่วงหน้า (yes / no)' },
    { key: 'useLoan', value: 'no', note: 'ใช้ช่องเงินกู้ กยศ./สหกรณ์ (yes / no)' },
    { key: 'attBonus', value: 0, note: 'เบี้ยขยันต่อเดือน (บาท) ได้เมื่อไม่ขาด ไม่ลาไม่รับค่าจ้าง และสายไม่เกินเกณฑ์ · 0 = ไม่มี' },
    { key: 'attBonusLateMax', value: 30, note: 'มาสายรวมในเดือนไม่เกินกี่นาทีจึงได้เบี้ยขยัน' },
    { key: 'taxAuto', value: 'yes', note: 'คำนวณภาษีหัก ณ ที่จ่ายอัตโนมัติ (yes / no) · กรอกเองในรายงานเงินเดือนจะใช้ค่าที่กรอกแทน' },
    { key: 'taxPersonal', value: 60000, note: 'ลดหย่อนส่วนตัว (บาท/ปี)' },
    { key: 'taxExpenseRate', value: 50, note: 'หักค่าใช้จ่าย (% ของเงินได้)' },
    { key: 'taxExpenseCap', value: 100000, note: 'หักค่าใช้จ่ายสูงสุด (บาท/ปี)' },
    { key: 'ssoEnabled', value: 'yes', note: 'หักเงินสมทบประกันสังคมส่วนของพนักงาน (yes / no)' },
    { key: 'ssoRate', value: 5, note: 'อัตราเงินสมทบประกันสังคม (%)' },
    { key: 'ssoMin', value: 1650, note: 'ฐานค่าจ้างต่ำสุดที่ใช้คำนวณประกันสังคม (บาท)' },
    { key: 'ssoCap', value: 17500, note: 'ฐานค่าจ้างสูงสุดที่ใช้คำนวณประกันสังคม (บาท) — ตรวจกับประกาศสำนักงานประกันสังคมปีปัจจุบัน' },
    { key: 'lateLimitPerYear', value: 3, note: 'มาสายเกินกี่ครั้งต่อปีจึงตักเตือน' },
    { key: 'liffId', value: '', note: 'LIFF ID จาก LINE Developers (เช่น 2001234567-AbCdEfGh) — ใช้เข้าสู่ระบบเท่านั้น ไม่ส่งข้อความ' },
    { key: 'lineLoginChannelId', value: '', note: 'Channel ID ของ LINE Login channel (ใช้ตรวจสอบ ID token)' },
    { key: 'driveFolderId', value: '', note: 'โฟลเดอร์ Google Drive สำหรับเก็บใบรับรองแพทย์ (setup จะสร้างให้)' }
  ]
};

/** วันหยุดตามประเพณีตัวอย่าง 13 วัน — ร้านต้องประกาศเป็นปี ๆ ไป ตรวจสอบวันที่จริงกับประกาศของรัฐก่อนใช้ */
function seedHolidays(year) {
  var y = String(year);
  return [
    [y + '-01-01', 'วันขึ้นปีใหม่'], [y + '-04-06', 'วันจักรี'], [y + '-04-13', 'วันสงกรานต์'], [y + '-04-14', 'วันสงกรานต์'],
    [y + '-04-15', 'วันสงกรานต์'], [y + '-05-01', 'วันแรงงานแห่งชาติ'], [y + '-06-03', 'วันเฉลิมพระชนมพรรษาพระราชินี'],
    [y + '-07-28', 'วันเฉลิมพระชนมพรรษา ร.10'], [y + '-08-12', 'วันแม่แห่งชาติ'], [y + '-10-13', 'วันนวมินทรมหาราช'],
    [y + '-10-23', 'วันปิยมหาราช'], [y + '-12-05', 'วันพ่อแห่งชาติ'], [y + '-12-31', 'วันสิ้นปี']
  ].map(function (h) { return { date: h[0], name: h[1], mode: 'dayoff', substituteDate: '', note: '' }; });
}

if (typeof module !== 'undefined') module.exports = { SCHEMA: SCHEMA, SEED: SEED, seedHolidays: seedHolidays };
