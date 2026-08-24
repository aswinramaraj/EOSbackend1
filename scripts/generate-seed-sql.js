#!/usr/bin/env node
/**
 * generate-seed-sql.js
 * ---------------------------------------------------------------------------
 * Generates the full seed SQL script at EOSbackend1/seed_aiml_and_all_departments.sql
 * from the plan in docs/06_SEED_DATA_PLAN.md.
 *
 * Run:  node scripts/generate-seed-sql.js > seed_aiml_and_all_departments.sql
 *
 * Every FK in every generated INSERT is resolved via a natural-key subquery
 * (never a bare integer). See the header comment written into the output
 * file for the full list of safety rules / assumptions / skipped tables.
 * ---------------------------------------------------------------------------
 */

'use strict';

// ---------------------------------------------------------------------------
// Small deterministic PRNG (mulberry32) so re-runs are reproducible.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260822);
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function randInt(min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------
const out = [];
function line(s) { out.push(s); }
function blank() { out.push(''); }

function esc(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function num(n) { return n === null || n === undefined ? 'NULL' : String(n); }
function boolSql(b) { return b ? 'TRUE' : 'FALSE'; }
function NUL() { return 'NULL'; }

// Natural-key subquery builders (NEVER a bare integer FK anywhere)
const sub = {
  dept: (code) => `(SELECT id FROM departments WHERE code = ${esc(code)})`,
  course: (code) => `(SELECT id FROM courses WHERE code = ${esc(code)})`,
  batch: (name) => `(SELECT id FROM batches WHERE name = ${esc(name)})`,
  quota: (name) => `(SELECT id FROM quotas WHERE name = ${esc(name)})`,
  demandCat: (name) => `(SELECT id FROM demand_categories WHERE name = ${esc(name)})`,
  designation: (title) => `(SELECT id FROM designations WHERE title = ${esc(title)})`,
  certType: (name) => `(SELECT id FROM certificate_types WHERE name = ${esc(name)})`,
  roomType: (name) => `(SELECT id FROM hostel_room_types WHERE name = ${esc(name)})`,
  route: (name) => `(SELECT id FROM transport_routes WHERE name = ${esc(name)})`,
  role: (name) => `(SELECT id FROM roles WHERE name = ${esc(name)})`,
  leaveType: (name) => `(SELECT id FROM leave_types WHERE name = ${esc(name)})`,
  userByEmail: (email) => `(SELECT id FROM users WHERE email = ${esc(email)})`,
  facultyByStaffCode: (code) => `(SELECT id FROM faculty WHERE staff_code = ${esc(code)})`,
  hostel: (code) => `(SELECT id FROM hostels WHERE code = ${esc(code)})`,
  hostelBlock: (hostelCode, name) =>
    `(SELECT id FROM hostel_blocks WHERE hostel_id = (SELECT id FROM hostels WHERE code = ${esc(hostelCode)}) AND name = ${esc(name)})`,
  feeStructure: (name) => `(SELECT id FROM fee_structures WHERE name = ${esc(name)} AND academic_year = ${esc(CURRENT_AY)})`,
  classByKey: (batchName, deptCode, section) =>
    `(SELECT id FROM classes WHERE batch_id = (SELECT id FROM batches WHERE name = ${esc(batchName)}) AND department_id = (SELECT id FROM departments WHERE code = ${esc(deptCode)}) AND section = ${esc(section)})`,
  subjectByCode: (code) => `(SELECT id FROM subjects WHERE subject_code = ${esc(code)})`,
  studentByRegNo: (regNo) => `(SELECT id FROM students WHERE register_no = ${esc(regNo)})`,
  roomByKey: (hostelCode, roomNumber) =>
    `(SELECT id FROM hostel_rooms WHERE hostel_id = (SELECT id FROM hostels WHERE code = ${esc(hostelCode)}) AND room_number = ${esc(roomNumber)})`,
  transportStage: (routeName, stageName) =>
    `(SELECT id FROM transport_stages WHERE route_id = (SELECT id FROM transport_routes WHERE name = ${esc(routeName)}) AND stage_name = ${esc(stageName)})`,
  examType: (name) => `(SELECT id FROM exam_types WHERE name = ${esc(name)})`,
  exam: (batchName, examTypeName, ay) =>
    `(SELECT id FROM exams WHERE batch_id = (SELECT id FROM batches WHERE name = ${esc(batchName)}) AND exam_type_id = (SELECT id FROM exam_types WHERE name = ${esc(examTypeName)}) AND academic_year = ${esc(ay)})`,
  examSubjMap: (batchName, examTypeName, deptCode, section, subjectCode, ay) =>
    `(SELECT id FROM exam_subject_mapping WHERE exam_id = ${sub.exam(batchName, examTypeName, ay)} AND class_id = ${sub.classByKey(batchName, deptCode, section)} AND subject_id = ${sub.subjectByCode(subjectCode)})`,
  examMarks: (batchName, examTypeName, deptCode, section, subjectCode, ay, regNo) =>
    `(SELECT id FROM exam_marks WHERE exam_subject_mapping_id = ${sub.examSubjMap(batchName, examTypeName, deptCode, section, subjectCode, ay)} AND student_id = ${sub.studentByRegNo(regNo)})`,
  venue: (name) => `(SELECT id FROM venues WHERE name = ${esc(name)})`,
  facultyUserByStaffCode: (code) => `(SELECT user_id FROM faculty WHERE staff_code = ${esc(code)})`,
  studentUserByRegNo: (regNo) => `(SELECT user_id FROM students WHERE register_no = ${esc(regNo)})`,
  lmsFolder: (subjectCode, staffCode, title) =>
    `(SELECT id FROM lms_folders WHERE subject_id = ${`(SELECT id FROM subjects WHERE subject_code = ${esc(subjectCode)})`} AND faculty_id = ${`(SELECT id FROM faculty WHERE staff_code = ${esc(staffCode)})`} AND title = ${esc(title)})`,
  assignmentByKey: (batchName, deptCode, section, subjectCode, ay, seq) =>
    `(SELECT id FROM assignments WHERE class_id = ${sub.classByKey(batchName, deptCode, section)} AND subject_id = ${sub.subjectByCode(subjectCode)} AND academic_year = ${esc(ay)} AND semester = (SELECT current_semester FROM classes WHERE id = ${sub.classByKey(batchName, deptCode, section)}) AND sequence_no = ${num(seq)})`,
  feedbackRatingScale: (name) => `(SELECT id FROM feedback_rating_scales WHERE name = ${esc(name)})`,
  feedbackForm: (title) => `(SELECT id FROM feedback_forms WHERE title = ${esc(title)})`,
  feedbackQuestion: (formTitle, questionText) =>
    `(SELECT id FROM feedback_questions WHERE form_id = ${`(SELECT id FROM feedback_forms WHERE title = ${esc(formTitle)})`} AND question_text = ${esc(questionText)})`,
  medicalStaffByName: (name) => `(SELECT id FROM medical_staff WHERE name = ${esc(name)})`,
};

/** Guarded insert using a raw SQL boolean expression (for subquery-based natural keys). */
function insertGuardedExpr(table, columns, valuesRow, guardExprSql) {
  line(`INSERT INTO ${table} (${columns.join(', ')})`);
  line(`SELECT ${valuesRow.join(', ')}`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${guardExprSql});`);
  blank();
}

function insertPlain(table, columns, rows, chunkSize = 200) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    line(`INSERT INTO ${table} (${columns.join(', ')}) VALUES`);
    line(chunk.map((r, idx) => `  (${r.join(', ')})${idx === chunk.length - 1 ? '' : ','}`).join('\n'));
    line(';');
    blank();
  }
}

/** Guarded single-row insert using WHERE NOT EXISTS against a natural key. */
function insertGuardedRow(table, columns, values, guardColumn, guardValue) {
  line(`INSERT INTO ${table} (${columns.join(', ')})`);
  line(`SELECT ${values.join(', ')}`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${guardColumn} = ${esc(guardValue)});`);
  blank();
}

// ===========================================================================
// REFERENCE DATA
// ===========================================================================

const CURRENT_AY = '2026-2027'; // current academic year in use for billing as of 2026-08-22

const DEPARTMENTS = [
  {
    code: 'CS', regCode: 'CS', emailCode: 'cse',
    name: 'B.E. Computer Science and Engineering',
    hod: { name: 'Dr. R. Subha', title: 'Professor & Head', phone: '+91-4259-200370', email: 'hodcse@sece.ac.in' },
    real: [
      { name: 'Dr. H. Anandakumar', title: 'Professor' },
      { name: 'Dr. V.S. Akshaya', title: 'Professor' },
      { name: 'Dr. S. Sampath Kumar', title: 'Associate Professor' },
      { name: 'Dr. S.K. Harikarthik', title: 'Associate Professor' },
      { name: 'Dr. M. Suriya', title: 'Associate Professor' },
    ],
  },
  {
    code: 'AI', regCode: 'AI', emailCode: 'aiml',
    name: 'B.E. Computer Science and Engineering (AI & ML)',
    hod: { name: 'Dr. S. Sumathi', title: 'Associate Professor & HOD', phone: '+91-4259-200449', email: 'hodaiml@sece.ac.in' },
    real: [
      { name: 'Dr. V. Karunakaran', title: 'Associate Professor' },
    ],
  },
  {
    code: 'CY', regCode: 'CY', emailCode: 'cys',
    name: 'B.E. Computer Science and Engineering (Cyber Security)',
    hod: { name: 'Dr. V.R. Azhaguramyaa', title: 'Assistant Professor & Head', phone: null, email: 'hodcys@sece.ac.in' },
    real: [
      { name: 'Dr. S. Yasotha', title: 'Associate Professor' },
      { name: 'Dr. S.K. Harikarthik', title: 'Associate Professor' },
      { name: 'B. Suchithra', title: 'Assistant Professor' },
      { name: 'R. Karthick', title: 'Assistant Professor' },
      { name: 'B. Gomathi', title: 'Assistant Professor' },
      { name: 'S. Arul Prakasham', title: 'Assistant Professor' },
      { name: 'K.S. Dharani', title: 'Assistant Professor' },
      { name: 'J. Kanimozhi', title: 'Assistant Professor' },
      { name: 'S. Thirisha', title: 'Assistant Professor' },
      { name: 'S. Aravind', title: 'Assistant Professor' },
    ],
  },
  {
    code: 'CC', regCode: 'CC', emailCode: 'cce',
    name: 'B.E. Computer and Communication Engineering',
    hod: { name: 'Dr. C. Vivek', title: 'Professor & Head', phone: '+91-4259-200400', email: 'hodcce@sece.ac.in' },
    real: [
      { name: 'Dr. C. Ganesh', title: 'Professor' },
      { name: 'S. Dhamodharan', title: 'Assistant Professor' },
      { name: 'R. Babitha Lincy', title: 'Assistant Professor' },
      { name: 'R.R. Thirrunavukkarasu', title: 'Assistant Professor' },
      { name: 'G.G. Sreeja', title: 'Assistant Professor' },
      { name: 'G. Dency Flora', title: 'Assistant Professor' },
      { name: 'R. Megala', title: 'Assistant Professor' },
      { name: 'N. Banupriya', title: 'Assistant Professor' },
      { name: 'P. Megala', title: 'Assistant Professor' },
      { name: 'R. Arun', title: 'Assistant Professor' },
      { name: 'R. Sangeetha', title: 'Assistant Professor' },
      { name: 'R. Preethi', title: 'Assistant Professor' },
    ],
  },
  {
    code: 'EC', regCode: 'EC', emailCode: 'ece',
    name: 'B.E. Electronics and Communication Engineering',
    hod: { name: 'Dr. N. Shanmugasundaram', title: 'Professor & Head', phone: '+91-4259-200350', email: 'hodece@sece.ac.in' },
    real: [
      { name: 'Dr. K.N. Vijeyakumar', title: 'Professor' },
      { name: 'Dr. L. Raja', title: 'Professor' },
      { name: 'Dr. N. Kumareshan', title: 'Professor' },
      { name: 'Dr. R. Michaelraj Kingston', title: 'Professor' },
      { name: 'Dr. C. Venkataramanan', title: 'Professor' },
      { name: 'Dr. S. Suresh', title: 'Professor' },
      { name: 'Dr. K. Mohaideen Abdul Kadhar', title: 'Professor' },
      { name: 'Dr. N. Muthukumaran', title: 'Professor' },
    ],
  },
  {
    code: 'EE', regCode: 'EE', emailCode: 'eee',
    name: 'B.E. Electrical and Electronics Engineering',
    hod: { name: 'Dr. W. Rajan Babu', title: 'Professor & Head', phone: '+91-4259-200385', email: 'hodeee@sece.ac.in' },
    real: [
      { name: 'Dr. D. Gunapriya', title: 'Associate Professor' },
      { name: 'Dr. M. Geetha', title: 'Assistant Professor' },
      { name: 'Dr. P. Anbarasu', title: 'Assistant Professor' },
      { name: 'Dr. N. Pushpalatha', title: 'Assistant Professor' },
      { name: 'Dr. S. Sheikameer Batcha', title: 'Assistant Professor' },
      { name: 'B. Hemananth', title: 'Assistant Professor' },
      { name: 'R. Premkumar', title: 'Assistant Professor' },
      { name: 'R. Hariharan', title: 'Assistant Professor' },
      { name: 'K. Raj Thilak', title: 'Assistant Professor' },
      { name: 'C. Mohan Raj', title: 'Assistant Professor' },
      { name: 'R. Sasikumar', title: 'Professor of Practice' },
      // Dr. Sudha Mohanram (Professor & Principal) is an institution-wide role,
      // not EEE-specific — seeded once as the institution's 'principal' account instead.
    ],
  },
  {
    code: 'ME', regCode: 'ME', emailCode: 'mech',
    name: 'B.E. Mechanical Engineering',
    hod: { name: 'Dr. R. Suresh Kumar', title: 'Professor & Head', phone: '+91-4259-200430', email: 'hodmech@sece.ac.in' },
    real: [
      { name: 'Dr. G. Karuppusamy', title: 'Professor' },
      { name: 'Dr. R.K. Suresh', title: 'Professor' },
      { name: 'Dr. T. Ramakrishnan', title: 'Professor' },
      { name: 'Dr. S. Venkatesh', title: 'Professor' },
      { name: 'Dr. N.K. Millerjothi', title: 'Professor' },
      { name: 'Dr. P. Ganeshan', title: 'Professor' },
      { name: 'Dr. M. Karthikeyan', title: 'Associate Professor' },
      { name: 'Dr. G. Gokilakrishnan', title: 'Associate Professor' },
      { name: 'Dr. B. Sugumaran', title: 'Associate Professor' },
      { name: 'Dr. S. Ganeshkumar', title: 'Associate Professor' },
      { name: 'Dr. Y. Suresh Babu', title: 'Associate Professor' },
      { name: 'Dr. V. Naveenprabhu', title: 'Associate Professor' },
      { name: 'Dr. V. Magesh Kannan', title: 'Associate Professor' },
      { name: 'Dr. Bipin Kumar Singh', title: 'Assistant Professor' },
      { name: 'Dr. K. Sathish', title: 'Assistant Professor' },
      { name: 'A. Vimal', title: 'Assistant Professor' },
      { name: 'D. Pradeep Kumar', title: 'Assistant Professor' },
      { name: 'S. Gokul', title: 'Assistant Professor' },
      { name: 'R. Vivek', title: 'Assistant Professor' },
      { name: 'N. Vishnu Sakravarthy', title: 'Assistant Professor' },
      { name: 'S. Gowtham', title: 'Assistant Professor' },
      { name: 'M. Tamil Selvan', title: 'Assistant Professor' },
    ],
  },
  {
    code: 'AD', regCode: 'AD', emailCode: 'aids',
    name: 'B.Tech Artificial Intelligence and Data Science',
    hod: { name: 'Dr. G. Sathish Kumar', title: 'Associate Professor & HOD', phone: '+91-4259-200452', email: 'hodaids@sece.ac.in' },
    real: [
      { name: 'Dr. L. Raja', title: 'Professor' },
      { name: 'Dr. K. Mohaideen Abdul Kadhar', title: 'Professor' },
      { name: 'Dr. M. Mohammed Mustafa', title: 'Associate Professor' },
      { name: 'Dr. G. Shobana', title: 'Associate Professor' },
      { name: 'Dr. A. Sivaramakrishnan', title: 'Associate Professor' },
      { name: 'Dr. M.P. Geetha', title: 'Associate Professor' },
      { name: 'Dr. M. Thenmozhi', title: 'Assistant Professor' },
      { name: 'Dr. M. Nivaashini', title: 'Assistant Professor' },
      { name: 'Dr. P. Dinesh Kumar', title: 'Assistant Professor' },
      { name: 'Dr. T. Kanimozhi', title: 'Assistant Professor' },
      { name: 'Dr. L.R. Sujithra', title: 'Assistant Professor' },
    ],
  },
  {
    code: 'CB', regCode: 'CB', emailCode: 'csbs',
    name: 'B.Tech Computer Science and Business Systems',
    hod: { name: 'Dr. P.L. Rajarajeswari', title: 'Professor & Head', phone: '+91-4259-200396', email: 'hodcsbs@sece.ac.in' },
    real: [
      { name: 'Dr. C. Arunkumar', title: 'Associate Professor' },
      { name: 'Dr. P.D. Mahendhiran', title: 'Associate Professor' },
      { name: 'Dr. A. Sandana Karuppan', title: 'Associate Professor' },
      { name: 'Dr. K. Cholaraja', title: 'Assistant Professor' },
      { name: 'Dr. Ponni', title: 'Assistant Professor' },
      { name: 'K.P. Siva', title: 'Assistant Professor' },
      { name: 'E. Saranya', title: 'Assistant Professor' },
      { name: 'G. Priyanka', title: 'Assistant Professor' },
      { name: 'D. Ramya', title: 'Assistant Professor' },
      { name: 'M. Mohanraj', title: 'Assistant Professor' },
      { name: 'K. Bhuvaneswari', title: 'Assistant Professor' },
      { name: 'S. Arul Prakasham', title: 'Assistant Professor' },
      { name: 'A. Bharathiraja', title: 'Professor of Practice' },
      { name: 'S. Shankara Varshith', title: 'Assistant Professor of Practice' },
    ],
  },
  {
    code: 'IT', regCode: 'IT', emailCode: 'it',
    name: 'B.Tech Information Technology',
    hod: { name: 'Dr. S. Siamala Devi', title: 'Professor & Head', phone: '+91-4259-200390', email: 'hodit@sece.ac.in' },
    real: [
      { name: 'Dr. P. John Augustine', title: 'Professor' },
      { name: 'Dr. V. Saranya', title: 'Associate Professor' },
      { name: 'Dr. T. Jayapratha', title: 'Assistant Professor' },
      { name: 'Dr. P. Kalpana', title: 'Assistant Professor' },
      { name: 'Dr. D. Saranya', title: 'Assistant Professor' },
      { name: 'Dr. R. Poonkodi', title: 'Assistant Professor' },
      { name: 'C. Vasanthakumar', title: 'Assistant Professor' },
      { name: 'Minu Balakrishnan', title: 'Assistant Professor' },
      { name: 'U. Prakash', title: 'Assistant Professor' },
      { name: 'V. Viswanathan', title: 'Assistant Professor' },
      { name: 'G. Swaminathan', title: 'Assistant Professor' },
      { name: 'N. Anand', title: 'Assistant Professor' },
      { name: 'R.P. Vijai Ganesh', title: 'Professor of Practice' },
    ],
  },
];

const BATCHES = [
  { name: '2023-2027', start: 2023, end: 2027, currentSemester: 7 },
  { name: '2024-2028', start: 2024, end: 2028, currentSemester: 5 },
  { name: '2025-2029', start: 2025, end: 2029, currentSemester: 3 },
  { name: '2026-2030', start: 2026, end: 2030, currentSemester: 1 },
];

const QUOTAS = ['Government', 'Government + First Graduate', '7.5% Reservation', 'Management'];
const DEMAND_CATEGORIES = ['Tuition Fee', 'Special Fee', 'Development Fee'];
const DESIGNATIONS = [
  { title: 'Professor', category: 'teaching' },
  { title: 'Associate Professor', category: 'teaching' },
  { title: 'Assistant Professor', category: 'teaching' },
  { title: 'Professor of Practice', category: 'teaching' },
  { title: 'Assistant Professor of Practice', category: 'teaching' },
  { title: 'Professor & Head', category: 'teaching' },
  { title: 'Associate Professor & HOD', category: 'teaching' },
  { title: 'Assistant Professor & Head', category: 'teaching' },
];

// ~20 real certificate types the user listed (docs/06_SEED_DATA_PLAN.md §4.3)
const CERTIFICATE_TYPES = [
  'SSLC Certificate',
  'HSC Certificate',
  'Transfer Certificate',
  'Community Certificate',
  'First Graduate Joint Declaration',
  'Government Quota Acknowledgement Order',
  'Initial Payment Acknowledgement Receipt',
  'Passport Size Photographs (4 Nos)',
  'Parent Photograph',
  'Income Certificate',
  'Migration Certificate',
  'Conduct Certificate',
  'Medical Certificate',
  'Fitness Certificate',
  'Bonafide Certificate',
  'Diploma or Degree Certificate',
  'Counselling Call Order',
  'Nativity Certificate',
  'Polytechnic Marksheets (Semester 1 to 6)',
  'UG Marksheet (Semester 8)',
  'UG Provisional Certificate',
];

// Hostel room types (docs/06_SEED_DATA_PLAN.md §4.2) — name encodes hostel+block+type for uniqueness.
const BOYS_ROOM_TYPES = [
  { name: 'Boys A/B Block 4 Sharing Non-Bath Attached', fee: 105000, block: 'A', sharing: 4 },
  { name: 'Boys A/B Block 4 Sharing Non-Bath Attached (Wooden Furniture)', fee: 112000, block: 'B', sharing: 4 },
  { name: 'Boys C Block 4 Sharing Non-Bath Attached', fee: 112000, block: 'C', sharing: 4 },
  { name: 'Boys C Block 3 Sharing Non-Bath Attached', fee: 120000, block: 'C', sharing: 3 },
  { name: 'Boys C Block 2 Sharing Non-Bath Attached', fee: 125000, block: 'C', sharing: 2 },
  { name: 'Boys D Block 4 Sharing Bath Attached', fee: 120000, block: 'D', sharing: 4 },
  { name: 'Boys D Block 3 Sharing Bath Attached', fee: 135000, block: 'D', sharing: 3 },
  { name: 'Boys D Block 2 Sharing Bath Attached', fee: 150000, block: 'D', sharing: 2 },
  { name: 'Boys E Block 3 Sharing Bath Attached', fee: 135000, block: 'E', sharing: 3 },
  { name: 'Boys F Block 4 Sharing Bath Attached', fee: 120000, block: 'F', sharing: 4 },
  { name: 'Boys F Block 3 Sharing Bath Attached', fee: 135000, block: 'F', sharing: 3 },
];
const GIRLS_ROOM_TYPES = [
  { name: 'Girls A Block 4 Sharing Non-Bath Attached', fee: 105000, block: 'A', sharing: 4 },
  { name: 'Girls A Block 4 Sharing Non-Bath Attached (Wooden Furniture)', fee: 112000, block: 'A', sharing: 4 },
  { name: 'Girls B Block 4 Sharing Bath Attached', fee: 120000, block: 'B', sharing: 4 },
  { name: 'Girls B Block 3 Sharing Bath Attached', fee: 135000, block: 'B', sharing: 3 },
  { name: 'Girls C Block 4 Sharing Bath Attached', fee: 120000, block: 'C', sharing: 4 },
  { name: 'Girls C/D Block 4 Sharing Apartment-Type Bath Attached', fee: 120000, block: 'C', sharing: 4 },
  { name: 'Girls C/D Block 3 Sharing Bath Attached', fee: 135000, block: 'D', sharing: 3 },
  { name: 'Girls C/D Block 2 Sharing Bath Attached', fee: 150000, block: 'D', sharing: 2 },
];

// ---------------------------------------------------------------------------
// Transport routes: REAL data, verbatim from the user's own message earlier
// in this conversation (the actual SECE bus-route/stop-sequence document,
// "Bus 1" through "Bus 34" skipping unused numbers). Not re-derived or
// fabricated — every route name and its ordered real stop list below is
// copied exactly as given.
// ---------------------------------------------------------------------------
// Used for student address generation (city/street placeholders), separate
// from the real transport route/stop data below.
const AREA_NAMES = [
  'Gandhipuram', 'Ukkadam', 'Podanur', 'Sundarapuram', 'Vadavalli', 'Saravanampatti',
  'Peelamedu', 'Singanallur', 'Ramanathapuram', 'Kuniyamuthur', 'Madukkarai',
  'Kinathukadavu', 'Pollachi', 'Sulur', 'Thudiyalur', 'Vilankurichi', 'Kavundampalayam',
  'Selvapuram', 'Ganapathy', 'Race Course', 'Town Hall', 'RS Puram', 'Chinnavedampatti',
  'Irugur', 'Kalapatti', 'Malumichampatti', 'Neelambur', 'Perur', 'Sowripalayam',
  'Vellalore', 'Karamadai', 'Mettupalayam', 'Annur', 'Palladam', 'Tiruppur',
  'Udumalpet', 'Valparai', 'Anaimalai',
];

const REAL_ROUTES_RAW = [
  ['Bharathiyar University - Bus 1', ['Bharathiyar University', 'Vadavalli', 'Milk company', 'Gandhipark', 'Ukkadam', 'Sundarapuram', 'Premier mills', 'Kinathukadavu']],
  ['Kottampatti - Pollachi - Bus 2', ['Kottampatti', 'Pollachi', 'Vadakipalayam privu', 'Kovilpalayam', 'Thamaraikulam', 'Kinathukadavu']],
  ['Saravanampatti (Via Ramanathapuram & Chettipalayam) - Bus 3', ['Saravanampatti', 'Gandhipuram – Thiruvallur bus stand', 'Women’s polytechnic', 'Lakshmi mills', 'Ramanathapuram', 'Nanjundapuram GD tank', 'Chettipalayam', 'Panapatti pirivu', 'Vadasithur']],
  ['Kovai pudur (Via Madukari Market) - Bus 4', ['Kovaipudur', 'Sundakamuthur', 'Perur', 'Selvapuram', 'Puttuviki', 'Kuniamuthur High School', 'Madukkarai Quary Office', 'Madukkarai market', 'Malumichampatti', 'Kinathukadavu']],
  ['Vadakkipalayam pirivu - Chenniyur (Via sulakkal) - Bus 5', ['Vadakipalayam Pirivu', 'Ponnapuram pirivu', 'Vadakipalayam', 'Sulakkal', 'Chennaiyur', 'Sulakkal – Roots Company road', 'Thamaraikulam', 'Kinathukadavu']],
  ['Sulur (Via Ramanathapuram) - Bus 6', ['Sulur', 'Ondipudur', 'Siganallur', 'Sowripalayam', 'Puliyakulam', 'Ramanathapuram', 'Najundapuram', 'Chettipalayam – Vadasithur']],
  ['Tirupur - GH (Via Old Bus stand,Mangalam) - Bus 9', ['Kovil vazhi Bus stand', 'Old bus Stand', 'mangalam', '63-Velampalayam', 'Palladam GH', 'Karaidivavi', 'Sellakarachal', 'Lakshiminaiyakanpalayam', 'Panapatti', 'Panapatti pirivu', 'Vadasithur']],
  ['Dhali (Via Negamam) - Bus 11', ['Kurichikottai', 'Dhali', 'Erichanampaatti', 'Kondigiyam', 'Udukkampalayam', 'Lakshmapuram', 'Kedimedu', 'Singuvadai', 'Poosaripatti', 'Negamam', 'Cheetipudur', 'Vadasithur']],
  ['Pollachi (Via Negemam) - Bus 12', ['Pollachi Their Nilayam', 'Puliyampatti', 'Negamam', 'Vadasithur']],
  ['Jallipatti (Via Mandrampalayam) - Bus 14', ['Jallipatti', 'Senjeriputhur', 'Kamalapatti', 'S.Ayyampalayam', 'J.Krishnapuram', 'Pachagoundampalayam', 'Senjerimalai', 'Kattampatti', 'Mandrampalayam', 'Vadasithur']],
  ['Udumalpet - Pallapalayam (Via Negamam) - Bus 15', ['Pallapalayam', 'Bodipatti', 'Udumalpet', 'Kuruncherri', 'Pethampampatti', 'Kongal Nagaram', 'Pudhupalayam', 'Poosaripatti', 'Avalpatti', 'Negamam', 'Kapplangarai', 'Vadasithur']],
  ['Thirumurugan Poondi (Via Kamanaikanpalayam) - Bus 18', ['Thirumurugan Poondi', 'Annuparpalayam', 'Pushpa theatre', 'Old bus Stand', 'Thennampalayam', 'Veerapandi', 'Arulpuram', 'Palladam', 'Vadugapalayam', 'Venkitapuram', 'Kamanaikkanpalayam', 'Sulthanpet', 'Senjeriprivu', 'Poorandam palayam', 'Matuvavi', 'Vadasithur']],
  ['Kalapatti (Via Hope College) - Bus 19', ['Kalapatti', 'Nehrunager', 'Sitra', 'Hope College', 'Peelamedu', 'Lakshmi Mills', 'Puliyakulam', 'Sungam-bye pass', 'Ukkadam', 'Sundarapuram', 'Malumichampatti', 'Kinathukadavu']],
  ['Kottur (Via NM Sungam) - Bus 20', ['Angalakurichi', 'Kottur', 'Somanthurai Chitthur', 'NM Sungam', 'samathur', 'Suleeswaran patti', 'Pollachi', 'Kovilpalayam', 'Kinathukadavu']],
  ['Kaliyapuram ( Via Pollachi) - Bus 21', ['Kaliyapuram', 'Vettaikaranpudur', 'Annaimalai', 'Sungam', 'Ambrampalayam', 'Uthukuli', 'Pollachi', 'Kovilpalayam', 'Kinathukadavu']],
  ['Vellalore - Bus 22', ['Vellalore – LG Nager', 'Konavaikkal palayam', 'GD tank', 'Chettipalayam', 'Thekkani', 'Karacheri', 'Vadasithur']],
  ['Vallakunda puram - Bus 23', ['Vallakundapuram', 'Ramachandrapuram', 'Virigal patti pirivu', 'Udhavipalayam', 'Negamam', 'Chettipudur', 'Kapplangarai', 'Devanampalayam', 'Chettikkapalayam', 'Cherripalayam', 'Kurinallipalayam', 'Vadasithur']],
  ['Poneri - Udumalpet ( Via Pollachi) - Bus 24', ['Poneri', 'Udumalpet', 'Mukkonam', 'Komangalam', 'Thippampatti', 'RTO Office', 'Pollachi', 'kinathukadavu']],
  ['Meenachipuram (Via Pollachi) - Bus 25', ['Meenachipuram', 'Valandhyamaram', 'Kaliyappankavundanpudur pirivu', 'Authu pollachi', 'Ramapattinam pirivu', 'Ayyampalayam', 'Nallur', 'NGM College', 'Pollachi', 'Achipatti', 'Kullakapalyam pirivu', 'Kovilpalayam', 'Kinathukadavu']],
  ['JothiNager ( Via Pollachi) - Bus 27', ['Jothinager', 'Omprakash Theatre', 'Pollachi', 'Mahalingapuram Arch', 'Nanjaigoundanputhur', 'Kinathukadavu']],
  ['Ramanathapuram (Via Sundarapuram) - Bus 28', ['Ramanathapuram', 'Podanur RS', 'Saradha mill road', 'Sundarapuram', 'Malumichampatti', 'Kinathukadavu']],
  ['Dhansarpatti ( Via Kudimangalam) - Bus 29', ['Dhasarpatti', 'Kudimangalam', 'Poolavadi pirivu', 'Periyapatti', 'Munkillthozhuvu pirivu', 'Veethampatti', 'Chandrapuram', 'Sirukanlanthai', 'Guruveygoundampalayam', 'Andipalayam', 'Vadasithur']],
  ['Edyarpalayam (via Abirami Hospital) - Bus 30', ['Edayarpalayam', 'Avila Convent', 'S.B.Kovil(MTP Road)', 'Poo Market', 'Marakadai', 'Abirami hospital', 'Kamaraj Nager', 'Madukarai Market', 'Malumichampatti', 'Kinathukadavu']],
  ['Periyanaikkanpalayam (Via Ukkadam) - Bus 31', ['Periyanaikkan palayam', 'Narasimanaikanpalayam', 'Vadamadurai', 'Thudiyalur', 'Kavundampalayam', 'MTP bus stand', 'S.B.Kovil', 'Poomarket', 'Marakadai', 'Ukkadam', 'Malumichampatti', 'Kinathukadavu']],
  ['Madathukulam (Via Pollachi) - Bus 32', ['Madathukulam', 'Palappampatti', 'Udamalpet', 'Mukkonam', 'Komangalam', 'Thippampatti', 'RTO Office', 'Pollachi', 'Kinathukadavu']],
  ['Perumanallur - Tirupur Pandiyan nager (Via New bus stand,Veerapandi,Palladam) - Bus 33', ['Perumanallur', 'Pandiyan nager', 'New Bus stand', 'Veerapandi pirivu', 'Arulpuram', 'Palladam', 'Vadugapalayam', 'Venkitapuram', 'Kamanaikkanpalayam', 'Sulthanpet', 'Senjeriprivu', 'Poorandam palayam', 'Matuvavi', 'Vadasitur']],
  ['Sivanandhacolony (Via Nachipalayam) - Bus 34', ['Sivanandhacolony', 'Tatabad', 'Gandhipark', 'Chokkampudur', 'Sivalaya Theatre', 'Puttiviki', 'Kuniamuthur High School', 'Madukkarai -Quary office', 'Madukkarai – Nataraj', 'Hospital', 'Nachipalayam', 'Othalkalmandapam', 'Premier mills', 'Kinathukadavu']],
];
function buildRoutes() {
  return REAL_ROUTES_RAW.map(([name, stops]) => ({
    name,
    boardingArea: stops[0],
    distanceKm: randInt(12, 45), // real distance not given per-route; reasonable generated value, flagged in header
    departure: '06:45:00',
    arrival: '08:00:00',
    stops: stops.concat(['SECE Campus']),
  }));
}
const TRANSPORT_ROUTES = buildRoutes();

// ---------------------------------------------------------------------------
// Synthetic Indian name pools — kept disjoint (faculty vs. student) per the
// task's "generate fresh ones, don't reuse faculty names" instruction.
// ---------------------------------------------------------------------------
const FAC_FIRST = ['Aravind', 'Bala', 'Chandra', 'Deepak', 'Elango', 'Farhan', 'Gokul', 'Harish', 'Ishwar', 'Jagan',
  'Kavin', 'Lokesh', 'Manoj', 'Naveen', 'Om', 'Pranav', 'Sanjay', 'Tarun', 'Uday', 'Vignesh',
  'Yogesh', 'Abinaya', 'Bhavya', 'Chitra', 'Divya', 'Esha', 'Gayathri', 'Harini', 'Indhu', 'Janani',
  'Kavya', 'Meena', 'Nithya', 'Pooja', 'Radha', 'Sneha', 'Uma', 'Vidhya', 'Yamini', 'Bharath'];
const FAC_LAST = ['Kumar', 'Raman', 'Subramanian', 'Krishnan', 'Murugan', 'Pandian', 'Selvam', 'Rajan', 'Natarajan',
  'Balasubramanian', 'Venkatesh', 'Sivakumar', 'Mani', 'Gopal', 'Ravi', 'Prasad', 'Elangovan', 'Chezhian',
  'Baskar', 'Anand', 'Suresh', 'Ramesh', 'Senthil', 'Kannan', 'Muthu', 'Shankar', 'Vijay', 'Prakash', 'Mahesh'];

const STU_FIRST = ['Arun', 'Ajay', 'Akash', 'Bharani', 'Dinesh', 'Ezhilan', 'Ganesh', 'Hariharan', 'Jayaram',
  'Karthik', 'Logesh', 'Madhavan', 'Naresh', 'Prasanth', 'Rajesh', 'Sathish', 'Thirumal', 'Vikram', 'Yuvan',
  'Aishwarya', 'Bhuvana', 'Deepika', 'Ezhili', 'Gomathi', 'Harini', 'Ishwarya', 'Jeevitha', 'Kavitha', 'Lavanya',
  'Malar', 'Nandhini', 'Priya', 'Ramya', 'Sowmya', 'Thenmozhi', 'Vaishnavi', 'Yamuna', 'Abinav', 'Dhanush', 'Keerthi'];
const STU_LAST = ['S', 'R', 'M', 'K', 'P', 'V', 'N', 'G', 'T', 'D', 'B', 'C', 'A', 'L', 'J'];

// ===========================================================================
// Semester-derivation helpers (per plan doc §5 item 10)
// ===========================================================================
function semesterDateRange(batchStartYear, semNo) {
  // sem k: base = start + floor((k-1)/2); odd k -> Jul-Dec(base); even k -> Jan-Jun(base+1)
  const base = batchStartYear + Math.floor((semNo - 1) / 2);
  if (semNo % 2 === 1) {
    return { start: `${base}-07-01`, end: `${base}-12-31` };
  }
  return { start: `${base + 1}-01-01`, end: `${base + 1}-06-30` };
}

// ===========================================================================
// Name parsing for real faculty ("Dr. R. Subha" -> {...})
// ===========================================================================
function parseRealName(raw) {
  const stripped = raw.replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s*/i, '').trim();
  const tokens = stripped.split(/\s+/);
  let first_name, last_name;
  if (tokens.length === 1) {
    first_name = tokens[0];
    last_name = tokens[0];
  } else {
    first_name = tokens[0];
    last_name = tokens.slice(1).join(' ');
  }
  const core = last_name.split(' ')[0].replace(/[^A-Za-z]/g, '') || 'faculty';
  const initial = (first_name.replace(/[^A-Za-z]/g, '').charAt(0) || 'x').toLowerCase();
  return { first_name, last_name, core: core.toLowerCase(), initial };
}

// Global uniqueness guard for generated emails/codes
const usedEmails = new Set();
function uniqueEmail(base) {
  let email = base;
  let n = 2;
  while (usedEmails.has(email)) {
    email = base.replace('@sece.ac.in', '').replace('@gmail.com', '') + n +
      (base.endsWith('@gmail.com') ? '@gmail.com' : '@sece.ac.in');
    n++;
  }
  usedEmails.add(email);
  return email;
}

function randomMobile() {
  const first = pick(['6', '7', '8', '9']);
  let rest = '';
  for (let i = 0; i < 9; i++) rest += randInt(0, 9);
  return first + rest;
}
function randomAadhaar() {
  let s = '';
  for (let i = 0; i < 12; i++) s += randInt(0, 9);
  return `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8, 12)}`;
}
function randomPAN() {
  const letters = () => String.fromCharCode(65 + randInt(0, 25));
  let l5 = ''; for (let i = 0; i < 5; i++) l5 += letters();
  let d4 = ''; for (let i = 0; i < 4; i++) d4 += randInt(0, 9);
  return `${l5}${d4}${letters()}`;
}
function randomBankAccount() {
  const len = randInt(9, 16);
  let s = '';
  for (let i = 0; i < len; i++) s += randInt(0, 9);
  return s;
}
function randomIFSC() {
  const bank = pick(['SBIN', 'HDFC', 'ICIC', 'IOBA', 'CNRB', 'UBIN']);
  return `${bank}0${randInt(100000, 999999)}`.slice(0, 11);
}
const BANK_NAMES = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Indian Overseas Bank', 'Canara Bank', 'Union Bank of India'];
function randomVehiclePlate() {
  const letters2 = () => String.fromCharCode(65 + randInt(0, 25)) + String.fromCharCode(65 + randInt(0, 25));
  return `TN-38-${letters2()}-${randInt(1000, 9999)}`;
}

// ===========================================================================
// BEGIN OUTPUT
// ===========================================================================

line(`--
-- seed_aiml_and_all_departments.sql
-- ===========================================================================
-- Auto-generated by EOSbackend1/scripts/generate-seed-sql.js
-- Generated at: ${new Date().toISOString()}
-- Source analysis: docs/06_SEED_DATA_PLAN.md (all open questions resolved)
--
-- WHAT THIS FILE DOES
--   PART 1 (original): Seeds the "core" academic/fee/hostel/transport/
--   certificate structure for all 10 real UG departments at Sri Eshwar
--   College of Engineering (SECE): departments, courses, batches, quotas,
--   demand categories, designations, certificate types, hostel room types +
--   hostels + blocks + rooms, transport routes + stages, academic calendars,
--   fee structures/items/concessions, classes, subjects, faculty (+
--   sensitive info), students (+ profiles/family/contacts/addresses/
--   identity marks/certificates/transport & hostel mapping/fee demand
--   mapping), class mentors, faculty-subject-class mapping, parent users +
--   parent_student_mapping, and one seed account per remaining real role.
--
--   PART 2 (extension pass, same date): companies (171 REAL recruiter names
--   verbatim from sece.ac.in/recruiters/ + separately-confirmed names);
--   library (book_categories, 80 books = 8 real standard engineering
--   textbooks/department, e_resources e-book entries for the same real
--   titles); sports (8 real disciplines, 4 real-named facilities from
--   sece.ac.in); medical centre (medical_staff w/ synthetic names,
--   medical_services, medical_equipment); 4 already-graduated historical
--   batches (2018-2022 .. 2021-2025, 5 students/section — smaller than the
--   15/section current batches, a deliberate size choice to avoid doubling
--   the file) with soa_applications/users/students/profiles/family/
--   contacts/certificates, marked status='inactive' (schema's
--   user_status_enum has no dedicated 'graduated' value) and linked to real
--   alumni_batches/alumni_members rows; historical placement_drives +
--   student_drive_applications for a realistic subset of those now-graduated
--   students against real recruiter names; and current placement_drives
--   (disclosed + undisclosed variants) + student_drive_applications for a
--   realistic subset of the current final-year (2023-2027) batch.
--
--   PART 3 (this extension pass, same date): exam_types (CIA1/CIA2/CIA3 +
--   University End Semester Exam) and exams (one row per batch x exam_type,
--   exams being batch-scoped not class-scoped in this schema) for all 4
--   current batches' active semester; exam_subject_mapping for CIA1
--   (published) and CIA2 (mapped only) across every current class's real
--   subjects; exam_marks for CIA1 only (5 of 15 students/class/subject,
--   realistic score spread + a small absent fraction); one
--   result_publications row per batch's CIA1 exam; a subset (30) of
--   revaluation_requests against the lowest CIA1 scores. period_timings
--   (7 real periods, 1 lunch break) + timetable_slots (full Mon-Sat grid for
--   all 160 current classes, reusing the exact faculty/subject pairs
--   already generated in faculty_subject_class_mapping, rotated daily).
--   venues (5 rows, 2 reusing already-seeded real sports_facilities
--   location names) + venue_bookings (5 rows, mixed approved/pending,
--   referencing real HOD/placement/sports_admin seed users).
--   attendance_records for exactly one recent week (5 real weekdays,
--   2026-08-17 to 2026-08-21) for all 160 current classes, one daily
--   present/absent/on_duty row per student per class (subject_id NULL —
--   models the daily roll-call register, not a full per-period/per-subject
--   entry set) — explicitly NOT the full semester for all ~2,400 students.
--
--   PART 4 (this extension pass, same date — item 10 + item 13 of the
--   remaining numbered scope only): announcements (5 rows, shape verified
--   against announcements.service.ts's create() branches) covering all 5
--   real target_audience values (students/teachers/roles/parents/
--   edc_founders) with real HOD/coordinator/principal/billing posters +
--   announcement_class_mapping (3 rows, students/parents-targeted) +
--   announcement_role_mapping (2 rows, library+placement roles); a
--   notifications batch (25 rows: announcement_new for a 3-student sample
--   per class-targeted announcement + exam_result_published for a 4-student
--   sample per batch, tied to the real CIA1 result_publications from PART
--   3); audit_logs (5 rows, shape verified against audit-log.service.ts,
--   entity_type='announcement' only, tied to the 5 announcements above).
--
--   PART 5 (this extension pass, same date — items 6 and 7 of the remaining
--   numbered scope): LMS — one lms_folders row per real
--   faculty_subject_class_mapping row (960 = 160 classes x 6 subjects),
--   + lms_folder_classes linking each to its class, + 1 generic lms_notes
--   and 1 generic lms_resources row per folder (960 each; titles explicitly
--   generic placeholders, no real syllabus content available); assignments
--   (960, 1 per mapping, sequence_no=1, generic title) +
--   student_assignment_status for a 3-of-15-student sample per assignment
--   (2880 rows, ~70% marked submitted with marks). Feedback —
--   feedback_rating_scales ("Standard 5-Point Scale") + its 5
--   feedback_rating_scale_options; feedback_question_templates (4 generic
--   THEORY + 4 generic LABORATORY template questions); feedback_forms (160,
--   1 general-type form per currently-active class, created by the
--   pre-existing academic_coordinator seed account, reusing the rating
--   scale) + feedback_questions (480, 3 generic questions/form: 2 rating +
--   1 free-text) + feedback_responses (2400, a 5-of-15-student sample per
--   form answering all 3 questions). The newer end-semester feedback-matrix
--   tables (feedback_assignments/feedback_assignment_questions/
--   feedback_faculty_responses) were deliberately NOT touched in this pass
--   — see NOT REACHED below.
--
--   PART 6 (this extension pass, same date — items 3, 8, 9, 11, 12 of the
--   remaining numbered scope): hall_plans (1/batch) + seating_plan_versions/
--   seating_plan_version_venues (1/batch, published) + seating_arrangements
--   (20-of-~600-per-batch real currently-enrolled student sample, 80 rows) +
--   invigilation_allocation_batches (1/batch) + invigilation_duties (4
--   rotating faculty/batch: 1 chief + 3 relief, 16 rows) + hall_tickets (one
--   per seated student, 80 rows) for the real University End Semester Exam
--   rows created in PART 3 (exam_date derived from each batch's real
--   semester-end date minus 10 days; that exam's exam_subject_mapping is
--   still deliberately not created — hall tickets/seating do not require it
--   in this schema, only exam_id). Appraisal — appraisal_cycles (1, current
--   AY), appraisal_divisions (4: Academic/Project/Online Courses/Paper
--   Publications), appraisal_criteria (7, real max_score/weightage per
--   division), appraisal_requests (3 non-HOD faculty/department sample = 30
--   of ~500, mixed status, real HOD-then-principal approval chain — the
--   schema's management_approved_by is the closest real role to "management"
--   and is reused for that step; hr_scored status rows carry no separate
--   HR-reviewer FK since appraisal_requests has none), appraisal_entries (7
--   per sampled request = 210), appraisal_attachments (1/department's first
--   sampled request = 10). Procurement — vendors (5, CLEARLY SYNTHETIC names,
--   flagged in-line) + vendor_quotations (10, real item categories: 16GB
--   RAM/CPU x10/SSD/Monitor/Printer/AC repair/Glass Door repair) +
--   purchase_indents (2/department = 20) + service_indents (1/department =
--   10) + purchase_order_proposals (10) + service_order_proposals (7) +
--   purchase_orders (5, for the principal_approved subset) + grn (5, for
--   those purchase_orders) + secretary_product_requests/
--   secretary_product_request_items (2 requests/3 items) +
--   secretary_service_requests/secretary_service_request_items (2
--   requests/2 items) — a genuinely separate secretary-requester flow, not
--   conflated with the department purchase_indents/service_indents above.
--   Hostel operations — hostel_wardens (5: 2 super_wardens incl. the
--   pre-existing 'warden' seed account + 3 sub_wardens on real hostel_blocks)
--   + hostel_in_out_ledger (15 hostellers x 5-day recent week x in+out =
--   150 rows) + hostel_outings (12, mixed pending/approved/rejected) +
--   hostel_complaints (15, real category enum, mixed open/in_progress/
--   resolved/escalated) + hostel_mess_feedback (30). Buses/wallet — buses
--   (27, 1 per real transport_route) + bus_documents (54, RC+Insurance per
--   bus) + bus_live_locations (8 current fixes) + wallet_outlets (3) +
--   wallets (200-student sample) + wallet_transactions (400: 1 razorpay
--   credit + 1 outlet-purchase debit per sampled wallet).
--
--   PART 7 (final stretch pass, same date): the end-semester feedback-matrix
--   tables — feedback_assignments (20: 2 sample points/department, a CLOSED
--   final-year 2023-2027/section-A point and a NOT_STARTED first-year
--   2026-2030/section-A point) + feedback_assignment_questions (80, 4/
--   assignment) + feedback_faculty_responses (200, 5-student sample x 4
--   questions for each of the 10 CLOSED assignments only). higher_education_*
--   — universities (6 real-named institutions), application_windows (3),
--   calendar_events (3), coaching_batches (2), loans (3), retake_watchlist
--   (2), standing_returns (2), test_register (4 real test names) — all
--   standalone lookup/aggregate tables per schema (no student FK on any of
--   them) — plus student_higher_education (5-student sample, final-year
--   batch). EDC/incubation/startup ecosystem — student_entrepreneurship (5,
--   final-year sample) + startup_ideas (5) + incubations (3) +
--   incubation_milestones (6) + edc_documents (3) + edc_funding_records (2) +
--   edc_events (3, standalone) + edc_reports (2, standalone), all
--   created/reviewed by the pre-existing edc_coordinator seed account.
--   alumni_announcements (3, posted by the alumni seed account) +
--   alumni_group_messages (8, 2/historical batch, posted by real
--   alumni_members). Remaining sports_* — sports_athlete_profiles (10) +
--   sports_coach_profiles (2) + sports_teams (3) + sports_training_sessions
--   (4) + sports_fixtures (3) + sports_achievements (3) +
--   sports_calendar_notes (3) + sports_od_requests (2) +
--   sports_od_squad_members (6) + sports_budget_requests (2), all reusing the
--   real sports_disciplines/sports_facilities seeded in the earlier pass.
--
--   PART 8 (further extension pass, same date): structural curriculum
--   mapping (class_subjects — one row per already-real class x subject;
--   curriculum_mappings — one row per department x semester x subject,
--   section fixed to 'A' since the table has no per-section unique key) +
--   leave_types (6 real HR leave-type names, standalone lookup) +
--   user_preferences (one row per already-real HOD/principal/coordinator/
--   HR/finance/secretary/warden/billing/EDC/sports-admin seed account) +
--   user_social_links (LinkedIn + department-page links for a 5-HOD sample).
--
--   PART 9 / CLUSTER 1 (later pass, same date): HR / faculty-leave chain.
--   holiday_slots (3 real academic-break rows, standalone lookup, also
--   needed by faculty_holiday_mapping); a fixed 5-per-department sample of
--   the already-real facultyRoster (HOD + 4 others x 10 departments = 50
--   faculty) drives: faculty_leave_balances (one row per sample-faculty x
--   leave_types, current AY), faculty_leaves (real applicant -> HOD ->
--   HR/principal approval chain, one per department), salary_divisions
--   (Basic/HRA/DA/Other breakdown per sample faculty), salary_payments
--   (Jun-Aug 2026 payroll history per sample faculty, Aug left "pending"),
--   faculty_daily_attendance (one real working week, 2026-08-17..21),
--   faculty_holiday_mapping (sample faculty x all 3 holiday_slots),
--   faculty_documents (2 standard HR docs per sample faculty, verified),
--   faculty_id_card_issuances (one per sample faculty), faculty_awards +
--   faculty_publications + faculty_committee_roles (HOD-focused, a couple
--   per department; publication titles are generic real-shaped topics, not
--   claimed as actually-published), faculty_activity_log (2 generic entries
--   per sample faculty), faculty_od_requests + faculty_attendance_corrections
--   (a handful, real approval chain), hr_payroll_requests + payslip_requests
--   + hr_queries (a handful of resolved/pending HR tickets); plus
--   non_teaching_staff (4 per department, real staff_category_enum values,
--   no user account). faculty_hostel_mapping intentionally left empty this
--   pass (no faculty warden currently housed on a mapped hostel room in the
--   existing seed data).
--
--   PART 10 / CLUSTER 2 (later pass, same date): fee/finance historical
--   records. fee_payments (a deterministic sample of 150 currently-enrolled
--   students, every 16th student spread across all dept/batch/section,
--   paying the Tuition Fee item in full + a Special Fee partial payment
--   is_partial=true for 1-in-3 of that sample, real payment_mode rotation
--   including razorpay) + fee_payment_gateway_orders (the razorpay-mode
--   subset, status=success, linked back to their fee_payment) +
--   fee_receipt_numbers/fee_receipt_number_payments (one receipt-number row
--   per 3 consecutive fee_payments) + education_loan_dd (10 Management-quota
--   students from the sample) + refunds (2, one approved/one pending) +
--   expense_categories (6 real category names) + expenses (1/department) +
--   bills (4, against the already-real procurement vendors) +
--   bank_reconciliation_entries (half of the razorpay gateway orders,
--   matched=true).
--
--   PART 11 / CLUSTER 3 (later pass, same date): exam-lifecycle remainder.
--   exam_pass_rules_settings (1 singleton config row) + grade_bands (6 real
--   NBA-style O/A+/A/B+/B/RA bands) + marks_entry_locks (CIA1, locked+
--   published, one row per batch x department = 40) + exam_timetable_versions
--   (1 published version/batch = 4, for the real already-existing CIA2 exam,
--   department_id NULL/institution-wide) + exam_timetable (240: the
--   section-A sample class per dept x batch, across every one of its real
--   CIA2-mapped subjects) + revaluation_windows (1/CIA1 exam = 4, reusing the
--   real CIA1 revaluation_requests already seeded) + malpractice_incidents
--   (4: one per batch, tied to a real CIA1 exam_subject_mapping + a real
--   currently-enrolled student + the real teaching faculty) +
--   hall_ticket_clearance_exceptions (2, fee_due, approved by the real HOD)
--   + seating_plan_venue_departments (40: every batch's real PART-6
--   seating_plan_version_venues row linked to all 10 real departments) +
--   marksheets (320: 2-of-15-students/class sample, plain generated-document
--   record against the real published CIA1 exam — confirmed a genuinely
--   plain insertable table per schema, not app-derived).
--
--   PART 12 / CLUSTER 4 (later pass, same date): medical centre remainder.
--   medical_visits (7: 5 student + 2 faculty walk-ins against the real
--   medical_staff) + medical_bills + medical_bill_items (2 bills, 4 items:
--   medicine + service line each) + medical_camps (3: 2 planning, 1
--   completed with outcome_summary) + pharmacy_stock (5 real-shaped drugs) +
--   pharmacy_dispense_log (3 dispense entries) + sick_room_beds (3) +
--   sick_room_stays (2: one closed stay linked to a real medical_visits row,
--   one currently-open stay) + ambulance_status (1 vehicle) +
--   ambulance_trips (2 historical trips).
--
--   PART 13 / CLUSTER 5 (final stretch pass, same date): OD workflow +
--   project/team module. od_teams (2, one locked/cross-dept) +
--   od_team_members (5) + od_requests (2, one mentor-approved/verified, one
--   pending/awaiting_documents) + od_request_hod_approvals (1, for the
--   cross-department team member) + project_teams (2, real leaders/classes)
--   + project_team_members (5) + project_recruitment_posts (1) +
--   project_join_requests (1) + student_projects (4, mentor-guided).
--
--   PART 14 / CLUSTER 6 (final stretch pass, same date): department
--   showcase. department_achievements (4, one per showcase dept) +
--   achievement_media (4) + achievement_comments (1) + department_documents
--   (3) + department_events (3) + department_labs (4) + department_meetings
--   (2) + department_mous (3) + department_research_funding (3).
--
--   PART 15 / CLUSTER 7 (final stretch pass, same date): scholarships +
--   remaining per-student/admin tables. scholarship_schemes (3) +
--   student_scholarship_awards (3) + student_leaves (3) +
--   student_sensitive_info (5, always-synthetic Aadhaar/PAN) +
--   student_test_scores (12) + student_no_due_status (4) +
--   student_outpasses (3) + student_meeting_notes (3) +
--   student_health_records (5) + student_escalations (1) +
--   campus_outing_requests (2) + bonafide_reasons (4) + bonafide_requests
--   (3) + main_gate_in_out_ledger (6) + visitor_logs (2) +
--   transport_notices (2) + photocopy_requests (dynamically bound to real
--   exam_marks rows via set-based INSERT...SELECT, guarded) +
--   meeting_action_items (3, on the real department_meetings row from
--   CLUSTER 6) + personal_calendar_entries (2) + coordinator_calendar_entries
--   (2) + calendar_events (1, on a real academic_calendars row) +
--   coe_profiles (1) + lesson_plans + lesson_plan_sessions (dynamically
--   bound to real faculty_subject_class_mapping rows via set-based
--   INSERT...SELECT, guarded) + library_racks (4) + library_settings
--   (1, single-row config) + budget_allocations (3). holiday_slots reused
--   as-is (already seeded in an earlier pass).
--
--   PART 16 / CLUSTER 8 (final stretch pass, same date): remaining
--   sports/media/chat/hostel/misc tables. sports_equipment (3) +
--   sports_equipment_issues (1) + sports_fitness_tests (3) +
--   sports_injuries (1) + sports_trials + sports_trial_scores (1 trial, 3
--   scores) + sports_session_attendance (dynamically bound to a real
--   sports_training_sessions row, set-based, guarded) + sports_announcements
--   (1) + sports_reports (1) + student_sports_team_mapping (3); media_team_
--   members (2) + media_equipment + media_equipment_movements (1 each) +
--   media_indents (1) + media_requests + media_shoot_assignments (1 each);
--   chat_conversations (1) + chat_messages (2); device_push_tokens (3);
--   book_borrow_records (3, bound to real already-seeded books by QR code);
--   bus_fuel_logs/bus_safety_checks/bus_service_logs (1 each, dynamically
--   bound to bus_no = 'BUS-001'); hostel_night_attendance (5) +
--   hostel_quit_requests (1, dynamically bound to a real hostel_rooms row)
--   + hostel_settings (1, single-row config) + hostel_goods (1);
--   service_orders (1, dynamically bound to a real principal_approved
--   service_order_proposals row via set-based INSERT...SELECT, guarded);
--   nba_criteria (3) + nba_evidence_items (3); faculty_hostel_mapping (1,
--   a sub-warden faculty housed on-campus, dynamically bound to a real
--   hostel_rooms row — closes the one gap left over from PART 9/CLUSTER 1).
--
--   FINAL SCOPE: 275 of 281 real Prisma schema models have real INSERTs in
--   the generated SQL. Only 6 models remain with zero inserts, all
--   genuinely not seedable by a static seed script — grepped fresh every
--   "INSERT INTO <table>" in the generated SQL against every "model X {" in
--   schema.prisma, not assumed from this list:
--     - model_performance, training_examples, query_logs (ML/chatbot
--       feedback-loop tables populated purely by app/runtime logic)
--     - attendance_record_changes (audit trail populated only when the app
--       edits an existing attendance_records row)
--     - admission_profile_drafts (in-progress admission wizard state,
--       never a finished/seedable record)
--     - roles (pre-existing lookup table per this file's own design — see
--       HARD SAFETY RULES below — only ever referenced via subquery, never
--       inserted into by this script)
--
-- HARD SAFETY RULES FOLLOWED (non-negotiable, re-checked on every INSERT)
--   1. No FK column is ever a bare integer literal. Every FK is resolved via
--      a (SELECT id FROM <parent> WHERE <natural_unique_key> = '<value>')
--      subquery, because this script runs against a REAL, already-populated
--      database whose current row ids are unknown to this script.
--   2. Every INSERT into a table that might already hold conflicting rows
--      (roles referenced only, quotas, demand_categories, designations,
--      certificate_types, hostel_room_types, transport_routes, and every
--      INSERT into users) is guarded with
--      INSERT INTO x (...) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM x
--      WHERE <natural_key> = '...') rather than ON CONFLICT, so it is safe
--      to accidentally run this file twice.
--   3. The whole file is one BEGIN; ... COMMIT; transaction so a real
--      mistake rolls back cleanly.
--   4. Aadhaar/PAN/bank/personal-contact values are ALWAYS synthetic, even
--      for real, publicly-listed HOD/faculty names used elsewhere in this
--      file for name/department/designation/real published work contact
--      info. Never a real individual's real identifier.
--
-- ASSUMPTIONS MADE WHERE THE PLAN DID NOT GIVE AN EXACT NUMBER/VALUE
--   - Quota split across the 15 students/section: 60% Government,
--     10% Government + First Graduate, 5% 7.5% Reservation, 25% Management
--     (~9/1.5/0.75/3.75 per section, rounded per-section deterministically).
--   - Hosteller/day-scholar split: 30% hosteller / 70% day-scholar; among
--     day-scholars, 50% college-transport / 50% own-vehicle.
--   - Subject list: NOT sourced from any real syllabus (none was provided).
--     6 clearly-generic subjects per department per semester actually in
--     use (semesters 1,3,5,7 — the four batches' current semesters), named
--     "<Dept> Semester <n> Subject <k>" with a generic subject_code.
--   - Transport route/stop data: REAL, verbatim from the user's own message
--     in this conversation — all 27 real named routes (Bus 1 through Bus 34,
--     skipping unused numbers, exactly as the user pasted them) with their
--     real ordered stop lists. Per-route distance_km was not given, so a
--     reasonable generated value is used for that one column only; every
--     route name and every stop name is real, not synthetic. Per-stage fee
--     = sequence_no x Rs.250, a generated placeholder (no real per-stage
--     fee was supplied — only the stop sequence itself is real).
--   - fee_structures are quota-scoped only (schema confirms no department
--     column on fee_structures) and generated only for the current
--     academic year "${CURRENT_AY}" (the year actually being billed for all
--     currently-enrolled batches), not one row per historical batch-year.
--   - Government / Government+First-Graduate / 7.5% Reservation quotas
--     share one Rs.1,00,000/year structure, split Tuition Rs.80,000 /
--     Special Rs.10,000 / Development Rs.10,000 (category split not given
--     exactly, chosen as a sensible breakdown).
--   - Management quota fee genuinely varies per the plan doc's instruction
--     ("many students not be same, some may differ") -> modeled as THREE
--     Management fee_structure variants (Rs.1,30,000 / Rs.1,50,000 /
--     Rs.1,75,000 total) rather than one fixed structure, and each
--     Management-quota student is randomly assigned to one of the three.
--   - student_transport_mapping.fee_structure_id and
--     student_hostel_mapping.fee_structure_id are left NULL: this script
--     does NOT build a separate hostel/transport-"applies_to" fee_structure
--     layer (out of the numeric scope actually specified), relying instead
--     on hostel_room_types.fee_amount / transport_stages.fee_amount as the
--     real charge record. Called out explicitly rather than silently
--     invented.
--   - hostel_rooms: a reasonable number of sequentially-numbered rooms per
--     block/room-type is generated (capacity matching the sharing count),
--     sized generously enough to plausibly house the ~30% hosteller
--     population computed above. Not real physical room numbers.
--   - is_mentor: exactly 16 of the 50 faculty per department (matching the
--     16 classes/department needing a class_mentors row) are flagged
--     is_mentor = true, each assigned to exactly one class, 1:1.
--   - faculty.reports_to_faculty_id: every non-HOD faculty member whose
--     designation is NOT "Professor" (i.e. Associate Professor, Assistant
--     Professor, Professor of Practice, Assistant Professor of Practice)
--     reports to their department's HOD; HODs and plain Professors have
--     reports_to_faculty_id = NULL.
--   - Real HOD/faculty names are used only for name/department/designation
--     and the real published work phone/email already listed in the plan
--     doc; every other faculty is a clearly-synthetic filler name (disjoint
--     name pools from students) to reach 50/department.
--   - community values for soa_applications/students: chosen from a small
--     realistic Tamil Nadu set {OC, BC, BCM, MBC, SC, ST} distributed
--     pseudo-randomly, since no real per-student community data exists.
--
-- TABLES DELIBERATELY NOT COVERED (final scope, as of PARTS 13-16 /
-- CLUSTERS 5-8 — the whole schema is now covered except the six genuinely
-- non-seedable models below; every table named in any earlier draft of this
-- comment across prior passes — including marks_entry_locks/grade_bands/
-- exam_timetable/revaluation_windows/malpractice_incidents/hall_ticket_
-- clearance_exceptions, book_borrow_records, feedback_assignments/
-- feedback_assignment_questions/feedback_faculty_responses, nba_criteria/
-- nba_evidence_items, media_requests/media_equipment/media_indents/
-- media_team_members, service_orders, hostel_quit_requests/
-- hostel_night_attendance/hostel_settings, bus_fuel_logs/bus_safety_checks/
-- bus_service_logs, device_push_tokens, chat_conversations/chat_messages,
-- and every appraisal/vendor/purchase/secretary-request/hostel-warden/bus/
-- wallet table from PARTS 1-12 — has since moved from "not covered" to
-- "covered"):
--   model_performance, training_examples, query_logs (ML/chatbot
--   feedback-loop tables populated purely by app/runtime logic);
--   attendance_record_changes (audit trail populated only when the app
--   edits an existing attendance_records row); admission_profile_drafts
--   (in-progress admission wizard state, never a finished/seedable record);
--   roles (pre-existing lookup table per this file's own design — see HARD
--   SAFETY RULES below — only ever referenced via subquery, never inserted
--   into by this script).
--
--   NOTE: higher_education_*, incubations/startup_ideas/
--   student_entrepreneurship/student_higher_education, edc_* and other
--   modules referenced in earlier drafts of this comment as "not covered"
--   were confirmed covered by earlier passes (not this one) — see the
--   fresh grep-derived model list above for the true current state, not
--   this historical narrative.
-- ===========================================================================

BEGIN;

`);

// ---------------------------------------------------------------------------
// TIER 0/1: departments, courses, batches, quotas, demand_categories,
// designations, certificate_types, hostel_room_types, transport_routes
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- TIER 0/1: LOOKUPS');
line('-- ===========================================================================');
blank();

line('-- departments (fresh rows, no guard needed by natural key beyond code)');
insertPlain(
  'departments',
  ['name', 'code', 'office_location', 'contact_phone', 'contact_email'],
  DEPARTMENTS.map((d) => [
    esc(d.name), esc(d.code),
    esc('Kondampatti (P.O), Vadasithur (Via), Kinathukadavu, Coimbatore - 641 202'),
    esc(d.hod.phone || '+91-4259 200 300'),
    esc(d.hod.email),
  ])
);

line('-- courses: one real UG programme per department, duration 4 years');
insertPlain(
  'courses',
  ['name', 'code', 'department_id', 'duration_years'],
  DEPARTMENTS.map((d) => [esc(d.name), esc(`${d.code}-UG`), sub.dept(d.code), '4'])
);

line('-- batches: the 4 currently-enrolled batches as of 2026-08-22');
insertPlain(
  'batches',
  ['name', 'start_year', 'end_year'],
  BATCHES.map((b) => [esc(b.name), num(b.start), num(b.end)])
);

line('-- quotas (guarded: may already exist)');
for (const q of QUOTAS) insertGuardedRow('quotas', ['name'], [esc(q)], 'name', q);

line('-- demand_categories (guarded)');
for (const dc of DEMAND_CATEGORIES) insertGuardedRow('demand_categories', ['name'], [esc(dc)], 'name', dc);

line('-- designations (guarded)');
for (const d of DESIGNATIONS) insertGuardedRow('designations', ['title', 'category'], [esc(d.title), esc(d.category)], 'title', d.title);

line('-- certificate_types (guarded, ~20 real types from the plan doc)');
for (const ct of CERTIFICATE_TYPES) insertGuardedRow('certificate_types', ['name'], [esc(ct)], 'name', ct);

line('-- hostel_room_types (guarded, 11 boys + 8 girls real block/type/fee combinations)');
for (const rt of BOYS_ROOM_TYPES.concat(GIRLS_ROOM_TYPES)) {
  insertGuardedRow('hostel_room_types', ['name', 'fee_amount'], [esc(rt.name), num(rt.fee)], 'name', rt.name);
}

line('-- transport_routes (guarded, 27 REAL routes with real verbatim stop lists)');
for (const r of TRANSPORT_ROUTES) {
  insertGuardedRow(
    'transport_routes',
    ['name', 'distance_km', 'boarding_area', 'departure_time', 'arrival_time'],
    [esc(r.name), num(r.distanceKm), esc(r.boardingArea), esc(r.departure), esc(r.arrival)],
    'name', r.name
  );
}

// ---------------------------------------------------------------------------
// TIER 1: academic_calendars, hostels, hostel_blocks, fee_structures
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- TIER 1: ACADEMIC CALENDARS, HOSTELS/BLOCKS, FEE STRUCTURES');
line('-- ===========================================================================');
blank();

line('-- academic_calendars: semesters 1..currentSemester for each batch, real Jul-Dec/Jan-Jun ranges');
{
  const rows = [];
  for (const b of BATCHES) {
    for (let s = 1; s <= b.currentSemester; s++) {
      const { start, end } = semesterDateRange(b.start, s);
      rows.push([sub.batch(b.name), num(s), esc(start), esc(end)]);
    }
  }
  insertPlain('academic_calendars', ['batch_id', 'semester', 'start_date', 'end_date'], rows);
}

line('-- hostels: 2 real hostels (Boys/Girls) — wing enum values are boys/girls');
insertPlain(
  'hostels',
  ['name', 'code', 'wing', 'established_year'],
  [
    [esc('Boys Hostel'), esc('BH'), esc('boys'), '2008'],
    [esc('Girls Hostel'), esc('GH'), esc('girls'), '2008'],
  ]
);

line('-- hostel_blocks: A-F for Boys Hostel, A-D for Girls Hostel');
{
  const rows = [];
  for (const blk of ['A', 'B', 'C', 'D', 'E', 'F']) rows.push([sub.hostel('BH'), esc(blk), num(randInt(3, 5))]);
  for (const blk of ['A', 'B', 'C', 'D']) rows.push([sub.hostel('GH'), esc(blk), num(randInt(3, 5))]);
  insertPlain('hostel_blocks', ['hostel_id', 'name', 'floors'], rows);
}

line('-- fee_structures: quota-scoped only (no department column on this table); current AY only');
line(`-- Government / Government+First-Graduate / 7.5% Reservation share the Rs.1,00,000 structure.`);
line(`-- Management quota gets 3 varied structures (see header comment).`);
{
  const feeStructRows = [
    ['Government - Standard', 'quota', sub.quota('Government')],
    ['Government + First Graduate - Standard', 'quota', sub.quota('Government + First Graduate')],
    ['7.5% Reservation - Standard', 'quota', sub.quota('7.5% Reservation')],
    ['Management - Tier 1 (Rs.1,30,000)', 'quota', sub.quota('Management')],
    ['Management - Tier 2 (Rs.1,50,000)', 'quota', sub.quota('Management')],
    ['Management - Tier 3 (Rs.1,75,000)', 'quota', sub.quota('Management')],
  ];
  insertPlain(
    'fee_structures',
    ['name', 'applies_to', 'quota_id', 'academic_year'],
    feeStructRows.map((r) => [esc(r[0]), esc(r[1]), r[2], esc(CURRENT_AY)])
  );
}

// ---------------------------------------------------------------------------
// TIER 2: transport_stages, fee_structure_items, fee_concessions, classes
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- TIER 2: TRANSPORT STAGES, FEE STRUCTURE ITEMS/CONCESSIONS, CLASSES');
line('-- ===========================================================================');
blank();

line('-- transport_stages: ordered stop list per route; fee_amount = sequence_no x Rs.250 (generated placeholder, see header)');
{
  const rows = [];
  for (const r of TRANSPORT_ROUTES) {
    r.stops.forEach((stopName, idx) => {
      const seq = idx + 1;
      rows.push([sub.route(r.name), esc(stopName), num(seq), num(seq * 250)]);
    });
  }
  insertPlain('transport_stages', ['route_id', 'stage_name', 'sequence_no', 'fee_amount'], rows);
}

line('-- fee_structure_items: Tuition/Special/Development split per fee_structure');
// FEE_ITEM_AMOUNTS is module-scoped (not just local to this block) so later clusters
// (e.g. fee_payments in the finance cluster) can look up the exact same per-item
// amounts without redeclaring/drifting from what was actually inserted here.
const FEE_ITEM_AMOUNTS = {
  'Government - Standard': { 'Tuition Fee': 80000, 'Special Fee': 10000, 'Development Fee': 10000 },
  'Government + First Graduate - Standard': { 'Tuition Fee': 80000, 'Special Fee': 10000, 'Development Fee': 10000 },
  '7.5% Reservation - Standard': { 'Tuition Fee': 80000, 'Special Fee': 10000, 'Development Fee': 10000 },
  'Management - Tier 1 (Rs.1,30,000)': { 'Tuition Fee': 105000, 'Special Fee': 12500, 'Development Fee': 12500 },
  'Management - Tier 2 (Rs.1,50,000)': { 'Tuition Fee': 120000, 'Special Fee': 15000, 'Development Fee': 15000 },
  'Management - Tier 3 (Rs.1,75,000)': { 'Tuition Fee': 140000, 'Special Fee': 17500, 'Development Fee': 17500 },
};
{
  const rows = [];
  for (const [name, split] of Object.entries(FEE_ITEM_AMOUNTS)) {
    for (const [cat, amt] of Object.entries(split)) {
      rows.push([sub.feeStructure(name), sub.demandCat(cat), num(amt)]);
    }
  }
  insertPlain('fee_structure_items', ['fee_structure_id', 'demand_category_id', 'amount'], rows);
}

line('-- fee_concessions: 7.5% Reservation gets full Rs.1,00,000 concession; Government+First-Graduate gets Rs.25,000');
insertPlain(
  'fee_concessions',
  ['fee_structure_id', 'concession_amount'],
  [
    [sub.feeStructure('7.5% Reservation - Standard'), '100000'],
    [sub.feeStructure('Government + First Graduate - Standard'), '25000'],
  ]
);

line('-- classes: 10 departments x 4 batches x 4 sections (A-D) = 160 rows; current_semester per batch formula');
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      for (const section of ['A', 'B', 'C', 'D']) {
        rows.push([
          sub.batch(b.name), sub.dept(d.code), sub.course(`${d.code}-UG`), esc(section), num(b.currentSemester),
          esc(`${d.code}-${b.name}-${section} Block`),
        ]);
      }
    }
  }
  insertPlain('classes', ['batch_id', 'department_id', 'course_id', 'section', 'current_semester', 'classroom'], rows);
}

// ---------------------------------------------------------------------------
// TIER 1 (users, other roles) + TIER 2 (faculty)
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- USERS: seed accounts for every other real role (one each), then faculty, then students, then parents');
line('-- ===========================================================================');
blank();

const OTHER_ROLE_SEED_ACCOUNTS = [
  ['admin', 'admin@sece.ac.in'],
  ['principal', 'principal@sece.ac.in'],
  ['coe', 'coe@sece.ac.in'],
  ['placement', 'placement@sece.ac.in'],
  ['library', 'library@sece.ac.in'],
  ['billing', 'billing@sece.ac.in'],
  ['hr_payroll', 'hrpayroll@sece.ac.in'],
  ['finance', 'finance@sece.ac.in'],
  ['iqac', 'iqac@sece.ac.in'],
  ['secretary', 'secretary@sece.ac.in'],
  ['gate_warden', 'gatewarden@sece.ac.in'],
  ['warden', 'warden@sece.ac.in'],
  ['media_room', 'mediaroom@sece.ac.in'],
  ['academic_coordinator', 'academiccoordinator@sece.ac.in'],
  ['alumni', 'alumni@sece.ac.in'],
  ['non_teaching_staff', 'nonteachingstaff@sece.ac.in'],
  ['transport', 'transport@sece.ac.in'],
  ['higheredu', 'highereducation@sece.ac.in'],
  ['medical_centre', 'medicalcentre@sece.ac.in'],
  ['sports_admin', 'sportsadmin@sece.ac.in'],
  ['edc_coordinator', 'edccoordinator@sece.ac.in'],
];
// Fixed dummy bcrypt-shaped hash placeholder (NOT a real usable password) for every seeded account.
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12';

line('-- one seed account per remaining real role (guarded on email)');
for (const [roleName, email] of OTHER_ROLE_SEED_ACCOUNTS) {
  usedEmails.add(email);
  insertGuardedRow(
    'users',
    ['email', 'password_hash', 'phone', 'role_id', 'status'],
    [esc(email), esc(DUMMY_HASH), esc(randomMobile()), sub.role(roleName), esc('active')],
    'email', email
  );
}

// ---------------------------------------------------------------------------
// Build faculty roster (real + synthetic fill) per department
// ---------------------------------------------------------------------------
const facultyRoster = []; // { deptCode, first_name, last_name, title, staffCode, isHod, email, phone }
let facSerial = 1;
for (const d of DEPARTMENTS) {
  const deptFaculty = [];

  // HOD first
  const hodParsed = parseRealName(d.hod.name);
  deptFaculty.push({
    deptCode: d.code, first_name: hodParsed.first_name, last_name: hodParsed.last_name,
    title: d.hod.title, isHod: true, isReal: true,
    email: d.hod.email, phone: d.hod.phone || '+91-4259 200 300',
  });

  // Real named faculty (dedup identical names within the same department)
  const seenNames = new Set([d.hod.name]);
  for (const rf of d.real) {
    if (seenNames.has(rf.name)) continue;
    seenNames.add(rf.name);
    const p = parseRealName(rf.name);
    const emailBase = `${p.core}.${p.initial}.${d.regCode.toLowerCase()}@sece.ac.in`;
    deptFaculty.push({
      deptCode: d.code, first_name: p.first_name, last_name: p.last_name,
      title: rf.title, isHod: false, isReal: true,
      email: uniqueEmail(emailBase), phone: randomMobile(),
    });
  }

  // Synthetic fill up to 50
  const weightedTitles = ['Assistant Professor', 'Assistant Professor', 'Assistant Professor', 'Associate Professor', 'Associate Professor', 'Professor'];
  let fi = 0, li = 0;
  while (deptFaculty.length < 50) {
    const first = FAC_FIRST[(fi + deptFaculty.length * 3) % FAC_FIRST.length];
    const last = FAC_LAST[(li + deptFaculty.length * 5) % FAC_LAST.length];
    fi++; li++;
    const p = { first_name: first, last_name: last, core: first.toLowerCase(), initial: first.charAt(0).toLowerCase() };
    const emailBase = `${p.core}.${p.initial}.${d.regCode.toLowerCase()}@sece.ac.in`;
    deptFaculty.push({
      deptCode: d.code, first_name: p.first_name, last_name: p.last_name,
      title: pick(weightedTitles), isHod: false, isReal: false,
      email: uniqueEmail(emailBase), phone: randomMobile(),
    });
  }

  // Assign staff codes + mentor flags (16 mentors, one per class of this dept)
  deptFaculty.forEach((f, idx) => {
    f.staffCode = `EMP${d.code}${String(idx + 1).padStart(3, '0')}`;
  });
  const nonHod = deptFaculty.filter((f) => !f.isHod);
  const mentorPool = shuffleCopy(nonHod).slice(0, 16);
  const mentorSet = new Set(mentorPool);
  deptFaculty.forEach((f) => { f.isMentor = mentorSet.has(f); });
  mentorPool.forEach((f, idx) => {
    const b = BATCHES[Math.floor(idx / 4)];
    const section = ['A', 'B', 'C', 'D'][idx % 4];
    f.mentorClass = { batchName: b.name, section };
  });

  for (const f of deptFaculty) facultyRoster.push(f);
  facSerial++;
}

line('-- faculty users (guarded on email) — role = hod for the one real HOD/department, else faculty');
{
  const rows = facultyRoster.map((f) => [
    esc(f.email), esc(DUMMY_HASH), esc(f.phone), sub.role(f.isHod ? 'hod' : 'faculty'), esc('active'),
  ]);
  // Guarded, one-per-row (staying safe on double-run) but batched for speed:
  // since NOT EXISTS-per-row can't be batched in one VALUES list, insert via
  // INSERT ... SELECT ... WHERE NOT EXISTS per row.
  for (const [email, , phone, roleSub, status] of facultyRoster.map((f) => [f.email, null, f.phone, null, 'active'])) {
    // placeholder loop unused; real insert below row-by-row for guard-safety
  }
}
for (const f of facultyRoster) {
  insertGuardedRow(
    'users',
    ['email', 'password_hash', 'phone', 'role_id', 'status'],
    [esc(f.email), esc(DUMMY_HASH), esc(f.phone), sub.role(f.isHod ? 'hod' : 'faculty'), esc('active')],
    'email', f.email
  );
}

line('-- faculty rows (department-locked; designation_id resolved via nearest designations title)');
{
  const rows = facultyRoster.map((f) => [
    sub.userByEmail(f.email), esc(f.first_name), esc(f.last_name), esc(f.title), sub.dept(f.deptCode),
    esc('2018-06-01'), esc('active'), boolSql(f.isMentor), esc(f.staffCode), sub.designation(f.title),
  ]);
  insertPlain(
    'faculty',
    ['user_id', 'first_name', 'last_name', 'designation', 'department_id', 'date_of_joining', 'status', 'is_mentor', 'staff_code', 'designation_id'],
    rows
  );
}

line('-- faculty_sensitive_info: ALWAYS synthetic Aadhaar/PAN/bank, even for real-named faculty (hard boundary)');
{
  const rows = facultyRoster.map((f) => [
    sub.facultyByStaffCode(f.staffCode), esc(randomAadhaar()), esc(randomPAN()), esc(randomBankAccount()), esc(randomIFSC()), esc(pick(BANK_NAMES)),
  ]);
  insertPlain('faculty_sensitive_info', ['faculty_id', 'aadhar_number', 'pan_number', 'bank_account_number', 'bank_ifsc', 'bank_name'], rows);
}

line('-- break the departments <-> faculty circular dependency: set head_of_department_faculty_id now that faculty exist');
for (const d of DEPARTMENTS) {
  line(`UPDATE departments SET head_of_department_faculty_id = ${sub.facultyByStaffCode(facultyRoster.find((f) => f.deptCode === d.code && f.isHod).staffCode)} WHERE code = ${esc(d.code)};`);
}
blank();

line('-- faculty.reports_to_faculty_id: non-HOD, non-Professor faculty report to their department HOD');
for (const d of DEPARTMENTS) {
  const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
  line(
    `UPDATE faculty SET reports_to_faculty_id = ${sub.facultyByStaffCode(hod.staffCode)} ` +
    `WHERE department_id = ${sub.dept(d.code)} AND staff_code <> ${esc(hod.staffCode)} AND designation <> 'Professor';`
  );
}
blank();

// ---------------------------------------------------------------------------
// class_mentors
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- CLASS MENTORS (department-locked advisors, one per class)');
line('-- ===========================================================================');
{
  const rows = [];
  for (const f of facultyRoster) {
    if (!f.isMentor || !f.mentorClass) continue;
    rows.push([
      sub.classByKey(f.mentorClass.batchName, f.deptCode, f.mentorClass.section),
      sub.facultyByStaffCode(f.staffCode),
      esc(CURRENT_AY),
    ]);
  }
  insertPlain('class_mentors', ['class_id', 'faculty_id', 'academic_year'], rows);
}

// ---------------------------------------------------------------------------
// subjects + faculty_subject_class_mapping
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- SUBJECTS (generic placeholder list, no real syllabus source given) + TEACHING MAPPING');
line('-- ===========================================================================');
const SEMESTERS_IN_USE = [1, 3, 5, 7];
const subjectsByDeptSem = {}; // deptCode -> sem -> [subject_code,...]
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    subjectsByDeptSem[d.code] = {};
    for (const sem of SEMESTERS_IN_USE) {
      const codes = [];
      for (let k = 1; k <= 6; k++) {
        const code = `${d.code}${sem}${String(k).padStart(2, '0')}`;
        codes.push(code);
        rows.push([
          esc(`${d.name.replace(/^B\.(E|Tech)\.?\s*/, '')} Semester ${sem} Subject ${k}`),
          esc(code), sub.dept(d.code), num(3), esc(sem <= 2 ? 'CORE' : (k === 6 ? 'ELECTIVE' : 'CORE')), num(sem),
        ]);
      }
      subjectsByDeptSem[d.code][sem] = codes;
    }
  }
  insertPlain('subjects', ['name', 'subject_code', 'department_id', 'credits', 'category', 'semester'], rows);
}

line('-- faculty_subject_class_mapping: 6 subjects per class taught by a random same-department faculty member');
// Captured for reuse (timetable_slots / attendance_records / LMS in the extension pass below) —
// reusing these exact real generated pairs rather than re-guessing subject/faculty pairings.
const fscMappingByClassKey = {}; // `${deptCode}|${batchName}|${section}` -> [{subjectCode, staffCode}, ...]
const classMentorByKey = {}; // `${deptCode}|${batchName}|${section}` -> faculty record
{
  const rows = [];
  const facByDept = {};
  for (const f of facultyRoster) {
    (facByDept[f.deptCode] = facByDept[f.deptCode] || []).push(f);
    if (f.isMentor && f.mentorClass) {
      classMentorByKey[`${f.deptCode}|${f.mentorClass.batchName}|${f.mentorClass.section}`] = f;
    }
  }
  for (const d of DEPARTMENTS) {
    const deptFac = facByDept[d.code];
    for (const b of BATCHES) {
      const sem = b.currentSemester;
      const codes = subjectsByDeptSem[d.code][sem];
      for (const section of ['A', 'B', 'C', 'D']) {
        const key = `${d.code}|${b.name}|${section}`;
        fscMappingByClassKey[key] = [];
        for (const code of codes) {
          const teacher = pick(deptFac);
          rows.push([
            sub.facultyByStaffCode(teacher.staffCode), sub.subjectByCode(code),
            sub.classByKey(b.name, d.code, section), esc(CURRENT_AY),
          ]);
          fscMappingByClassKey[key].push({ subjectCode: code, staffCode: teacher.staffCode });
        }
      }
    }
  }
  insertPlain('faculty_subject_class_mapping', ['faculty_id', 'subject_id', 'class_id', 'academic_year'], rows);
}

// ---------------------------------------------------------------------------
// TIER 3: STUDENTS
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- TIER 3: STUDENTS (soa_applications -> users -> students -> profile/family/etc.)');
line('-- ===========================================================================');

const COMMUNITIES = ['OC', 'BC', 'BCM', 'MBC', 'SC', 'ST'];
const TODAY = new Date('2026-08-22');

const students = []; // flat list of generated student records

for (const d of DEPARTMENTS) {
  for (const b of BATCHES) {
    for (const section of ['A', 'B', 'C', 'D']) {
      // Quota distribution across 15 students/section: 60/10/5/25% -> 9/1/1/4 (sums to 15)
      const quotaPlan = ['Government', 'Government', 'Government', 'Government', 'Government', 'Government', 'Government', 'Government', 'Government',
        'Government + First Graduate', '7.5% Reservation',
        'Management', 'Management', 'Management', 'Management'];
      for (let i = 0; i < 15; i++) {
        const serial = students.filter((s) => s.deptCode === d.code && s.batchName === b.name).length + 1;
        const first = STU_FIRST[randInt(0, STU_FIRST.length - 1)];
        const lastInit = STU_LAST[randInt(0, STU_LAST.length - 1)];
        const quota = quotaPlan[i];
        const genderGuess = ['Aishwarya', 'Bhuvana', 'Deepika', 'Ezhili', 'Gomathi', 'Harini', 'Ishwarya', 'Jeevitha', 'Kavitha', 'Lavanya', 'Malar', 'Nandhini', 'Priya', 'Ramya', 'Sowmya', 'Thenmozhi', 'Vaishnavi', 'Yamuna', 'Keerthi'].includes(first) ? 'Female' : 'Male';
        const regNo = `U${String(b.start).slice(2)}${d.code}${String(students.length + 1).padStart(3, '0')}`;
        const emailBase = `${first.toLowerCase()}.${lastInit.toLowerCase()}${b.start}${d.emailCode}@sece.ac.in`;
        const isHosteller = rng() < 0.30;
        const dayscholarMode = isHosteller ? null : (rng() < 0.5 ? 'transport' : 'own_vehicle');
        students.push({
          deptCode: d.code, deptEmailCode: d.emailCode, batchName: b.name, batchStart: b.start, section,
          currentSemester: b.currentSemester,
          firstName: first, lastName: lastInit, gender: genderGuess,
          quota, regNo, email: uniqueEmail(emailBase),
          isHosteller, dayscholarMode,
          community: pick(COMMUNITIES),
          isFirstGraduate: quota === 'Government + First Graduate',
        });
      }
    }
  }
}

line(`-- total students generated: ${students.length}`);

// soa_applications
{
  const rows = students.map((s) => [
    esc(s.firstName), esc(s.lastName), esc(`${pick(FAC_LAST)} ${s.lastName}`), esc(`${pick(FAC_LAST)} ${s.lastName}`),
    esc(randomMobile()), esc(randomMobile()), esc(s.email), num((60 + rng() * 40).toFixed(2)),
    num((60 + rng() * 40).toFixed(2)), num((60 + rng() * 40).toFixed(2)), esc(s.community), esc('admission_confirmed'),
  ]);
  insertPlain(
    'soa_applications',
    ['first_name', 'last_name', 'father_name', 'mother_name', 'parent_contact', 'student_contact', 'student_email',
      'cutoff_physics', 'cutoff_chemistry', 'cutoff_maths', 'community', 'status'],
    rows
  );
}

line('-- student users (guarded on email)');
for (const s of students) {
  insertGuardedRow(
    'users',
    ['email', 'password_hash', 'phone', 'role_id', 'status'],
    [esc(s.email), esc(DUMMY_HASH), esc(randomMobile()), sub.role('student'), esc('active')],
    'email', s.email
  );
}

line('-- students rows');
{
  const rows = students.map((s) => {
    const admissionNo = `ADM${s.regNo}`;
    const dob = `${s.batchStart - 18}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`;
    const vehicleNumber = (!s.isHosteller && s.dayscholarMode === 'own_vehicle') ? randomVehiclePlate() : null;
    return [
      `(SELECT id FROM soa_applications WHERE student_email = ${esc(s.email)})`,
      sub.userByEmail(s.email),
      esc(s.regNo), esc(s.regNo), esc(s.regNo), esc(admissionNo),
      sub.course(`${s.deptCode}-UG`), sub.quota(s.quota), sub.batch(s.batchName),
      esc(`${s.batchStart}-06-15`), esc('regular'), esc(`${s.batchStart}-2027`),
      esc(s.gender), esc(dob),
      esc(s.isHosteller ? 'hosteller' : 'dayscholar'),
      s.dayscholarMode ? esc(s.dayscholarMode) : NUL(),
      vehicleNumber ? esc(vehicleNumber) : NUL(),
      esc('active'), boolSql(s.isFirstGraduate),
      esc('Indian'), esc(pick(['Hindu', 'Christian', 'Muslim'])), esc(s.community), esc(pick(['Nadar', 'Gounder', 'Naidu', 'Reddy', 'Chettiar', 'Iyer'])),
      esc('Tamil'), esc(pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'])),
      boolSql(false), NUL(), boolSql(false), NUL(),
      NUL(), NUL(), NUL(), esc(pick(['TNEA Counselling', 'Management Direct'])), esc(pick(['College Website', 'Friend/Relative', 'School Notice'])),
      esc(`${pick(FAC_LAST)} ${s.lastName}`),
      sub.classByKey(s.batchName, s.deptCode, s.section),
    ];
  });
  insertPlain(
    'students',
    ['soa_application_id', 'user_id', 'student_id_no', 'roll_no', 'register_no', 'admission_no',
      'course_id', 'quota_id', 'batch_id', 'admission_date', 'admission_type', 'joined_academic_year',
      'gender', 'date_of_birth', 'student_type', 'dayscholar_mode', 'vehicle_number', 'status', 'is_first_graduate',
      'nationality', 'religion', 'community', 'caste', 'mother_tongue', 'blood_group',
      'is_father_exserviceman', 'exserviceman_info', 'is_diff_abled', 'diff_abled_info',
      'counselling_order_no', 'counselling_rank_no', 'govt_quota_admission_no', 'joined_through', 'knew_institution_by',
      'nominee', 'class_id'],
    rows
  );
}

line('-- student_profiles');
{
  const rows = students.map((s) => [sub.studentByRegNo(s.regNo), NUL(), NUL(), NUL(), NUL(), NUL(), NUL()]);
  insertPlain('student_profiles', ['student_id', 'resume_url', 'linkedin_url', 'github_url', 'leetcode_url', 'hackerrank_url', 'codeforces_url'], rows);
}

line('-- student_family_details');
{
  const rows = students.map((s) => {
    const fatherName = `${pick(FAC_LAST)} ${s.lastName}`;
    const motherName = `${pick(STU_FIRST)} ${s.lastName}`;
    return [
      sub.studentByRegNo(s.regNo), esc(fatherName), esc(pick(['SSLC', 'HSC', 'Diploma', 'B.Sc', 'B.Com', 'B.E.'])),
      esc(pick(['Farmer', 'Business', 'Government Employee', 'Private Employee', 'Teacher'])), num(randInt(150000, 900000)),
      esc(`${fatherName.toLowerCase().replace(/\s+/g, '.')}@gmail.com`), esc(randomMobile()),
      esc(motherName), esc(pick(['SSLC', 'HSC', 'Diploma', 'B.Sc', 'B.Com'])),
      esc(pick(['Homemaker', 'Teacher', 'Private Employee', 'Business'])), num(randInt(0, 300000)),
      esc(`${motherName.toLowerCase().replace(/\s+/g, '.')}@gmail.com`), esc(randomMobile()),
      NUL(), NUL(), NUL(), NUL(), NUL(), NUL(),
    ];
  });
  insertPlain(
    'student_family_details',
    ['student_id', 'father_name', 'father_qualification', 'father_occupation', 'father_annual_income', 'father_email', 'father_mobile',
      'mother_name', 'mother_qualification', 'mother_occupation', 'mother_annual_income', 'mother_email', 'mother_mobile',
      'father_photo_url', 'mother_photo_url', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'guardian_email'],
    rows
  );
}

line('-- student_contacts');
{
  const rows = students.map((s) => [sub.studentByRegNo(s.regNo), esc(s.email), esc(`${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@gmail.com`), esc(randomMobile())]);
  insertPlain('student_contacts', ['student_id', 'student_email1', 'student_email2', 'student_mobile'], rows);
}

line('-- student_addresses (permanent only, per plan minimum)');
{
  const rows = students.map((s) => [
    sub.studentByRegNo(s.regNo), esc('permanent'),
    esc(`${randInt(1, 200)}, ${pick(AREA_NAMES)} Street`), esc(pick(AREA_NAMES)), esc('Tamil Nadu'),
    esc(String(randInt(600001, 643253))), esc('Coimbatore'),
  ]);
  insertPlain('student_addresses', ['student_id', 'address_type', 'address_line', 'city', 'state', 'pincode', 'district'], rows);
}

line('-- student_identity_marks (2 per student, generic text)');
{
  const rows = [];
  const marks = ['Mole on left cheek', 'Scar on right hand', 'Mole on chin', 'Scar above left eyebrow', 'Birthmark on neck', 'Mole on right palm'];
  for (const s of students) {
    rows.push([sub.studentByRegNo(s.regNo), '1', esc(pick(marks))]);
    rows.push([sub.studentByRegNo(s.regNo), '2', esc(pick(marks))]);
  }
  insertPlain('student_identity_marks', ['student_id', 'mark_number', 'description'], rows);
}

line('-- student_certificates: one row per student per certificate type; mostly available, some not (realism)');
{
  const rows = [];
  for (const s of students) {
    for (const ct of CERTIFICATE_TYPES) {
      const available = rng() > 0.12; // ~88% available
      rows.push([sub.studentByRegNo(s.regNo), sub.certType(ct), boolSql(available)]);
    }
  }
  insertPlain('student_certificates', ['student_id', 'certificate_type_id', 'is_available'], rows, 300);
}

line('-- student_fee_demand_mapping: link each student to their quota fee_structure (Management randomly picks one of the 3 tiers)');
{
  const rows = students.map((s) => {
    let structName, total;
    if (s.quota === 'Government') { structName = 'Government - Standard'; total = 100000; }
    else if (s.quota === 'Government + First Graduate') { structName = 'Government + First Graduate - Standard'; total = 100000; }
    else if (s.quota === '7.5% Reservation') { structName = '7.5% Reservation - Standard'; total = 100000; }
    else {
      const tier = pick(['Management - Tier 1 (Rs.1,30,000)', 'Management - Tier 2 (Rs.1,50,000)', 'Management - Tier 3 (Rs.1,75,000)']);
      structName = tier;
      total = tier.includes('Tier 1') ? 130000 : tier.includes('Tier 2') ? 150000 : 175000;
    }
    s.feeStructureName = structName; // stashed for later clusters (fee_payments etc.) so the random Management tier pick is reusable
    s.feeTotalAmount = total;
    return [sub.studentByRegNo(s.regNo), sub.feeStructure(structName), esc(CURRENT_AY), num(s.currentSemester), num(total)];
  });
  insertPlain('student_fee_demand_mapping', ['student_id', 'fee_structure_id', 'academic_year', 'semester', 'total_amount'], rows);
}

// ---------------------------------------------------------------------------
// hostel_rooms + student_hostel_mapping
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- HOSTEL ROOMS + STUDENT HOSTEL MAPPING (hosteller subset only)');
line('-- ===========================================================================');

const hostellerStudents = students.filter((s) => s.isHosteller);
// naive gender split: assume department gender mix mirrors generated s.gender field
const boysHostellers = hostellerStudents.filter((s) => s.gender === 'Male');
const girlsHostellers = hostellerStudents.filter((s) => s.gender === 'Female');

function buildRooms(hostelCode, roomTypes, studentCount) {
  const rooms = [];
  let roomsNeeded = Math.ceil((studentCount * 1.15) / 3); // slight surplus capacity, ~3 avg sharing
  let idx = 0;
  const perType = Math.max(1, Math.ceil(roomsNeeded / roomTypes.length));
  for (const rt of roomTypes) {
    for (let r = 0; r < perType; r++) {
      idx++;
      rooms.push({
        hostelCode, block: rt.block, roomNumber: `${rt.block}-${String(idx).padStart(3, '0')}`,
        capacity: rt.sharing, roomTypeName: rt.name,
      });
    }
  }
  return rooms;
}
const boysRooms = buildRooms('BH', BOYS_ROOM_TYPES, boysHostellers.length);
const girlsRooms = buildRooms('GH', GIRLS_ROOM_TYPES, girlsHostellers.length);

line('-- hostel_rooms (sequential synthetic room numbers, capacity = room type sharing count)');
{
  const rows = [];
  for (const r of boysRooms.concat(girlsRooms)) {
    rows.push([
      esc(r.roomNumber), sub.roomType(r.roomTypeName), num(r.capacity), sub.hostel(r.hostelCode), sub.hostelBlock(r.hostelCode, r.block),
    ]);
  }
  insertPlain('hostel_rooms', ['room_number', 'room_type_id', 'capacity', 'hostel_id', 'block_id'], rows);
}

line('-- student_hostel_mapping: round-robin allocate hostellers into rooms respecting capacity');
{
  const rows = [];
  function allocate(list, rooms, hostelCode) {
    let roomIdx = 0, seatsUsed = 0;
    for (const s of list) {
      if (roomIdx >= rooms.length) roomIdx = rooms.length - 1; // overflow guard, reuse last room
      if (seatsUsed >= rooms[roomIdx].capacity) { roomIdx++; seatsUsed = 0; if (roomIdx >= rooms.length) roomIdx = rooms.length - 1; }
      const room = rooms[roomIdx];
      rows.push([sub.studentByRegNo(s.regNo), sub.roomByKey(hostelCode, room.roomNumber)]);
      seatsUsed++;
    }
  }
  allocate(boysHostellers, boysRooms, 'BH');
  allocate(girlsHostellers, girlsRooms, 'GH');
  insertPlain('student_hostel_mapping', ['student_id', 'room_id'], rows);
}

// ---------------------------------------------------------------------------
// student_transport_mapping
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- STUDENT TRANSPORT MAPPING (day-scholar + college-transport subset only)');
line('-- ===========================================================================');
{
  const rows = [];
  const transportStudents = students.filter((s) => !s.isHosteller && s.dayscholarMode === 'transport');
  for (const s of transportStudents) {
    const route = pick(TRANSPORT_ROUTES);
    const boarding = route.stops[randInt(0, route.stops.length - 2)];
    const destination = route.stops[route.stops.length - 1];
    rows.push([
      sub.studentByRegNo(s.regNo), sub.route(route.name),
      sub.transportStage(route.name, boarding), sub.transportStage(route.name, destination),
    ]);
  }
  insertPlain('student_transport_mapping', ['student_id', 'route_id', 'boarding_stage_id', 'destination_stage_id'], rows);
}

// ---------------------------------------------------------------------------
// Parent users + parent_student_mapping
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- PARENT USERS + parent_student_mapping (one parent account per student)');
line('-- ===========================================================================');
{
  const parentRows = [];
  const mappingRows = [];
  for (const s of students) {
    const parentEmailBase = `${s.lastName.toLowerCase()}.${s.firstName.toLowerCase()}.parent@gmail.com`;
    const parentEmail = uniqueEmail(parentEmailBase);
    parentRows.push({ email: parentEmail, regNo: s.regNo });
  }
  for (const p of parentRows) {
    insertGuardedRow(
      'users',
      ['email', 'password_hash', 'phone', 'role_id', 'status'],
      [esc(p.email), esc(DUMMY_HASH), esc(randomMobile()), sub.role('parent'), esc('active')],
      'email', p.email
    );
  }
  for (const p of parentRows) {
    mappingRows.push([sub.userByEmail(p.email), sub.studentByRegNo(p.regNo), esc('father')]);
  }
  insertPlain('parent_student_mapping', ['parent_user_id', 'student_id', 'relationship'], mappingRows);
}

// ===========================================================================
// EXTENSION PASS (2026-08-22): companies, library, sports, medical centre,
// historical/alumni batches + placement history, current placement drives.
// Same safety rules as above: subquery-only FKs, WHERE NOT EXISTS guards on
// any table that might already hold a conflicting natural-key row, still one
// single BEGIN/COMMIT (no new transaction block).
// ===========================================================================

// ---------------------------------------------------------------------------
// COMPANIES — REAL recruiter names verbatim from sece.ac.in/recruiters/ plus
// separately-confirmed real names (see docs/06_SEED_DATA_PLAN.md extension
// instructions). profile_info is the only other real column on this table
// (schema: companies.name, companies.profile_info only) — kept as a short,
// generic, non-fabricated sector tag where obvious, else NULL.
// ---------------------------------------------------------------------------
const REAL_COMPANIES = [
  '1CloudHub', '1Cloud Technologies', 'Accenture', 'Acumen Cad-Cam Solutions', 'Aagnia Tech', 'Agraga',
  'AK Engineering', 'Allsec Technology', 'Appranix', 'Apisero', 'Apexon', 'Arraa Energy', 'Aspire Systems',
  'Assistanz', 'Avasoft', 'AVTEC', 'Bahwan CyberTek', 'Bosch', 'Bootlabs', 'British Petroleum', 'Brakes India',
  'Calibraint', 'Candor', 'Cantier', 'Caresoft', 'Caterpillar', 'Cerium Systems', 'Chainsys', 'Cloudvice',
  'Codingmart', 'Cognizant Technology Solutions', 'Comcast', 'Consultancy', 'CTS', 'Danfoss', 'Data Patterns',
  'Deloitte', 'Dewan Staff Finders', 'Divum', 'Ducen', 'DXC Technology', 'ERP Roots', 'Eunimart', 'Face Prep',
  'Finastra', 'Fleetstudio', 'Flowserve', 'Focus R', 'Freightify', 'Fundsindia', 'Genisys Group',
  'Global Knowledge Technologies', 'Green Labs', 'Guvi', 'Gyan Matrix', 'Guidehouse', 'Haworth', 'Hashedin',
  'Hexaware', 'Hill Point', 'HP Inc.', 'Hydro Materials', 'Iamneo', 'Informatica', 'Intellect Design Arena',
  'Intellipaat', 'Integra Automation', 'Itss Global', 'Joules to Watts', 'JP Solutions', 'Jaro', 'Kaar Technologies',
  'Kanini Systems', 'KSB Pumps', 'Kubernetikos Infosec', 'Lcode Technologies', 'Linga Technologies',
  'Lumens Technologies', 'Lumen Data', 'Maxlinear', 'Meedenlabs', 'Mercedes Benz', 'Microchip Technologies',
  'Mindlance Technologies', 'Mindtree', 'Molecular Connections', 'Mr. Cooper', 'Mphasis', 'Mu Sigma',
  'Murugan Traders', 'Nbase2', 'Nference', 'Netlink', 'NTT Data', 'Odessa', 'On Track', 'Pathfinder', 'Payoda',
  'Peoplehum', 'Persistent', 'Pinnacle Infotech', 'Pinaca Labs', 'Plumb5', 'Pricol', 'Propel', 'Psiog Digital',
  'Pumo Technovation', 'Quess Corp', 'Qubercomm', 'Quinbay', 'Ram Kalam', 'Rane', 'Real Tech', 'Rnd Soft',
  'Rently', 'Renacon', 'Rfpio', 'Sahaj', 'Sansera', 'Sap Arena', 'Saradha Consulting', 'Saptang Labs',
  'Savysoft Technologies', 'Schuf', 'Schwing Stetter', 'Secure Kloud', 'Sedin Technologies', 'Sevenglasgow',
  'Shop Up', 'Siemens', 'Sirius', 'Sketch Brahma', 'Smartdv', 'Solavio', 'Sopra Steria', 'Span Technology',
  'Sporfy', 'Syrma Technologies', 'Symbion', 'Taras Systems', 'Tata Consultancy Services', 'Tata Technologies',
  'Tech Mahindra', 'Tekion', 'Tekizma', 'Tekinow', 'Toshiba', 'Tretter', 'Tsugami', 'Unilogic', 'Urjanet',
  'Vakil Search', 'Valeo', 'Vuram', 'VVDN', 'Vivait', 'Vivriti Capital', 'Wells Fargo', 'Wipro', 'X Pay Back',
  'Xtrachef Toast', 'Zoho',
  'Autodesk', 'Zscaler', 'Microsoft', 'Amazon', 'Philips', 'Dell Technologies', 'Juspay', 'Infosys', 'Virtusa',
];
line('-- ===========================================================================');
line('-- COMPANIES (REAL recruiter names, verbatim from sece.ac.in/recruiters/ + separately-confirmed names)');
line('-- ===========================================================================');
for (const name of REAL_COMPANIES) {
  insertGuardedRow('companies', ['name', 'profile_info'], [esc(name), NUL()], 'name', name);
}
blank();

// ---------------------------------------------------------------------------
// LIBRARY — book_categories, books, e_resources. Real, standard, widely
// published engineering textbooks (verified real title+author combinations
// per docs). Grouped per the 4 real subject clusters given; each department
// gets 8 book rows (cycling its group's real titles for extra "copies" when
// the group has fewer than 8 distinct titles — never a fabricated title).
// ---------------------------------------------------------------------------
const BOOK_GROUPS = {
  CS_CLUSTER: [
    ['Introduction to Algorithms', 'Cormen, Leiserson, Rivest, Stein'],
    ['Operating System Concepts', 'Silberschatz, Galvin, Gagne'],
    ['Database System Concepts', 'Silberschatz, Korth, Sudarshan'],
    ['Computer Networks', 'Tanenbaum, Wetherall'],
    ['Software Engineering', 'Sommerville'],
    ['Artificial Intelligence: A Modern Approach', 'Russell, Norvig'],
    ['Machine Learning', 'Tom Mitchell'],
    ['Data Communications and Networking', 'Forouzan'],
  ],
  ECE_CLUSTER: [
    ['Electronic Devices and Circuit Theory', 'Boylestad, Nashelsky'],
    ['Digital Design', 'Morris Mano'],
    ['Signals and Systems', 'Oppenheim, Willsky'],
    ['Microelectronic Circuits', 'Sedra, Smith'],
    ['Communication Systems', 'Simon Haykin'],
  ],
  EEE_CLUSTER: [
    ['Electrical Machines', 'P.S. Bimbhra'],
    ['Power System Analysis', 'Hadi Saadat'],
    ['Control Systems Engineering', 'Nise'],
    ['Electric Circuits', 'Nilsson, Riedel'],
  ],
  MECH_CLUSTER: [
    ['Theory of Machines', 'Khurmi'],
    ['Strength of Materials', 'Rajput'],
    ['Machine Design', 'Shigley'],
    ['Thermal Engineering', 'Rajput'],
    ['Fluid Mechanics and Hydraulics', 'Modi & Seth'],
  ],
};
const DEPT_BOOK_GROUP = {
  CS: 'CS_CLUSTER', AI: 'CS_CLUSTER', CY: 'CS_CLUSTER', AD: 'CS_CLUSTER', CB: 'CS_CLUSTER', IT: 'CS_CLUSTER',
  EC: 'ECE_CLUSTER', CC: 'ECE_CLUSTER',
  EE: 'EEE_CLUSTER',
  ME: 'MECH_CLUSTER',
};
const BOOK_CATEGORY_NAME = {
  CS_CLUSTER: 'Computer Science & Engineering', ECE_CLUSTER: 'Electronics & Communication',
  EEE_CLUSTER: 'Electrical & Electronics', MECH_CLUSTER: 'Mechanical Engineering',
};

line('-- ===========================================================================');
line('-- LIBRARY: book_categories, books (real, standard engineering textbooks), e_resources');
line('-- ===========================================================================');
for (const cat of Object.values(BOOK_CATEGORY_NAME)) {
  insertGuardedRow('book_categories', ['name'], [esc(cat)], 'name', cat);
}
{
  let qrSerial = 1;
  for (const d of DEPARTMENTS) {
    const groupKey = DEPT_BOOK_GROUP[d.code];
    const titles = BOOK_GROUPS[groupKey];
    const catName = BOOK_CATEGORY_NAME[groupKey];
    for (let i = 0; i < 8; i++) {
      const [title, author] = titles[i % titles.length];
      const qr = `LIB-${d.code}-${String(qrSerial).padStart(4, '0')}`;
      qrSerial++;
      insertGuardedRow(
        'books',
        ['qr_code', 'title', 'author', 'category_id', 'total_copies', 'available_copies', 'department_id', 'publisher'],
        [esc(qr), esc(title), esc(author), `(SELECT id FROM book_categories WHERE name = ${esc(catName)})`,
          num(2), num(2), sub.dept(d.code), NUL()],
        'qr_code', qr
      );
    }
  }
}
line('-- e_resources: e-book access entries for a handful of the same real titles');
{
  const rows = [];
  const seen = new Set();
  for (const [groupKey, catName] of Object.entries(BOOK_CATEGORY_NAME)) {
    for (const [title] of BOOK_GROUPS[groupKey]) {
      if (seen.has(title)) continue;
      seen.add(title);
      rows.push([
        esc(`${title} (E-Book)`), esc('https://library.sece.ac.in/e-resources/placeholder'),
        `(SELECT id FROM book_categories WHERE name = ${esc(catName)})`, num(5), esc('pdf'), esc('institutional'), esc('published'),
      ]);
    }
  }
  insertPlain('e_resources', ['title', 'url', 'category_id', 'concurrent_seats', 'format', 'license_type', 'publish_state'], rows);
}
blank();

// ---------------------------------------------------------------------------
// SPORTS — real disciplines/facility mentions from sece.ac.in. No free-text
// contact column exists on sports_disciplines/sports_facilities (only an
// optional faculty_id FK for head coach); since no seeded faculty row is
// Dr. Vignesh (Director of Physical Education is not part of the 10-dept
// faculty roster built above), head_coach_faculty_id is left NULL rather
// than mis-attaching a real name to an unrelated synthetic faculty row.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- SPORTS: real disciplines + real facility mentions from sece.ac.in');
line('-- ===========================================================================');
const SPORTS_DISCIPLINES = ['Basketball', 'Volleyball', 'Athletics', 'Cricket', 'Hockey', 'Kabaddi', 'Carrom', 'Chess'];
for (const disc of SPORTS_DISCIPLINES) {
  insertGuardedRow('sports_disciplines', ['name'], [esc(disc)], 'name', disc);
}
{
  const facilities = [
    ['Gymnasium', 'Amenity Centre', 'gym', 60],
    ['Indoor Sports Hall', 'Amenity Centre', 'hall', 100],
    ['Basketball Court', 'Sports Ground', 'court', 30],
    ['Main Sports Ground', 'Campus Sports Ground', 'ground', 500],
  ];
  // guard each row (name has no unique constraint in schema, so a manual NOT EXISTS on name+location)
  for (const f of facilities) {
    line(`INSERT INTO sports_facilities (name, location, facility_type, capacity)`);
    line(`SELECT ${esc(f[0])}, ${esc(f[1])}, ${esc(f[2])}, ${num(f[3])}`);
    line(`WHERE NOT EXISTS (SELECT 1 FROM sports_facilities WHERE name = ${esc(f[0])} AND location = ${esc(f[1])});`);
    blank();
  }
}

// ---------------------------------------------------------------------------
// MEDICAL CENTRE — small real-shaped campus health-centre set. Staff names
// are synthetic (no real named campus doctor was supplied/verified), no
// fabricated diagnoses tied to any real person.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- MEDICAL CENTRE: medical_staff (synthetic names), medical_services, medical_equipment');
line('-- ===========================================================================');
{
  const staff = [
    ['Dr. Meena Sundaram', 'Medical Officer', 'General Physician', '09:00-17:00'],
    ['Dr. Karthik Raman', 'Visiting Physician', 'General Medicine', '09:00-13:00'],
    ['Ms. Priya Dharshini', 'Staff Nurse', 'Nursing', '08:00-20:00'],
    ['Mr. Selvam Kumar', 'Pharmacist', 'Pharmacy', '09:00-17:00'],
  ];
  for (const [name, designation, specialization, workingDays] of staff) {
    insertGuardedRow(
      'medical_staff',
      ['name', 'designation', 'specialization', 'working_days', 'status'],
      [esc(name), esc(designation), esc(specialization), esc(workingDays), esc('active')],
      'name', name
    );
  }
}
{
  const services = [
    ['General Consultation', 100, 'Walk-in, no appointment needed'],
    ['First Aid', 0, 'Free of charge'],
    ['Blood Pressure Check', 0, 'Free of charge'],
    ['Blood Sugar Test', 50, null],
    ['Minor Dressing', 50, null],
    ['ECG', 200, 'Referral to hospital if abnormal'],
    ['Vaccination', 150, 'Seasonal, as scheduled'],
    ['Health Certificate Issuance', 0, 'Free of charge'],
  ];
  for (const [name, rate, note] of services) {
    insertGuardedRow('medical_services', ['name', 'rate', 'note'], [esc(name), num(rate), note ? esc(note) : NUL()], 'name', name);
  }
}
{
  const equipment = [
    ['Wheelchair', 2, 'Medical Centre Reception'],
    ['Oxygen Cylinder', 2, 'Medical Centre Store'],
    ['First Aid Kit', 10, 'Medical Centre + Hostel Blocks'],
    ['BP Monitor', 3, 'Medical Centre'],
    ['Glucometer', 2, 'Medical Centre'],
    ['Stretcher', 1, 'Medical Centre'],
  ];
  const rows = equipment.map((e) => [esc(e[0]), num(e[1]), esc(e[2]), esc('working')]);
  insertPlain('medical_equipment', ['name', 'quantity', 'location', 'condition'], rows);
}
blank();

// ---------------------------------------------------------------------------
// HISTORICAL / ALUMNI BATCHES — 4 already-graduated batches as of 2026-08-22
// (none of the 4 currently-enrolled batches have graduated yet, so alumni
// data must come from a separate, older set to be logically consistent).
// Chosen size: 5 students/section (vs. 15 for current batches) to keep this
// addition from doubling the file — documented choice, not the same density
// as active students. Skipped for these historical students (documented,
// time-boxed): student_addresses, student_identity_marks,
// student_hostel_mapping, student_transport_mapping, student_fee_demand_mapping
// (they are not currently paying anyone or living on campus) and no `classes`
// rows are generated for them (class_id left NULL) since they need no
// current timetable/section. status = 'inactive' is used to mark them
// graduated (schema's user_status_enum only has active/inactive — no
// dedicated 'graduated' value exists).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- HISTORICAL / ALUMNI: 4 already-graduated batches, 5 students/section, alumni_batches + alumni_members');
line('-- ===========================================================================');

const HISTORICAL_BATCHES = [
  { name: '2018-2022', start: 2018, end: 2022 },
  { name: '2019-2023', start: 2019, end: 2023 },
  { name: '2020-2024', start: 2020, end: 2024 },
  { name: '2021-2025', start: 2021, end: 2025 },
];
insertPlain('batches', ['name', 'start_year', 'end_year'], HISTORICAL_BATCHES.map((b) => [esc(b.name), num(b.start), num(b.end)]));

line('-- alumni_batches: one row per historical batch (batch_id is unique on this table)');
insertPlain(
  'alumni_batches',
  ['batch_id', 'group_name', 'graduated_on'],
  HISTORICAL_BATCHES.map((b) => [sub.batch(b.name), esc(`SECE Batch of ${b.end}`), esc(`${b.end}-06-15`)])
);

const alumniStudents = [];
for (const d of DEPARTMENTS) {
  for (const b of HISTORICAL_BATCHES) {
    for (const section of ['A', 'B', 'C', 'D']) {
      for (let i = 0; i < 5; i++) {
        const first = STU_FIRST[randInt(0, STU_FIRST.length - 1)];
        const lastInit = STU_LAST[randInt(0, STU_LAST.length - 1)];
        const genderGuess = ['Aishwarya', 'Bhuvana', 'Deepika', 'Ezhili', 'Gomathi', 'Harini', 'Ishwarya', 'Jeevitha', 'Kavitha', 'Lavanya', 'Malar', 'Nandhini', 'Priya', 'Ramya', 'Sowmya', 'Thenmozhi', 'Vaishnavi', 'Yamuna', 'Keerthi'].includes(first) ? 'Female' : 'Male';
        const regNo = `U${String(b.start).slice(2)}${d.code}${String(alumniStudents.length + 1).padStart(3, '0')}`;
        const emailBase = `${first.toLowerCase()}.${lastInit.toLowerCase()}${b.start}${d.emailCode}alum@sece.ac.in`;
        alumniStudents.push({
          deptCode: d.code, batchName: b.name, batchStart: b.start, batchEnd: b.end, section,
          firstName: first, lastName: lastInit, gender: genderGuess,
          quota: pick(QUOTAS), regNo, email: uniqueEmail(emailBase),
          community: pick(COMMUNITIES),
        });
      }
    }
  }
}
line(`-- total historical/alumni students generated: ${alumniStudents.length} (5/section x 4 sections x 10 depts x 4 historical batches)`);

{
  const rows = alumniStudents.map((s) => [
    esc(s.firstName), esc(s.lastName), esc(`${pick(FAC_LAST)} ${s.lastName}`), esc(`${pick(FAC_LAST)} ${s.lastName}`),
    esc(randomMobile()), esc(randomMobile()), esc(s.email), num((60 + rng() * 40).toFixed(2)),
    num((60 + rng() * 40).toFixed(2)), num((60 + rng() * 40).toFixed(2)), esc(s.community), esc('admission_confirmed'),
  ]);
  insertPlain(
    'soa_applications',
    ['first_name', 'last_name', 'father_name', 'mother_name', 'parent_contact', 'student_contact', 'student_email',
      'cutoff_physics', 'cutoff_chemistry', 'cutoff_maths', 'community', 'status'],
    rows
  );
}
for (const s of alumniStudents) {
  insertGuardedRow(
    'users', ['email', 'password_hash', 'phone', 'role_id', 'status'],
    [esc(s.email), esc(DUMMY_HASH), esc(randomMobile()), sub.role('student'), esc('inactive')],
    'email', s.email
  );
}
{
  const rows = alumniStudents.map((s) => {
    const admissionNo = `ADM${s.regNo}`;
    const dob = `${s.batchStart - 18}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`;
    return [
      `(SELECT id FROM soa_applications WHERE student_email = ${esc(s.email)})`,
      sub.userByEmail(s.email),
      esc(s.regNo), esc(s.regNo), esc(s.regNo), esc(admissionNo),
      sub.course(`${s.deptCode}-UG`), sub.quota(s.quota), sub.batch(s.batchName),
      esc(`${s.batchStart}-06-15`), esc('regular'), esc(`${s.batchStart}-${s.batchStart + 1}`),
      esc(s.gender), esc(dob), esc('dayscholar'), esc('transport'), NUL(),
      esc('inactive'), boolSql(s.quota === 'Government + First Graduate'),
      esc('Indian'), esc(pick(['Hindu', 'Christian', 'Muslim'])), esc(s.community), esc(pick(['Nadar', 'Gounder', 'Naidu', 'Reddy', 'Chettiar', 'Iyer'])),
      esc('Tamil'), esc(pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'])),
      boolSql(false), NUL(), boolSql(false), NUL(), NUL(), NUL(), NUL(),
      esc(pick(['TNEA Counselling', 'Management Direct'])), esc(pick(['College Website', 'Friend/Relative', 'School Notice'])),
      esc(`${pick(FAC_LAST)} ${s.lastName}`), NUL(),
    ];
  });
  insertPlain(
    'students',
    ['soa_application_id', 'user_id', 'student_id_no', 'roll_no', 'register_no', 'admission_no',
      'course_id', 'quota_id', 'batch_id', 'admission_date', 'admission_type', 'joined_academic_year',
      'gender', 'date_of_birth', 'student_type', 'dayscholar_mode', 'vehicle_number', 'status', 'is_first_graduate',
      'nationality', 'religion', 'community', 'caste', 'mother_tongue', 'blood_group',
      'is_father_exserviceman', 'exserviceman_info', 'is_diff_abled', 'diff_abled_info',
      'counselling_order_no', 'counselling_rank_no', 'govt_quota_admission_no', 'joined_through', 'knew_institution_by',
      'nominee', 'class_id'],
    rows
  );
}
line('-- student_profiles / student_family_details / student_contacts / student_certificates for alumni students');
{
  const rows = alumniStudents.map((s) => [sub.studentByRegNo(s.regNo), NUL(), NUL(), NUL(), NUL(), NUL(), NUL()]);
  insertPlain('student_profiles', ['student_id', 'resume_url', 'linkedin_url', 'github_url', 'leetcode_url', 'hackerrank_url', 'codeforces_url'], rows);
}
{
  const rows = alumniStudents.map((s) => {
    const fatherName = `${pick(FAC_LAST)} ${s.lastName}`;
    const motherName = `${pick(STU_FIRST)} ${s.lastName}`;
    return [
      sub.studentByRegNo(s.regNo), esc(fatherName), esc(pick(['SSLC', 'HSC', 'Diploma', 'B.Sc', 'B.Com', 'B.E.'])),
      esc(pick(['Farmer', 'Business', 'Government Employee', 'Private Employee', 'Teacher'])), num(randInt(150000, 900000)),
      esc(`${fatherName.toLowerCase().replace(/\s+/g, '.')}@gmail.com`), esc(randomMobile()),
      esc(motherName), esc(pick(['SSLC', 'HSC', 'Diploma', 'B.Sc', 'B.Com'])),
      esc(pick(['Homemaker', 'Teacher', 'Private Employee', 'Business'])), num(randInt(0, 300000)),
      esc(`${motherName.toLowerCase().replace(/\s+/g, '.')}@gmail.com`), esc(randomMobile()),
      NUL(), NUL(), NUL(), NUL(), NUL(), NUL(),
    ];
  });
  insertPlain(
    'student_family_details',
    ['student_id', 'father_name', 'father_qualification', 'father_occupation', 'father_annual_income', 'father_email', 'father_mobile',
      'mother_name', 'mother_qualification', 'mother_occupation', 'mother_annual_income', 'mother_email', 'mother_mobile',
      'father_photo_url', 'mother_photo_url', 'guardian_name', 'guardian_relationship', 'guardian_phone', 'guardian_email'],
    rows
  );
}
{
  const rows = alumniStudents.map((s) => [sub.studentByRegNo(s.regNo), esc(s.email), esc(`${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@gmail.com`), esc(randomMobile())]);
  insertPlain('student_contacts', ['student_id', 'student_email1', 'student_email2', 'student_mobile'], rows);
}
{
  const rows = [];
  for (const s of alumniStudents) {
    for (const ct of CERTIFICATE_TYPES) rows.push([sub.studentByRegNo(s.regNo), sub.certType(ct), boolSql(true)]);
  }
  insertPlain('student_certificates', ['student_id', 'certificate_type_id', 'is_available'], rows, 300);
}

line('-- alumni_members: one row per graduated student, linked to their alumni_batches row via students -> batches -> alumni_batches');
{
  const rows = alumniStudents.map((s) => {
    const employed = rng() < 0.55;
    return [
      `(SELECT id FROM alumni_batches WHERE batch_id = (SELECT id FROM batches WHERE name = ${esc(s.batchName)}))`,
      sub.studentByRegNo(s.regNo),
      esc(`${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}.alumni@gmail.com`),
      esc(randomMobile()),
      employed ? esc(pick(REAL_COMPANIES)) : NUL(),
      employed ? esc(pick(['Software Engineer', 'Senior Software Engineer', 'Analyst', 'Associate Consultant', 'Design Engineer', 'Graduate Engineer Trainee'])) : NUL(),
      esc('active'),
    ];
  });
  insertPlain('alumni_members', ['alumni_batch_id', 'student_id', 'personal_email', 'personal_phone', 'current_company', 'designation', 'status'], rows);
}
blank();

// ---------------------------------------------------------------------------
// PLACEMENT — historical drives/applications for the now-graduated alumni,
// plus current drives/applications for the 2023-2027 final-year batch.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- PLACEMENT: historical drives+applications for alumni, current drives+applications for final-year batch');
line('-- ===========================================================================');

const HISTORICAL_DRIVE_COMPANIES = ['Cognizant Technology Solutions', 'TCS'.replace('TCS', 'Tata Consultancy Services'), 'Wipro', 'Infosys', 'Hexaware', 'Mindtree', 'Zoho', 'Bosch', 'Accenture', 'Persistent'];
{
  const rows = [];
  for (const b of HISTORICAL_BATCHES) {
    for (const companyName of HISTORICAL_DRIVE_COMPANIES.slice(0, 6)) {
      const schedYear = b.end - 1; // drive held in final year, before graduation
      rows.push([
        `(SELECT id FROM companies WHERE name = ${esc(companyName)})`, boolSql(true), NUL(),
        esc(`${schedYear}-11-${String(randInt(10, 25)).padStart(2, '0')}`), esc('completed'), NUL(),
        esc(pick(['Software Engineer', 'Graduate Engineer Trainee', 'Analyst'])), num(randInt(35, 90) / 10),
      ]);
    }
  }
  insertPlain(
    'placement_drives',
    ['company_id', 'is_disclosed', 'disclosed_reveal_date', 'scheduled_date', 'status', 'created_by_user_id', 'job_role', 'package_lpa'],
    rows
  );
}
line('-- historical student_drive_applications: ~35% of each historical batch applies to one of their batch-year drives');
{
  const rows = [];
  for (const b of HISTORICAL_BATCHES) {
    const batchAlumni = alumniStudents.filter((s) => s.batchName === b.name);
    const applicants = shuffleCopy(batchAlumni).slice(0, Math.round(batchAlumni.length * 0.35));
    const schedYear = b.end - 1;
    for (const s of applicants) {
      const companyName = pick(HISTORICAL_DRIVE_COMPANIES.slice(0, 6));
      const outcome = pick(['placed', 'placed', 'r2_cleared', 'r1_cleared', 'rejected', 'rejected']);
      rows.push([
        `(SELECT id FROM placement_drives WHERE scheduled_date >= ${esc(`${schedYear}-11-01`)} AND scheduled_date <= ${esc(`${schedYear}-11-30`)} AND company_id = (SELECT id FROM companies WHERE name = ${esc(companyName)}) LIMIT 1)`,
        sub.studentByRegNo(s.regNo),
        esc(outcome),
        outcome === 'placed' ? esc('accepted') : NUL(),
        outcome === 'placed' ? num(randInt(35, 90) / 10) : NUL(),
      ]);
    }
  }
  insertPlain('student_drive_applications', ['drive_id', 'student_id', 'status', 'offer_response', 'offered_package'], rows);
}

line('-- current placement_drives: real companies, disclosed + undisclosed variants, scheduled for the current final-year batch (2023-2027)');
const CURRENT_DRIVE_COMPANIES_DISCLOSED = ['Zoho', 'Wipro', 'Cognizant Technology Solutions', 'Hexaware', 'Bosch', 'Infosys'];
const CURRENT_DRIVE_COMPANIES_UNDISCLOSED = ['Amazon', 'Microsoft'];
{
  const rows = [];
  for (const companyName of CURRENT_DRIVE_COMPANIES_DISCLOSED) {
    rows.push([
      `(SELECT id FROM companies WHERE name = ${esc(companyName)})`, boolSql(true), NUL(),
      esc(`2026-${pick(['09', '10', '11'])}-${String(randInt(10, 25)).padStart(2, '0')}`), esc('scheduled'), NUL(),
      esc(pick(['Software Engineer', 'Associate Engineer', 'Trainee Engineer'])), num(randInt(35, 120) / 10),
    ]);
  }
  for (const companyName of CURRENT_DRIVE_COMPANIES_UNDISCLOSED) {
    rows.push([
      `(SELECT id FROM companies WHERE name = ${esc(companyName)})`, boolSql(false),
      esc(`2026-${pick(['10', '11'])}-${String(randInt(20, 28)).padStart(2, '0')}`),
      esc(`2026-${pick(['10', '11'])}-${String(randInt(1, 19)).padStart(2, '0')}`), esc('scheduled'), NUL(),
      esc(pick(['Software Development Engineer', 'Product Analyst'])), num(randInt(80, 440) / 10),
    ]);
  }
  insertPlain(
    'placement_drives',
    ['company_id', 'is_disclosed', 'disclosed_reveal_date', 'scheduled_date', 'status', 'created_by_user_id', 'job_role', 'package_lpa'],
    rows
  );
}
line('-- current student_drive_applications: ~40% of the 2023-2027 (final-year) batch applies to one of the current drives');
{
  const finalYearStudents = students.filter((s) => s.batchName === '2023-2027');
  const applicants = shuffleCopy(finalYearStudents).slice(0, Math.round(finalYearStudents.length * 0.4));
  const allCurrentCompanies = CURRENT_DRIVE_COMPANIES_DISCLOSED.concat(CURRENT_DRIVE_COMPANIES_UNDISCLOSED);
  const rows = applicants.map((s) => {
    const companyName = pick(allCurrentCompanies);
    const outcome = pick(['applied', 'applied', 'r1_cleared', 'r2_cleared', 'rejected']);
    return [
      `(SELECT id FROM placement_drives WHERE company_id = (SELECT id FROM companies WHERE name = ${esc(companyName)}) AND status = 'scheduled' LIMIT 1)`,
      sub.studentByRegNo(s.regNo), esc(outcome), NUL(), NUL(),
    ];
  });
  insertPlain('student_drive_applications', ['drive_id', 'student_id', 'status', 'offer_response', 'offered_package'], rows);
}
blank();

// ===========================================================================
// PART 3 (this extension pass): exams/results, timetable, venues +
// venue_bookings, attendance_records — see header comment for full scope
// and what is still NOT covered after this pass.
// ===========================================================================

// ---------------------------------------------------------------------------
// EXAM TYPES / EXAMS / EXAM_SUBJECT_MAPPING / EXAM_MARKS / RESULT_PUBLICATIONS
// / REVALUATION_REQUESTS — scoped to the currently-active semester of each
// of the 4 current batches, reusing the real subjects/classes/faculty_
// subject_class_mapping rows generated above.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- EXAMS & RESULTS (currently-active semester of each current batch only)');
line('-- ===========================================================================');

const EXAM_TYPES = [
  { name: 'CIA1', category: 'internal', code: 'CIA1', isUniversity: false },
  { name: 'CIA2', category: 'internal', code: 'CIA2', isUniversity: false },
  { name: 'CIA3', category: 'internal', code: 'CIA3', isUniversity: false },
  { name: 'University End Semester Exam', category: 'external', code: 'UNIV_END', isUniversity: true },
];
line('-- exam_types (guarded on name) — real workflow-doc exam types: CIA1/CIA2/CIA3 (internal) + University end-semester (external)');
for (const et of EXAM_TYPES) {
  insertGuardedRow(
    'exam_types', ['name', 'category', 'code', 'is_university'],
    [esc(et.name), esc(et.category), esc(et.code), boolSql(et.isUniversity)], 'name', et.name
  );
}

// As of 2026-08-22 every current batch is early in its Jul-Dec 2026 semester
// (see semesterDateRange): CIA1 has been conducted and results published;
// CIA2 timetable is published (not yet conducted); CIA3 and the University
// end-semester exam have not yet been scheduled. This mirrors the real
// SECE academic calendar rhythm rather than inventing arbitrary states.
const EXAM_STATUS_BY_TYPE = {
  CIA1: 'results_published',
  CIA2: 'timetable_published',
  CIA3: 'created',
  'University End Semester Exam': 'created',
};

line('-- exams: one row per (batch, exam_type) for the current academic year — exams are batch-scoped in this schema, not class-scoped');
{
  const rows = [];
  for (const b of BATCHES) {
    for (const et of EXAM_TYPES) {
      const status = EXAM_STATUS_BY_TYPE[et.name];
      const { start } = semesterDateRange(b.start, b.currentSemester);
      const startDate = new Date(start);
      const cia1Start = new Date(startDate.getTime() + 30 * 86400000); // ~1 month into semester
      const examStart = et.name === 'CIA1' ? cia1Start : new Date(cia1Start.getTime() + (et.name === 'CIA2' ? 30 : 60) * 86400000);
      const fmt = (d) => d.toISOString().slice(0, 10);
      rows.push([
        sub.examType(et.name), sub.batch(b.name), esc(CURRENT_AY), num(b.currentSemester), esc(status),
        sub.userByEmail('academiccoordinator@sece.ac.in'),
        status === 'created' ? NUL() : esc(fmt(examStart)),
        status === 'created' ? NUL() : esc(fmt(new Date(examStart.getTime() + 6 * 86400000))),
        esc(`${b.name} Semester ${b.currentSemester} - ${et.name}`),
      ]);
    }
  }
  insertPlain(
    'exams',
    ['exam_type_id', 'batch_id', 'academic_year', 'semester', 'status', 'created_by_user_id', 'start_date', 'end_date', 'title'],
    rows
  );
}

line('-- exam_subject_mapping: CIA1 (published) + CIA2 (mapped, not yet published) for every current class x its real subjects');
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      const codes = subjectsByDeptSem[d.code][b.currentSemester];
      for (const section of ['A', 'B', 'C', 'D']) {
        for (const examTypeName of ['CIA1', 'CIA2']) {
          for (const code of codes) {
            rows.push([
              sub.exam(b.name, examTypeName, CURRENT_AY), sub.classByKey(b.name, d.code, section), sub.subjectByCode(code),
              boolSql(examTypeName === 'CIA1'),
            ]);
          }
        }
      }
    }
  }
  insertPlain('exam_subject_mapping', ['exam_id', 'class_id', 'subject_id', 'is_published'], rows);
}

line('-- exam_marks: CIA1 only (the one completed/published exam type), 5 of the 15 students per class per subject, max_marks = 50');
line('-- realistic score spread: mostly 25-48, a few low scorers (<20), a small absent fraction — not a uniform distribution');
const cia1LowScores = []; // { batchName, deptCode, section, subjectCode, regNo } for revaluation candidates
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      const codes = subjectsByDeptSem[d.code][b.currentSemester];
      for (const section of ['A', 'B', 'C', 'D']) {
        const classStudents = students.filter((s) => s.deptCode === d.code && s.batchName === b.name && s.section === section);
        const markedStudents = shuffleCopy(classStudents).slice(0, 5);
        const fscList = fscMappingByClassKey[`${d.code}|${b.name}|${section}`];
        for (const code of codes) {
          const teacherEntry = fscList.find((e) => e.subjectCode === code);
          for (const s of markedStudents) {
            const isAbsent = rng() < 0.04;
            let scoreStr;
            if (isAbsent) {
              scoreStr = NUL();
            } else {
              const roll = rng();
              const score = roll < 0.12 ? randInt(8, 19) : roll < 0.25 ? randInt(20, 29) : randInt(30, 49);
              scoreStr = num(score);
              if (score < 20) cia1LowScores.push({ batchName: b.name, deptCode: d.code, section, subjectCode: code, regNo: s.regNo });
            }
            rows.push([
              sub.examSubjMap(b.name, 'CIA1', d.code, section, code, CURRENT_AY), sub.studentByRegNo(s.regNo),
              scoreStr, num(50), sub.facultyByStaffCode(teacherEntry.staffCode), boolSql(isAbsent),
            ]);
          }
        }
      }
    }
  }
  insertPlain('exam_marks', ['exam_subject_mapping_id', 'student_id', 'marks_obtained', 'max_marks', 'entered_by_faculty_id', 'is_absent'], rows);
}

line('-- result_publications: one row per CIA1 exam (per batch), published by the institution-wide academic_coordinator seed account');
{
  const rows = BATCHES.map((b) => [
    sub.exam(b.name, 'CIA1', CURRENT_AY), esc('original'), sub.userByEmail('academiccoordinator@sece.ac.in'),
  ]);
  insertPlain('result_publications', ['exam_id', 'publication_type', 'published_by_user_id'], rows);
}

line('-- revaluation_requests: subset of CIA1 low-scoring (< 20/50) exam_marks rows, guarded on exam_marks_id');
{
  const candidates = shuffleCopy(cia1LowScores).slice(0, Math.min(30, cia1LowScores.length));
  for (const c of candidates) {
    const examMarksExpr = sub.examMarks(c.batchName, 'CIA1', c.deptCode, c.section, c.subjectCode, CURRENT_AY, c.regNo);
    insertGuardedExpr(
      'revaluation_requests',
      ['exam_marks_id', 'student_id', 'status', 'subject_id', 'exam_id', 'remarks', 'fee_amount', 'fee_paid'],
      [
        examMarksExpr, sub.studentByRegNo(c.regNo), esc('requested'), sub.subjectByCode(c.subjectCode),
        sub.exam(c.batchName, 'CIA1', CURRENT_AY), esc('Requesting recheck of CIA1 answer script'), num(200), boolSql(true),
      ],
      `exam_marks_id = ${examMarksExpr}`
    );
  }
}

// ---------------------------------------------------------------------------
// TIMETABLE: period_timings (Tier 0 lookup) + timetable_slots for every
// current class, reusing the exact faculty/subject pairs already generated
// above in faculty_subject_class_mapping.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- TIMETABLE: period_timings + timetable_slots (Mon-Sat, real mapped subjects/faculty reused)');
line('-- ===========================================================================');

const PERIODS = [
  { n: 1, start: '09:00:00', end: '09:50:00', isBreak: false },
  { n: 2, start: '09:50:00', end: '10:40:00', isBreak: false },
  { n: 3, start: '10:40:00', end: '11:30:00', isBreak: false },
  { n: 4, start: '11:30:00', end: '12:20:00', isBreak: true }, // lunch break
  { n: 5, start: '12:20:00', end: '13:10:00', isBreak: false },
  { n: 6, start: '13:10:00', end: '14:00:00', isBreak: false },
  { n: 7, start: '14:00:00', end: '14:50:00', isBreak: false },
];
const TEACHING_PERIODS = PERIODS.filter((p) => !p.isBreak); // 6 teaching periods == 6 subjects/dept/sem

line('-- period_timings (guarded on period_number) — Tier 0 lookup, not previously present');
for (const p of PERIODS) {
  insertGuardedRow(
    'period_timings', ['period_number', 'start_time', 'end_time', 'is_break'],
    [num(p.n), esc(p.start), esc(p.end), boolSql(p.isBreak)], 'period_number', String(p.n)
  );
}

line('-- timetable_slots: Mon(1)-Sat(6) weekly grid per class, rotated daily so the same 6 subjects appear in a different period order each day');
line('-- day_of_week convention: 1=Monday .. 6=Saturday. venue_id left NULL (classes already carry a classroom text field).');
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      for (const section of ['A', 'B', 'C', 'D']) {
        const key = `${d.code}|${b.name}|${section}`;
        const pairs = fscMappingByClassKey[key];
        for (let day = 1; day <= 6; day++) {
          for (let pi = 0; pi < TEACHING_PERIODS.length; pi++) {
            const pair = pairs[(pi + day) % pairs.length];
            const period = TEACHING_PERIODS[pi];
            rows.push([
              sub.classByKey(b.name, d.code, section), sub.subjectByCode(pair.subjectCode), sub.facultyByStaffCode(pair.staffCode),
              num(day), num(period.n), esc(period.start), esc(period.end), esc(CURRENT_AY), num(b.currentSemester),
            ]);
          }
        }
      }
    }
  }
  insertPlain(
    'timetable_slots',
    ['class_id', 'subject_id', 'faculty_id', 'day_of_week', 'period_number', 'start_time', 'end_time', 'academic_year', 'semester'],
    rows
  );
}

// ---------------------------------------------------------------------------
// VENUES + VENUE_BOOKINGS
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- VENUES + VENUE_BOOKINGS');
line('-- ===========================================================================');
const VENUES = [
  { name: 'Main Auditorium', location: 'Main Block', capacity: 1000, type: 'auditorium' },
  { name: 'Seminar Hall 1', location: 'Main Block', capacity: 150, type: 'seminar_hall' },
  { name: 'Seminar Hall 2', location: 'Main Block', capacity: 120, type: 'seminar_hall' },
  // Reuses the real facility names already seeded under sports_facilities (separate table, no FK link).
  { name: 'Main Sports Ground', location: 'Campus Sports Ground', capacity: 500, type: 'other' },
  { name: 'Amenity Centre Indoor Hall', location: 'Amenity Centre', capacity: 100, type: 'other' },
];
line('-- venues (no unique constraint in schema -> manual NOT EXISTS on name)');
for (const v of VENUES) {
  line(`INSERT INTO venues (name, location, capacity, venue_type)`);
  line(`SELECT ${esc(v.name)}, ${esc(v.location)}, ${num(v.capacity)}, ${esc(v.type)}`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM venues WHERE name = ${esc(v.name)});`);
  blank();
}

line('-- venue_bookings: a realistic mix of approved/pending bookings referencing real departments/placement drives already seeded');
{
  const rows = [
    ['Main Auditorium', 'hodmech@sece.ac.in', 'CSE department technical symposium inauguration', '2026-09-10 09:00:00+05:30', '2026-09-10 13:00:00+05:30', 400, 'approved', 'admin@sece.ac.in'],
    ['Seminar Hall 1', 'placement@sece.ac.in', 'Pre-placement talk and drive coordination meeting', '2026-09-15 10:00:00+05:30', '2026-09-15 12:30:00+05:30', 120, 'approved', 'admin@sece.ac.in'],
    ['Seminar Hall 2', 'hodaiml@sece.ac.in', 'AI & ML department guest lecture series', '2026-09-20 14:00:00+05:30', '2026-09-20 16:00:00+05:30', 90, 'pending', null],
    ['Amenity Centre Indoor Hall', 'sportsadmin@sece.ac.in', 'Inter-department indoor sports meet', '2026-09-25 08:00:00+05:30', '2026-09-25 17:00:00+05:30', 100, 'approved', 'admin@sece.ac.in'],
    ['Main Sports Ground', 'sportsadmin@sece.ac.in', 'Annual sports day ground booking', '2026-10-02 07:00:00+05:30', '2026-10-02 18:00:00+05:30', 500, 'pending', null],
  ];
  const outRows = rows.map((r) => [
    sub.venue(r[0]), sub.userByEmail(r[1]), esc(r[2]), esc(r[3]), esc(r[4]), num(r[5]), esc(r[6]),
    r[7] ? sub.userByEmail(r[7]) : NUL(),
  ]);
  insertPlain(
    'venue_bookings',
    ['venue_id', 'booked_by_user_id', 'purpose', 'from_datetime', 'to_datetime', 'accommodating_strength', 'status', 'reviewed_by_user_id'],
    outRows
  );
}

// ---------------------------------------------------------------------------
// ATTENDANCE_RECORDS — SCOPE NOTE: one recent week (5 real weekdays
// immediately preceding 2026-08-22, i.e. Mon 2026-08-17 .. Fri 2026-08-21),
// for the 4 currently-active batches' classes only (all 160 classes, since
// there are no other "current" classes in this schema). One daily
// attendance_records row per student per class (subject_id left NULL —
// this models the daily/period-register roll-call, not a per-period
// entry for every one of the 6 subjects x 6 periods x 5 days, which would
// be excessive for a seed). NOT the full semester for all ~2,400 students.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- ATTENDANCE_RECORDS (one recent week only, 4 current batches — see scope note in comment above)');
line('-- ===========================================================================');
{
  const ATT_DATES = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      for (const section of ['A', 'B', 'C', 'D']) {
        const mentor = classMentorByKey[`${d.code}|${b.name}|${section}`];
        const classStudents = students.filter((s) => s.deptCode === d.code && s.batchName === b.name && s.section === section);
        for (const date of ATT_DATES) {
          for (const s of classStudents) {
            const roll = rng();
            const status = roll < 0.85 ? 'present' : roll < 0.95 ? 'absent' : 'on_duty';
            rows.push([
              sub.studentByRegNo(s.regNo), sub.classByKey(b.name, d.code, section), NUL(), esc(date), esc(status),
              sub.facultyByStaffCode(mentor.staffCode), sub.facultyUserByStaffCode(mentor.staffCode),
            ]);
          }
        }
      }
    }
  }
  insertPlain(
    'attendance_records',
    ['student_id', 'class_id', 'subject_id', 'attendance_date', 'status', 'marked_by_faculty_id', 'marked_by_user_id'],
    rows
  );
}

blank();

// ===========================================================================
// PART 4 (this extension pass): ANNOUNCEMENTS + NOTIFICATIONS + AUDIT_LOGS
// (item 10 + item 13 of the remaining scope). Shapes verified against
// src/modules/announcements/announcements/announcements.service.ts and
// src/modules/fees-billing/audit-log/audit-log.service.ts before writing.
// See header comment for full "not yet covered" list after this pass.
// ===========================================================================
line('-- ===========================================================================');
line('-- ANNOUNCEMENTS + ANNOUNCEMENT_CLASS_MAPPING / ANNOUNCEMENT_ROLE_MAPPING');
line('-- (shape verified against announcements.service.ts create() branches:');
line('--  students/parents -> class_ids via announcement_class_mapping,');
line('--  teachers -> department_id column, roles -> announcement_role_mapping,');
line('--  edc_* -> no targeting table at all)');
line('-- ===========================================================================');
sub.announcementByTitle = (title) => `(SELECT id FROM announcements WHERE title = ${esc(title)})`;

const ANNOUNCEMENTS = [
  {
    title: 'CIA2 Timetable Released',
    content: 'The CIA2 internal assessment timetable has been published. Students are advised to check the timetable module and prepare accordingly.',
    category: 'academic', targetAudience: 'students', postedByEmail: 'academiccoordinator@sece.ac.in',
    classes: [{ batch: '2024-2028', dept: 'CS', section: 'A' }, { batch: '2024-2028', dept: 'AI', section: 'A' }],
  },
  {
    title: 'Department Faculty Meeting - AIML',
    content: 'All AIML department faculty are requested to attend the monthly review meeting in Seminar Hall 2 on the scheduled date.',
    category: 'department', targetAudience: 'teachers', postedByEmail: 'hodaiml@sece.ac.in',
    departmentCode: 'AI',
  },
  {
    title: 'Library and Placement Cell Coordination Update',
    content: 'The library and placement cell teams are requested to coordinate on the upcoming pre-placement reading material drive.',
    category: 'general', targetAudience: 'roles', postedByEmail: 'principal@sece.ac.in',
    roleNames: ['library', 'placement'],
  },
  {
    title: 'Semester Fee Payment Reminder',
    content: 'Parents are reminded that the current semester fee payment deadline is approaching. Please clear dues at the earliest to avoid late fee penalties.',
    category: 'general', targetAudience: 'parents', postedByEmail: 'billing@sece.ac.in',
    classes: [{ batch: '2025-2029', dept: 'EC', section: 'A' }],
  },
  {
    title: 'EDC Founders Meetup',
    content: 'All registered EDC student founders are invited to the monthly founders meetup at the Amenity Centre.',
    category: 'event', targetAudience: 'edc_founders', postedByEmail: 'edccoordinator@sece.ac.in',
  },
];

line('-- announcements (guarded on title — no unique constraint in schema, so title doubles as our natural key here)');
for (const a of ANNOUNCEMENTS) {
  const deptExpr = a.departmentCode ? sub.dept(a.departmentCode) : NUL();
  insertGuardedRow(
    'announcements',
    ['posted_by_user_id', 'title', 'content', 'target_audience', 'department_id', 'status', 'category'],
    [sub.userByEmail(a.postedByEmail), esc(a.title), esc(a.content), esc(a.targetAudience), deptExpr, esc('published'), esc(a.category)],
    'title', a.title
  );
}

line('-- announcement_class_mapping (students/parents-targeted announcements only)');
for (const a of ANNOUNCEMENTS) {
  if (!a.classes) continue;
  for (const c of a.classes) {
    const classExpr = sub.classByKey(c.batch, c.dept, c.section);
    insertGuardedExpr(
      'announcement_class_mapping', ['announcement_id', 'class_id'],
      [sub.announcementByTitle(a.title), classExpr],
      `announcement_id = ${sub.announcementByTitle(a.title)} AND class_id = ${classExpr}`
    );
  }
}

line('-- announcement_role_mapping (roles-targeted announcements only)');
for (const a of ANNOUNCEMENTS) {
  if (!a.roleNames) continue;
  for (const roleName of a.roleNames) {
    const roleExpr = sub.role(roleName);
    insertGuardedExpr(
      'announcement_role_mapping', ['announcement_id', 'role_id'],
      [sub.announcementByTitle(a.title), roleExpr],
      `announcement_id = ${sub.announcementByTitle(a.title)} AND role_id = ${roleExpr}`
    );
  }
}

line('-- ===========================================================================');
line('-- NOTIFICATIONS: tied to real events already seeded this pass or a prior one');
line('-- (the 5 announcements above + the CIA1 result_publications from PART 3)');
line('-- ===========================================================================');
{
  const rows = [];
  // announcement_new: a small sample of recipient students for the two
  // class-targeted announcements (not every student in every class).
  const notifTargets = [
    { title: 'CIA2 Timetable Released', batch: '2024-2028', dept: 'CS', section: 'A' },
    { title: 'CIA2 Timetable Released', batch: '2024-2028', dept: 'AI', section: 'A' },
    { title: 'Semester Fee Payment Reminder', batch: '2025-2029', dept: 'EC', section: 'A' },
  ];
  for (const t of notifTargets) {
    const classStudents = students.filter((s) => s.deptCode === t.dept && s.batchName === t.batch && s.section === t.section);
    const sample = shuffleCopy(classStudents).slice(0, 3); // 3 of 15 students per class — a representative sample, not the whole roster
    for (const s of sample) {
      rows.push([
        sub.studentUserByRegNo(s.regNo), esc('New Announcement'), esc(`New announcement posted: "${t.title}"`),
        boolSql(false), esc('announcement_new'), esc('announcement'), sub.announcementByTitle(t.title),
      ]);
    }
  }
  // exam_result_published: a small sample of students per batch, tied to the
  // real CIA1 result_publications rows created in PART 3 above.
  for (const b of BATCHES) {
    const batchStudents = shuffleCopy(students.filter((s) => s.batchName === b.name)).slice(0, 4);
    for (const s of batchStudents) {
      rows.push([
        sub.studentUserByRegNo(s.regNo), esc('CIA1 Results Published'),
        esc(`Your CIA1 exam results for ${b.name} have been published. Check the results module for details.`),
        boolSql(false), esc('exam_result_published'), esc('exam'), sub.exam(b.name, 'CIA1', CURRENT_AY),
      ]);
    }
  }
  insertPlain('notifications', ['user_id', 'title', 'message', 'is_read', 'type', 'related_entity_type', 'related_entity_id'], rows);
}

line('-- ===========================================================================');
line('-- AUDIT_LOGS (shape verified against audit-log.service.ts: entity_type/');
line('-- entity_id/action/performed_by_user_id/old_value/new_value/reason).');
line('-- A handful of rows for the "announcement" entity_type only, tied to the');
line('-- real announcements created immediately above in this pass.');
line('-- ===========================================================================');
{
  const rows = ANNOUNCEMENTS.map((a) => [
    esc('announcement'), sub.announcementByTitle(a.title), esc('created'), sub.userByEmail(a.postedByEmail),
    NUL(), esc(JSON.stringify({ title: a.title, target_audience: a.targetAudience })), esc('Seed data: announcement published'),
  ]);
  insertPlain('audit_logs', ['entity_type', 'entity_id', 'action', 'performed_by_user_id', 'old_value', 'new_value', 'reason'], rows);
}

blank();

// ===========================================================================
// PART 5 (this extension pass): LMS module (item 6) + Feedback module (item 7)
// of the remaining numbered scope. Same hard rules: subquery-only FKs,
// WHERE NOT EXISTS guards on every table below (none of lms_folders/
// lms_notes/lms_resources/assignments/student_assignment_status/
// feedback_forms/feedback_questions/feedback_responses/
// feedback_question_templates has a real natural unique key in the schema
// beyond the tuples used below, so every guard is a subquery-expression
// check against those tuples, matching the existing revaluation_requests/
// announcement_class_mapping pattern), single existing BEGIN/COMMIT.
// ===========================================================================

line('-- ===========================================================================');
line('-- LMS: one lms_folders row per real faculty_subject_class_mapping row already');
line('-- generated above, + 1 generic lms_notes row + 1 generic lms_resources row per');
line('-- folder, + 1 assignments row per mapping with student_assignment_status for a');
line('-- 3-student sample (of 15) per class-subject. Titles/descriptions are all');
line('-- explicitly generic placeholders (no real syllabus/LMS content available).');
line('-- ===========================================================================');
{
  const folderRows = []; // {subjectCode, staffCode, title, description}
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      for (const section of ['A', 'B', 'C', 'D']) {
        const key = `${d.code}|${b.name}|${section}`;
        const mapping = fscMappingByClassKey[key] || [];
        for (const m of mapping) {
          const title = `${m.subjectCode} Course Material`;
          folderRows.push({
            deptCode: d.code, batchName: b.name, section, subjectCode: m.subjectCode, staffCode: m.staffCode,
            title, description: 'Generic placeholder course-material folder (no real syllabus content available).',
          });
        }
      }
    }
  }
  line(`-- lms_folders: ${folderRows.length} rows (one per faculty_subject_class_mapping row)`);
  for (const f of folderRows) {
    insertGuardedExpr(
      'lms_folders', ['subject_id', 'faculty_id', 'title', 'description'],
      [sub.subjectByCode(f.subjectCode), sub.facultyByStaffCode(f.staffCode), esc(f.title), esc(f.description)],
      `subject_id = ${sub.subjectByCode(f.subjectCode)} AND faculty_id = ${sub.facultyByStaffCode(f.staffCode)} AND title = ${esc(f.title)}`
    );
  }
  blank();

  line('-- lms_folder_classes: link each folder to the one class it was generated for');
  for (const f of folderRows) {
    const folderSub = sub.lmsFolder(f.subjectCode, f.staffCode, f.title);
    const classSub = sub.classByKey(f.batchName, f.deptCode, f.section);
    insertGuardedExpr(
      'lms_folder_classes', ['folder_id', 'class_id'],
      [folderSub, classSub],
      `folder_id = ${folderSub} AND class_id = ${classSub}`
    );
  }
  blank();

  line('-- lms_notes: 1 generic note per folder');
  for (const f of folderRows) {
    const noteTitle = `${f.subjectCode} - Unit Notes (Generic Placeholder)`;
    insertGuardedExpr(
      'lms_notes', ['subject_id', 'class_id', 'faculty_id', 'title', 'file_url'],
      [sub.subjectByCode(f.subjectCode), sub.classByKey(f.batchName, f.deptCode, f.section), sub.facultyByStaffCode(f.staffCode), esc(noteTitle), NUL()],
      `subject_id = ${sub.subjectByCode(f.subjectCode)} AND class_id = ${sub.classByKey(f.batchName, f.deptCode, f.section)} AND faculty_id = ${sub.facultyByStaffCode(f.staffCode)} AND title = ${esc(noteTitle)}`
    );
  }
  blank();

  line('-- lms_resources: 1 generic file resource per folder');
  for (const f of folderRows) {
    const resTitle = `${f.subjectCode} - Reference Material (Generic Placeholder)`;
    const folderSub = sub.lmsFolder(f.subjectCode, f.staffCode, f.title);
    insertGuardedExpr(
      'lms_resources', ['folder_id', 'title', 'description', 'resource_type', 'file_url'],
      [folderSub, esc(resTitle), esc('Generic placeholder reference material.'), esc('file'), NUL()],
      `folder_id = ${folderSub} AND title = ${esc(resTitle)}`
    );
  }
  blank();

  line('-- assignments: 1 per faculty_subject_class_mapping row, generic title, sequence_no = 1');
  for (const f of folderRows) {
    const title = `${f.subjectCode} Assignment 1`;
    insertGuardedExpr(
      'assignments',
      ['class_id', 'subject_id', 'faculty_id', 'academic_year', 'semester', 'sequence_no', 'title', 'description', 'due_date', 'max_marks', 'task_type'],
      [
        sub.classByKey(f.batchName, f.deptCode, f.section), sub.subjectByCode(f.subjectCode), sub.facultyByStaffCode(f.staffCode),
        esc(CURRENT_AY), `(SELECT current_semester FROM classes WHERE id = ${sub.classByKey(f.batchName, f.deptCode, f.section)})`,
        '1', esc(title), esc('Generic placeholder assignment (no real syllabus content available).'),
        esc('2026-09-15 23:59:00+05:30'), '50', esc('assignment'),
      ],
      `class_id = ${sub.classByKey(f.batchName, f.deptCode, f.section)} AND subject_id = ${sub.subjectByCode(f.subjectCode)} AND academic_year = ${esc(CURRENT_AY)} AND sequence_no = 1`
    );
  }
  blank();

  line('-- student_assignment_status: 3-of-15-student sample per assignment');
  let sasCount = 0;
  for (const f of folderRows) {
    const classStudents = students.filter((s) => s.deptCode === f.deptCode && s.batchName === f.batchName && s.section === f.section);
    const sample = shuffleCopy(classStudents).slice(0, 3);
    const assignSub = sub.assignmentByKey(f.batchName, f.deptCode, f.section, f.subjectCode, CURRENT_AY, 1);
    for (const s of sample) {
      const isSubmitted = rng() < 0.7;
      insertGuardedExpr(
        'student_assignment_status',
        ['assignment_id', 'student_id', 'is_submitted', 'submitted_at', 'marks_obtained'],
        [
          assignSub, sub.studentByRegNo(s.regNo), boolSql(isSubmitted),
          isSubmitted ? esc('2026-09-14 18:00:00+05:30') : NUL(),
          isSubmitted ? num(randInt(30, 50)) : NUL(),
        ],
        `assignment_id = ${assignSub} AND student_id = ${sub.studentByRegNo(s.regNo)}`
      );
      sasCount++;
    }
  }
  line(`-- total student_assignment_status rows: ${sasCount}`);
  blank();
}

line('-- ===========================================================================');
line('-- FEEDBACK: feedback_rating_scales (+options), feedback_question_templates,');
line('-- feedback_forms (one per currently-active class, created by the existing');
line('-- academic_coordinator seed account) + feedback_questions (3 generic questions');
line('-- per form) + feedback_responses (5-student sample per form, all 3 questions).');
line('-- ===========================================================================');
{
  line('-- feedback_rating_scales (guarded by name) + its 5 options');
  insertGuardedRow('feedback_rating_scales', ['name'], [esc('Standard 5-Point Scale')], 'name', 'Standard 5-Point Scale');
  const scaleOptions = [
    [1, 1, 'Need Improvement'], [2, 2, 'Satisfactory'], [3, 3, 'Good'], [4, 4, 'Very Good'], [5, 5, 'Excellent'],
  ];
  for (const [seq, val, label] of scaleOptions) {
    const scaleSub = sub.feedbackRatingScale('Standard 5-Point Scale');
    insertGuardedExpr(
      'feedback_rating_scale_options', ['scale_id', 'sequence_no', 'value', 'label'],
      [scaleSub, num(seq), num(val), esc(label)],
      `scale_id = ${scaleSub} AND sequence_no = ${num(seq)}`
    );
  }
  blank();

  line('-- feedback_question_templates: 4 generic THEORY + 4 generic LABORATORY templates (guarded)');
  const templateQuestions = {
    THEORY: [
      'Is the faculty member regular and punctual in taking classes?',
      'Does the faculty member cover the syllabus adequately within the given time?',
      'Does the faculty member use teaching aids / real-life examples effectively?',
      'Does the faculty member clarify doubts and encourage questions?',
    ],
    LABORATORY: [
      'Is the laboratory equipment adequate and in working condition?',
      'Does the faculty member give clear instructions before each experiment?',
      'Is individual attention given during laboratory sessions?',
      'Are laboratory records/manuals evaluated and returned on time?',
    ],
  };
  for (const [courseType, qs] of Object.entries(templateQuestions)) {
    qs.forEach((q, idx) => {
      insertGuardedExpr(
        'feedback_question_templates', ['course_type', 'question_text', 'is_optional', 'display_order'],
        [esc(courseType), esc(q), boolSql(false), num(idx + 1)],
        `course_type = ${esc(courseType)} AND question_text = ${esc(q)}`
      );
    });
  }
  blank();

  line('-- feedback_forms: 1 general form per currently-active class, created by academic_coordinator (assumed pre-existing seed account)');
  const feedbackFormsBuilt = []; // { title, deptCode, batchName, section }
  const generalQuestions = [
    'Is the faculty approachable and helpful outside class hours?',
    'Rate the overall teaching quality of the faculty mapped to this class this semester.',
    'Any additional comments about the teaching-learning experience this semester?',
  ];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      for (const section of ['A', 'B', 'C', 'D']) {
        const title = `${d.code}-${b.name}-${section} End Semester Feedback ${CURRENT_AY}`;
        feedbackFormsBuilt.push({ title, deptCode: d.code, batchName: b.name, section });
        insertGuardedExpr(
          'feedback_forms', ['created_by_user_id', 'title', 'class_id', 'form_type', 'rating_scale_id'],
          [
            sub.userByEmail('academiccoordinator@sece.ac.in'), esc(title), sub.classByKey(b.name, d.code, section),
            esc('general'), sub.feedbackRatingScale('Standard 5-Point Scale'),
          ],
          `title = ${esc(title)}`
        );
      }
    }
  }
  blank();

  line('-- feedback_questions: 3 generic questions per form (rating question_type, plain text for the comments question)');
  for (const f of feedbackFormsBuilt) {
    generalQuestions.forEach((q, idx) => {
      const qType = idx === generalQuestions.length - 1 ? 'text' : 'rating';
      insertGuardedExpr(
        'feedback_questions', ['form_id', 'question_text', 'sequence_no', 'question_type'],
        [sub.feedbackForm(f.title), esc(q), num(idx + 1), esc(qType)],
        `form_id = ${sub.feedbackForm(f.title)} AND question_text = ${esc(q)}`
      );
    });
  }
  blank();

  line('-- feedback_responses: 5-of-15-student sample per form, answering all 3 questions each');
  let responseCount = 0;
  for (const f of feedbackFormsBuilt) {
    const classStudents = students.filter((s) => s.deptCode === f.deptCode && s.batchName === f.batchName && s.section === f.section);
    const sample = shuffleCopy(classStudents).slice(0, 5);
    for (const s of sample) {
      generalQuestions.forEach((q, idx) => {
        const isTextQ = idx === generalQuestions.length - 1;
        const questionSub = sub.feedbackQuestion(f.title, q);
        if (isTextQ) {
          insertGuardedExpr(
            'feedback_responses', ['question_id', 'student_id', 'response_text'],
            [questionSub, sub.studentByRegNo(s.regNo), esc(pick(['Good teaching experience overall.', 'No specific comments.', 'Would like more interactive sessions.', 'Satisfied with the semester.']))],
            `question_id = ${questionSub} AND student_id = ${sub.studentByRegNo(s.regNo)}`
          );
        } else {
          const ratingVal = randInt(3, 5);
          const ratingLabel = ratingVal === 5 ? 'excellent' : ratingVal === 4 ? 'very_good' : 'good';
          insertGuardedExpr(
            'feedback_responses', ['question_id', 'student_id', 'rating_value', 'rating_label'],
            [questionSub, sub.studentByRegNo(s.regNo), num(ratingVal), esc(ratingLabel)],
            `question_id = ${questionSub} AND student_id = ${sub.studentByRegNo(s.regNo)}`
          );
        }
        responseCount++;
      });
    }
  }
  line(`-- total feedback_responses rows: ${responseCount}`);
  blank();
}

blank();

// ===========================================================================
// PART 6 (this extension pass): items 3, 8, 9, 11, 12 of the remaining
// numbered scope. Same hard rules re-verified: subquery-only FKs everywhere,
// WHERE NOT EXISTS guards on every collision-prone table (none of these
// tables besides a few with real @@unique constraints has a natural key
// beyond the tuples used below), single existing BEGIN/COMMIT.
// ===========================================================================

// ---------------------------------------------------------------------------
// ITEM 3: Hall tickets + seating + invigilation for the University End
// Semester Exam. Reuses the real exam_types/exams rows created in PART 3
// (status='created', dates NULL there) and the 5 real venues from PART 3.
// A sample of 20 currently-enrolled students per batch (not all ~600/batch)
// is seated and issued hall tickets — a deliberate, explicitly-scoped size
// choice consistent with every other sampled section in this file.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- HALL TICKETS + SEATING PLANS + INVIGILATION (University End Semester Exam)');
line('-- 20-student sample per batch seated/ticketed — not the full ~600/batch roster');
line('-- ===========================================================================');
{
  const examDateByBatch = {};
  for (const b of BATCHES) {
    const { end } = semesterDateRange(b.start, b.currentSemester);
    const endDate = new Date(end);
    examDateByBatch[b.name] = new Date(endDate.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  }

  // hall_plans: one per batch, rotating through the 5 real venues
  const hallPlanKey = (batchName) => {
    const venueName = VENUES[BATCHES.findIndex((b) => b.name === batchName) % VENUES.length].name;
    return { venueName, examDate: examDateByBatch[batchName] };
  };
  line('-- hall_plans (guarded on exam_id + venue_id + exam_date, no @@unique in schema)');
  for (const b of BATCHES) {
    const { venueName, examDate } = hallPlanKey(b.name);
    const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
    const venueExpr = sub.venue(venueName);
    insertGuardedExpr(
      'hall_plans', ['exam_id', 'venue_id', 'exam_date', 'capacity'],
      [examExpr, venueExpr, esc(examDate), num(40)],
      `exam_id = ${examExpr} AND venue_id = ${venueExpr} AND exam_date = ${esc(examDate)}`
    );
  }

  const hallPlanExpr = (batchName) => {
    const { venueName, examDate } = hallPlanKey(batchName);
    return `(SELECT id FROM hall_plans WHERE exam_id = ${sub.exam(batchName, 'University End Semester Exam', CURRENT_AY)} AND venue_id = ${sub.venue(venueName)} AND exam_date = ${esc(examDate)})`;
  };

  line('-- seating_plan_versions (one per batch, version 1, published) + seating_plan_version_venues');
  for (const b of BATCHES) {
    const { examDate } = hallPlanKey(b.name);
    const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
    insertGuardedExpr(
      'seating_plan_versions', ['exam_id', 'exam_date', 'session', 'version_number', 'status', 'created_by_user_id', 'published_by_user_id', 'published_at'],
      [examExpr, esc(examDate), esc('FN'), num(1), esc('published'), sub.userByEmail('coe@sece.ac.in'), sub.userByEmail('coe@sece.ac.in'), esc(`${examDate} 09:00:00+05:30`)],
      `exam_id = ${examExpr} AND exam_date = ${esc(examDate)} AND session = 'FN' AND version_number = 1`
    );
  }
  const versionExpr = (batchName) => {
    const { examDate } = hallPlanKey(batchName);
    return `(SELECT id FROM seating_plan_versions WHERE exam_id = ${sub.exam(batchName, 'University End Semester Exam', CURRENT_AY)} AND exam_date = ${esc(examDate)} AND session = 'FN' AND version_number = 1)`;
  };
  for (const b of BATCHES) {
    const { venueName } = hallPlanKey(b.name);
    const vExpr = versionExpr(b.name);
    const venueExpr = sub.venue(venueName);
    insertGuardedExpr(
      'seating_plan_version_venues', ['version_id', 'venue_id', 'hall_plan_id', 'allocation_mode', 'pattern'],
      [vExpr, venueExpr, hallPlanExpr(b.name), esc('automatic'), esc('sequential')],
      `version_id = ${vExpr} AND venue_id = ${venueExpr}`
    );
  }

  line('-- seating_arrangements: 20 real currently-enrolled students per batch, sequential seat numbers');
  const seatedByBatch = {}; // batchName -> [student records]
  for (const b of BATCHES) {
    const batchStudents = shuffleCopy(students.filter((s) => s.batchName === b.name)).slice(0, 20);
    seatedByBatch[b.name] = batchStudents;
    const hpExpr = hallPlanExpr(b.name);
    const vExpr = versionExpr(b.name);
    batchStudents.forEach((s, idx) => {
      const seatNo = `S-${String(idx + 1).padStart(3, '0')}`;
      insertGuardedExpr(
        'seating_arrangements', ['hall_plan_id', 'student_id', 'seat_number', 'version_id', 'is_special_accommodation'],
        [hpExpr, sub.studentByRegNo(s.regNo), esc(seatNo), vExpr, boolSql(false)],
        `hall_plan_id = ${hpExpr} AND seat_number = ${esc(seatNo)}`
      );
    });
  }

  line('-- invigilation_allocation_batches (one per batch exam) + invigilation_duties (rotating faculty subset)');
  for (const b of BATCHES) {
    const { examDate } = hallPlanKey(b.name);
    const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
    insertGuardedExpr(
      'invigilation_allocation_batches', ['exam_id', 'exam_date', 'session', 'status', 'created_by_user_id', 'published_by_user_id', 'published_at'],
      [examExpr, esc(examDate), esc('FN'), esc('published'), sub.userByEmail('coe@sece.ac.in'), sub.userByEmail('coe@sece.ac.in'), esc(`${examDate} 08:00:00+05:30`)],
      `exam_id = ${examExpr} AND exam_date = ${esc(examDate)} AND session = 'FN'`
    );
  }
  const allocBatchExpr = (batchName) => {
    const { examDate } = hallPlanKey(batchName);
    return `(SELECT id FROM invigilation_allocation_batches WHERE exam_id = ${sub.exam(batchName, 'University End Semester Exam', CURRENT_AY)} AND exam_date = ${esc(examDate)} AND session = 'FN')`;
  };
  let invigCount = 0;
  for (const b of BATCHES) {
    const { examDate } = hallPlanKey(b.name);
    const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
    const hpExpr = hallPlanExpr(b.name);
    const abExpr = allocBatchExpr(b.name);
    // rotating subset: 1 chief + 3 relief invigilators, drawn from across departments, rotated by batch index
    const rotation = shuffleCopy(facultyRoster.filter((f) => !f.isHod));
    const batchIdx = BATCHES.findIndex((bb) => bb.name === b.name);
    const duty = rotation.slice(batchIdx * 4, batchIdx * 4 + 4);
    duty.forEach((f, idx) => {
      const role = idx === 0 ? 'chief' : 'relief';
      insertGuardedExpr(
        'invigilation_duties', ['exam_id', 'faculty_id', 'hall_plan_id', 'duty_date', 'session', 'role', 'allocation_batch_id'],
        [examExpr, sub.facultyByStaffCode(f.staffCode), hpExpr, esc(examDate), esc('FN'), esc(role), abExpr],
        `exam_id = ${examExpr} AND faculty_id = ${sub.facultyByStaffCode(f.staffCode)} AND duty_date = ${esc(examDate)} AND session = 'FN'`
      );
      invigCount++;
    });
  }
  line(`-- total invigilation_duties rows: ${invigCount}`);

  line('-- hall_tickets: one per seated student above, tied to the real University End Semester exam for their batch');
  for (const b of BATCHES) {
    const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
    for (const s of seatedByBatch[b.name]) {
      const stuExpr = sub.studentByRegNo(s.regNo);
      insertGuardedExpr(
        'hall_tickets', ['exam_id', 'student_id', 'file_url'],
        [examExpr, stuExpr, esc(`https://placeholder.sece.ac.in/hall-tickets/${s.regNo}-univ-end-sem.pdf`)],
        `exam_id = ${examExpr} AND student_id = ${stuExpr}`
      );
    }
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 8: Appraisal — cycles, divisions (Academic/Project/Online Courses/
// Paper Publications), criteria with max scores, requests for a sample of
// 3 faculty per department (30 of ~500, not all), entries, and a handful of
// attachments. Real HOD-then-management approval chain reusing real HOD
// seed accounts + the pre-existing 'principal' seed account for the
// management-approval step (schema has no separate 'management' role/user;
// this is the most faithful real-role stand-in) and the pre-existing
// 'hr_payroll' seed account referenced in comments for the HR-scoring step
// (schema's appraisal_requests has no dedicated hr-reviewer column, only
// hod_reviewed_by / management_approved_by, so hr_scored status rows carry
// no separate HR-reviewer FK — noted explicitly rather than invented).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- APPRAISAL: cycles, divisions, criteria, requests (3 faculty/dept sample = 30),');
line('-- entries, attachments. HOD-then-management (principal) approval chain.');
line('-- ===========================================================================');
sub.appraisalDivision = (name) => `(SELECT id FROM appraisal_divisions WHERE name = ${esc(name)})`;
{
  line('-- appraisal_cycles (guarded on academic_year — one active cycle for the current AY)');
  insertGuardedRow(
    'appraisal_cycles', ['academic_year', 'start_date', 'end_date', 'is_active', 'created_by_user_id'],
    [esc(CURRENT_AY), esc('2026-07-01'), esc('2027-05-31'), boolSql(true), sub.userByEmail('hrpayroll@sece.ac.in')],
    'academic_year', CURRENT_AY
  );

  const DIVISIONS = ['Academic', 'Project', 'Online Courses', 'Paper Publications'];
  line('-- appraisal_divisions (guarded on unique name)');
  for (const dv of DIVISIONS) insertGuardedRow('appraisal_divisions', ['name'], [esc(dv)], 'name', dv);

  const CRITERIA = [
    ['Academic', 'Teaching Excellence Rating', 20, 20],
    ['Academic', 'Attendance & Punctuality', 10, 10],
    ['Project', 'Funded Project Involvement', 15, 15],
    ['Project', 'Project Guidance to Students', 10, 10],
    ['Online Courses', 'NPTEL/Coursera Certification Completed', 10, 10],
    ['Paper Publications', 'Journal Publication (Scopus/SCI)', 20, 20],
    ['Paper Publications', 'Conference Paper Presented', 15, 15],
  ];
  line('-- appraisal_criteria (guarded on division_id + criteria_name + academic_year)');
  for (const [dv, name, maxScore, weight] of CRITERIA) {
    const divExpr = sub.appraisalDivision(dv);
    insertGuardedExpr(
      'appraisal_criteria', ['division_id', 'criteria_name', 'max_score', 'academic_year', 'weightage_percent', 'created_by_user_id', 'status'],
      [divExpr, esc(name), num(maxScore), esc(CURRENT_AY), num(weight), sub.userByEmail('hrpayroll@sece.ac.in'), esc('active')],
      `division_id = ${divExpr} AND criteria_name = ${esc(name)} AND academic_year = ${esc(CURRENT_AY)}`
    );
  }
  const criteriaExpr = (dv, name) =>
    `(SELECT id FROM appraisal_criteria WHERE division_id = ${sub.appraisalDivision(dv)} AND criteria_name = ${esc(name)} AND academic_year = ${esc(CURRENT_AY)})`;

  line('-- appraisal_requests: 3 non-HOD faculty/department sample (30 total), mixed status, real HOD/principal approval chain');
  const STATUS_CYCLE = ['submitted', 'hod_reviewed', 'hr_scored', 'management_approved'];
  const appraisalSample = []; // { faculty, status }
  for (const d of DEPARTMENTS) {
    const pool = shuffleCopy(facultyRoster.filter((f) => f.deptCode === d.code && !f.isHod)).slice(0, 3);
    pool.forEach((f, idx) => appraisalSample.push({ f, d, status: STATUS_CYCLE[idx % STATUS_CYCLE.length] }));
  }
  for (const { f, d, status } of appraisalSample) {
    const hod = facultyRoster.find((ff) => ff.deptCode === d.code && ff.isHod);
    const hodDone = status !== 'submitted';
    const mgmtDone = status === 'management_approved';
    const facExpr = sub.facultyByStaffCode(f.staffCode);
    insertGuardedExpr(
      'appraisal_requests',
      ['faculty_id', 'academic_year', 'status', 'hod_reviewed_by', 'hod_reviewed_at', 'management_approved_by', 'management_approved_at', 'hod_remarks', 'staff_user_id'],
      [
        facExpr, esc(CURRENT_AY), esc(status),
        hodDone ? sub.userByEmail(hod.email) : NUL(), hodDone ? esc('2026-08-10 10:00:00+05:30') : NUL(),
        mgmtDone ? sub.userByEmail('principal@sece.ac.in') : NUL(), mgmtDone ? esc('2026-08-15 10:00:00+05:30') : NUL(),
        hodDone ? esc('Reviewed and forwarded as per departmental appraisal norms.') : NUL(),
        sub.userByEmail(f.email),
      ],
      `faculty_id = ${facExpr} AND academic_year = ${esc(CURRENT_AY)}`
    );
  }
  const appraisalReqExpr = (staffCode) => `(SELECT id FROM appraisal_requests WHERE faculty_id = ${sub.facultyByStaffCode(staffCode)} AND academic_year = ${esc(CURRENT_AY)})`;

  line('-- appraisal_entries: one entry per criteria per sampled faculty request; score populated once reviewed');
  for (const { f, status } of appraisalSample) {
    const reqExpr = appraisalReqExpr(f.staffCode);
    for (const [dv, name, maxScore] of CRITERIA) {
      const critExpr = criteriaExpr(dv, name);
      const scored = status !== 'submitted';
      insertGuardedExpr(
        'appraisal_entries', ['appraisal_request_id', 'criteria_id', 'description', 'score'],
        [reqExpr, critExpr, esc(`Self-declared entry for ${name}`), scored ? num(randInt(Math.floor(maxScore * 0.5), maxScore)) : NUL()],
        `appraisal_request_id = ${reqExpr} AND criteria_id = ${critExpr}`
      );
    }
  }

  line('-- appraisal_attachments: one sample attachment (Academic division) per department\'s first sampled faculty request');
  const perDeptFirst = {};
  for (const s of appraisalSample) { if (!perDeptFirst[s.d.code]) perDeptFirst[s.d.code] = s; }
  for (const d of DEPARTMENTS) {
    const s = perDeptFirst[d.code];
    if (!s) continue;
    const reqExpr = appraisalReqExpr(s.f.staffCode);
    const divExpr = sub.appraisalDivision('Academic');
    const fileName = `${s.f.staffCode}-academic-appraisal-evidence.pdf`;
    insertGuardedExpr(
      'appraisal_attachments', ['appraisal_request_id', 'division_id', 'file_url', 'file_name', 'storage_path'],
      [reqExpr, divExpr, esc(`https://placeholder.sece.ac.in/appraisal/${fileName}`), esc(fileName), esc(`/appraisal/${s.f.staffCode}/${fileName}`)],
      `appraisal_request_id = ${reqExpr} AND division_id = ${divExpr} AND file_name = ${esc(fileName)}`
    );
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 9: Procurement — vendors (clearly-synthetic names, called out below),
// vendor_quotations, purchase_indents/service_indents per department (real
// item categories from the workflow doc), purchase_order_proposals/
// service_order_proposals, secretary_product_requests/
// secretary_service_request_items (a genuinely separate request pair from
// purchase_indents/service_indents — distinct requester flow, not conflated),
// and grn for a subset of the resulting purchase_orders.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- PROCUREMENT: vendors (SYNTHETIC names, called out explicitly) + quotations,');
line('-- purchase_indents/service_indents per department (real item categories from');
line('-- the workflow doc), purchase_order_proposals/service_order_proposals,');
line('-- secretary_product_requests/secretary_service_request_items (separate flow),');
line('-- purchase_orders + grn for a subset of approved proposals.');
line('-- ===========================================================================');
const PRODUCT_ITEMS = ['16GB RAM', 'CPU x10', 'SSD', 'Monitor', 'Printer'];
const SERVICE_ITEMS = ['AC repair', 'Glass Door repair'];
const VENDORS = [
  // All vendor names below are CLEARLY SYNTHETIC placeholders — no real vendor/company was supplied for procurement.
  { name: 'BrightWave Computer Traders', type: 'product' },
  { name: 'Nexstar IT Solutions', type: 'product' },
  { name: 'CampusTech Peripherals', type: 'product' },
  { name: 'CoolAir Facility Services', type: 'service' },
  { name: 'UrbanFix Maintenance Co.', type: 'service' },
];
{
  line('-- vendors (guarded on name; SYNTHETIC names, see comment above)');
  for (const v of VENDORS) {
    insertGuardedExpr(
      'vendors', ['name', 'contact_info', 'gst_no', 'company_name', 'phone', 'type'],
      [esc(v.name), esc(`Coimbatore, Tamil Nadu`), esc(`33${randInt(10, 99)}${pick(['A', 'B', 'C'])}${randInt(1000, 9999)}Z${randInt(1, 9)}`), esc(v.name), esc(randomMobile()), esc(v.type)],
      `name = ${esc(v.name)}`
    );
  }
  const vendorExpr = (name) => `(SELECT id FROM vendors WHERE name = ${esc(name)})`;

  line('-- vendor_quotations: 2 item quotes per vendor (product vendors quote PRODUCT_ITEMS, service vendors quote SERVICE_ITEMS)');
  for (const v of VENDORS) {
    const items = v.type === 'product' ? PRODUCT_ITEMS.slice(0, 2) : SERVICE_ITEMS;
    const vExpr = vendorExpr(v.name);
    for (const item of items) {
      insertGuardedExpr(
        'vendor_quotations', ['vendor_id', 'item_description', 'quoted_price', 'quotation_date'],
        [vExpr, esc(item), num(randInt(2000, 60000)), esc('2026-08-05')],
        `vendor_id = ${vExpr} AND item_description = ${esc(item)}`
      );
    }
  }

  line('-- purchase_indents: 2 PRODUCT_ITEMS per department, ref used as the natural guard key');
  const INDENT_STATUS_CYCLE = ['submitted', 'hod_approved', 'order_created'];
  const purchaseIndentPlan = []; // { d, item, qty, ref, status }
  DEPARTMENTS.forEach((d, dIdx) => {
    const items = shuffleCopy(PRODUCT_ITEMS).slice(0, 2);
    items.forEach((item, idx) => {
      const ref = `PI-${d.code}-${idx + 1}`;
      // idx 0 -> submitted (nothing approved yet); idx 1 -> alternate hod_approved/order_created across
      // departments so a real subset of purchase_order_proposals reaches principal_approved and feeds
      // purchase_orders/grn below (not left permanently at hod_approved for every department).
      const status = idx === 0 ? 'submitted' : (dIdx % 2 === 0 ? 'order_created' : 'hod_approved');
      purchaseIndentPlan.push({ d, item, qty: item.includes('x10') ? 10 : randInt(2, 6), ref, status });
    });
  });
  for (const p of purchaseIndentPlan) {
    const hod = facultyRoster.find((f) => f.deptCode === p.d.code && f.isHod);
    const hodDone = p.status !== 'submitted';
    insertGuardedRow(
      'purchase_indents',
      ['requested_by_user_id', 'department_id', 'item_name', 'quantity', 'purpose', 'status', 'needed_by', 'hod_remarks', 'hod_reviewed_by', 'hod_reviewed_at', 'ref', 'estimated_amount'],
      [
        sub.userByEmail(hod.email), sub.dept(p.d.code), esc(p.item), num(p.qty), esc(`Departmental requirement for ${p.item}`),
        esc(p.status), esc('2026-09-30'), hodDone ? esc('Approved as per department budget.') : NUL(),
        hodDone ? sub.userByEmail(hod.email) : NUL(), hodDone ? esc('2026-08-12 11:00:00+05:30') : NUL(),
        esc(p.ref), num(randInt(2000, 60000) * p.qty / Math.max(1, p.qty)),
      ],
      'ref', p.ref
    );
  }
  const purchaseIndentExpr = (ref) => `(SELECT id FROM purchase_indents WHERE ref = ${esc(ref)})`;

  line('-- service_indents: 1 SERVICE_ITEMS row per department, ref used as the natural guard key');
  const serviceIndentPlan = [];
  for (const d of DEPARTMENTS) {
    const item = pick(SERVICE_ITEMS);
    const ref = `SI-${d.code}-1`;
    serviceIndentPlan.push({ d, item, ref, status: pick(INDENT_STATUS_CYCLE) });
  }
  for (const p of serviceIndentPlan) {
    const hod = facultyRoster.find((f) => f.deptCode === p.d.code && f.isHod);
    const hodDone = p.status !== 'submitted';
    insertGuardedRow(
      'service_indents',
      ['requested_by_user_id', 'department_id', 'service_description', 'status', 'title', 'needed_by', 'quantity', 'location', 'hod_remarks', 'hod_reviewed_by', 'hod_reviewed_at', 'ref', 'category', 'priority'],
      [
        sub.userByEmail(hod.email), sub.dept(p.d.code), esc(`${p.item} required in the department block`),
        esc(p.status), esc(p.item), esc('2026-09-30'), esc('1'), esc(`${p.d.code} Department Block`),
        hodDone ? esc('Approved, to be scheduled.') : NUL(), hodDone ? sub.userByEmail(hod.email) : NUL(), hodDone ? esc('2026-08-12 11:30:00+05:30') : NUL(),
        esc(p.ref), esc('maintenance'), esc(pick(['low', 'medium', 'high'])),
      ],
      'ref', p.ref
    );
  }
  const serviceIndentExpr = (ref) => `(SELECT id FROM service_indents WHERE ref = ${esc(ref)})`;

  line('-- purchase_order_proposals: for indents already hod_approved/order_created, guarded on indent_id (one proposal/indent in this seed)');
  const poProposalPlan = [];
  for (const p of purchaseIndentPlan) {
    if (p.status === 'submitted') continue;
    const propStatus = p.status === 'order_created' ? 'principal_approved' : 'hod_approved';
    poProposalPlan.push({ p, propStatus });
    const indentExpr = purchaseIndentExpr(p.ref);
    const vendor = pick(VENDORS.filter((v) => v.type === 'product'));
    const hod = facultyRoster.find((f) => f.deptCode === p.d.code && f.isHod);
    insertGuardedExpr(
      'purchase_order_proposals',
      ['indent_id', 'vendor_id', 'finance_reviewed_by', 'finance_reviewed_at', 'hod_reviewed_by', 'hod_reviewed_at', 'status', 'hod_remarks', 'finance_remarks', 'principal_reviewed_by', 'principal_reviewed_at'],
      [
        indentExpr, vendorExpr(vendor.name), sub.userByEmail('finance@sece.ac.in'), esc('2026-08-13 10:00:00+05:30'),
        sub.userByEmail(hod.email), esc('2026-08-12 11:00:00+05:30'), esc(propStatus),
        esc('Approved.'), esc('Budget available, approved.'),
        propStatus === 'principal_approved' ? sub.userByEmail('principal@sece.ac.in') : NUL(),
        propStatus === 'principal_approved' ? esc('2026-08-14 10:00:00+05:30') : NUL(),
      ],
      `indent_id = ${indentExpr}`
    );
  }
  const poProposalExpr = (ref) => `(SELECT id FROM purchase_order_proposals WHERE indent_id = ${purchaseIndentExpr(ref)})`;

  line('-- service_order_proposals: for hod_approved/order_created service_indents, guarded on indent_id');
  for (const p of serviceIndentPlan) {
    if (p.status === 'submitted') continue;
    const propStatus = p.status === 'order_created' ? 'principal_approved' : 'hod_approved';
    const indentExpr = serviceIndentExpr(p.ref);
    const vendor = pick(VENDORS.filter((v) => v.type === 'service'));
    const hod = facultyRoster.find((f) => f.deptCode === p.d.code && f.isHod);
    insertGuardedExpr(
      'service_order_proposals',
      ['indent_id', 'vendor_id', 'finance_reviewed_by', 'finance_reviewed_at', 'hod_reviewed_by', 'hod_reviewed_at', 'status', 'hod_remarks', 'finance_remarks', 'principal_reviewed_by', 'principal_reviewed_at'],
      [
        indentExpr, vendorExpr(vendor.name), sub.userByEmail('finance@sece.ac.in'), esc('2026-08-13 12:00:00+05:30'),
        sub.userByEmail(hod.email), esc('2026-08-12 12:30:00+05:30'), esc(propStatus),
        esc('Approved.'), esc('Approved for service order.'),
        propStatus === 'principal_approved' ? sub.userByEmail('principal@sece.ac.in') : NUL(),
        propStatus === 'principal_approved' ? esc('2026-08-14 12:00:00+05:30') : NUL(),
      ],
      `indent_id = ${indentExpr}`
    );
  }

  line('-- purchase_orders: one per principal_approved proposal (po_number unique -> guarded row)');
  let poSeq = 1;
  const poNumberByRef = {};
  for (const { p, propStatus } of poProposalPlan) {
    if (propStatus !== 'principal_approved') continue;
    const poNumber = `PO-${CURRENT_AY.slice(0, 4)}-${String(poSeq).padStart(4, '0')}`;
    poNumberByRef[p.ref] = poNumber;
    poSeq++;
    insertGuardedRow(
      'purchase_orders', ['proposal_id', 'po_number', 'approved_by_user_id', 'approved_at', 'sent_to_vendor_at'],
      [poProposalExpr(p.ref), esc(poNumber), sub.userByEmail('principal@sece.ac.in'), esc('2026-08-14 10:30:00+05:30'), esc('2026-08-14 15:00:00+05:30')],
      'po_number', poNumber
    );
  }

  line('-- grn: for every purchase_order above (subset of approved POs), quantity_received = indent quantity');
  for (const { p, propStatus } of poProposalPlan) {
    if (propStatus !== 'principal_approved') continue;
    const poNumber = poNumberByRef[p.ref];
    const poExpr = `(SELECT id FROM purchase_orders WHERE po_number = ${esc(poNumber)})`;
    insertGuardedExpr(
      'grn', ['purchase_order_id', 'quantity_received', 'received_date', 'issued_to_venue_id', 'issued_date', 'recorded_by_user_id'],
      [poExpr, num(p.qty), esc('2026-08-20'), sub.venue(pick(VENUES).name), esc('2026-08-21'), sub.userByEmail('finance@sece.ac.in')],
      `purchase_order_id = ${poExpr}`
    );
  }

  line('-- secretary_product_requests + items: a SEPARATE requester flow (secretary seed account), distinct from purchase_indents above');
  const SECRETARY_PRODUCT_REQUESTS = [
    { title: 'Front Office Desktop Upgrade', justification: 'Front office desktops need a RAM and SSD upgrade for smoother operation.', items: [['16GB RAM', 2, 'RAM upgrade for front-office desktops'], ['SSD', 2, 'SSD upgrade for front-office desktops']], status: 'approved' },
    { title: 'Reception Printer Replacement', justification: 'Existing reception printer is beyond repair.', items: [['Printer', 1, 'Replacement printer for reception desk']], status: 'pending' },
  ];
  for (const r of SECRETARY_PRODUCT_REQUESTS) {
    insertGuardedRow(
      'secretary_product_requests', ['requested_by_user_id', 'title', 'justification', 'status', 'reviewed_by_user_id', 'reviewed_at'],
      [sub.userByEmail('secretary@sece.ac.in'), esc(r.title), esc(r.justification), esc(r.status), r.status !== 'draft' && r.status !== 'pending' ? sub.userByEmail('principal@sece.ac.in') : NUL(), r.status === 'approved' ? esc('2026-08-16 10:00:00+05:30') : NUL()],
      'title', r.title
    );
  }
  for (const r of SECRETARY_PRODUCT_REQUESTS) {
    const reqExpr = `(SELECT id FROM secretary_product_requests WHERE title = ${esc(r.title)})`;
    for (const [productName, qty, purpose] of r.items) {
      insertGuardedExpr(
        'secretary_product_request_items', ['request_id', 'product_name', 'quantity', 'purpose'],
        [reqExpr, esc(productName), num(qty), esc(purpose)],
        `request_id = ${reqExpr} AND product_name = ${esc(productName)}`
      );
    }
  }

  line('-- secretary_service_requests + items: separate requester flow (secretary seed account)');
  const SECRETARY_SERVICE_REQUESTS = [
    { title: 'AC Repair - Secretary Office', justification: 'Air conditioner in the secretary office is not cooling.', items: ['AC repair'], status: 'approved' },
    { title: 'Glass Door Repair - Reception', justification: 'Reception glass door hinge is broken.', items: ['Glass Door repair'], status: 'pending' },
  ];
  for (const r of SECRETARY_SERVICE_REQUESTS) {
    insertGuardedRow(
      'secretary_service_requests', ['requested_by_user_id', 'title', 'justification', 'status', 'reviewed_by_user_id', 'reviewed_at'],
      [sub.userByEmail('secretary@sece.ac.in'), esc(r.title), esc(r.justification), esc(r.status), r.status === 'approved' ? sub.userByEmail('principal@sece.ac.in') : NUL(), r.status === 'approved' ? esc('2026-08-16 11:00:00+05:30') : NUL()],
      'title', r.title
    );
  }
  for (const r of SECRETARY_SERVICE_REQUESTS) {
    const reqExpr = `(SELECT id FROM secretary_service_requests WHERE title = ${esc(r.title)})`;
    for (const serviceName of r.items) {
      insertGuardedExpr(
        'secretary_service_request_items', ['request_id', 'service_name'],
        [reqExpr, esc(serviceName)],
        `request_id = ${reqExpr} AND service_name = ${esc(serviceName)}`
      );
    }
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 11: Hostel operational tables for the hostellers already seeded via
// student_hostel_mapping. hostel_wardens assigned to real hostel_blocks,
// hostel_in_out_ledger for a recent week, hostel_outings (small subset),
// hostel_complaints (real category enum, mixed open/resolved),
// hostel_mess_feedback (small subset).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- HOSTEL OPERATIONS: hostel_wardens, hostel_in_out_ledger (recent week),');
line('-- hostel_outings, hostel_complaints, hostel_mess_feedback');
line('-- ===========================================================================');
{
  line('-- hostel_wardens (emp_id unique -> guarded row); 1 super_warden/hostel + 1 sub_warden per sampled block');
  const WARDENS = [
    { name: 'R. Elumalai', empId: 'WARD-BH-001', role: 'super_warden', hostelCode: 'BH', block: null, userEmail: 'warden@sece.ac.in' },
    { name: 'K. Meenakshi', empId: 'WARD-GH-001', role: 'super_warden', hostelCode: 'GH', block: null, userEmail: null },
    { name: 'S. Palanivel', empId: 'WARD-BH-A-001', role: 'sub_warden', hostelCode: 'BH', block: 'A', userEmail: null },
    { name: 'M. Kaviyarasu', empId: 'WARD-BH-C-001', role: 'sub_warden', hostelCode: 'BH', block: 'C', userEmail: null },
    { name: 'V. Rajalakshmi', empId: 'WARD-GH-A-001', role: 'sub_warden', hostelCode: 'GH', block: 'A', userEmail: null },
  ];
  for (const w of WARDENS) {
    insertGuardedRow(
      'hostel_wardens', ['user_id', 'name', 'emp_id', 'role', 'gender', 'designation', 'block_id', 'mobile', 'email', 'joined_date', 'quarters'],
      [
        w.userEmail ? sub.userByEmail(w.userEmail) : NUL(), esc(w.name), esc(w.empId), esc(w.role),
        esc(w.role === 'super_warden' ? (w.hostelCode === 'BH' ? 'Male' : 'Female') : pick(['Male', 'Female'])),
        esc(w.role === 'super_warden' ? 'Chief Warden' : 'Assistant Warden'),
        w.block ? sub.hostelBlock(w.hostelCode, w.block) : NUL(), esc(randomMobile()),
        esc(`${w.name.toLowerCase().replace(/[^a-z]/g, '.')}@sece.ac.in`), esc('2020-06-01'), esc(`Q-${w.empId}`),
      ],
      'emp_id', w.empId
    );
  }

  line('-- hostel_in_out_ledger: 15 sampled hostellers x the 5-day recent week (out+in pair per day)');
  const ATT_DATES2 = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
  const ledgerStudents = shuffleCopy(hostellerStudents).slice(0, 15);
  for (const s of ledgerStudents) {
    const stuExpr = sub.studentByRegNo(s.regNo);
    for (const date of ATT_DATES2) {
      const outTs = esc(`${date} 18:${String(randInt(0, 59)).padStart(2, '0')}:00+05:30`);
      const inTs = esc(`${date} 20:${String(randInt(0, 59)).padStart(2, '0')}:00+05:30`);
      insertGuardedExpr(
        'hostel_in_out_ledger', ['student_id', 'entry_type', 'recorded_at', 'recorded_by_user_id'],
        [stuExpr, esc('out'), outTs, sub.userByEmail('gatewarden@sece.ac.in')],
        `student_id = ${stuExpr} AND entry_type = 'out' AND recorded_at = ${outTs}`
      );
      insertGuardedExpr(
        'hostel_in_out_ledger', ['student_id', 'entry_type', 'recorded_at', 'recorded_by_user_id'],
        [stuExpr, esc('in'), inTs, sub.userByEmail('gatewarden@sece.ac.in')],
        `student_id = ${stuExpr} AND entry_type = 'in' AND recorded_at = ${inTs}`
      );
    }
  }

  line('-- hostel_outings: 12-student subset, mixed pending/approved/rejected');
  const outingStudents = shuffleCopy(hostellerStudents).slice(0, 12);
  outingStudents.forEach((s, idx) => {
    const status = ['pending', 'approved', 'approved', 'rejected'][idx % 4];
    const fromDate = '2026-08-22';
    const toDate = '2026-08-23';
    const stuExpr = sub.studentByRegNo(s.regNo);
    insertGuardedExpr(
      'hostel_outings', ['student_id', 'start_time', 'return_time', 'reason', 'from_date', 'to_date', 'status', 'approved_by_warden_user_id'],
      [
        stuExpr, esc('09:00:00'), status === 'approved' ? esc('20:00:00') : NUL(),
        esc(pick(['Home visit', 'Medical appointment', 'Family function', 'Personal work'])),
        esc(fromDate), esc(toDate), esc(status), status !== 'pending' ? sub.userByEmail('warden@sece.ac.in') : NUL(),
      ],
      `student_id = ${stuExpr} AND from_date = ${esc(fromDate)} AND to_date = ${esc(toDate)}`
    );
  });

  line('-- hostel_complaints: 15-row sample, real category enum, mixed open/in_progress/resolved/escalated');
  const complaintStudents = shuffleCopy(hostellerStudents).slice(0, 15);
  const CATEGORIES = ['plumbing', 'electrical', 'carpentry', 'network', 'mess', 'facilities'];
  complaintStudents.forEach((s, idx) => {
    const category = CATEGORIES[idx % CATEGORIES.length];
    const status = ['open', 'in_progress', 'resolved', 'resolved', 'escalated'][idx % 5];
    const title = `${category[0].toUpperCase()}${category.slice(1)} issue - Room complaint ${idx + 1}`;
    const stuExpr = sub.studentByRegNo(s.regNo);
    insertGuardedExpr(
      'hostel_complaints',
      ['student_id', 'hostel_id', 'category', 'title', 'description', 'priority', 'status', 'assigned_to', 'resolution_note', 'resolved_at'],
      [
        stuExpr, sub.hostel(s.gender === 'Male' ? 'BH' : 'GH'), esc(category), esc(title),
        esc(`Reported ${category} issue in the room, requesting maintenance attention.`),
        esc(pick(['low', 'medium', 'high'])), esc(status), esc('Hostel Maintenance Team'),
        status === 'resolved' ? esc('Issue inspected and fixed by maintenance staff.') : NUL(),
        status === 'resolved' ? esc('2026-08-20 16:00:00+05:30') : NUL(),
      ],
      `student_id = ${stuExpr} AND title = ${esc(title)}`
    );
  });

  line('-- hostel_mess_feedback: 30-student sample, rating 1-5 with comment');
  const messStudents = shuffleCopy(hostellerStudents).slice(0, 30);
  for (const s of messStudents) {
    const rating = randInt(2, 5);
    const stuExpr = sub.studentByRegNo(s.regNo);
    const comment = pick(['Food quality is good overall.', 'Would like more variety in dinner menu.', 'Breakfast timing could be earlier.', 'Mess hygiene has improved this month.', 'Satisfied with the mess service.']);
    insertGuardedExpr(
      'hostel_mess_feedback', ['student_id', 'hostel_id', 'rating', 'comment'],
      [stuExpr, sub.hostel(s.gender === 'Male' ? 'BH' : 'GH'), num(rating), esc(comment)],
      `student_id = ${stuExpr} AND rating = ${num(rating)} AND comment = ${esc(comment)}`
    );
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 12: Buses + bus_documents for the 27 real transport_routes already
// seeded, bus_live_locations (a few current rows), wallet_outlets/wallets/
// wallet_transactions for a sensible sample of currently-enrolled students.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- BUSES + BUS_DOCUMENTS + BUS_LIVE_LOCATIONS (real transport_routes reused)');
line('-- WALLET_OUTLETS + WALLETS + WALLET_TRANSACTIONS (200-student sample)');
line('-- ===========================================================================');
{
  line('-- buses: one per real transport_route (27 rows), guarded on unique vehicle_number');
  const busPlan = TRANSPORT_ROUTES.map((r, idx) => ({
    route: r, vehicleNumber: randomVehiclePlate(), busNo: `BUS-${String(idx + 1).padStart(3, '0')}`,
    driverName: `${pick(FAC_LAST)} ${pick(STU_LAST)}.`,
  }));
  // guarantee vehicle_number uniqueness even though randomVehiclePlate() is not itself guaranteed unique
  const seenPlates = new Set();
  for (const b of busPlan) {
    while (seenPlates.has(b.vehicleNumber)) b.vehicleNumber = randomVehiclePlate();
    seenPlates.add(b.vehicleNumber);
  }
  for (const b of busPlan) {
    insertGuardedRow(
      'buses',
      ['route_id', 'vehicle_number', 'driver_name', 'bus_no', 'capacity', 'status', 'driver_phone', 'driver_licence_no', 'driver_licence_expiry', 'model', 'year_of_manufacture', 'ownership'],
      [
        sub.route(b.route.name), esc(b.vehicleNumber), esc(b.driverName), esc(b.busNo), num(52), esc('on_route'),
        esc(randomMobile()), esc(`TN${randInt(10, 99)}${randInt(2015, 2024)}${randInt(100000, 999999)}`), esc('2028-03-31'),
        esc(pick(['Ashok Leyland Viking', 'Tata Starbus', 'Eicher Skyline Pro'])), num(randInt(2016, 2024)), esc('owned'),
      ],
      'vehicle_number', b.vehicleNumber
    );
  }
  const busExpr = (vehicleNumber) => `(SELECT id FROM buses WHERE vehicle_number = ${esc(vehicleNumber)})`;

  line('-- bus_documents: RC + Insurance per bus (unique on bus_id + doc_type -> guarded row via expr)');
  for (const b of busPlan) {
    const bExpr = busExpr(b.vehicleNumber);
    for (const [docType, validUntil] of [['permit', '2031-03-31'], ['insurance', '2027-03-31']]) {
      insertGuardedExpr(
        'bus_documents', ['bus_id', 'doc_type', 'reference_no', 'valid_until'],
        [bExpr, esc(docType), esc(`${docType.toUpperCase()}-${b.busNo}`), esc(validUntil)],
        `bus_id = ${bExpr} AND doc_type = ${esc(docType)}`
      );
    }
  }

  line('-- bus_live_locations: 8 buses with a current GPS fix near Coimbatore/Kinathukadavu campus corridor');
  const liveBuses = busPlan.slice(0, 8);
  for (const b of liveBuses) {
    const bExpr = busExpr(b.vehicleNumber);
    const lat = (10.85 + rng() * 0.35).toFixed(6);
    const lon = (76.85 + rng() * 0.35).toFixed(6);
    const ts = esc('2026-08-22 08:15:00+05:30');
    insertGuardedExpr(
      'bus_live_locations', ['bus_id', 'latitude', 'longitude', 'updated_at'],
      [bExpr, num(lat), num(lon), ts],
      `bus_id = ${bExpr} AND updated_at = ${ts}`
    );
  }

  line('-- wallet_outlets (guarded on name)');
  const OUTLETS = [
    ['Recharge Counter - Admin Block', 'recharge_counter'],
    ['Campus Stationery Store', 'stationary'],
    ['Central Photocopier - Library', 'photocopier'],
  ];
  for (const [name, type] of OUTLETS) {
    insertGuardedRow('wallet_outlets', ['name', 'outlet_type', 'location'], [esc(name), esc(type), esc('Main Block')], 'name', name);
  }
  const outletExpr = (name) => `(SELECT id FROM wallet_outlets WHERE name = ${esc(name)})`;

  line('-- wallets: 200-student sample of currently-enrolled students (guarded on unique user_id)');
  const walletStudents = shuffleCopy(students).slice(0, 200);
  for (const s of walletStudents) {
    const userExpr = sub.studentUserByRegNo(s.regNo);
    insertGuardedExpr(
      'wallets', ['user_id', 'balance'],
      [userExpr, num(randInt(50, 2000))],
      `user_id = ${userExpr}`
    );
  }
  const walletExpr = (regNo) => `(SELECT id FROM wallets WHERE user_id = ${sub.studentUserByRegNo(regNo)})`;

  line('-- wallet_transactions: 1 razorpay credit (success) + 1 outlet debit (success) per sampled wallet');
  let walletTxnCount = 0;
  walletStudents.forEach((s, idx) => {
    const wExpr = walletExpr(s.regNo);
    const creditAmount = num(randInt(200, 1000));
    const creditTs = esc(`2026-08-1${idx % 9} 10:${String(idx % 60).padStart(2, '0')}:00+05:30`);
    insertGuardedExpr(
      'wallet_transactions', ['wallet_id', 'txn_type', 'source', 'amount', 'status', 'razorpay_payment_id', 'razorpay_order_id', 'created_at'],
      [wExpr, esc('credit'), esc('razorpay'), creditAmount, esc('success'), esc(`rzp_pay_${s.regNo}`), esc(`rzp_order_${s.regNo}`), creditTs],
      `wallet_id = ${wExpr} AND created_at = ${creditTs}`
    );
    walletTxnCount++;
    const outletName = OUTLETS[idx % OUTLETS.length][0];
    const debitAmount = num(randInt(10, 150));
    const debitTs = esc(`2026-08-2${idx % 2} 12:${String((idx + 15) % 60).padStart(2, '0')}:00+05:30`);
    insertGuardedExpr(
      'wallet_transactions', ['wallet_id', 'txn_type', 'source', 'amount', 'status', 'outlet_id', 'processed_by_user_id', 'created_at'],
      [wExpr, esc('debit'), esc('purchase'), debitAmount, esc('success'), outletExpr(outletName), sub.userByEmail('billing@sece.ac.in'), debitTs],
      `wallet_id = ${wExpr} AND created_at = ${debitTs}`
    );
    walletTxnCount++;
  });
  line(`-- total wallet_transactions rows: ${walletTxnCount}`);
}
blank();

// ===========================================================================
// PART 7 (this extension pass, same date): final stretch pass covering items
// 1-6 of the remaining numbered scope. Same hard rules re-verified:
// subquery-only FKs everywhere, WHERE NOT EXISTS guards on every
// collision-prone table, single existing BEGIN/COMMIT preserved.
// ===========================================================================

// ---------------------------------------------------------------------------
// ITEM 1: End-semester feedback-matrix tables (feedback_assignments /
// feedback_assignment_questions / feedback_faculty_responses) — a distinct
// department/year_of_study/semester/class-keyed shape, NOT the general
// feedback_forms path seeded earlier. 2 sample points per department: the
// current final-year class (2023-2027, section A, CLOSED with responses
// collected) and the current first-year class (2026-2030, section A,
// NOT_STARTED, no responses yet — a realistic in-progress-cycle mix).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- END-SEMESTER FEEDBACK MATRIX: feedback_assignments/feedback_assignment_questions/');
line('-- feedback_faculty_responses (2 sample points/department: final-year CLOSED + first-year NOT_STARTED)');
line('-- ===========================================================================');
{
  const FB_QUESTIONS = [
    'How would you rate the teaching pace for this course?',
    'Rate the clarity of concepts explained by the faculty.',
    "Rate the faculty's approachability for doubt clarification.",
    'Any additional comments or suggestions?',
  ];
  const FB_MATRIX_POINTS = [
    { batch: BATCHES[0], status: 'CLOSED' },      // 2023-2027, final year, sem 7
    { batch: BATCHES[3], status: 'NOT_STARTED' },  // 2026-2030, first year, sem 1
  ];
  let fbFacultyResponseCount = 0;
  for (const d of DEPARTMENTS) {
    for (const point of FB_MATRIX_POINTS) {
      const b = point.batch;
      const yearOfStudy = Math.ceil(b.currentSemester / 2);
      const classExpr = sub.classByKey(b.name, d.code, 'A');
      const deptExpr = sub.dept(d.code);
      const guardExpr = `course_type = 'THEORY' AND department_id = ${deptExpr} AND year_of_study = ${num(yearOfStudy)} AND semester = ${num(b.currentSemester)} AND class_id = ${classExpr}`;
      insertGuardedExpr(
        'feedback_assignments', ['course_type', 'year_of_study', 'department_id', 'semester', 'class_id', 'status'],
        [esc('THEORY'), num(yearOfStudy), deptExpr, num(b.currentSemester), classExpr, esc(point.status)],
        guardExpr
      );
      const assignExpr = `(SELECT id FROM feedback_assignments WHERE ${guardExpr})`;
      FB_QUESTIONS.forEach((q, idx) => {
        insertGuardedExpr(
          'feedback_assignment_questions', ['assignment_id', 'question_text', 'is_optional', 'display_order'],
          [assignExpr, esc(q), boolSql(idx === 3), num(idx + 1)],
          `assignment_id = ${assignExpr} AND question_text = ${esc(q)}`
        );
      });

      if (point.status !== 'CLOSED') continue; // no responses yet for the not-started cycle
      const key = `${d.code}|${b.name}|A`;
      const pair = (fscMappingByClassKey[key] || [])[0];
      if (!pair) continue;
      const mappingExpr = `(SELECT id FROM faculty_subject_class_mapping WHERE subject_id = ${sub.subjectByCode(pair.subjectCode)} AND class_id = ${classExpr} AND academic_year = ${esc(CURRENT_AY)})`;
      const facultyExpr = sub.facultyByStaffCode(pair.staffCode);
      const subjectExpr = sub.subjectByCode(pair.subjectCode);
      // feedback_faculty_responses.question_id is a real FK into feedback_questions
      // (feedback_faculty_responses_question_id_fkey), not into
      // feedback_assignment_questions (that table has no downstream response FK at
      // all in the schema — it's a separate tracking-only table). Resolve against
      // the general feedback_forms/feedback_questions rows already seeded per
      // class above (form title keyed by dept-batch-section A, matching classExpr).
      const formTitle = `${d.code}-${b.name}-A End Semester Feedback ${CURRENT_AY}`;
      const REAL_FORM_QUESTIONS = [
        'Is the faculty approachable and helpful outside class hours?',
        'Rate the overall teaching quality of the faculty mapped to this class this semester.',
        'Any additional comments about the teaching-learning experience this semester?',
      ];
      const sampleStudents = shuffleCopy(students.filter((s) => s.deptCode === d.code && s.batchName === b.name && s.section === 'A')).slice(0, 5);
      for (const s of sampleStudents) {
        const stuExpr = sub.studentByRegNo(s.regNo);
        REAL_FORM_QUESTIONS.forEach((q, idx) => {
          const qExpr = sub.feedbackQuestion(formTitle, q);
          const isRating = idx < REAL_FORM_QUESTIONS.length - 1;
          insertGuardedExpr(
            'feedback_faculty_responses', ['question_id', 'student_id', 'mapping_id', 'faculty_id', 'subject_id', 'response_text', 'rating_value'],
            [qExpr, stuExpr, mappingExpr, facultyExpr, subjectExpr,
              isRating ? NUL() : esc('Overall a good learning experience this semester.'),
              isRating ? num(randInt(3, 5)) : NUL()],
            `question_id = ${qExpr} AND student_id = ${stuExpr} AND mapping_id = ${mappingExpr}`
          );
          fbFacultyResponseCount++;
        });
      }
    }
  }
  line(`-- total feedback_faculty_responses rows: ${fbFacultyResponseCount}`);
}
blank();

// ---------------------------------------------------------------------------
// ITEM 2: higher_education_* — all standalone lookup/aggregate tables (no
// student FK on any of them except student_higher_education). Real-named
// universities; a 5-student sample of the current final-year (2023-2027)
// batch for student_higher_education.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- HIGHER EDUCATION: universities (real names) + application windows/calendar/');
line('-- coaching batches/loans/retake watchlist/standing returns/test register +');
line('-- student_higher_education (5-student sample, final-year batch)');
line('-- ===========================================================================');
{
  // relation must be one of the real check-constraint values: mou_active,
  // regular, national, affiliating, new. IIT Madras (domestic premier
  // institute) is tagged 'national'; the international destinations with no
  // verified formal MOU partnership are tagged 'regular'.
  const HE_UNIVERSITIES = [
    ['Massachusetts Institute of Technology', 'USA', 'MS Computer Science, MS Data Science', 3, 1, 1, 'regular'],
    ['Indian Institute of Technology Madras', 'India', 'M.Tech Computer Science', 4, 2, 1, 'national'],
    ['National University of Singapore', 'Singapore', 'MSc Computing', 2, 1, 0, 'regular'],
    ['University of Waterloo', 'Canada', 'MEng Electrical and Computer Engineering', 2, 1, 1, 'regular'],
    ['University of Melbourne', 'Australia', 'Master of Information Technology', 1, 0, 0, 'new'],
    ['Technical University of Munich', 'Germany', 'MSc Mechanical Engineering', 1, 1, 0, 'regular'],
  ];
  for (const [name, country, programmes, applied, admits, funded, relation] of HE_UNIVERSITIES) {
    insertGuardedRow(
      'higher_education_universities', ['name', 'country', 'programmes', 'applied_count', 'admits_count', 'funded_count', 'relation'],
      [esc(name), esc(country), esc(programmes), num(applied), num(admits), num(funded), esc(relation)],
      'name', name
    );
  }

  const HE_APP_WINDOWS = [
    ['Massachusetts Institute of Technology', 'USA', 'Fall 2027', 3, 1, '2027-01-15'],
    ['Indian Institute of Technology Madras', 'India', 'Fall 2027', 4, 1, '2027-02-28'],
    ['University of Waterloo', 'Canada', 'Fall 2027', 2, 1, '2027-01-31'],
  ];
  for (const [uni, country, intake, applicants, docsPending, deadline] of HE_APP_WINDOWS) {
    insertGuardedExpr(
      'higher_education_application_windows', ['university', 'country', 'intake', 'applicants_count', 'documents_pending', 'deadline'],
      [esc(uni), esc(country), esc(intake), num(applicants), num(docsPending), esc(deadline)],
      `university = ${esc(uni)} AND intake = ${esc(intake)}`
    );
  }

  const HE_CALENDAR_EVENTS = [
    ['GRE Registration Deadline', '2026-09-30', 'test'],
    ['IELTS Test Date - Batch 1', '2026-10-15', 'test'],
    ['SOP Submission Deadline', '2026-11-30', 'application'],
  ];
  for (const [title, date, category] of HE_CALENDAR_EVENTS) {
    insertGuardedExpr(
      'higher_education_calendar_events', ['title', 'event_date', 'category'],
      [esc(title), esc(date), esc(category)],
      `title = ${esc(title)} AND event_date = ${esc(date)}`
    );
  }

  const HE_COACHING_BATCHES = [
    ['GRE Batch - Aug 2026', 'Weekday evenings, 3 months'],
    ['IELTS Batch - Aug 2026', 'Weekend mornings, 6 weeks'],
  ];
  for (const [name, detail] of HE_COACHING_BATCHES) {
    insertGuardedExpr(
      'higher_education_coaching_batches', ['batch_name', 'detail'],
      [esc(name), esc(detail)],
      `batch_name = ${esc(name)}`
    );
  }

  const HE_LOANS = [
    [BANK_NAMES[0], 1200000, 'under_process', false, true],
    [BANK_NAMES[2], 1500000, 'sanctioned', false, false],
    [BANK_NAMES[4], 900000, 'under_process', true, true],
  ];
  for (const [bank, amount, status, reapplied, collateralFree] of HE_LOANS) {
    insertGuardedExpr(
      'higher_education_loans', ['bank_name', 'amount', 'status', 'reapplied', 'collateral_free'],
      [esc(bank), num(amount), esc(status), boolSql(reapplied), boolSql(collateralFree)],
      `bank_name = ${esc(bank)} AND amount = ${num(amount)}`
    );
  }

  const HE_RETAKE_WATCHLIST = [
    ['GRE Retake Candidates', 5],
    ['IELTS Retake Candidates', 3],
  ];
  for (const [label, count] of HE_RETAKE_WATCHLIST) {
    insertGuardedExpr('higher_education_retake_watchlist', ['label', 'count'], [esc(label), num(count)], `label = ${esc(label)}`);
  }

  // status must be one of the real check-constraint values: filed, drafting,
  // in_review, not_started.
  const HE_STANDING_RETURNS = [
    ['I-20 Document Return', 'USA visa applicants', 'not_started'],
    ['CAS Letter Return', 'UK visa applicants', 'in_review'],
  ];
  for (const [title, meta, status] of HE_STANDING_RETURNS) {
    insertGuardedExpr(
      'higher_education_standing_returns', ['title', 'meta', 'status'],
      [esc(title), esc(meta), esc(status)],
      `title = ${esc(title)}`
    );
  }

  // readiness must be one of the real check-constraint values: on_track, watch, behind.
  const HE_TEST_REGISTER = [
    ['GRE', 12, 8, 'Sept 2026 Window', '2026-09-15', 'on_track'],
    ['IELTS', 18, 15, 'Oct 2026 Window', '2026-10-01', 'on_track'],
    ['TOEFL', 6, 4, 'Sept 2026 Window', '2026-09-20', 'watch'],
    ['GMAT', 3, 2, 'Nov 2026 Window', '2026-11-05', 'on_track'],
  ];
  for (const [testName, enrolled, cleared, nextLabel, nextDate, readiness] of HE_TEST_REGISTER) {
    insertGuardedRow(
      'higher_education_test_register', ['test_name', 'enrolled_count', 'cleared_count', 'next_window_label', 'next_window_date', 'readiness'],
      [esc(testName), num(enrolled), num(cleared), esc(nextLabel), esc(nextDate), esc(readiness)],
      'test_name', testName
    );
  }

  line('-- student_higher_education: 5-student sample of the final-year (2023-2027) batch');
  const heFinalYear = students.filter((s) => s.batchName === '2023-2027');
  const heSample = shuffleCopy(heFinalYear).slice(0, 5);
  const HE_PREFS = [
    ['MS Computer Science', 'USA', 'Massachusetts Institute of Technology', 'admitted', 'accepted', 'approved'],
    ['M.Tech Computer Science', 'India', 'Indian Institute of Technology Madras', 'applied', 'awaited', 'not_applied'],
    ['MSc Computing', 'Singapore', 'National University of Singapore', 'interested', 'awaited', 'not_applied'],
    ['MEng Electrical and Computer Engineering', 'Canada', 'University of Waterloo', 'applied', 'awaited', 'in_progress'],
    ['Master of Information Technology', 'Australia', 'University of Melbourne', 'interested', 'awaited', 'not_applied'],
  ];
  heSample.forEach((s, idx) => {
    const [course, country, uni, admissionStatus, offerStatus, visaStatus] = HE_PREFS[idx % HE_PREFS.length];
    const stuExpr = sub.studentByRegNo(s.regNo);
    insertGuardedExpr(
      'student_higher_education',
      ['student_id', 'preferred_course', 'preferred_country', 'preferred_university', 'admission_status', 'offer_status', 'visa_status', 'is_scholarship', 'intake_term', 'cgpa'],
      [stuExpr, esc(course), esc(country), esc(uni), esc(admissionStatus), esc(offerStatus), esc(visaStatus), boolSql(idx % 2 === 0), esc('Fall 2027'), num((7 + rng() * 2.5).toFixed(2))],
      `student_id = ${stuExpr}`
    );
  });
}
blank();

// ---------------------------------------------------------------------------
// ITEM 3: EDC / incubation / startup ecosystem — sample of final-year
// students, real-shaped student_entrepreneurship ventures, startup_ideas,
// incubations + milestones, edc_documents/edc_events/edc_funding_records/
// edc_reports, all created/reviewed by the pre-existing edc_coordinator
// seed account (edccoordinator@sece.ac.in).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- EDC / INCUBATION / STARTUP ECOSYSTEM: student_entrepreneurship, startup_ideas,');
line('-- incubations + incubation_milestones, edc_documents/edc_events/');
line('-- edc_funding_records/edc_reports (edc_coordinator seed account reused)');
line('-- ===========================================================================');
{
  const edcFinalYear = shuffleCopy(students.filter((s) => s.batchName === '2023-2027')).slice(0, 5);
  const VENTURES = [
    { biz: 'GreenCart Campus Delivery', sector: 'Logistics', stage: 'MVP', category: 'E-commerce' },
    { biz: 'StudyBuddy AI Notes', sector: 'EdTech', stage: 'Idea', category: 'Education' },
    { biz: 'AgroSense IoT', sector: 'AgriTech', stage: 'Prototype', category: 'IoT' },
    { biz: 'CampusCred Wallet', sector: 'FinTech', stage: 'Idea', category: 'Finance' },
    { biz: 'EcoWeave Textiles', sector: 'Sustainability', stage: 'MVP', category: 'Manufacturing' },
  ];
  const ventureExpr = (regNo) => `(SELECT id FROM student_entrepreneurship WHERE student_id = ${sub.studentByRegNo(regNo)})`;
  edcFinalYear.forEach((s, idx) => {
    const v = VENTURES[idx % VENTURES.length];
    const deptFac = facultyRoster.find((f) => f.deptCode === s.deptCode && !f.isHod);
    const stuExpr = sub.studentByRegNo(s.regNo);
    insertGuardedExpr(
      'student_entrepreneurship',
      ['student_id', 'business_name', 'business_description', 'sector', 'stage', 'business_category', 'funding_required', 'mentor_faculty_id', 'is_incubated', 'team_size', 'idea_developed', 'prototype_developed'],
      [
        stuExpr, esc(v.biz), esc(`A student-run venture in the ${v.sector.toLowerCase()} space, incubated under the college EDC.`),
        esc(v.sector), esc(v.stage), esc(v.category), num(randInt(50000, 500000)),
        deptFac ? sub.facultyByStaffCode(deptFac.staffCode) : NUL(), boolSql(idx < 3), num(randInt(2, 5)),
        boolSql(true), boolSql(v.stage !== 'Idea'),
      ],
      `student_id = ${stuExpr}`
    );
  });

  line('-- startup_ideas: 1 idea per sampled student, reviewed by edc_coordinator');
  edcFinalYear.forEach((s, idx) => {
    const v = VENTURES[idx % VENTURES.length];
    const stuExpr = sub.studentByRegNo(s.regNo);
    const title = `${v.biz} - Initial Idea Submission`;
    insertGuardedExpr(
      'startup_ideas',
      ['student_id', 'title', 'category', 'problem_statement', 'solution', 'target_customers', 'review_status', 'reviewer_user_id', 'converted_venture_id'],
      [
        stuExpr, esc(title), esc(v.category),
        esc(`Students on campus lack an easy way to access ${v.sector.toLowerCase()} services.`),
        esc(`${v.biz} solves this via a student-built app/platform.`),
        esc('College students and nearby residents'),
        esc(idx < 3 ? 'Approved' : 'Under Review'), sub.userByEmail('edccoordinator@sece.ac.in'),
        idx < 3 ? ventureExpr(s.regNo) : NUL(),
      ],
      `student_id = ${stuExpr} AND title = ${esc(title)}`
    );
  });

  line('-- incubations: first 3 sampled ventures (is_incubated = true above)');
  const incubatedStudents = edcFinalYear.slice(0, 3);
  incubatedStudents.forEach((s, idx) => {
    const deptFac = facultyRoster.find((f) => f.deptCode === s.deptCode && !f.isHod);
    const vExpr = ventureExpr(s.regNo);
    insertGuardedExpr(
      'incubations',
      ['student_entrepreneurship_id', 'intake_label', 'seat', 'incubated_since', 'mentor_faculty_id', 'status', 'progress_percent', 'created_by_user_id'],
      [
        vExpr, esc(`Cohort ${CURRENT_AY}`), esc(`EDC Incubation Cell - Desk ${idx + 1}`), esc('2026-07-01'),
        deptFac ? sub.facultyByStaffCode(deptFac.staffCode) : NUL(), esc('Active'), num(randInt(20, 70)),
        sub.userByEmail('edccoordinator@sece.ac.in'),
      ],
      `student_entrepreneurship_id = ${vExpr}`
    );
  });
  const incubationExpr = (regNo) => `(SELECT id FROM incubations WHERE student_entrepreneurship_id = ${ventureExpr(regNo)})`;

  line('-- incubation_milestones: 2 per incubation');
  const MILESTONES = ['MVP Validation', 'First Paying Customer', 'Seed Funding Round', 'Product Launch'];
  incubatedStudents.forEach((s) => {
    const incExpr = incubationExpr(s.regNo);
    for (let i = 0; i < 2; i++) {
      const label = MILESTONES[i];
      insertGuardedExpr(
        'incubation_milestones', ['incubation_id', 'label', 'due_date', 'status', 'progress_percent', 'sort_order'],
        [incExpr, esc(label), esc('2026-12-31'), esc(i === 0 ? 'In Progress' : 'Upcoming'), num(i === 0 ? 50 : 0), num(i + 1)],
        `incubation_id = ${incExpr} AND label = ${esc(label)}`
      );
    }
  });

  line('-- edc_documents: one per incubated venture');
  incubatedStudents.forEach((s) => {
    const vExpr = ventureExpr(s.regNo);
    const fileName = `${s.regNo}-business-plan.pdf`;
    insertGuardedExpr(
      'edc_documents',
      ['student_entrepreneurship_id', 'document_type', 'file_name', 'file_url', 'file_key', 'uploaded_by_user_id', 'verification_status', 'reviewed_by_user_id', 'reviewed_at'],
      [
        vExpr, esc('Business Plan'), esc(fileName), esc(`https://placeholder.sece.ac.in/edc/${fileName}`), esc(`/edc/${s.regNo}/${fileName}`),
        sub.userByEmail('edccoordinator@sece.ac.in'), esc('Verified'), sub.userByEmail('edccoordinator@sece.ac.in'), esc('2026-08-10 10:00:00+05:30'),
      ],
      `student_entrepreneurship_id = ${vExpr} AND file_name = ${esc(fileName)}`
    );
  });

  line('-- edc_funding_records: for first 2 incubated ventures');
  incubatedStudents.slice(0, 2).forEach((s) => {
    const vExpr = ventureExpr(s.regNo);
    insertGuardedExpr(
      'edc_funding_records',
      ['student_entrepreneurship_id', 'source_category', 'source_detail', 'amount', 'disbursed_date', 'utilisation_pct', 'status', 'created_by_user_id'],
      [vExpr, esc('Seed Grant'), esc('SECE EDC Seed Grant Programme'), num(randInt(25000, 100000)), esc('2026-08-01'), num(randInt(10, 60)), esc('Disbursed'), sub.userByEmail('edccoordinator@sece.ac.in')],
      `student_entrepreneurship_id = ${vExpr} AND source_category = 'Seed Grant'`
    );
  });

  line('-- edc_events (standalone) + edc_reports (standalone)');
  const EDC_EVENTS = [
    ['EDC Founders Meetup', 'meetup', '2026-09-05', 'Amenity Centre', 40],
    ['Startup Pitch Day', 'pitch_day', '2026-10-10', 'Seminar Hall', 80],
    ['Entrepreneurship Bootcamp', 'bootcamp', '2026-11-20', 'Amenity Centre', 60],
  ];
  for (const [title, type, date, venue, count] of EDC_EVENTS) {
    insertGuardedExpr(
      'edc_events', ['title', 'event_type', 'event_date', 'venue', 'participants_count', 'status', 'created_by_user_id'],
      [esc(title), esc(type), esc(date), esc(venue), num(count), esc('Upcoming'), sub.userByEmail('edccoordinator@sece.ac.in')],
      `title = ${esc(title)} AND event_date = ${esc(date)}`
    );
  }
  const EDC_REPORTS = [
    ['EDC Quarterly Activity Report', 'Jul-Sep 2026'],
    ['EDC Annual Incubation Report', 'AY 2025-2026'],
  ];
  for (const [name, period] of EDC_REPORTS) {
    insertGuardedExpr(
      'edc_reports', ['report_name', 'period_label', 'prepared_by_user_id', 'status'],
      [esc(name), esc(period), sub.userByEmail('edccoordinator@sece.ac.in'), esc('Completed')],
      `report_name = ${esc(name)} AND period_label = ${esc(period)}`
    );
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 4: alumni_group_messages / alumni_announcements — tied to the real
// alumni_batches / alumni_members seeded earlier in this file.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- ALUMNI ANNOUNCEMENTS + GROUP MESSAGES (real alumni_batches/alumni_members reused)');
line('-- ===========================================================================');
{
  const ALUMNI_ANNOUNCEMENTS = [
    ['Alumni Meet 2026 - Save the Date', 'The annual alumni meet will be held on 20th December 2026 at the SECE campus. All batches welcome.'],
    ['Mentorship Programme for Final-Year Students', 'Alumni interested in mentoring final-year students under the placement mentorship programme may register with the alumni office.'],
    ['Alumni Startup Showcase', 'Alumni running their own ventures are invited to showcase at the upcoming EDC Alumni Startup Showcase.'],
  ];
  for (const [title, content] of ALUMNI_ANNOUNCEMENTS) {
    insertGuardedExpr(
      'alumni_announcements', ['posted_by_user_id', 'title', 'content'],
      [sub.userByEmail('alumni@sece.ac.in'), esc(title), esc(content)],
      `title = ${esc(title)}`
    );
  }

  line('-- alumni_group_messages: 2 per historical batch, posted by a real alumni_member of that batch');
  const alumniMemberExpr = (regNo) => `(SELECT id FROM alumni_members WHERE student_id = ${sub.studentByRegNo(regNo)})`;
  for (const b of HISTORICAL_BATCHES) {
    const batchAlumniSample = shuffleCopy(alumniStudents.filter((s) => s.batchName === b.name)).slice(0, 2);
    const batchExpr = `(SELECT id FROM alumni_batches WHERE batch_id = ${sub.batch(b.name)})`;
    batchAlumniSample.forEach((s, idx) => {
      const content = idx === 0
        ? `Great to reconnect with everyone from the ${b.name} batch! Looking forward to the next meet.`
        : `Does anyone from ${b.name} have contacts at any of the recent recruiter drives? Would love to catch up.`;
      insertGuardedExpr(
        'alumni_group_messages', ['alumni_batch_id', 'posted_by_alumni_member_id', 'content'],
        [batchExpr, alumniMemberExpr(s.regNo), esc(content)],
        `alumni_batch_id = ${batchExpr} AND content = ${esc(content)}`
      );
    });
  }
}
blank();

// ---------------------------------------------------------------------------
// ITEM 5: Remaining sports_* tables — sports_athlete_profiles/
// sports_coach_profiles first (referenced by the rest), then sports_teams,
// sports_training_sessions, sports_fixtures, sports_achievements,
// sports_calendar_notes, sports_od_requests(+squad members),
// sports_budget_requests. Reuses the real sports_disciplines/
// sports_facilities seeded earlier in this file.
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- SPORTS (remaining tables): athlete/coach profiles, teams, training sessions,');
line('-- fixtures, achievements, calendar notes, OD requests, budget requests');
line('-- ===========================================================================');
sub.sportsDiscipline = (name) => `(SELECT id FROM sports_disciplines WHERE name = ${esc(name)})`;
sub.sportsFacility = (name) => `(SELECT id FROM sports_facilities WHERE name = ${esc(name)})`;
{
  line('-- sports_athlete_profiles: 10-student sample across departments');
  const athletes = shuffleCopy(students).slice(0, 10);
  athletes.forEach((s, idx) => {
    const disc = SPORTS_DISCIPLINES[idx % SPORTS_DISCIPLINES.length];
    const stuExpr = sub.studentByRegNo(s.regNo);
    insertGuardedExpr(
      'sports_athlete_profiles', ['student_id', 'primary_discipline_id', 'status', 'registered_academic_year'],
      [stuExpr, sub.sportsDiscipline(disc), esc('active'), esc(CURRENT_AY)],
      `student_id = ${stuExpr}`
    );
  });

  line('-- sports_coach_profiles: 2 faculty (CS + ME departments) assigned as discipline coaches');
  const coachFaculty = [
    { f: facultyRoster.find((f) => f.deptCode === 'CS' && !f.isHod), disc: 'Basketball' },
    { f: facultyRoster.find((f) => f.deptCode === 'ME' && !f.isHod), disc: 'Athletics' },
  ].filter((c) => c.f);
  for (const c of coachFaculty) {
    const facExpr = sub.facultyByStaffCode(c.f.staffCode);
    insertGuardedExpr(
      'sports_coach_profiles', ['faculty_id', 'discipline_id', 'coaching_experience_years', 'duty_status', 'certifications', 'responsibilities'],
      [facExpr, sub.sportsDiscipline(c.disc), num(randInt(3, 12)), esc('on_duty'), `ARRAY['Level 1 Coaching Certificate']::text[]`, `ARRAY['Team selection', 'Training schedule']::text[]`],
      `faculty_id = ${facExpr}`
    );
  }
  const coachFacExpr = coachFaculty.length ? sub.facultyByStaffCode(coachFaculty[0].f.staffCode) : NUL();

  line('-- sports_teams: 3 teams reusing real disciplines/facilities, captains from the athlete sample');
  const TEAMS = [
    { name: 'SECE Men\'s Basketball Team', disc: 'Basketball', facility: 'Basketball Court' },
    { name: 'SECE Women\'s Volleyball Team', disc: 'Volleyball', facility: 'Indoor Sports Hall' },
    { name: 'SECE Athletics Squad', disc: 'Athletics', facility: 'Main Sports Ground' },
  ];
  TEAMS.forEach((t, idx) => {
    const captain = athletes[idx % athletes.length];
    const vice = athletes[(idx + 1) % athletes.length];
    insertGuardedRow(
      'sports_teams',
      ['name', 'discipline_id', 'facility_id', 'coach_faculty_id', 'captain_student_id', 'vice_captain_student_id', 'formed_date', 'played', 'won', 'lost', 'drawn', 'status'],
      [
        esc(t.name), sub.sportsDiscipline(t.disc), sub.sportsFacility(t.facility), coachFacExpr,
        sub.studentByRegNo(captain.regNo), sub.studentByRegNo(vice.regNo), esc('2026-07-15'),
        num(randInt(3, 10)), num(randInt(1, 6)), num(randInt(0, 4)), num(randInt(0, 2)), esc('confirmed'),
      ],
      'name', t.name
    );
  });
  const teamExpr = (name) => `(SELECT id FROM sports_teams WHERE name = ${esc(name)})`;

  line('-- sports_training_sessions: 4 sessions across disciplines/facilities');
  const SESSIONS = [
    { disc: 'Basketball', facility: 'Basketball Court', date: '2026-08-24' },
    { disc: 'Volleyball', facility: 'Indoor Sports Hall', date: '2026-08-25' },
    { disc: 'Athletics', facility: 'Main Sports Ground', date: '2026-08-26' },
    { disc: 'Basketball', facility: 'Basketball Court', date: '2026-08-27' },
  ];
  for (const sess of SESSIONS) {
    insertGuardedExpr(
      'sports_training_sessions', ['discipline_id', 'facility_id', 'coach_faculty_id', 'session_date', 'start_time', 'end_time', 'status'],
      [sub.sportsDiscipline(sess.disc), sub.sportsFacility(sess.facility), coachFacExpr, esc(sess.date), esc('16:00:00'), esc('17:30:00'), esc('confirmed')],
      `discipline_id = ${sub.sportsDiscipline(sess.disc)} AND session_date = ${esc(sess.date)}`
    );
  }

  line('-- sports_fixtures: 3 fixtures for the real teams above');
  const FIXTURES = [
    { title: 'Basketball Friendly vs PSG Tech', team: TEAMS[0].name, disc: 'Basketball', opponent: 'PSG College of Technology', date: '2026-09-10' },
    { title: 'Volleyball Inter-College Match', team: TEAMS[1].name, disc: 'Volleyball', opponent: 'Kumaraguru College of Technology', date: '2026-09-15' },
    { title: 'Athletics Meet - Zonal Round', team: TEAMS[2].name, disc: 'Athletics', opponent: 'Anna University Zone', date: '2026-09-20' },
  ];
  for (const fx of FIXTURES) {
    insertGuardedExpr(
      'sports_fixtures', ['title', 'discipline_id', 'team_id', 'opponent', 'is_home', 'fixture_date', 'status'],
      [esc(fx.title), sub.sportsDiscipline(fx.disc), teamExpr(fx.team), esc(fx.opponent), boolSql(true), esc(fx.date), esc('confirmed')],
      `title = ${esc(fx.title)} AND fixture_date = ${esc(fx.date)}`
    );
  }

  line('-- sports_achievements: 3 rows for the athlete sample');
  const ACHIEVEMENTS = [
    { student: athletes[0], event: 'District Basketball Championship 2026', result: 'Winner', level: 'District' },
    { student: athletes[1], event: 'State Athletics Meet 2026', result: 'Runner-up', level: 'State' },
    { student: athletes[2], event: 'Inter-College Volleyball Tournament 2026', result: '3rd Place', level: 'Zonal' },
  ];
  for (const ach of ACHIEVEMENTS) {
    insertGuardedExpr(
      'sports_achievements', ['athlete_student_id', 'event_name', 'participant_name', 'result', 'achievement_date', 'level'],
      [sub.studentByRegNo(ach.student.regNo), esc(ach.event), esc(`${ach.student.firstName} ${ach.student.lastName}.`), esc(ach.result), esc('2026-08-05'), esc(ach.level)],
      `athlete_student_id = ${sub.studentByRegNo(ach.student.regNo)} AND event_name = ${esc(ach.event)}`
    );
  }

  line('-- sports_calendar_notes: 3 rows created by sports_admin');
  const CAL_NOTES = [
    ['Inter-Department Sports Meet', 'meet', '2026-09-05'],
    ['Annual Athletics Day', 'meet', '2026-10-12'],
    ['Basketball Tryouts - New Batch', 'trial', '2026-09-01'],
  ];
  for (const [title, category, date] of CAL_NOTES) {
    insertGuardedExpr(
      'sports_calendar_notes', ['title', 'category', 'event_date', 'created_by_user_id'],
      [esc(title), esc(category), esc(date), sub.userByEmail('sportsadmin@sece.ac.in')],
      `title = ${esc(title)} AND event_date = ${esc(date)}`
    );
  }

  line('-- sports_od_requests + sports_od_squad_members: 2 requests, requested by sports_admin');
  const OD_REQUESTS = [
    { event: 'District Basketball Championship 2026', from: '2026-09-08', to: '2026-09-10', status: 'approved', squad: athletes.slice(0, 3) },
    { event: 'State Athletics Meet 2026', from: '2026-09-18', to: '2026-09-21', status: 'pending', squad: athletes.slice(3, 6) },
  ];
  for (const od of OD_REQUESTS) {
    insertGuardedExpr(
      'sports_od_requests',
      ['od_type', 'from_date', 'to_date', 'event', 'accompanying_coach_faculty_id', 'requested_by_user_id', 'status'],
      [esc('Sports Duty Leave'), esc(od.from), esc(od.to), esc(od.event), coachFacExpr, sub.userByEmail('sportsadmin@sece.ac.in'), esc(od.status)],
      `event = ${esc(od.event)} AND from_date = ${esc(od.from)}`
    );
    const odExpr = `(SELECT id FROM sports_od_requests WHERE event = ${esc(od.event)} AND from_date = ${esc(od.from)})`;
    for (const s of od.squad) {
      const stuExpr = sub.studentByRegNo(s.regNo);
      insertGuardedExpr(
        'sports_od_squad_members', ['od_request_id', 'student_id'],
        [odExpr, stuExpr],
        `od_request_id = ${odExpr} AND student_id = ${stuExpr}`
      );
    }
  }

  line('-- sports_budget_requests: 2 rows raised by sports_admin');
  const BUDGET_REQUESTS = [
    { title: 'New Basketball Kits and Equipment', amount: 45000, status: 'approved' },
    { title: 'Athletics Meet Travel and Accommodation', amount: 60000, status: 'pending' },
  ];
  for (const br of BUDGET_REQUESTS) {
    insertGuardedExpr(
      'sports_budget_requests', ['title', 'description', 'amount', 'raised_by_user_id', 'status', 'reviewed_by_user_id', 'reviewed_at'],
      [
        esc(br.title), esc(`Budget request for ${br.title.toLowerCase()}.`), num(br.amount), sub.userByEmail('sportsadmin@sece.ac.in'),
        esc(br.status), br.status === 'approved' ? sub.userByEmail('principal@sece.ac.in') : NUL(),
        br.status === 'approved' ? esc('2026-08-18 10:00:00+05:30') : NUL(),
      ],
      `title = ${esc(br.title)}`
    );
  }
}
blank();

// ===========================================================================
// PART 8 (final extension pass, same date): structural curriculum-mapping
// tables + small standalone/user-scoped lookup tables.
// ===========================================================================
line('-- ===========================================================================');
line('-- PART 8: class_subjects + curriculum_mappings (structural mapping of the');
line('-- already-real subjects/classes/departments; no new syllabus content)');
line('-- ===========================================================================');
{
  // class_subjects: one row per class x subject already generated in
  // subjectsByDeptSem, for every current class (all 4 sections) of every batch.
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const b of BATCHES) {
      const sem = b.currentSemester;
      const codes = subjectsByDeptSem[d.code][sem];
      for (const section of ['A', 'B', 'C', 'D']) {
        for (const code of codes) {
          const isElective = code.endsWith('06'); // subject k=6 was generated as 'elective' category
          rows.push([
            sub.classByKey(b.name, d.code, section), sub.subjectByCode(code), num(sem), boolSql(isElective),
          ]);
        }
      }
    }
  }
  insertPlain('class_subjects', ['class_id', 'subject_id', 'semester', 'is_elective'], rows);
}

line('-- curriculum_mappings: one row per department x semester x subject (section fixed to A,');
line('-- since the table has no per-section unique key — display_order = subject sequence k)');
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    for (const sem of SEMESTERS_IN_USE) {
      const codes = subjectsByDeptSem[d.code][sem];
      codes.forEach((code, idx) => {
        rows.push([
          sub.dept(d.code), num(sem), sub.subjectByCode(code), esc('A'), num(idx + 1),
        ]);
      });
    }
  }
  insertPlain('curriculum_mappings', ['department_id', 'semester', 'subject_id', 'section', 'display_order'], rows);
}
blank();

line('-- ===========================================================================');
line('-- PART 8: leave_types (real HR leave-type lookup, standalone)');
line('-- ===========================================================================');
{
  const LEAVE_TYPES = [
    ['Casual Leave', 12],
    ['Sick Leave', 10],
    ['Earned Leave', 15],
    ['Maternity Leave', 180],
    ['On Duty Leave', 0],
    ['Compensatory Off', 0],
  ];
  for (const [name, quota] of LEAVE_TYPES) {
    insertGuardedRow('leave_types', ['name', 'default_annual_quota'], [esc(name), num(quota)], 'name', name);
  }
}
blank();

line('-- ===========================================================================');
line('-- PART 8: user_preferences + user_social_links (sample of already-real seed users)');
line('-- ===========================================================================');
{
  // Reuse real, already-seeded HOD accounts + the fixed institutional seed accounts.
  const HOD_EMAILS = DEPARTMENTS.map((d) => d.hod.email);
  const OTHER_USERS = [
    'principal@sece.ac.in', 'academiccoordinator@sece.ac.in', 'coe@sece.ac.in',
    'hrpayroll@sece.ac.in', 'finance@sece.ac.in', 'secretary@sece.ac.in',
    'warden@sece.ac.in', 'billing@sece.ac.in', 'edccoordinator@sece.ac.in', 'sportsadmin@sece.ac.in',
  ];
  const PREF_USERS = HOD_EMAILS.concat(OTHER_USERS);
  for (const email of PREF_USERS) {
    const userExpr = sub.userByEmail(email);
    insertGuardedExpr(
      'user_preferences',
      ['user_id', 'daily_attendance_digest', 'sop_escalation_alerts', 'auto_circulate_mom', 'compact_tables'],
      [userExpr, boolSql(true), boolSql(true), boolSql(rng() < 0.4), boolSql(rng() < 0.3)],
      `user_id = ${userExpr}`
    );
  }

  line('-- user_social_links: a small sample of HOD accounts with a department-page + LinkedIn link');
  const SOCIAL_SAMPLE = HOD_EMAILS.slice(0, 5);
  for (const email of SOCIAL_SAMPLE) {
    const userExpr = sub.userByEmail(email);
    const links = [
      ['LinkedIn', `https://www.linkedin.com/in/${email.split('@')[0]}`, 1],
      ['Department Page', 'https://www.sece.ac.in/departments/', 2],
    ];
    for (const [title, url, order] of links) {
      insertGuardedExpr(
        'user_social_links', ['user_id', 'title', 'url', 'display_order'],
        [userExpr, esc(title), esc(url), num(order)],
        `user_id = ${userExpr} AND title = ${esc(title)}`
      );
    }
  }
}
blank();

// ===========================================================================
// PART 9 (Cluster 1): HR / faculty-leave chain.
// Uses a small deterministic per-department sample of the already-built
// facultyRoster (HOD + 4 others per department = 5 x 10 depts = 50 faculty)
// so history tables stay a manageable, reviewable size while still covering
// every department and every real HOD.
// ===========================================================================
line('-- ===========================================================================');
line('-- PART 9 (Cluster 1): HR / faculty-leave chain');
line('-- ===========================================================================');

const hrFacultySample = [];
for (const d of DEPARTMENTS) {
  const deptFac = facultyRoster.filter((f) => f.deptCode === d.code);
  const hod = deptFac.find((f) => f.isHod);
  const others = deptFac.filter((f) => !f.isHod).slice(0, 4);
  hrFacultySample.push(hod, ...others);
}

const LEAVE_TYPE_NAMES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave', 'On Duty Leave', 'Compensatory Off'];
const LEAVE_TYPE_QUOTA = { 'Casual Leave': 12, 'Sick Leave': 10, 'Earned Leave': 15, 'Maternity Leave': 180, 'On Duty Leave': 0, 'Compensatory Off': 0 };

line('-- holiday_slots: a small real academic-calendar sample (needed by faculty_holiday_mapping)');
const HOLIDAY_SLOTS = [
  ['Diwali Break', '2026-11-08', '2026-11-10'],
  ['Pongal Break', '2027-01-14', '2027-01-16'],
  ['Christmas & New Year Break', '2026-12-24', '2027-01-01'],
];
for (const [name, from, to] of HOLIDAY_SLOTS) {
  insertGuardedExpr(
    'holiday_slots', ['name', 'from_date', 'to_date'],
    [esc(name), esc(from), esc(to)],
    `name = ${esc(name)} AND from_date = ${esc(from)}`
  );
}
const holidaySlot = (name) => `(SELECT id FROM holiday_slots WHERE name = ${esc(name)})`;

line('-- faculty_leave_balances: current AY balances for the HR sample, one row per faculty x leave type');
{
  const rows = [];
  for (const f of hrFacultySample) {
    for (const lt of LEAVE_TYPE_NAMES) {
      const allocated = LEAVE_TYPE_QUOTA[lt];
      const used = allocated > 0 ? randInt(0, Math.min(4, allocated)) : 0;
      rows.push([
        sub.facultyByStaffCode(f.staffCode), sub.leaveType(lt), esc(CURRENT_AY), num(allocated), num(used),
      ]);
    }
  }
  insertPlain('faculty_leave_balances', ['faculty_id', 'leave_type_id', 'academic_year', 'allocated', 'used'], rows);
}

line('-- faculty_leaves: a handful of real approval-chain leave requests (faculty -> HOD -> HR, some also principal)');
{
  const LEAVE_SAMPLES = [
    ['Casual Leave', '2026-07-06', '2026-07-07', 'Family function', 'approved', 'approved'],
    ['Sick Leave', '2026-07-20', '2026-07-21', 'Fever and viral infection', 'approved', 'approved'],
    ['Earned Leave', '2026-08-10', '2026-08-14', 'Personal travel', 'approved', 'pending'],
    ['On Duty Leave', '2026-06-15', '2026-06-15', 'Attending workshop at Anna University', 'approved', 'approved'],
    ['Casual Leave', '2026-08-25', '2026-08-25', 'Personal work', 'pending', 'pending'],
  ];
  const rows = [];
  for (const d of DEPARTMENTS) {
    const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
    const applicant = facultyRoster.filter((f) => f.deptCode === d.code && !f.isHod)[0];
    const [ltName, from, to, reason, hodStatus, hrStatus] = pick(LEAVE_SAMPLES);
    const hodDecided = hodStatus !== 'pending';
    const hrDecided = hodDecided && hrStatus !== 'pending';
    rows.push([
      sub.facultyByStaffCode(applicant.staffCode), esc(from), esc(to), esc(reason),
      esc(hodStatus), esc(hrStatus), sub.leaveType(ltName),
      hodDecided ? sub.userByEmail(hod.email) : NUL(),
      hrDecided ? sub.userByEmail('hrpayroll@sece.ac.in') : NUL(),
      hodDecided ? esc(from) : NUL(),
      hrDecided ? esc(from) : NUL(),
    ]);
  }
  insertPlain(
    'faculty_leaves',
    ['faculty_id', 'from_date', 'to_date', 'reason', 'hod_approval_status', 'hr_approval_status', 'leave_type_id',
      'hod_decided_by_user_id', 'hr_decided_by_user_id', 'hod_decided_at', 'hr_decided_at'],
    rows
  );
}

line('-- salary_divisions: Basic + HRA + DA breakdown for the HR sample, effective from current AY start');
{
  const DIVISIONS = [
    ['Basic Pay', 0.55],
    ['HRA', 0.2],
    ['Dearness Allowance', 0.15],
    ['Other Allowances', 0.1],
  ];
  const rows = [];
  for (const f of hrFacultySample) {
    const gross = f.isHod ? 95000 : (f.title === 'Professor' ? 90000 : f.title.includes('Associate') ? 70000 : 50000);
    for (const [name, frac] of DIVISIONS) {
      rows.push([
        sub.facultyByStaffCode(f.staffCode), esc(name), (gross * frac).toFixed(2), esc('2026-06-01'),
      ]);
    }
  }
  insertPlain('salary_divisions', ['faculty_id', 'division_name', 'amount', 'effective_from'], rows);
}

line('-- salary_payments: 3 months of processed payroll history (Jun-Aug 2026) for the HR sample');
{
  const rows = [];
  for (const f of hrFacultySample) {
    const gross = f.isHod ? 95000 : (f.title === 'Professor' ? 90000 : f.title.includes('Associate') ? 70000 : 50000);
    for (const [month, year] of [[6, 2026], [7, 2026], [8, 2026]]) {
      const deductions = Math.round(gross * 0.08);
      const net = gross - deductions;
      const paidAt = month === 8 ? NUL() : esc(`${year}-${String(month).padStart(2, '0')}-28 00:00:00+05:30`);
      const status = month === 8 ? 'pending' : 'processed';
      rows.push([
        esc('faculty'), sub.facultyByStaffCode(f.staffCode), NUL(), num(month), num(year),
        gross.toFixed(2), net.toFixed(2), paidAt, month === 8 ? NUL() : sub.userByEmail('hrpayroll@sece.ac.in'),
        esc(status), deductions.toFixed(2), num(0), '0.00',
      ]);
    }
  }
  insertPlain(
    'salary_payments',
    ['payee_type', 'faculty_id', 'staff_id', 'month', 'year', 'gross_amount', 'net_amount', 'paid_at',
      'processed_by_user_id', 'status', 'deductions_amount', 'lop_days', 'lop_amount'],
    rows
  );
}

line('-- non_teaching_staff: a handful per department with real designation-style job titles (no user account needed)');
{
  const NT_ROLES = [
    ['housekeeping', 'Housekeeping Staff'],
    ['security', 'Security Guard'],
    ['lab_assistant', 'Lab Assistant'],
    ['office', 'Office Assistant'],
  ];
  const rows = [];
  let serial = 1;
  for (const d of DEPARTMENTS) {
    for (const [cat] of NT_ROLES) {
      const first = FAC_FIRST[serial % FAC_FIRST.length];
      const last = FAC_LAST[serial % FAC_LAST.length];
      rows.push([
        esc(first), esc(last), esc(cat), sub.dept(d.code), esc('2019-06-01'), esc('active'),
      ]);
      serial++;
    }
  }
  insertPlain('non_teaching_staff', ['first_name', 'last_name', 'category', 'department_id', 'date_of_joining', 'status'], rows);
}

line('-- faculty_daily_attendance: a recent week (2026-08-17 to 2026-08-21, Mon-Fri) for the HR sample');
{
  const rows = [];
  const days = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
  for (const f of hrFacultySample) {
    for (const day of days) {
      const status = rng() < 0.9 ? 'full_day' : (rng() < 0.5 ? 'half_day' : 'on_leave');
      const punchIn = status === 'on_leave' ? NUL() : esc('09:1' + randInt(0, 5) + ':00');
      const punchOut = status === 'on_leave' ? NUL() : esc('17:0' + randInt(0, 5) + ':00');
      rows.push([
        sub.facultyByStaffCode(f.staffCode), esc(day), punchIn, punchOut, esc(status), esc(CURRENT_AY),
      ]);
    }
  }
  insertPlain('faculty_daily_attendance', ['faculty_id', 'attendance_date', 'punch_in', 'punch_out', 'status', 'academic_year'], rows);
}

line('-- faculty_holiday_mapping: link every HR-sample faculty to the seeded holiday_slots');
{
  const rows = [];
  for (const f of hrFacultySample) {
    for (const [name] of HOLIDAY_SLOTS) {
      rows.push([sub.facultyByStaffCode(f.staffCode), holidaySlot(name)]);
    }
  }
  insertPlain('faculty_holiday_mapping', ['faculty_id', 'holiday_slot_id'], rows);
}

line('-- faculty_documents: a couple of standard HR documents per HR-sample faculty');
{
  const DOC_TYPES = ['PAN Card', 'Highest Degree Certificate', 'Relieving Letter'];
  const rows = [];
  for (const f of hrFacultySample) {
    const docs = shuffleCopy(DOC_TYPES).slice(0, 2);
    for (const docType of docs) {
      rows.push([
        sub.facultyByStaffCode(f.staffCode), esc(docType), esc(`${f.staffCode}_${docType.replace(/\s+/g, '_')}.pdf`),
        esc(`https://storage.sece.ac.in/faculty-documents/${f.staffCode}/${docType.replace(/\s+/g, '_')}.pdf`),
        sub.userByEmail(f.email), esc('verified'), sub.userByEmail('hrpayroll@sece.ac.in'),
      ]);
    }
  }
  insertPlain(
    'faculty_documents',
    ['faculty_id', 'document_type', 'file_name', 'file_url', 'uploaded_by_user_id', 'verification_status', 'verified_by_user_id'],
    rows
  );
}

line('-- faculty_id_card_issuances: one issuance per HR-sample faculty');
{
  const rows = hrFacultySample.map((f) => [
    sub.facultyByStaffCode(f.staffCode), sub.userByEmail('hrpayroll@sece.ac.in'),
  ]);
  insertPlain('faculty_id_card_issuances', ['faculty_id', 'issued_by_user_id'], rows);
}

line('-- faculty_awards: a couple of real-shaped institutional/teaching awards for a subset of the HR sample');
{
  const AWARDS = [
    ['Best Teacher Award', 'SECE Management', 2025],
    ['Best Mentor Award', 'SECE Management', 2024],
    ['Outstanding Research Contribution', 'Anna University', 2025],
  ];
  const rows = [];
  for (const d of DEPARTMENTS) {
    const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
    const [title, awardedBy, year] = pick(AWARDS);
    rows.push([sub.facultyByStaffCode(hod.staffCode), esc(title), esc(awardedBy), num(year)]);
  }
  insertPlain('faculty_awards', ['faculty_id', 'title', 'awarded_by', 'year'], rows);
}

line('-- faculty_publications: generic real-shaped paper titles (not claimed as actually-published), a couple per HOD');
{
  const PUB_TYPES = ['journal', 'conference'];
  const VENUES = ['IEEE Access', 'Springer LNCS', 'Elsevier Procedia CS', 'Anna University Journal of Engineering'];
  const rows = [];
  for (const d of DEPARTMENTS) {
    const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
    for (let i = 0; i < 2; i++) {
      const type = PUB_TYPES[i % 2];
      const title = `A Study on ${['Machine Learning Applications', 'Energy Efficient Systems', 'Data Security Frameworks', 'IoT Based Monitoring', 'Cloud Resource Optimization'][((d.code.length + i) * 7) % 5]} in ${d.name.replace('B.E. ', '')}`;
      rows.push([
        sub.facultyByStaffCode(hod.staffCode), esc(title), esc(type), num(2024 + i), esc(pick(VENUES)), NUL(), num(randInt(0, 15)),
      ]);
    }
  }
  insertPlain('faculty_publications', ['faculty_id', 'title', 'type', 'year', 'venue', 'doi', 'citation_count'], rows);
}

line('-- faculty_committee_roles: HOD + one other faculty per department on a standard committee');
{
  const COMMITTEES = ['Anti-Ragging Committee', 'Grievance Redressal Committee', 'IQAC', 'Curriculum Development Committee', 'Placement Committee'];
  const rows = [];
  for (const d of DEPARTMENTS) {
    const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
    rows.push([sub.facultyByStaffCode(hod.staffCode), esc(pick(COMMITTEES)), esc('Chairperson'), esc(CURRENT_AY)]);
    const other = facultyRoster.filter((f) => f.deptCode === d.code && !f.isHod)[1];
    if (other) rows.push([sub.facultyByStaffCode(other.staffCode), esc(pick(COMMITTEES)), esc('Member'), esc(CURRENT_AY)]);
  }
  insertPlain('faculty_committee_roles', ['faculty_id', 'committee_name', 'role', 'academic_year'], rows);
}

line('-- faculty_activity_log: a couple of generic activity entries per HR-sample faculty');
{
  const ACTIVITIES = [
    'Conducted internal assessment for assigned subject',
    'Attended faculty development programme',
    'Submitted course file for the semester',
    'Participated in department review meeting',
  ];
  const rows = [];
  for (const f of hrFacultySample) {
    for (let i = 0; i < 2; i++) {
      rows.push([sub.facultyByStaffCode(f.staffCode), esc(pick(ACTIVITIES)), sub.userByEmail(f.email)]);
    }
  }
  insertPlain('faculty_activity_log', ['faculty_id', 'description', 'created_by_user_id'], rows);
}

line('-- faculty_od_requests: a couple of on-duty requests for the HR sample, real approval chain');
{
  const rows = [];
  for (const d of DEPARTMENTS) {
    const applicant = facultyRoster.filter((f) => f.deptCode === d.code && !f.isHod)[2];
    if (!applicant) continue;
    const hod = facultyRoster.find((f) => f.deptCode === d.code && f.isHod);
    rows.push([
      sub.facultyByStaffCode(applicant.staffCode), esc('2026-07-15'), esc('2026-07-15'),
      esc('Anna University, Chennai'), esc('Attending curriculum revision workshop'),
      esc('approved'), esc('approved'), esc('Anna University'), num(0), NUL(), esc('awaiting_documents'),
    ]);
  }
  insertPlain(
    'faculty_od_requests',
    ['faculty_id', 'from_date', 'to_date', 'place', 'purpose', 'hod_approval_status', 'hr_approval_status',
      'organization_visited', 'students_guided', 'sanction_order', 'verification_status'],
    rows
  );
}

line('-- faculty_attendance_corrections: one correction request per couple of departments');
{
  const rows = [];
  for (const d of DEPARTMENTS.slice(0, 5)) {
    const f = facultyRoster.filter((x) => x.deptCode === d.code && !x.isHod)[3];
    if (!f) continue;
    rows.push([
      sub.facultyByStaffCode(f.staffCode), esc('2026-08-18'), esc('absent'), esc('half_day'),
      esc('Forgot to punch in after returning from an approved on-duty visit'), sub.userByEmail(f.email),
      esc('approved'), esc('approved'), esc('2026-08-19 10:00:00+05:30'),
    ]);
  }
  insertPlain(
    'faculty_attendance_corrections',
    ['faculty_id', 'attendance_date', 'old_status', 'requested_status', 'reason', 'requested_by_user_id',
      'hod_approval_status', 'hr_approval_status', 'decided_at'],
    rows
  );
}

line('-- hr_payroll_requests: a couple of generic payroll queries raised by HR-sample faculty (via their own user account)');
{
  const rows = [];
  for (const f of hrFacultySample.slice(0, 6)) {
    rows.push([
      sub.userByEmail(f.email), esc('Payslip'), esc('Discrepancy in July payslip HRA amount'),
      esc('The HRA component shown in my July payslip does not match the salary division breakup.'),
      NUL(), esc('resolved'), sub.userByEmail('hrpayroll@sece.ac.in'), esc('Corrected and reissued payslip'), esc('2026-08-05 12:00:00+05:30'),
    ]);
  }
  insertPlain(
    'hr_payroll_requests',
    ['requested_by_user_id', 'category', 'subject', 'description', 'attachment_url', 'status',
      'assigned_hr_user_id', 'resolution_note', 'resolved_at'],
    rows
  );
}

line('-- payslip_requests: a couple of payslip download requests for the HR sample');
{
  const rows = [];
  for (const f of hrFacultySample.slice(0, 8)) {
    rows.push([
      sub.facultyByStaffCode(f.staffCode), num(7), num(2026), esc('processed'),
      esc(`https://storage.sece.ac.in/payslips/${f.staffCode}/2026-07.pdf`), esc('Loan application'), sub.userByEmail(f.email),
    ]);
  }
  insertPlain('payslip_requests', ['faculty_id', 'month', 'year', 'status', 'file_url', 'purpose', 'staff_user_id'], rows);
}

line('-- hr_queries: a couple of general HR queries raised by faculty');
{
  const QUERIES = [
    ['Leave Policy', 'Clarification on earned leave carry-forward rule'],
    ['PF/ESI', 'Query regarding PF contribution statement'],
  ];
  const rows = [];
  for (const d of DEPARTMENTS.slice(0, 6)) {
    const f = facultyRoster.filter((x) => x.deptCode === d.code && !x.isHod)[0];
    const [category, subject] = pick(QUERIES);
    rows.push([
      sub.facultyByStaffCode(f.staffCode), esc(category), esc(subject),
      esc('Requesting clarification/assistance regarding the above subject.'), NUL(), esc('resolved'),
      esc('HR Payroll Team'), esc('2026-08-02 11:00:00+05:30'), esc('2026-08-04 15:00:00+05:30'), esc('Clarified over email.'),
    ]);
  }
  insertPlain(
    'hr_queries',
    ['faculty_id', 'category', 'subject', 'description', 'file_url', 'status', 'assigned_to_name', 'assigned_at', 'resolved_at', 'resolution_note'],
    rows
  );
}

// ---------------------------------------------------------------------------
// CLUSTER 2: FEE/FINANCE HISTORICAL RECORDS
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- CLUSTER 2: FEE / FINANCE HISTORICAL RECORDS');
line('-- fee_payments (sample of currently-enrolled students paying against real');
line('-- fee_structure_items, some is_partial=true) + fee_payment_gateway_orders');
line('-- (subset paid online) + fee_receipt_numbers/fee_receipt_number_payments');
line('-- (covering multiple payments each) + education_loan_dd (Management-quota');
line('-- students) + refunds + bills + expenses/expense_categories + ');
line('-- bank_reconciliation_entries (subset of the online payments).');
line('-- ===========================================================================');
blank();

const feeItemExpr = (structName, catName) => `(SELECT id FROM fee_structure_items WHERE fee_structure_id = ${sub.feeStructure(structName)} AND demand_category_id = ${sub.demandCat(catName)})`;
const feeDemandExpr = (regNo) => `(SELECT id FROM student_fee_demand_mapping WHERE student_id = ${sub.studentByRegNo(regNo)} AND academic_year = ${esc(CURRENT_AY)})`;
const feePaymentByReceiptExpr = (receiptNo) => `(SELECT id FROM fee_payments WHERE receipt_no = ${esc(receiptNo)})`;

// Deterministic sample of currently-enrolled students, spread across every dept/batch/section (every 16th student ~150 of 2400).
const feeSample = students.filter((s, i) => i % 16 === 0);
line(`-- fee_payments: sample of ${feeSample.length} currently-enrolled students (every 16th, spread across all dept/batch/section)`);

const PAYMENT_MODES = ['cash', 'card', 'upi', 'netbanking', 'razorpay'];
const feePaymentPlan = []; // { receiptNo, regNo, structName, cat, amount, isPartial, mode }
feeSample.forEach((s, idx) => {
  const structName = s.feeStructureName;
  const tuitionAmt = FEE_ITEM_AMOUNTS[structName]['Tuition Fee'];
  const mode = PAYMENT_MODES[idx % PAYMENT_MODES.length];
  // Payment 1: full payment of the Tuition Fee item.
  feePaymentPlan.push({
    receiptNo: `RCPT-${CURRENT_AY.slice(0, 4)}-${String(idx + 1).padStart(5, '0')}`,
    regNo: s.regNo, structName, cat: 'Tuition Fee', amount: tuitionAmt, isPartial: false, mode,
  });
  // Payment 2 (1 of every 3 sampled students): a partial payment on the Special Fee item.
  if (idx % 3 === 0) {
    const specialAmt = FEE_ITEM_AMOUNTS[structName]['Special Fee'];
    const partialAmt = Math.round(specialAmt * 0.6);
    feePaymentPlan.push({
      receiptNo: `RCPT-${CURRENT_AY.slice(0, 4)}-${String(idx + 1).padStart(5, '0')}-P`,
      regNo: s.regNo, structName, cat: 'Special Fee', amount: partialAmt, isPartial: true, mode: 'cash',
    });
  }
});

for (const p of feePaymentPlan) {
  insertGuardedExpr(
    'fee_payments',
    ['student_fee_demand_mapping_id', 'amount_paid', 'payment_date', 'payment_mode', 'receipt_no', 'is_partial', 'collected_by_user_id', 'fee_structure_item_id'],
    [
      feeDemandExpr(p.regNo), num(p.amount), esc('2026-08-05'), esc(p.mode), esc(p.receiptNo),
      boolSql(p.isPartial), sub.userByEmail('billing@sece.ac.in'), feeItemExpr(p.structName, p.cat),
    ],
    `receipt_no = ${esc(p.receiptNo)}`
  );
}

line('-- fee_payment_gateway_orders: subset of the above paid online (payment_mode = razorpay)');
const gatewayOrderPlan = feePaymentPlan
  .filter((p) => p.mode === 'razorpay')
  .map((p, idx) => ({ ...p, orderId: `order_SEED${String(idx + 1).padStart(8, '0')}` }));
for (const p of gatewayOrderPlan) {
  insertGuardedExpr(
    'fee_payment_gateway_orders',
    ['student_fee_demand_mapping_id', 'amount', 'status', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature', 'fee_payment_id', 'created_by_user_id'],
    [
      feeDemandExpr(p.regNo), num(p.amount), esc('success'), esc(p.orderId),
      esc(`pay_SEED${p.orderId.slice(-8)}`), esc(`sig_SEED${p.orderId.slice(-8)}`),
      feePaymentByReceiptExpr(p.receiptNo), sub.userByEmail(p.regNo === feeSample[0].regNo ? 'billing@sece.ac.in' : 'billing@sece.ac.in'),
    ],
    `razorpay_order_id = ${esc(p.orderId)}`
  );
}

line('-- fee_receipt_numbers + fee_receipt_number_payments: each receipt-number row covers 3 consecutive fee_payments');
{
  const chunks = [];
  for (let i = 0; i < feePaymentPlan.length; i += 3) chunks.push(feePaymentPlan.slice(i, i + 3));
  chunks.forEach((chunk, cIdx) => {
    const printDate = '2026-08-06';
    // No natural unique key on fee_receipt_numbers itself (pure historical print-batch record);
    // guarded implicitly by the underlying fee_payments' unique receipt_no via the join rows below,
    // and inserted only once per generator run like the rest of this file's fresh historical data.
    line(`INSERT INTO fee_receipt_numbers (print_date, issued_by_user_id)`);
    line(`SELECT ${esc(printDate)}, ${sub.userByEmail('billing@sece.ac.in')}`);
    line(`WHERE NOT EXISTS (SELECT 1 FROM fee_receipt_numbers frn JOIN fee_receipt_number_payments frnp ON frnp.receipt_number_id = frn.id JOIN fee_payments fp ON fp.id = frnp.fee_payment_id WHERE fp.receipt_no = ${esc(chunk[0].receiptNo)});`);
    blank();
    for (const p of chunk) {
      line(`INSERT INTO fee_receipt_number_payments (receipt_number_id, fee_payment_id)`);
      line(`SELECT (SELECT frn.id FROM fee_receipt_numbers frn WHERE frn.print_date = ${esc(printDate)} AND frn.issued_by_user_id = ${sub.userByEmail('billing@sece.ac.in')} ORDER BY frn.id LIMIT 1 OFFSET ${cIdx}), ${feePaymentByReceiptExpr(p.receiptNo)}`);
      line(`WHERE NOT EXISTS (SELECT 1 FROM fee_receipt_number_payments WHERE fee_payment_id = ${feePaymentByReceiptExpr(p.receiptNo)});`);
      blank();
    }
  });
}

line('-- education_loan_dd: a subset of Management-quota students in the fee sample');
{
  const mgmtSample = feeSample.filter((s) => s.quota === 'Management').slice(0, 10);
  const rows = [];
  mgmtSample.forEach((s, idx) => {
    const ddRef = `DD-${CURRENT_AY.slice(0, 4)}-${String(idx + 1).padStart(4, '0')}`;
    insertGuardedExpr(
      'education_loan_dd',
      ['student_fee_demand_mapping_id', 'dd_reference_number', 'bank_name', 'amount', 'status', 'acknowledgement_receipt_no', 'received_by_user_id'],
      [
        feeDemandExpr(s.regNo), esc(ddRef), esc(pick(BANK_NAMES)), num(s.feeTotalAmount), esc(pick(['received', 'cleared'])),
        esc(`ACK-${ddRef}`), sub.userByEmail('billing@sece.ac.in'),
      ],
      `dd_reference_number = ${esc(ddRef)}`
    );
  });
}

line('-- refunds: a couple against already-created fee_payments (excess-payment correction scenarios)');
{
  const refundSources = feePaymentPlan.filter((p) => p.isPartial === false).slice(0, 2);
  refundSources.forEach((p, idx) => {
    const reqNo = `REF-${CURRENT_AY.slice(0, 4)}-${String(idx + 1).padStart(3, '0')}`;
    insertGuardedExpr(
      'refunds',
      ['student_fee_demand_mapping_id', 'fee_payment_id', 'request_no', 'reason', 'amount', 'status', 'requested_by_user_id', 'approved_by_user_id', 'settled_date'],
      [
        feeDemandExpr(p.regNo), feePaymentByReceiptExpr(p.receiptNo), esc(reqNo),
        esc('Duplicate fee payment made in error; excess amount to be refunded.'), num(1000),
        esc(idx === 0 ? 'approved' : 'pending'), sub.userByEmail('billing@sece.ac.in'),
        idx === 0 ? sub.userByEmail('finance@sece.ac.in') : NUL(), idx === 0 ? esc('2026-08-10') : NUL(),
      ],
      `request_no = ${esc(reqNo)}`
    );
  });
}

line('-- expense_categories + expenses: real department operational costs (guarded on category name)');
{
  const EXPENSE_CATEGORIES = ['Lab Consumables', 'Housekeeping & Maintenance', 'Stationery & Printing', 'Electricity & Utilities', 'Guest Lecture Honorarium', 'Equipment Repair'];
  for (const cat of EXPENSE_CATEGORIES) insertGuardedRow('expense_categories', ['name'], [esc(cat)], 'name', cat);
  const expCatExpr = (name) => `(SELECT id FROM expense_categories WHERE name = ${esc(name)})`;
  const rows = [];
  DEPARTMENTS.forEach((d, idx) => {
    const cat = EXPENSE_CATEGORIES[idx % EXPENSE_CATEGORIES.length];
    rows.push([
      expCatExpr(cat), esc(`${cat} - ${d.name.replace('B.E. ', '').replace('B.Tech ', '')} Department, ${CURRENT_AY}`),
      num(randInt(5000, 85000)), esc('2026-08-01'), sub.userByEmail('finance@sece.ac.in'),
    ]);
  });
  insertPlain('expenses', ['category_id', 'description', 'amount', 'expense_date', 'recorded_by_user_id'], rows);
}

line('-- bills: department operational-cost bills against the already-real procurement vendors');
{
  // chk_bills_exactly_one_order requires exactly one of purchase_order_id /
  // service_order_id to be non-null, so each bill is tied to a real order of
  // the kind its vendor supplies: product vendors bill against a
  // purchase_order, service vendors against a service_order.
  const BILL_VENDORS = [
    { name: 'BrightWave Computer Traders', kind: 'product' },
    { name: 'CoolAir Facility Services', kind: 'service' },
    { name: 'Nexstar IT Solutions', kind: 'product' },
    { name: 'UrbanFix Maintenance Co.', kind: 'service' },
  ];
  // NOTE: service_orders are seeded LATER in this file than bills, so a bill
  // cannot reference one (the subquery would resolve to NULL and break the
  // exactly-one-order constraint). Every bill therefore references a
  // purchase_order, which is already seeded by this point.
  let poSeq = 0;
  BILL_VENDORS.forEach((v, idx) => {
    const billNo = `BILL-${CURRENT_AY.slice(0, 4)}-${String(idx + 1).padStart(4, '0')}`;
    const qty = randInt(1, 5);
    const unitPrice = randInt(2000, 40000);
    poSeq += 1;
    const poExpr = `(SELECT id FROM purchase_orders WHERE po_number = ${esc(`PO-2026-${String(poSeq).padStart(4, '0')}`)})`;
    const soExpr = NUL();
    insertGuardedExpr(
      'bills',
      ['bill_number', 'purchase_order_id', 'service_order_id', 'vendor_id', 'quantity', 'unit_price', 'total_amount', 'remarks', 'status', 'created_by_user_id', 'paid_at'],
      [
        esc(billNo), poExpr, soExpr, `(SELECT id FROM vendors WHERE name = ${esc(v.name)})`,
        num(qty), num(unitPrice), num(qty * unitPrice),
        esc('Departmental operational cost bill.'), esc(idx < 2 ? 'paid' : 'pending'),
        sub.userByEmail('finance@sece.ac.in'), idx < 2 ? esc('2026-08-10 10:00:00+05:30') : NUL(),
      ],
      `bill_number = ${esc(billNo)}`
    );
  });
}

line('-- bank_reconciliation_entries: subset of the online fee_payment_gateway_orders, matched against a bank statement line');
{
  const reconSubset = gatewayOrderPlan.slice(0, Math.ceil(gatewayOrderPlan.length / 2));
  const rows = reconSubset.map((p) => [
    esc(`UTR${p.orderId.replace('order_SEED', '')}`), esc('2026-08-05'),
    `(SELECT id FROM fee_payment_gateway_orders WHERE razorpay_order_id = ${esc(p.orderId)})`,
    num(p.amount), boolSql(true), sub.userByEmail('finance@sece.ac.in'), esc('2026-08-07 09:00:00+05:30'),
  ]);
  insertPlain(
    'bank_reconciliation_entries',
    ['bank_reference', 'value_date', 'fee_payment_gateway_order_id', 'amount', 'matched', 'matched_by_user_id', 'matched_at'],
    rows
  );
}

blank();

// ---------------------------------------------------------------------------
// CLUSTER 3: EXAM-LIFECYCLE REMAINDER
// exam_pass_rules_settings (singleton config), grade_bands (7 real NBA-style
// bands), marks_entry_locks (CIA1, locked+published, per batch x department),
// exam_timetable_versions + exam_timetable (CIA2 timetable, published, one
// section/dept/batch sample across all its real mapped subjects),
// revaluation_windows (one per CIA1 exam, reusing the already-real CIA1
// revaluation_requests), malpractice_incidents (a couple, tied to real
// CIA1 exam_subject_mapping + students), hall_ticket_clearance_exceptions
// (a couple, tied to the University End Semester exam),
// seating_plan_venue_departments (linking the already-real PART 6
// seating_plan_version_venues to their batch's real department), and
// marksheets (genuinely a plain document-record table per schema — file_url
// + generated_at only — populated for a small sample of students per
// current class against the real published CIA1 exam).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- CLUSTER 3: EXAM-LIFECYCLE REMAINDER');
line('-- ===========================================================================');
{
  line('-- exam_pass_rules_settings: singleton institution-wide config row (guarded so a rerun never duplicates it)');
  insertGuardedExpr(
    'exam_pass_rules_settings',
    ['internal_max_marks', 'external_max_marks', 'pass_mark_total', 'min_external_marks'],
    [num(40), num(60), num(50), num(24)],
    'TRUE'
  );

  line('-- grade_bands: real NBA-style 10-point grade bands (guarded on unique grade_label)');
  const GRADE_BANDS = [
    ['O', 90, 10, 1], ['A+', 80, 9, 2], ['A', 70, 8, 3], ['B+', 60, 7, 4],
    ['B', 50, 6, 5], ['RA', 0, 0, 6],
  ];
  for (const [label, minPct, gp, order] of GRADE_BANDS) {
    insertGuardedExpr(
      'grade_bands', ['grade_label', 'min_percentage', 'grade_point', 'is_pass', 'display_order'],
      [esc(label), num(minPct), num(gp), boolSql(label !== 'RA'), num(order)],
      `grade_label = ${esc(label)}`
    );
  }

  line('-- marks_entry_locks: CIA1 (results already published) locked+published, one row per batch x department');
  {
    const rows = [];
    for (const b of BATCHES) {
      const examExpr = sub.exam(b.name, 'CIA1', CURRENT_AY);
      for (const d of DEPARTMENTS) {
        rows.push([
          examExpr, sub.dept(d.code), boolSql(true), sub.userByEmail('coe@sece.ac.in'), esc('2026-08-05 18:00:00+05:30'),
          boolSql(true), sub.userByEmail('academiccoordinator@sece.ac.in'), esc('2026-08-06 09:00:00+05:30'),
        ]);
      }
    }
    insertPlain(
      'marks_entry_locks',
      ['exam_id', 'department_id', 'is_locked', 'locked_by_user_id', 'locked_at', 'is_published', 'published_by_user_id', 'published_at'],
      rows
    );
  }

  line('-- exam_timetable_versions: one published version per batch for the CIA2 exam (institution-wide, department_id NULL)');
  for (const b of BATCHES) {
    const examExpr = sub.exam(b.name, 'CIA2', CURRENT_AY);
    insertGuardedExpr(
      'exam_timetable_versions',
      ['exam_id', 'department_id', 'version_number', 'status', 'created_by_user_id', 'published_by_user_id', 'published_at'],
      [examExpr, NUL(), num(1), esc('published'), sub.userByEmail('coe@sece.ac.in'), sub.userByEmail('coe@sece.ac.in'), esc('2026-09-10 10:00:00+05:30')],
      `exam_id = ${examExpr} AND department_id IS NULL AND version_number = 1`
    );
  }
  const ettVersionExpr = (batchName) =>
    `(SELECT id FROM exam_timetable_versions WHERE exam_id = ${sub.exam(batchName, 'CIA2', CURRENT_AY)} AND department_id IS NULL AND version_number = 1)`;

  line('-- exam_timetable: CIA2 slots for the section-A sample class per dept x batch, across all its real mapped subjects');
  {
    const rows = [];
    for (const d of DEPARTMENTS) {
      for (const b of BATCHES) {
        const codes = subjectsByDeptSem[d.code][b.currentSemester];
        const versionExprB = ettVersionExpr(b.name);
        codes.forEach((code, idx) => {
          const examDate = new Date(new Date(semesterDateRange(b.start, b.currentSemester).start).getTime() + (60 + idx) * 86400000)
            .toISOString().slice(0, 10);
          const period = TEACHING_PERIODS[idx % TEACHING_PERIODS.length];
          const esmExpr = sub.examSubjMap(b.name, 'CIA2', d.code, 'A', code, CURRENT_AY);
          rows.push([
            esmExpr, esc(examDate), esc(period.start), esc(period.end), versionExprB, esc('FN'), sub.venue(VENUES[idx % VENUES.length].name),
          ]);
        });
      }
    }
    insertPlain('exam_timetable', ['exam_subject_mapping_id', 'exam_date', 'start_time', 'end_time', 'version_id', 'session', 'venue_id'], rows);
  }

  line('-- revaluation_windows: one per CIA1 exam (per batch) — real fee structure reused from the already-real revaluation_requests');
  for (const b of BATCHES) {
    const examExpr = sub.exam(b.name, 'CIA1', CURRENT_AY);
    insertGuardedExpr(
      'revaluation_windows',
      ['exam_id', 'application_type', 'is_open', 'opens_at', 'closes_at', 'fee_per_paper', 'photocopy_fee_per_paper', 'max_papers_per_student', 'created_by_user_id'],
      [
        examExpr, esc('photocopy_and_reval'), boolSql(true), esc('2026-08-07 09:00:00+05:30'), esc('2026-08-14 17:00:00+05:30'),
        num(200), num(50), num(3), sub.userByEmail('coe@sece.ac.in'),
      ],
      `exam_id = ${examExpr}`
    );
  }

  line('-- malpractice_incidents: one per batch, tied to a real CIA1 exam_subject_mapping + a real currently-enrolled student');
  {
    const rows = [];
    for (const b of BATCHES) {
      const d = DEPARTMENTS[0];
      const code = subjectsByDeptSem[d.code][b.currentSemester][0];
      const s = students.find((st) => st.deptCode === d.code && st.batchName === b.name && st.section === 'A');
      const fscList = fscMappingByClassKey[`${d.code}|${b.name}|A`];
      const teacherEntry = fscList.find((e) => e.subjectCode === code);
      rows.push([
        sub.studentByRegNo(s.regNo), sub.exam(b.name, 'CIA1', CURRENT_AY),
        sub.examSubjMap(b.name, 'CIA1', d.code, 'A', code, CURRENT_AY), NUL(),
        esc('2026-08-04'), esc('FN'), esc('S-001'), esc('mobile_device'), esc('warning_issued'),
        esc('Mobile phone found in possession during examination; confiscated and warning issued.'),
        sub.facultyByStaffCode(teacherEntry.staffCode), sub.userByEmail('coe@sece.ac.in'),
      ]);
    }
    insertPlain(
      'malpractice_incidents',
      ['student_id', 'exam_id', 'exam_subject_mapping_id', 'venue_id', 'incident_date', 'session', 'seat_number',
        'nature', 'action_taken', 'invigilator_remarks', 'reported_by_faculty_id', 'recorded_by_user_id'],
      rows
    );
  }

  line('-- hall_ticket_clearance_exceptions: a couple of real students granted a fee-due exception for the University End Semester exam');
  {
    for (const b of BATCHES.slice(0, 2)) {
      const s = students.find((st) => st.batchName === b.name && st.section === 'B');
      const examExpr = sub.exam(b.name, 'University End Semester Exam', CURRENT_AY);
      const stuExpr = sub.studentByRegNo(s.regNo);
      insertGuardedExpr(
        'hall_ticket_clearance_exceptions',
        ['student_id', 'exam_id', 'clearance_type', 'reason', 'status', 'reviewed_by_hod_user_id', 'reviewed_at', 'valid_until'],
        [
          stuExpr, examExpr, esc('fee_due'), esc('Partial fee payment pending; hall ticket exception granted on parent undertaking letter.'),
          esc('approved'), sub.userByEmail(DEPARTMENTS.find((dd) => dd.code === s.deptCode).hod.email),
          esc('2026-08-20 11:00:00+05:30'), esc('2026-12-31'),
        ],
        `student_id = ${stuExpr} AND exam_id = ${examExpr} AND clearance_type = 'fee_due'`
      );
    }
  }

  line('-- seating_plan_venue_departments: link each batch\'s real PART-6 seating_plan_version_venues row to its 10 real departments');
  {
    const rows = [];
    for (const b of BATCHES) {
      const venueName = VENUES[BATCHES.findIndex((bb) => bb.name === b.name) % VENUES.length].name;
      const { end } = semesterDateRange(b.start, b.currentSemester);
      const examDate = new Date(new Date(end).getTime() - 10 * 86400000).toISOString().slice(0, 10);
      const versionExprB = `(SELECT id FROM seating_plan_versions WHERE exam_id = ${sub.exam(b.name, 'University End Semester Exam', CURRENT_AY)} AND exam_date = ${esc(examDate)} AND session = 'FN' AND version_number = 1)`;
      const versionVenueExpr = `(SELECT id FROM seating_plan_version_venues WHERE version_id = ${versionExprB} AND venue_id = ${sub.venue(venueName)})`;
      for (const d of DEPARTMENTS) {
        insertGuardedExpr(
          'seating_plan_venue_departments', ['version_venue_id', 'department_id'],
          [versionVenueExpr, sub.dept(d.code)],
          `version_venue_id = ${versionVenueExpr} AND department_id = ${sub.dept(d.code)}`
        );
      }
    }
  }

  line('-- marksheets: real published CIA1 exam, 2-of-15-students/class sample (plain generated-document record, no derived fields in schema)');
  {
    const rows = [];
    for (const d of DEPARTMENTS) {
      for (const b of BATCHES) {
        for (const section of ['A', 'B', 'C', 'D']) {
          const sample = students.filter((s) => s.deptCode === d.code && s.batchName === b.name && s.section === section).slice(0, 2);
          const examExpr = sub.exam(b.name, 'CIA1', CURRENT_AY);
          for (const s of sample) {
            rows.push([examExpr, sub.studentByRegNo(s.regNo), esc(`https://placeholder.sece.ac.in/marksheets/${s.regNo}-cia1.pdf`)]);
          }
        }
      }
    }
    insertPlain('marksheets', ['exam_id', 'student_id', 'file_url'], rows);
  }
}
blank();

// ---------------------------------------------------------------------------
// CLUSTER 4: MEDICAL CENTRE REMAINDER
// medical_visits (student + faculty walk-ins against the real medical_staff
// from the earlier MEDICAL CENTRE block), medical_bills + medical_bill_items
// (a handful of billed visits), medical_camps (a few planned/past camps),
// pharmacy_stock + pharmacy_dispense_log (a small real-shaped drug stock with
// dispense history tied to visits), sick_room_beds + sick_room_stays (a
// couple of beds with open/closed stays linked to visits), ambulance_status
// (one vehicle) + ambulance_trips (a couple of historical trips).
// ---------------------------------------------------------------------------
line('-- ===========================================================================');
line('-- CLUSTER 4: MEDICAL CENTRE REMAINDER');
line('-- ===========================================================================');
{
  const MED_STAFF_NAMES = ['Dr. Meena Sundaram', 'Dr. Karthik Raman', 'Ms. Priya Dharshini', 'Mr. Selvam Kumar'];

  // medical_visits: a small sample of student + faculty visits
  line('-- medical_visits');
  const visitSamples = []; // keep track for reuse by bills / sick_room_stays
  {
    const rows = [];
    const reasons = [
      ['Fever and headache', 'Viral fever', 'Paracetamol given, advised rest'],
      ['Minor cut on hand', 'Superficial laceration', 'Wound cleaned and dressed'],
      ['Stomach ache', 'Mild gastritis', 'Antacid given'],
      ['Sports injury - ankle sprain', 'Grade 1 ankle sprain', 'Ice pack applied, rest advised'],
      ['Dizziness', 'Mild dehydration', 'ORS given, observed for 30 minutes'],
    ];
    let n = 0;
    for (const d of DEPARTMENTS.slice(0, 5)) {
      const s = students.find((st) => st.deptCode === d.code);
      if (!s) continue;
      const [reason, diagnosis, treatment] = reasons[n % reasons.length];
      const staffName = MED_STAFF_NAMES[n % MED_STAFF_NAMES.length];
      visitSamples.push({ kind: 'student', regNo: s.regNo, reason, diagnosis, treatment, staffName });
      rows.push([
        esc('student'), sub.studentByRegNo(s.regNo), NUL(), esc('2026-08-' + String(10 + n).padStart(2, '0')),
        esc(reason), esc(diagnosis), esc(treatment), boolSql(false), sub.medicalStaffByName(staffName), esc('done'),
      ]);
      n++;
    }
    for (const f of facultyRoster.slice(0, 2)) {
      const [reason, diagnosis, treatment] = reasons[n % reasons.length];
      const staffName = MED_STAFF_NAMES[n % MED_STAFF_NAMES.length];
      visitSamples.push({ kind: 'faculty', staffCode: f.staffCode, reason, diagnosis, treatment, staffName });
      rows.push([
        esc('faculty'), NUL(), sub.facultyByStaffCode(f.staffCode), esc('2026-08-' + String(10 + n).padStart(2, '0')),
        esc(reason), esc(diagnosis), esc(treatment), boolSql(false), sub.medicalStaffByName(staffName), esc('done'),
      ]);
      n++;
    }
    insertPlain(
      'medical_visits',
      ['visitor_type', 'student_id', 'faculty_id', 'visit_date', 'reason', 'diagnosis', 'treatment_given', 'referred_to_hospital', 'attended_by_staff_id', 'status'],
      rows
    );
  }

  // medical_bills + medical_bill_items: bill 2 of the student visits
  line('-- medical_bills + medical_bill_items');
  {
    const billed = visitSamples.filter((v) => v.kind === 'student').slice(0, 2);
    for (const v of billed) {
      const s = students.find((st) => st.regNo === v.regNo);
      const dept = DEPARTMENTS.find((d) => d.code === s.deptCode);
      const medTotal = 50; const svcTotal = 100; const total = medTotal + svcTotal;
      insertGuardedExpr(
        'medical_bills',
        ['patient_name', 'patient_dept', 'condition', 'attended_by_staff_id', 'payment_mode', 'status', 'medicine_total', 'service_total', 'total'],
        [
          esc(`${s.firstName} ${s.lastName}`), esc(dept.name), esc(v.diagnosis), sub.medicalStaffByName(v.staffName),
          esc('cash'), esc('paid'), num(medTotal), num(svcTotal), num(total),
        ],
        `patient_name = ${esc(`${s.firstName} ${s.lastName}`)} AND condition = ${esc(v.diagnosis)}`
      );
      const billExpr = `(SELECT id FROM medical_bills WHERE patient_name = ${esc(`${s.firstName} ${s.lastName}`)} AND condition = ${esc(v.diagnosis)})`;
      insertGuardedExpr(
        'medical_bill_items', ['bill_id', 'item_type', 'description', 'quantity', 'rate', 'amount'],
        [billExpr, esc('medicine'), esc('Paracetamol 500mg (strip of 10)'), num(1), num(50), num(50)],
        `bill_id = ${billExpr} AND description = 'Paracetamol 500mg (strip of 10)'`
      );
      insertGuardedExpr(
        'medical_bill_items', ['bill_id', 'item_type', 'description', 'quantity', 'rate', 'amount'],
        [billExpr, esc('service'), esc('General Consultation'), num(1), num(100), num(100)],
        `bill_id = ${billExpr} AND description = 'General Consultation'`
      );
    }
  }

  // medical_camps
  line('-- medical_camps');
  {
    const camps = [
      ['Annual General Health Checkup Camp', 'Free general health checkup for all students', '2026-09-15', 'planning', 500, 0, false, null],
      ['Blood Donation Camp', 'In association with Coimbatore Medical College blood bank', '2026-10-02', 'planning', 200, 0, false, null],
      // state has no 'completed' value in the real check constraint (running,
      // scheduled, planning) — a finished camp is represented by is_past +
      // outcome_summary, so this past camp stays 'scheduled'.
      ['Eye Checkup Camp', 'Free eye checkup and spectacles for needy students', '2026-03-10', 'scheduled', 300, 268, true, 'Screened 268 students, 42 referred for spectacles'],
    ];
    for (const [title, detail, date, state, target, registered, isPast, outcome] of camps) {
      insertGuardedRow(
        'medical_camps',
        ['title', 'detail', 'camp_date', 'state', 'target_count', 'registered_count', 'is_past', 'outcome_summary'],
        [esc(title), esc(detail), esc(date), esc(state), num(target), num(registered), boolSql(isPast), outcome ? esc(outcome) : NUL()],
        'title', title
      );
    }
  }

  // pharmacy_stock + pharmacy_dispense_log
  line('-- pharmacy_stock + pharmacy_dispense_log');
  {
    const stock = [
      ['Paracetamol 500mg', 'Fever, pain relief', 'Tablet', 500, 50, '2027-06-30', 2.5],
      ['ORS Sachets', 'Dehydration', 'Sachet', 200, 30, '2027-12-31', 10],
      ['Antiseptic Cream', 'Wound care', 'Cream', 60, 10, '2028-01-31', 45],
      ['Cetirizine 10mg', 'Allergy', 'Tablet', 300, 40, '2027-08-31', 1.5],
      ['Crepe Bandage', 'Sprain/dressing', 'Roll', 100, 15, null, 25],
    ];
    for (const [name, useCase, form, qty, reorder, expiry, rate] of stock) {
      insertGuardedExpr(
        'pharmacy_stock', ['name', 'use_case', 'form', 'quantity', 'reorder_level', 'expiry_date', 'rate'],
        [esc(name), esc(useCase), esc(form), num(qty), num(reorder), expiry ? esc(expiry) : NUL(), num(rate)],
        `name = ${esc(name)}`
      );
    }
    const dispenseExpr = (name) => `(SELECT id FROM pharmacy_stock WHERE name = ${esc(name)})`;
    const dispenseRows = [
      [dispenseExpr('Paracetamol 500mg'), 10],
      [dispenseExpr('ORS Sachets'), 5],
      [dispenseExpr('Antiseptic Cream'), 1],
    ];
    insertPlain('pharmacy_dispense_log', ['stock_id', 'quantity'], dispenseRows);
  }

  // sick_room_beds + sick_room_stays
  line('-- sick_room_beds + sick_room_stays');
  {
    // wing must be one of the real check-constraint values: ladies, gents.
    const beds = [['SR-01', 'gents'], ['SR-02', 'gents'], ['SR-03', 'ladies']];
    for (const [code, wing] of beds) {
      insertGuardedRow('sick_room_beds', ['bed_code', 'wing'], [esc(code), esc(wing)], 'bed_code', code);
    }
    const firstVisit = visitSamples.find((v) => v.kind === 'student');
    const visitExpr = firstVisit
      ? `(SELECT id FROM medical_visits WHERE visitor_type = 'student' AND student_id = ${sub.studentByRegNo(firstVisit.regNo)} AND reason = ${esc(firstVisit.reason)})`
      : NUL();
    line('-- sick_room_stays: one closed stay + one currently-open stay');
    const bedExpr = (code) => `(SELECT id FROM sick_room_beds WHERE bed_code = ${esc(code)})`;
    insertGuardedExpr(
      'sick_room_stays',
      ['bed_id', 'visit_id', 'reason', 'vitals', 'medication_given', 'guardian_contacted', 'plan', 'admitted_at', 'expected_review_at', 'discharged_at'],
      [
        bedExpr('SR-01'), visitExpr, esc('Fever, advised rest under observation'), esc('Temp 100.2F, BP 110/70'),
        esc('Paracetamol 500mg'), boolSql(true), esc('Discharge after 2 hours if temp normalizes'),
        esc('2026-08-10 10:00:00+05:30'), esc('2026-08-10 12:00:00+05:30'), esc('2026-08-10 12:30:00+05:30'),
      ],
      `bed_id = ${bedExpr('SR-01')} AND admitted_at = '2026-08-10 10:00:00+05:30'`
    );
    insertGuardedExpr(
      'sick_room_stays',
      ['bed_id', 'visit_id', 'reason', 'vitals', 'medication_given', 'guardian_contacted', 'plan', 'admitted_at', 'expected_review_at', 'discharged_at'],
      [
        bedExpr('SR-02'), NUL(), esc('Observation after minor sports injury'), esc('BP 118/76, pulse 78'),
        esc('Ibuprofen 400mg'), boolSql(false), esc('Review after 1 hour, discharge if stable'),
        esc('2026-08-21 16:00:00+05:30'), esc('2026-08-21 18:00:00+05:30'), NUL(),
      ],
      `bed_id = ${bedExpr('SR-02')} AND admitted_at = '2026-08-21 16:00:00+05:30'`
    );
  }

  // ambulance_status + ambulance_trips
  line('-- ambulance_status + ambulance_trips');
  {
    insertGuardedRow(
      'ambulance_status',
      ['vehicle_number', 'driver_staff_id', 'oxygen_cylinder_status', 'status'],
      [esc('TN-38-AM-1234'), sub.medicalStaffByName('Mr. Selvam Kumar'), esc('full'), esc('on_call')],
      'vehicle_number', 'TN-38-AM-1234'
    );
    const trips = [
      ['Student fall from stairs, suspected fracture', 'Referred to Coimbatore Medical College Hospital', 'referred', '2026-05-14 14:20:00+05:30'],
      ['Faculty member chest pain complaint', 'Stabilized on campus, taken to hospital as precaution', 'referred', '2026-07-02 09:10:00+05:30'],
    ];
    const rows = trips.map(([summary, detail, outcome, occurredAt]) => [esc(summary), esc(detail), esc(outcome), esc(occurredAt)]);
    insertPlain('ambulance_trips', ['case_summary', 'detail', 'outcome', 'occurred_at'], rows);
  }
}
blank();

// ===========================================================================
// CLUSTER 5 — OD workflow + project/team module
// ===========================================================================
line('-- ===========================================================================');
line('-- CLUSTER 5: OD requests/teams + project teams/recruitment/join-requests');
line('-- ===========================================================================');
{
  const csA = students.filter((s) => s.deptCode === 'CS' && s.batchName === '2024-2028' && s.section === 'A');
  const csB = students.filter((s) => s.deptCode === 'CS' && s.batchName === '2024-2028' && s.section === 'B');
  const csFac = facultyRoster.filter((f) => f.deptCode === 'CS' && !f.isHod);

  // od_teams (2 teams; one cross-dept-free, one same-dept trip)
  const odTeamRows = [
    ['ODT-2026-CS-001', csA[0].regNo, false, 'Robotics Workshop Team', 'Attending inter-college robotics workshop', 'Kumaraguru College of Technology, Coimbatore', '2026-08-25', '2026-08-25', '09:00:00+05:30', '17:00:00+05:30', csFac[0].staffCode],
    ['ODT-2026-CS-002', csB[0].regNo, true, 'Paper Presentation Team', 'IEEE conference paper presentation', 'PSG College of Technology, Coimbatore', '2026-09-10', '2026-09-11', '08:00:00+05:30', '18:00:00+05:30', csFac[1].staffCode],
  ];
  for (const [code, leaderRegNo, locked, teamName, reason, venue, fromDate, toDate, fromTime, toTime, staffCode] of odTeamRows) {
    insertGuardedExpr(
      'od_teams',
      ['created_by_student_id', 'unique_code', 'is_locked', 'team_name', 'reason', 'venue', 'from_date', 'to_date', 'from_time', 'to_time', 'faculty_guide_id'],
      [sub.studentByRegNo(leaderRegNo), esc(code), boolSql(locked), esc(teamName), esc(reason), esc(venue), esc(fromDate), esc(toDate), esc(fromTime), esc(toTime), sub.facultyByStaffCode(staffCode)],
      `unique_code = ${esc(code)}`
    );
  }
  const odTeamExpr = (code) => `(SELECT id FROM od_teams WHERE unique_code = ${esc(code)})`;

  // od_team_members
  const memberRows = [
    [odTeamExpr('ODT-2026-CS-001'), csA[0].regNo],
    [odTeamExpr('ODT-2026-CS-001'), csA[1].regNo],
    [odTeamExpr('ODT-2026-CS-001'), csA[2].regNo],
    [odTeamExpr('ODT-2026-CS-002'), csB[0].regNo],
    [odTeamExpr('ODT-2026-CS-002'), csB[1].regNo],
  ];
  for (const [teamExpr, regNo] of memberRows) {
    insertGuardedExpr(
      'od_team_members', ['team_id', 'student_id'], [teamExpr, sub.studentByRegNo(regNo)],
      `team_id = ${teamExpr} AND student_id = ${sub.studentByRegNo(regNo)}`
    );
  }

  // od_requests (one per team)
  const odReqRows = [
    ['ODT-2026-CS-001', '2026-08-25', '2026-08-25', 'Robotics Workshop Team', 'approved', csFac[0].staffCode, 'Kumaraguru College of Technology, Coimbatore', 'verified'],
    ['ODT-2026-CS-002', '2026-09-10', '2026-09-11', 'Paper Presentation Team', 'pending', csFac[1].staffCode, 'PSG College of Technology, Coimbatore', 'awaiting_documents'],
  ];
  for (const [teamCode, fromDate, toDate, reason, mentorStatus, staffCode, org, verifStatus] of odReqRows) {
    insertGuardedExpr(
      'od_requests',
      ['team_id', 'from_date', 'to_date', 'reason', 'mentor_approval_status', 'faculty_guide_id', 'organization', 'verification_status'],
      [odTeamExpr(teamCode), esc(fromDate), esc(toDate), esc(reason), esc(mentorStatus), sub.facultyByStaffCode(staffCode), esc(org), esc(verifStatus)],
      `team_id = ${odTeamExpr(teamCode)} AND from_date = ${esc(fromDate)} AND reason = ${esc(reason)}`
    );
  }
  const odReqExpr = (teamCode, reason) => `(SELECT id FROM od_requests WHERE team_id = ${odTeamExpr(teamCode)} AND reason = ${esc(reason)})`;

  // od_request_hod_approvals: cross-dept team (ODT-2026-CS-002 has an EC member -> HOD approval needed)
  const ecFirstStudent = students.find((s) => s.deptCode === 'EC');
  if (ecFirstStudent) {
    insertGuardedExpr(
      'od_team_members', ['team_id', 'student_id'], [odTeamExpr('ODT-2026-CS-002'), sub.studentByRegNo(ecFirstStudent.regNo)],
      `team_id = ${odTeamExpr('ODT-2026-CS-002')} AND student_id = ${sub.studentByRegNo(ecFirstStudent.regNo)}`
    );
    const ecHod = facultyRoster.find((f) => f.deptCode === 'EC' && f.isHod);
    insertGuardedExpr(
      'od_request_hod_approvals',
      ['od_request_id', 'student_id', 'department_id', 'hod_user_id', 'status'],
      [odReqExpr('ODT-2026-CS-002', 'Paper Presentation Team'), sub.studentByRegNo(ecFirstStudent.regNo), sub.dept('EC'), sub.userByEmail(ecHod.email), esc('pending')],
      `od_request_id = ${odReqExpr('ODT-2026-CS-002', 'Paper Presentation Team')} AND student_id = ${sub.studentByRegNo(ecFirstStudent.regNo)}`
    );
  }

  // project_teams + project_team_members + project_recruitment_posts + project_join_requests
  const teamName1 = 'Smart Campus IoT Team';
  const teamName2 = 'AI Chatbot Squad';
  insertGuardedExpr(
    'project_teams',
    ['team_name', 'project_title', 'project_description', 'leader_student_id', 'class_id', 'batch_id', 'department_id', 'max_members', 'current_members', 'status'],
    [
      esc(teamName1), esc('Smart Campus IoT Monitoring System'), esc('An IoT-based system to monitor campus energy and occupancy in real time'),
      sub.studentByRegNo(csA[0].regNo), sub.classByKey('2024-2028', 'CS', 'A'), sub.batch('2024-2028'), sub.dept('CS'), num(5), num(3), esc('OPEN'),
    ],
    `team_name = ${esc(teamName1)}`
  );
  insertGuardedExpr(
    'project_teams',
    ['team_name', 'project_title', 'project_description', 'leader_student_id', 'class_id', 'batch_id', 'department_id', 'max_members', 'current_members', 'status'],
    [
      esc(teamName2), esc('AI-Powered Campus Helpdesk Chatbot'), esc('An NLP chatbot to answer common student queries about campus services'),
      sub.studentByRegNo(csB[0].regNo), sub.classByKey('2024-2028', 'CS', 'B'), sub.batch('2024-2028'), sub.dept('CS'), num(4), num(2), esc('OPEN'),
    ],
    `team_name = ${esc(teamName2)}`
  );
  const projTeamExpr = (name) => `(SELECT id FROM project_teams WHERE team_name = ${esc(name)})`;

  const teamMemberRows = [
    [projTeamExpr(teamName1), csA[0].regNo, 'LEADER'],
    [projTeamExpr(teamName1), csA[1].regNo, 'MEMBER'],
    [projTeamExpr(teamName1), csA[2].regNo, 'MEMBER'],
    [projTeamExpr(teamName2), csB[0].regNo, 'LEADER'],
    [projTeamExpr(teamName2), csB[1].regNo, 'MEMBER'],
  ];
  for (const [teamExpr, regNo, role] of teamMemberRows) {
    insertGuardedExpr(
      'project_team_members', ['team_id', 'student_id', 'role'], [teamExpr, sub.studentByRegNo(regNo), esc(role)],
      `team_id = ${teamExpr} AND student_id = ${sub.studentByRegNo(regNo)}`
    );
  }

  insertGuardedExpr(
    'project_recruitment_posts',
    ['team_id', 'title', 'description', 'vacancies', 'required_skills', 'deadline', 'status'],
    [
      projTeamExpr(teamName1), esc('Looking for embedded/firmware developer'), esc('Need a member comfortable with ESP32 and MQTT for the sensor layer'),
      num(2), `ARRAY['Embedded C', 'IoT', 'MQTT']::text[]`, esc('2026-09-05'), esc('ACTIVE'),
    ],
    `team_id = ${projTeamExpr(teamName1)} AND title = ${esc('Looking for embedded/firmware developer')}`
  );

  const applicant = csA[3];
  insertGuardedExpr(
    'project_join_requests',
    ['team_id', 'student_id', 'message', 'status'],
    [projTeamExpr(teamName1), sub.studentByRegNo(applicant.regNo), esc('I have worked with ESP32 boards in a personal project and would like to join.'), esc('PENDING')],
    `team_id = ${projTeamExpr(teamName1)} AND student_id = ${sub.studentByRegNo(applicant.regNo)}`
  );

  // student_projects (mini/capstone project per a handful of students, mentor-guided)
  const spRows = [];
  for (const s of csA.slice(0, 4)) {
    const mentor = csFac[randInt(0, csFac.length - 1)];
    spRows.push([
      sub.studentByRegNo(s.regNo), esc('Smart Attendance System using Face Recognition'),
      esc('A mini project implementing a face-recognition-based attendance marking system'), sub.facultyByStaffCode(mentor.staffCode),
    ]);
  }
  insertPlain('student_projects', ['student_id', 'title', 'description', 'mentor_faculty_id'], spRows);
}
blank();

// ===========================================================================
// CLUSTER 6 — Department showcase
// ===========================================================================
line('-- ===========================================================================');
line('-- CLUSTER 6: Department achievements/media/comments, documents, events, labs, meetings, MOUs, research funding');
line('-- ===========================================================================');
{
  const showcaseDepts = ['CS', 'AI', 'EC', 'ME'];

  // department_achievements + achievement_media + achievement_comments
  const achievements = [
    ['CS', 'Best Paper Award at IEEE ICCCI 2026', 'A team of final-year students won the best paper award for their work on federated learning.', '2026-06-12'],
    ['AI', 'Smart India Hackathon Grand Finalist', 'AI & ML department team qualified as grand finalists in Smart India Hackathon 2026.', '2026-03-20'],
    ['EC', 'Patent Filed for Low-Power IoT Sensor Node', 'Faculty and student team filed a patent for an energy-efficient IoT sensor node design.', '2026-02-05'],
    ['ME', 'National Level Go-Kart Championship — 2nd Place', 'The Mechanical department racing team secured second place at the national go-kart championship.', '2026-01-18'],
  ];
  for (const [deptCode, title, description, date] of achievements) {
    const hod = facultyRoster.find((f) => f.deptCode === deptCode && f.isHod);
    insertGuardedExpr(
      'department_achievements',
      ['department_id', 'posted_by_user_id', 'title', 'description', 'achievement_date'],
      [sub.dept(deptCode), sub.userByEmail(hod.email), esc(title), esc(description), esc(date)],
      `title = ${esc(title)}`
    );
  }
  const achExpr = (title) => `(SELECT id FROM department_achievements WHERE title = ${esc(title)})`;

  for (const [, title] of achievements) {
    insertGuardedExpr(
      'achievement_media',
      ['achievement_id', 'media_type', 'media_url', 'thumbnail_url', 'sequence_no'],
      [achExpr(title), esc('photo'), esc('https://cdn.sece.ac.in/achievements/' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '/photo-1.jpg'), NUL(), num(1)],
      `achievement_id = ${achExpr(title)} AND sequence_no = 1`
    );
  }

  const commentAuthor = facultyRoster.find((f) => f.deptCode === 'CS' && !f.isHod);
  insertGuardedExpr(
    'achievement_comments',
    ['achievement_id', 'commented_by_user_id', 'comment_text'],
    [achExpr(achievements[0][1]), sub.userByEmail(commentAuthor.email), esc('Congratulations to the whole team, well deserved!')],
    `achievement_id = ${achExpr(achievements[0][1])} AND comment_text = ${esc('Congratulations to the whole team, well deserved!')}`
  );

  // department_documents
  const docs = [
    ['CS', 'NBA Accreditation Self-Assessment Report 2026', 'accreditation', 'verified'],
    ['AI', 'Board of Studies Meeting Minutes - Aug 2026', 'academic', 'pending'],
    ['EC', 'Lab Equipment Inventory 2026', 'infrastructure', 'verified'],
  ];
  for (const [deptCode, name, category, status] of docs) {
    const hod = facultyRoster.find((f) => f.deptCode === deptCode && f.isHod);
    insertGuardedExpr(
      'department_documents',
      ['department_id', 'name', 'category', 'file_url', 'status', 'uploaded_by_user_id'],
      [
        sub.dept(deptCode), esc(name), esc(category),
        esc('https://cdn.sece.ac.in/dept-docs/' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf'),
        esc(status), sub.userByEmail(hod.email),
      ],
      `department_id = ${sub.dept(deptCode)} AND name = ${esc(name)}`
    );
  }

  // department_events
  const events = [
    ['CS', 'TechFest 2026 - Code Sprint', 'technical', 'Sept 2026', 'planning', 0, 150],
    ['AI', 'AI/ML Symposium 2026', 'symposium', 'Oct 2026', 'approved', 40, 200],
    ['ME', 'Automobile Design Workshop', 'workshop', 'Nov 2026', 'planning', 0, 80],
  ];
  for (const [deptCode, title, kind, eventDate, status, regs, capacity] of events) {
    const hod = facultyRoster.find((f) => f.deptCode === deptCode && f.isHod);
    insertGuardedExpr(
      'department_events',
      ['department_id', 'title', 'kind', 'event_date', 'status', 'registrations', 'capacity', 'created_by_user_id'],
      [sub.dept(deptCode), esc(title), esc(kind), esc(eventDate), esc(status), num(regs), num(capacity), sub.userByEmail(hod.email)],
      `department_id = ${sub.dept(deptCode)} AND title = ${esc(title)}`
    );
  }

  // department_labs
  const labs = [
    ['CS', 'Advanced Programming Lab', 60, 'operational'],
    ['AI', 'Deep Learning & GPU Lab', 30, 'operational'],
    ['EC', 'VLSI Design Lab', 40, 'operational'],
    ['ME', 'CAD/CAM Lab', 35, 'operational'],
  ];
  for (const [deptCode, name, systemsCount, status] of labs) {
    const inchargeFac = facultyRoster.find((f) => f.deptCode === deptCode && !f.isHod);
    insertGuardedExpr(
      'department_labs',
      ['department_id', 'name', 'incharge_faculty_id', 'systems_count', 'status'],
      [sub.dept(deptCode), esc(name), sub.facultyByStaffCode(inchargeFac.staffCode), num(systemsCount), esc(status)],
      `department_id = ${sub.dept(deptCode)} AND name = ${esc(name)}`
    );
  }

  // department_meetings + (reuse) meeting_action_items handled in cluster 7 note; keep minimal FK-safe meeting here
  const meetings = [
    ['CS', 'Department Curriculum Review Meeting', '2026-08-05 15:00:00+05:30', 'Seminar Hall, CS Block', 'recorded', 'Discussed curriculum updates for AY 2026-2027. Action items assigned.'],
    ['AI', 'Placement Readiness Review', '2026-08-18 11:00:00+05:30', 'AI Dept Conference Room', 'scheduled', null],
  ];
  for (const [deptCode, title, meetingAt, venue, momStatus, momText] of meetings) {
    const hod = facultyRoster.find((f) => f.deptCode === deptCode && f.isHod);
    insertGuardedExpr(
      'department_meetings',
      ['department_id', 'title', 'meeting_at', 'venue', 'chair_user_id', 'invitee_count', 'mom_status', 'mom_text', 'created_by_user_id'],
      [
        sub.dept(deptCode), esc(title), esc(meetingAt), esc(venue), sub.userByEmail(hod.email), num(12), esc(momStatus),
        momText ? esc(momText) : NUL(), sub.userByEmail(hod.email),
      ],
      `department_id = ${sub.dept(deptCode)} AND title = ${esc(title)} AND meeting_at = ${esc(meetingAt)}`
    );
  }

  // department_mous
  const mous = [
    ['CS', 'Infosys Campus Connect', '2024-01-15', '2027-01-14', 'active'],
    ['AI', 'NVIDIA AI Center of Excellence', '2025-07-01', '2028-06-30', 'active'],
    ['EC', 'Texas Instruments India Innovation Lab', '2023-09-01', '2026-08-31', 'active'],
  ];
  for (const [deptCode, partnerName, signedDate, validUntil, status] of mous) {
    insertGuardedExpr(
      'department_mous',
      ['department_id', 'partner_name', 'signed_date', 'valid_until', 'status'],
      [sub.dept(deptCode), esc(partnerName), esc(signedDate), esc(validUntil), esc(status)],
      `department_id = ${sub.dept(deptCode)} AND partner_name = ${esc(partnerName)}`
    );
  }

  // department_research_funding
  const funding = [
    ['CS', 'Federated Learning for Privacy-Preserving Healthcare Analytics', 'DST-SERB', 1850000, '2025-11-01', 'ongoing'],
    ['AI', 'AI-Driven Precision Agriculture for Tamil Nadu Farmers', 'AICTE-RPS', 950000, '2026-02-01', 'ongoing'],
    ['ME', 'Low-Cost Solar-Powered Irrigation Pump Design', 'TNSCST', 480000, '2025-06-01', 'completed'],
  ];
  for (const [deptCode, title, agency, amount, sanctionedDate, status] of funding) {
    insertGuardedExpr(
      'department_research_funding',
      ['department_id', 'title', 'funding_agency', 'sanctioned_amount', 'sanctioned_date', 'status'],
      [sub.dept(deptCode), esc(title), esc(agency), num(amount), esc(sanctionedDate), esc(status)],
      `department_id = ${sub.dept(deptCode)} AND title = ${esc(title)}`
    );
  }
  line(`-- showcaseDepts referenced: ${showcaseDepts.join(', ')}`);
}
blank();

// ===========================================================================
// CLUSTER 7 — Scholarships + remaining per-student + misc admin
// ===========================================================================
line('-- ===========================================================================');
line('-- CLUSTER 7: scholarships, leaves, sensitive info, test scores, no-due, outpasses, meeting notes,');
line('-- health records, escalations, campus outing, bonafide, gate/visitor logs, transport notices,');
line('-- photocopy requests, meeting action items, calendars, coe_profiles, lesson plans, library, budget');
line('-- ===========================================================================');
{
  const csStudents = students.filter((s) => s.deptCode === 'CS' && s.batchName === '2024-2028' && s.section === 'A');
  const csFacNonHod = facultyRoster.filter((f) => f.deptCode === 'CS' && !f.isHod);
  const csHod = facultyRoster.find((f) => f.deptCode === 'CS' && f.isHod);

  // scholarship_schemes + student_scholarship_awards
  const schemes = [
    ['First Graduate Scholarship', CURRENT_AY, 'government', 40000],
    ['Merit Scholarship - Top 5%', CURRENT_AY, 'merit', 120000],
    ['Sports Excellence Scholarship', CURRENT_AY, 'sports', 30000],
  ];
  for (const [name, ay, schemeType, totalValue] of schemes) {
    insertGuardedExpr(
      'scholarship_schemes',
      ['name', 'academic_year', 'status', 'scheme_type', 'applied_count', 'awarded_count', 'total_value'],
      [esc(name), esc(ay), esc('approved'), esc(schemeType), num(8), num(5), num(totalValue)],
      `name = ${esc(name)} AND academic_year = ${esc(ay)}`
    );
  }
  const schemeExpr = (name) => `(SELECT id FROM scholarship_schemes WHERE name = ${esc(name)} AND academic_year = ${esc(CURRENT_AY)})`;
  const fgStudents = csStudents.filter((s) => s.isFirstGraduate).slice(0, 2);
  const awardRows = [];
  for (const s of fgStudents) {
    awardRows.push([schemeExpr('First Graduate Scholarship'), sub.studentByRegNo(s.regNo), num(8000)]);
  }
  for (const s of csStudents.slice(2, 4)) {
    awardRows.push([schemeExpr('Merit Scholarship - Top 5%'), sub.studentByRegNo(s.regNo), num(24000)]);
  }
  for (const [schemeSub, studentSub, amount] of awardRows) {
    insertGuardedExpr(
      'student_scholarship_awards', ['scheme_id', 'student_id', 'amount'], [schemeSub, studentSub, amount],
      `scheme_id = ${schemeSub} AND student_id = ${studentSub}`
    );
  }

  // student_leaves
  const leaveRows = [];
  for (const [idx, s] of csStudents.slice(0, 3).entries()) {
    const mentor = csFacNonHod[idx % csFacNonHod.length];
    leaveRows.push([
      sub.studentByRegNo(s.regNo), esc('2026-08-01'), esc('2026-08-02'), esc('Family function'), esc('faculty_approved'),
      sub.facultyByStaffCode(mentor.staffCode), NUL(), boolSql(false), boolSql(false), NUL(),
    ]);
  }
  insertPlain(
    'student_leaves',
    ['student_id', 'from_date', 'to_date', 'reason', 'status', 'approved_by_faculty_id', 'approved_by_hod_user_id', 'also_on_hostel_leave', 'routed_to_warden', 'approved_by_warden_user_id'],
    leaveRows
  );

  // student_sensitive_info
  const sensRows = csStudents.slice(0, 5).map((s) => [sub.studentByRegNo(s.regNo), esc(randomAadhaar()), esc(randomPAN()), NUL(), NUL()]);
  for (const [studentSub, aadhar, pan, passport, passportValid] of sensRows) {
    insertGuardedExpr(
      'student_sensitive_info', ['student_id', 'aadhar_number', 'pan_number', 'passport_number', 'passport_valid_until'],
      [studentSub, aadhar, pan, passport, passportValid], `student_id = ${studentSub}`
    );
  }

  // student_test_scores
  const testRows = [];
  for (const s of csStudents.slice(0, 6)) {
    testRows.push([sub.studentByRegNo(s.regNo), esc('CGPA'), num((6.5 + rng() * 3).toFixed(2)), esc('2026-06-30')]);
    testRows.push([sub.studentByRegNo(s.regNo), esc('Aptitude'), num(randInt(60, 95)), esc('2026-07-15')]);
  }
  insertPlain('student_test_scores', ['student_id', 'test_name', 'score', 'test_date'], testRows);

  // student_no_due_status
  const noDueRows = csStudents.slice(0, 4).map((s) => [
    sub.studentByRegNo(s.regNo), esc(CURRENT_AY), boolSql(true), boolSql(true), boolSql(true), boolSql(true), boolSql(true),
    esc('2026-08-10 10:00:00+05:30'), sub.userByEmail(csHod.email),
  ]);
  for (const [studentSub, ay, lib, lab, fees, hostel, sports, issuedAt, issuedBy] of noDueRows) {
    insertGuardedExpr(
      'student_no_due_status',
      ['student_id', 'academic_year', 'library_cleared', 'laboratory_cleared', 'fees_cleared', 'hostel_cleared', 'sports_cleared', 'issued_at', 'issued_by_user_id'],
      [studentSub, ay, lib, lab, fees, hostel, sports, issuedAt, issuedBy],
      `student_id = ${studentSub} AND academic_year = ${ay}`
    );
  }

  // student_outpasses
  const opRows = csStudents.slice(0, 3).map((s, idx) => [
    sub.studentByRegNo(s.regNo), esc(idx === 0 ? 'medical' : 'personal'), esc('2026-08-20'), esc('10:00:00'), esc('16:00:00'),
    esc('Visit to town for personal work'), esc(randomMobile()), esc('approved'), sub.userByEmail(csHod.email), esc('2026-08-19 18:00:00+05:30'),
    sub.userByEmail(csHod.email),
  ]);
  for (const [studentSub, kind, date, fromT, toT, reason, contact, status, approvedBy, approvedAt, createdBy] of opRows) {
    insertGuardedExpr(
      'student_outpasses',
      ['student_id', 'kind', 'outpass_date', 'from_time', 'to_time', 'reason', 'parent_contact', 'status', 'approved_by_user_id', 'approved_at', 'created_by_user_id'],
      [studentSub, kind, date, fromT, toT, reason, contact, status, approvedBy, approvedAt, createdBy],
      `student_id = ${studentSub} AND outpass_date = ${date} AND from_time = ${fromT}`
    );
  }

  // student_meeting_notes
  const noteRows = csStudents.slice(0, 3).map((s) => [
    sub.studentByRegNo(s.regNo), esc('2026-08-05'), esc('Discussed academic progress and attendance; advised to attend extra classes for weak subjects.'),
    sub.userByEmail(csFacNonHod[0].email),
  ]);
  insertPlain('student_meeting_notes', ['student_id', 'meeting_date', 'note', 'recorded_by_user_id'], noteRows);

  // student_health_records
  const bloodGroups = ['A+', 'B+', 'O+', 'AB+', 'O-'];
  for (const [idx, s] of csStudents.slice(0, 5).entries()) {
    insertGuardedExpr(
      'student_health_records',
      ['student_id', 'blood_group', 'allergies', 'chronic_condition', 'guardian_name', 'guardian_phone'],
      [
        sub.studentByRegNo(s.regNo), esc(bloodGroups[idx % bloodGroups.length]), idx === 0 ? esc('Dust allergy') : NUL(),
        NUL(), esc(`${pick(FAC_LAST)} ${s.lastName}`), esc(randomMobile()),
      ],
      `student_id = ${sub.studentByRegNo(s.regNo)}`
    );
  }

  // student_escalations
  insertGuardedExpr(
    'student_escalations',
    ['student_id', 'class_id', 'title', 'status', 'owner_user_id', 'notes'],
    [
      sub.studentByRegNo(csStudents[0].regNo), sub.classByKey('2024-2028', 'CS', 'A'), esc('Repeated late submission of assignments'),
      esc('open'), sub.userByEmail(csFacNonHod[0].email), esc('Student counselled once; monitoring for improvement over the next two weeks.'),
    ],
    `title = ${esc('Repeated late submission of assignments')} AND student_id = ${sub.studentByRegNo(csStudents[0].regNo)}`
  );

  // campus_outing_requests
  const outingRows = csStudents.slice(0, 2).map((s, idx) => [
    sub.studentByRegNo(s.regNo), esc('2026-08-22'), esc('2026-08-22'), esc('14:00:00'), idx === 0 ? esc('18:00:00') : NUL(),
    esc('Shopping for hostel essentials'), esc(idx === 0 ? 'hod_approved' : 'pending'),
    sub.facultyByStaffCode(csFacNonHod[0].staffCode), idx === 0 ? sub.userByEmail(csHod.email) : NUL(),
  ]);
  for (const [studentSub, fromDate, toDate, startTime, returnTime, reason, status, facApp, hodApp] of outingRows) {
    insertGuardedExpr(
      'campus_outing_requests',
      ['student_id', 'from_date', 'to_date', 'start_time', 'return_time', 'reason', 'status', 'approved_by_faculty_id', 'approved_by_hod_user_id'],
      [studentSub, fromDate, toDate, startTime, returnTime, reason, status, facApp, hodApp],
      `student_id = ${studentSub} AND from_date = ${fromDate} AND start_time = ${startTime}`
    );
  }

  // bonafide_reasons + bonafide_requests
  const reasons = ['Bank Loan Purpose', 'Passport Application', 'Scholarship Application', 'Visa Application'];
  for (const r of reasons) {
    insertGuardedExpr('bonafide_reasons', ['reason_text'], [esc(r)], `reason_text = ${esc(r)}`);
  }
  const reasonExpr = (r) => `(SELECT id FROM bonafide_reasons WHERE reason_text = ${esc(r)})`;
  const bonafideRows = csStudents.slice(0, 3).map((s, idx) => [
    sub.studentByRegNo(s.regNo), reasonExpr(reasons[idx % reasons.length]), esc(idx === 0 ? 'issued' : 'pending'),
    idx === 0 ? esc('2026-08-10 12:00:00+05:30') : NUL(), idx === 0 ? esc('https://cdn.sece.ac.in/bonafide/' + s.regNo + '.pdf') : NUL(),
    sub.facultyByStaffCode(csFacNonHod[0].staffCode), idx === 0 ? sub.userByEmail(csHod.email) : NUL(),
  ]);
  insertPlain(
    'bonafide_requests',
    ['student_id', 'reason_id', 'status', 'issued_at', 'file_url', 'approved_by_faculty_id', 'issued_by_hod_user_id'],
    bonafideRows
  );

  // main_gate_in_out_ledger
  const gateRows = [];
  for (const s of csStudents.slice(0, 3)) {
    gateRows.push([sub.studentByRegNo(s.regNo), esc(s.regNo), esc('out'), esc('2026-08-22 08:30:00+05:30'), NUL(), boolSql(true), boolSql(false)]);
    gateRows.push([sub.studentByRegNo(s.regNo), esc(s.regNo), esc('in'), esc('2026-08-22 17:15:00+05:30'), NUL(), boolSql(false), boolSql(false)]);
  }
  insertPlain('main_gate_in_out_ledger', ['student_id', 'roll_no', 'entry_type', 'recorded_at', 'recorded_by_user_id', 'sms_sent_parent', 'sms_sent_student'], gateRows);

  // visitor_logs
  const visitorRows = [
    [esc('Ramesh Kumar'), esc('TN-38-BX-4521'), num(1), esc('Meeting HOD regarding admission enquiry'), esc(randomMobile()), esc('2026-08-20 11:00:00+05:30'), esc('2026-08-20 11:45:00+05:30')],
    [esc('Latha Suresh'), NUL(), num(2), esc('Vendor demo for lab equipment'), esc(randomMobile()), esc('2026-08-21 14:00:00+05:30'), NUL()],
  ];
  insertPlain('visitor_logs', ['visitor_name', 'vehicle_number', 'member_count', 'reason', 'phone_number', 'entry_time', 'exit_time'], visitorRows);

  // transport_notices
  const noticeRows = [
    [esc('ROUTE'), esc('Route 4 timing changed to 7:45 AM from Monday'), sub.userByEmail(csHod.email)],
    [esc('GENERAL'), esc('Bus fee for Q3 due by 30th August'), NUL()],
  ];
  insertPlain('transport_notices', ['tag', 'title', 'posted_by_user_id'], noticeRows);

  // photocopy_requests: dynamic pick of a real exam_marks row to keep FK valid
  line('-- photocopy_requests: dynamically bound to real exam_marks rows (set-based insert, guarded)');
  line(`INSERT INTO photocopy_requests (student_id, exam_marks_id, fee_amount, status)`);
  line(`SELECT em.student_id, em.id, 20.00, 'requested'`);
  line(`FROM exam_marks em`);
  line(`WHERE em.is_absent = FALSE`);
  line(`  AND NOT EXISTS (SELECT 1 FROM photocopy_requests pr WHERE pr.exam_marks_id = em.id)`);
  line(`ORDER BY em.id`);
  line(`LIMIT 3;`);
  blank();

  // meeting_action_items: attach to the real department_meetings row seeded in cluster 6
  const meetingExpr = `(SELECT id FROM department_meetings WHERE title = ${esc('Department Curriculum Review Meeting')} AND department_id = ${sub.dept('CS')})`;
  const actionItems = ['Update AI/ML elective syllabus by 10 Sept', 'Circulate revised timetable to all sections', 'Schedule industry expert guest lecture for odd semester'];
  for (const label of actionItems) {
    insertGuardedExpr(
      'meeting_action_items', ['meeting_id', 'label', 'done'], [meetingExpr, esc(label), boolSql(false)],
      `meeting_id = ${meetingExpr} AND label = ${esc(label)}`
    );
  }

  // personal_calendar_entries
  const pcRows = [
    [sub.userByEmail(csHod.email), esc('2026-08-25'), esc('Department budget review'), esc('meeting'), esc('Prepare budget utilization report')],
    [sub.userByEmail(csFacNonHod[0].email), esc('2026-08-28'), esc('Submit CIA2 question papers'), esc('deadline'), NUL()],
  ];
  insertPlain('personal_calendar_entries', ['user_id', 'entry_date', 'title', 'category', 'details'], pcRows);

  // coordinator_calendar_entries
  const ccRows = [
    [esc(CURRENT_AY), num(1), esc('2026-09-01'), esc('EVENT'), esc('Odd semester CIA1 exams begin')],
    [esc(CURRENT_AY), NUL(), esc('2026-10-02'), esc('LEAVE'), esc('Gandhi Jayanti Holiday')],
  ];
  insertPlain('coordinator_calendar_entries', ['academic_year', 'semester', 'entry_date', 'entry_type', 'title'], ccRows);

  // calendar_events: attach to an existing academic_calendars row (batch 2024-2028, semester 5)
  const acExpr = `(SELECT id FROM academic_calendars WHERE batch_id = ${sub.batch('2024-2028')} AND semester = 5)`;
  insertGuardedExpr(
    'calendar_events',
    ['academic_calendar_id', 'event_date', 'description', 'event_type', 'title'],
    [acExpr, esc('2026-08-30'), esc('Semester mid-term feedback collection window opens'), esc('event'), esc('Feedback Collection Window')],
    `academic_calendar_id = ${acExpr} AND title = ${esc('Feedback Collection Window')}`
  );

  // coe_profiles (2 senior COE staff accounts drawn from existing exam-cell-ish faculty emails)
  insertGuardedExpr(
    'coe_profiles', ['user_id', 'is_senior'], [sub.userByEmail('academiccoordinator@sece.ac.in'), boolSql(true)],
    `user_id = ${sub.userByEmail('academiccoordinator@sece.ac.in')}`
  );

  // lesson_plans + lesson_plan_sessions: dynamically bound to real faculty_subject_class_mapping rows
  line('-- lesson_plans: dynamically bound to real faculty_subject_class_mapping rows (set-based insert, guarded)');
  line(`INSERT INTO lesson_plans (faculty_id, subject_id, class_id, semester, content)`);
  line(`SELECT fscm.faculty_id, fscm.subject_id, fscm.class_id, c.current_semester, 'Standard lesson plan covering the prescribed syllabus units for the semester, aligned to the course outcomes.'`);
  line(`FROM faculty_subject_class_mapping fscm`);
  line(`JOIN classes c ON c.id = fscm.class_id`);
  line(`WHERE NOT EXISTS (`);
  line(`  SELECT 1 FROM lesson_plans lp WHERE lp.faculty_id = fscm.faculty_id AND lp.subject_id = fscm.subject_id AND lp.class_id = fscm.class_id AND lp.semester = c.current_semester`);
  line(`)`);
  line(`ORDER BY fscm.id`);
  line(`LIMIT 6;`);
  blank();

  line('-- lesson_plan_sessions: 3 sessions per lesson plan just seeded above (set-based insert, guarded)');
  line(`INSERT INTO lesson_plan_sessions (lesson_plan_id, session_date, unit_title, topic, is_covered, sequence_no)`);
  line(`SELECT lp.id, DATE '2026-07-15' + ((v.seq - 1) * 7), 'Unit ' || v.seq, 'Core topics for unit ' || v.seq || ' of the syllabus', v.seq <= 2, v.seq`);
  line(`FROM lesson_plans lp`);
  line(`CROSS JOIN (VALUES (1), (2), (3)) AS v(seq)`);
  line(`WHERE NOT EXISTS (`);
  line(`  SELECT 1 FROM lesson_plan_sessions s WHERE s.lesson_plan_id = lp.id AND s.sequence_no = v.seq`);
  line(`);`);
  blank();

  // library_racks + library_settings
  const racks = [
    ['RACK-A1', 8, 'Computer Science (004-006)'],
    ['RACK-A2', 8, 'Electronics & Communication (620-621)'],
    ['RACK-B1', 6, 'Mechanical Engineering (620-621)'],
    ['RACK-C1', 6, 'General / Reference'],
  ];
  for (const [code, shelves, range] of racks) {
    insertGuardedExpr('library_racks', ['rack_code', 'shelves', 'subject_range'], [esc(code), num(shelves), esc(range)], `rack_code = ${esc(code)}`);
  }
  line('-- library_settings: single-row configuration table');
  // updated_at is NOT NULL with no database default, so it must be supplied.
  line(`INSERT INTO library_settings (books_per_student, default_borrowing_days, max_renewals, renewal_extension_days, fine_per_day, lost_book_processing_fee, damaged_book_charge_rate, grace_period_days, block_issue_above_fine, barcode_format, spine_label_prefix, counter_opens_at, counter_closes_at, updated_at)`);
  line(`SELECT 3, 14, 2, 14, 5, 100, 0.40, 1, 200, 'CODE128', 'SECE-LIB', '09:00', '17:00', '2026-08-01 09:00:00'`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM library_settings);`);
  blank();

  // budget_allocations
  const budgetRows = [
    [esc('Sports Department'), esc(CURRENT_AY), num(1500000)],
    [esc('Central Library'), esc(CURRENT_AY), num(800000)],
    [esc('Computer Science Department'), esc(CURRENT_AY), num(2500000)],
  ];
  for (const [head, ay, amount] of budgetRows) {
    insertGuardedExpr('budget_allocations', ['head', 'academic_year', 'sanctioned_amount'], [head, ay, amount], `head = ${head} AND academic_year = ${ay}`);
  }
}
blank();

// ===========================================================================
// CLUSTER 8 — remaining sports/media/chat/hostel/misc
// ===========================================================================
line('-- ===========================================================================');
line('-- CLUSTER 8: sports equipment/fitness/injuries/trials/attendance/announcements/reports/team-mapping;');
line('-- media equipment/indents/requests/shoots/team; chat; push tokens; book borrow; bus logs;');
line('-- hostel night attendance/quit/settings/goods; service_orders; nba criteria/evidence');
line('-- ===========================================================================');
{
  const csHod2 = facultyRoster.find((f) => f.deptCode === 'CS' && f.isHod);
  const csFacNonHod2 = facultyRoster.filter((f) => f.deptCode === 'CS' && !f.isHod);
  const sampleStudents = shuffleCopy(students).slice(0, 8);
  const medStaffName = 'Dr. Priya Ramesh'; // matches an existing medical_staff row seeded earlier

  // --- sports_equipment + sports_equipment_issues ---
  const equipRows = [
    ['Basketballs (Spalding, size 7)', 'ball', 20, 'available'],
    ['Volleyball Nets', 'net', 6, 'available'],
    ['Athletics Starting Blocks', 'track', 8, 'available'],
  ];
  for (const [name, category, qty, status] of equipRows) {
    insertGuardedExpr(
      'sports_equipment', ['name', 'category', 'total_quantity', 'status', 'facility_id'],
      [esc(name), esc(category), num(qty), esc(status), sub.sportsFacility('Basketball Court')],
      `name = ${esc(name)}`
    );
  }
  const equipExpr = (name) => `(SELECT id FROM sports_equipment WHERE name = ${esc(name)})`;
  insertGuardedExpr(
    'sports_equipment_issues',
    ['equipment_id', 'issued_to_type', 'student_id', 'issued_date', 'status', 'due_date', 'remarks'],
    [equipExpr('Basketballs (Spalding, size 7)'), esc('student'), sub.studentByRegNo(sampleStudents[0].regNo), esc('2026-08-20'), esc('borrowed'), esc('2026-08-27'), esc('For inter-college practice sessions')],
    `equipment_id = ${equipExpr('Basketballs (Spalding, size 7)')} AND student_id = ${sub.studentByRegNo(sampleStudents[0].regNo)}`
  );

  // --- sports_fitness_tests ---
  for (const s of sampleStudents.slice(0, 3)) {
    insertGuardedExpr(
      'sports_fitness_tests', ['student_id', 'test_name', 'score', 'test_date', 'status', 'recorded_by_staff_id'],
      [sub.studentByRegNo(s.regNo), esc('BMI & Endurance Screening'), esc('BMI 21.4, 2.4km in 11:40'), esc('2026-08-05'), esc('fit'), sub.medicalStaffByName(medStaffName)],
      `student_id = ${sub.studentByRegNo(s.regNo)} AND test_name = ${esc('BMI & Endurance Screening')}`
    );
  }

  // --- sports_injuries ---
  insertGuardedExpr(
    'sports_injuries',
    ['incident_type', 'student_id', 'discipline_id', 'incident', 'incident_date', 'care_notes', 'status', 'return_to_play_date'],
    [
      esc('injury'), sub.studentByRegNo(sampleStudents[1].regNo), sub.sportsDiscipline('Basketball'),
      esc('Ankle sprain during practice match'), esc('2026-08-15'), esc('RICE protocol advised, physiotherapy for 1 week'),
      esc('closed'), esc('2026-08-22'),
    ],
    `student_id = ${sub.studentByRegNo(sampleStudents[1].regNo)} AND incident = ${esc('Ankle sprain during practice match')}`
  );

  // --- sports_trials + sports_trial_scores ---
  insertGuardedExpr(
    'sports_trials',
    ['student_id', 'discipline_id', 'target_team_id', 'round_label', 'trial_at', 'panel', 'status', 'recommendation'],
    [
      sub.studentByRegNo(sampleStudents[2].regNo), sub.sportsDiscipline('Basketball'),
      `(SELECT id FROM sports_teams WHERE name = ${esc("SECE Men's Basketball Team")})`, esc('Final Round'),
      esc('2026-08-18 16:00:00+05:30'), esc('Head Coach + 2 senior players'), esc('selected'), esc('Good ball-handling skills, recommended for the starting five'),
    ],
    `student_id = ${sub.studentByRegNo(sampleStudents[2].regNo)} AND trial_at = ${esc('2026-08-18 16:00:00+05:30')}`
  );
  const trialExpr = `(SELECT id FROM sports_trials WHERE student_id = ${sub.studentByRegNo(sampleStudents[2].regNo)} AND trial_at = ${esc('2026-08-18 16:00:00+05:30')})`;
  const trialCriteria = [['Dribbling', '8/10'], ['Shooting Accuracy', '7/10'], ['Team Play', '9/10']];
  trialCriteria.forEach(([criterion, score], idx) => {
    insertGuardedExpr(
      'sports_trial_scores', ['trial_id', 'criterion', 'score', 'sort_order'], [trialExpr, esc(criterion), esc(score), num(idx + 1)],
      `trial_id = ${trialExpr} AND criterion = ${esc(criterion)}`
    );
  });

  // --- sports_session_attendance: dynamically bound to a real training session ---
  line('-- sports_session_attendance: dynamically bound to a real sports_training_sessions row (set-based, guarded)');
  line(`INSERT INTO sports_session_attendance (session_id, student_id, status)`);
  line(`SELECT s.id, x.student_id, x.status`);
  line(`FROM (SELECT id FROM sports_training_sessions ORDER BY id LIMIT 1) s`);
  line(`CROSS JOIN (VALUES (${sub.studentByRegNo(sampleStudents[0].regNo)}, 'present'), (${sub.studentByRegNo(sampleStudents[1].regNo)}, 'present'), (${sub.studentByRegNo(sampleStudents[2].regNo)}, 'absent')) AS x(student_id, status)`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM sports_session_attendance a WHERE a.session_id = s.id AND a.student_id = x.student_id);`);
  blank();

  // --- sports_announcements ---
  insertGuardedExpr(
    'sports_announcements',
    ['title', 'content', 'category', 'posted_by_user_id'],
    [esc('Basketball Team Trials - Final Round'), esc('Final round of trials for the men\'s basketball team will be held on 18 Aug 2026 at the Basketball Court.'), esc('trials'), sub.userByEmail(csHod2.email)],
    `title = ${esc('Basketball Team Trials - Final Round')}`
  );

  // --- sports_reports ---
  insertGuardedExpr(
    'sports_reports', ['name', 'period_label', 'status', 'created_by_user_id'],
    [esc('Annual Sports Participation Report 2025-2026'), esc('AY 2025-2026'), esc('open'), sub.userByEmail(csHod2.email)],
    `name = ${esc('Annual Sports Participation Report 2025-2026')}`
  );

  // --- student_sports_team_mapping ---
  const teamMapRows = sampleStudents.slice(3, 6).map((s, idx) => [
    sub.studentByRegNo(s.regNo), `(SELECT id FROM sports_teams WHERE name = ${esc("SECE Men's Basketball Team")})`,
    esc(String(10 + idx)), esc(idx === 0 ? 'Point Guard' : 'Forward'),
  ]);
  for (const [studentSub, teamSub, jersey, role] of teamMapRows) {
    insertGuardedExpr(
      'student_sports_team_mapping', ['student_id', 'team_id', 'jersey_no', 'squad_role'], [studentSub, teamSub, jersey, role],
      `student_id = ${studentSub} AND team_id = ${teamSub}`
    );
  }

  // --- media_team_members + media_equipment + media_equipment_movements ---
  const mediaMembers = [
    ['Arun Prakash', 'Photographer', 'arun.prakash.media@sece.ac.in', 'active'],
    ['Divya Shree', 'Video Editor', 'divya.shree.media@sece.ac.in', 'active'],
  ];
  for (const [name, designation, email, status] of mediaMembers) {
    insertGuardedExpr(
      'media_team_members', ['full_name', 'designation', 'email', 'status', 'joined_on'],
      [esc(name), esc(designation), esc(email), esc(status), esc('2025-07-01')],
      `email = ${esc(email)}`
    );
  }
  const mediaMemberExpr = (email) => `(SELECT id FROM media_team_members WHERE email = ${esc(email)})`;

  insertGuardedExpr(
    'media_equipment', ['asset_tag', 'name', 'category', 'serial_no', 'condition', 'status', 'purchased_on', 'invoice_value', 'warranty_till', 'created_by_user_id'],
    [esc('MEDIA-CAM-001'), esc('Canon EOS 90D DSLR Camera'), esc('camera'), esc('CN90D2025XYZ001'), esc('good'), esc('available'), esc('2025-06-15'), num(125000), esc('2027-06-14'), sub.userByEmail(csHod2.email)],
    `asset_tag = ${esc('MEDIA-CAM-001')}`
  );
  const mediaEquipExpr = `(SELECT id FROM media_equipment WHERE asset_tag = ${esc('MEDIA-CAM-001')})`;
  insertGuardedExpr(
    'media_equipment_movements', ['equipment_id', 'moved_at', 'note', 'created_by_user_id'],
    [mediaEquipExpr, esc('2026-08-19 09:00:00+05:30'), esc('Checked out to Arun Prakash for TechFest photo coverage'), sub.userByEmail(csHod2.email)],
    `equipment_id = ${mediaEquipExpr} AND note = ${esc('Checked out to Arun Prakash for TechFest photo coverage')}`
  );

  // --- media_indents ---
  insertGuardedExpr(
    'media_indents',
    ['requested_by_user_id', 'title', 'indent_type', 'quantity', 'estimated_cost', 'needed_by', 'justification', 'status'],
    [
      sub.userByEmail(csHod2.email), esc('New wireless microphone set for events'), esc('capital_equipment'), num(2), num(35000),
      esc('2026-09-15'), esc('Existing wired mics are insufficient for large-audience events'), esc('pending'),
    ],
    `title = ${esc('New wireless microphone set for events')}`
  );

  // --- media_requests + media_shoot_assignments ---
  insertGuardedExpr(
    'media_requests',
    ['requested_by_faculty_id', 'requested_by_user_id', 'description', 'status', 'event_name', 'event_date', 'coordinator_name', 'contact_number', 'media_types', 'audience'],
    [
      sub.facultyByStaffCode(csFacNonHod2[0].staffCode), sub.userByEmail(csFacNonHod2[0].email),
      esc('Photo and video coverage for TechFest 2026 Code Sprint event'), esc('approved'), esc('TechFest 2026 - Code Sprint'),
      esc('2026-09-05'), esc(`${csFacNonHod2[0].first_name} ${csFacNonHod2[0].last_name}`), esc(randomMobile()),
      `ARRAY['photo', 'video']::text[]`, `ARRAY['students', 'faculty']::text[]`,
    ],
    `description = ${esc('Photo and video coverage for TechFest 2026 Code Sprint event')}`
  );
  const mediaReqExpr = `(SELECT id FROM media_requests WHERE description = ${esc('Photo and video coverage for TechFest 2026 Code Sprint event')})`;
  insertGuardedExpr(
    'media_shoot_assignments',
    ['media_request_id', 'assigned_to_member_id', 'crew', 'gear_issued', 'output_type', 'scheduled_at', 'status', 'created_by_user_id'],
    [
      mediaReqExpr, mediaMemberExpr('arun.prakash.media@sece.ac.in'), esc('Arun Prakash, Divya Shree'), esc('Canon EOS 90D, tripod'),
      esc('photo+video'), esc('2026-09-05 09:00:00+05:30'), esc('planned'), sub.userByEmail(csHod2.email),
    ],
    `media_request_id = ${mediaReqExpr} AND assigned_to_member_id = ${mediaMemberExpr('arun.prakash.media@sece.ac.in')}`
  );

  // --- chat_conversations + chat_messages ---
  insertGuardedExpr(
    'chat_conversations', ['user_id', 'title'], [sub.studentUserByRegNo(sampleStudents[0].regNo), esc('Attendance query')],
    `user_id = ${sub.studentUserByRegNo(sampleStudents[0].regNo)} AND title = ${esc('Attendance query')}`
  );
  const convExpr = `(SELECT id FROM chat_conversations WHERE user_id = ${sub.studentUserByRegNo(sampleStudents[0].regNo)} AND title = ${esc('Attendance query')})`;
  const chatMsgRows = [
    [convExpr, esc('user'), esc('What is my current attendance percentage?'), NUL(), NUL()],
    [convExpr, esc('assistant'), esc('Your current overall attendance is 92%. You are eligible to write the semester exams.'), esc('attendance_query'), num(0.95)],
  ];
  insertPlain('chat_messages', ['conversation_id', 'role', 'message', 'intent', 'confidence'], chatMsgRows);

  // --- device_push_tokens ---
  const pushRows = sampleStudents.slice(0, 3).map((s, idx) => [
    sub.studentUserByRegNo(s.regNo), esc(`fcm-token-${s.regNo}-${idx}`), esc('android'),
  ]);
  for (const [userSub, token, platform] of pushRows) {
    insertGuardedExpr(
      'device_push_tokens', ['user_id', 'push_token', 'platform'], [userSub, token, platform], `push_token = ${token}`
    );
  }

  // --- book_borrow_records: bound to real, already-seeded books via QR code ---
  const borrowRows = sampleStudents.slice(0, 3).map((s, idx) => [
    esc(`LIB-CS-000${idx + 1}`), sub.studentByRegNo(s.regNo), esc('2026-08-10'), esc('2026-08-24'),
  ]);
  for (const [qr, studentSub, borrowedDate, dueDate] of borrowRows) {
    const bookExpr = `(SELECT id FROM books WHERE qr_code = ${qr})`;
    insertGuardedExpr(
      'book_borrow_records', ['book_id', 'borrower_type', 'student_id', 'borrowed_date', 'due_date', 'status'],
      [bookExpr, esc('student'), studentSub, borrowedDate, dueDate, esc('borrowed')],
      `book_id = ${bookExpr} AND student_id = ${studentSub} AND borrowed_date = ${borrowedDate}`
    );
  }

  // --- bus_fuel_logs / bus_safety_checks / bus_service_logs: dynamically bound to a real bus ---
  line('-- bus_fuel_logs / bus_safety_checks / bus_service_logs: dynamically bound to bus_no = BUS-001 (set-based, guarded)');
  const busExpr = `(SELECT id FROM buses WHERE bus_no = 'BUS-001')`;
  insertGuardedExpr(
    'bus_fuel_logs', ['bus_id', 'fill_date', 'litres', 'rate_per_litre', 'station', 'odometer_km', 'cost', 'recorded_by_user_id'],
    [busExpr, esc('2026-08-18'), num(60), num(96.5), esc('IOCL Bus Stand Filling Station'), num(45230), num(5790), sub.userByEmail(csHod2.email)],
    `bus_id = ${busExpr} AND fill_date = ${esc('2026-08-18')}`
  );
  insertGuardedExpr(
    'bus_safety_checks', ['bus_id', 'item_key', 'status_text', 'is_ok', 'checked_date'],
    [busExpr, esc('brakes'), esc('Brakes checked, functioning normally'), boolSql(true), esc('2026-08-15')],
    `bus_id = ${busExpr} AND item_key = ${esc('brakes')}`
  );
  insertGuardedExpr(
    'bus_service_logs', ['bus_id', 'service_date', 'work_description', 'garage', 'odometer_km', 'cost', 'recorded_by_user_id'],
    [busExpr, esc('2026-07-20'), esc('Routine service: oil change, brake pad inspection, tyre rotation'), esc('Ashok Leyland Authorized Service Center, Coimbatore'), num(44800), num(8500), sub.userByEmail(csHod2.email)],
    `bus_id = ${busExpr} AND service_date = ${esc('2026-07-20')}`
  );

  // --- hostel_night_attendance: dynamically bound to real hostellers ---
  const hostellerSample = students.filter((s) => s.isHosteller).slice(0, 5);
  const nightRows = hostellerSample.map((s) => [sub.studentByRegNo(s.regNo), esc('2026-08-21'), esc('present'), sub.userByEmail('warden@sece.ac.in')]);
  for (const [studentSub, date, status, markedBy] of nightRows) {
    insertGuardedExpr(
      'hostel_night_attendance', ['student_id', 'attendance_date', 'status', 'marked_by_user_id'], [studentSub, date, status, markedBy],
      `student_id = ${studentSub} AND attendance_date = ${date}`
    );
  }

  // --- hostel_quit_requests: dynamically bound to a real hostel_rooms row ---
  if (hostellerSample.length) {
    line('-- hostel_quit_requests: dynamically bound to a real hostel_rooms row (set-based, guarded)');
    line(`INSERT INTO hostel_quit_requests (student_id, room_id, requested_date, reason, fee_status, status)`);
    line(`SELECT ${sub.studentByRegNo(hostellerSample[0].regNo)}, r.id, '2026-08-19', 'Shifting to a day-scholar arrangement due to family relocation nearby', 'pending', 'pending'`);
    line(`FROM (SELECT id FROM hostel_rooms WHERE hostel_id = ${sub.hostel(hostellerSample[0].isHosteller ? 'BH' : 'BH')} ORDER BY id LIMIT 1) r`);
    line(`WHERE NOT EXISTS (SELECT 1 FROM hostel_quit_requests hq WHERE hq.student_id = ${sub.studentByRegNo(hostellerSample[0].regNo)});`);
    blank();
  }

  // --- hostel_settings (single-row configuration table) ---
  line('-- hostel_settings: single-row configuration table');
  // updated_at is NOT NULL with no database default, so it must be supplied.
  line(`INSERT INTO hostel_settings (auto_approve_low_risk, min_attendance_for_auto_pct, require_biometric_pop, sms_guardian_on_checkout, alert_on_overdue_return, weekly_arrears_reminder, publish_resolved_complaints, max_outing_days, curfew_time, updated_at)`);
  line(`SELECT TRUE, 85, FALSE, TRUE, TRUE, TRUE, FALSE, 7, '20:30:00', '2026-08-01 09:00:00'`);
  line(`WHERE NOT EXISTS (SELECT 1 FROM hostel_settings);`);
  blank();

  // --- hostel_goods ---
  insertGuardedExpr(
    'hostel_goods', ['req_date', 'location', 'item', 'purpose', 'warden_id', 'block_id', 'received'],
    [
      esc('2026-08-10'), esc('Boys Hostel Block A, Ground Floor'), esc('Study Tables (20 units)'), esc('Replacement of damaged furniture in rooms'),
      `(SELECT id FROM hostel_wardens WHERE emp_id = 'WARD-BH-A-001')`, sub.hostelBlock('BH', 'A'), boolSql(false),
    ],
    `item = ${esc('Study Tables (20 units)')} AND req_date = ${esc('2026-08-10')}`
  );

  // --- service_orders: dynamically bound to a real principal_approved service_order_proposals row ---
  line('-- service_orders: dynamically bound to a real principal_approved service_order_proposals row (set-based, guarded)');
  line(`INSERT INTO service_orders (proposal_id, so_number, approved_by_user_id, approved_at, sent_to_vendor_at)`);
  line(`SELECT p.id, 'SO-2026-' || LPAD(p.id::text, 4, '0'), ${sub.userByEmail('principal@sece.ac.in')}, '2026-08-15 10:00:00+05:30', '2026-08-15 11:00:00+05:30'`);
  line(`FROM service_order_proposals p`);
  line(`WHERE p.status = 'principal_approved'`);
  line(`  AND NOT EXISTS (SELECT 1 FROM service_orders so WHERE so.proposal_id = p.id)`);
  line(`ORDER BY p.id`);
  line(`LIMIT 1;`);
  blank();

  // --- faculty_hostel_mapping: a sub-warden faculty housed on-campus (dynamically bound to a real hostel_rooms row) ---
  const wardenFacultyCandidate = facultyRoster.find((f) => f.deptCode === 'CS' && !f.isHod);
  if (wardenFacultyCandidate) {
    line('-- faculty_hostel_mapping: dynamically bound to a real hostel_rooms row (set-based, guarded)');
    line(`INSERT INTO faculty_hostel_mapping (faculty_id, room_id, allocated_date)`);
    line(`SELECT ${sub.facultyByStaffCode(wardenFacultyCandidate.staffCode)}, r.id, '2025-06-01'`);
    line(`FROM (SELECT id FROM hostel_rooms WHERE hostel_id = ${sub.hostel('BH')} ORDER BY id LIMIT 1) r`);
    line(`WHERE NOT EXISTS (SELECT 1 FROM faculty_hostel_mapping fhm WHERE fhm.faculty_id = ${sub.facultyByStaffCode(wardenFacultyCandidate.staffCode)});`);
    blank();
  }

  // --- nba_criteria + nba_evidence_items ---
  const nbaCriteria = [
    ['CS', 'CR1', 'Vision, Mission and Program Educational Objectives', 50],
    ['CS', 'CR2', 'Program Curriculum and Teaching-Learning Processes', 100],
    ['AI', 'CR1', 'Vision, Mission and Program Educational Objectives', 50],
  ];
  for (const [deptCode, code, name, maxMarks] of nbaCriteria) {
    insertGuardedExpr(
      'nba_criteria', ['department_id', 'code', 'name', 'max_marks'],
      [sub.dept(deptCode), esc(code), esc(name), num(maxMarks)],
      `department_id = ${sub.dept(deptCode)} AND code = ${esc(code)}`
    );
  }
  const nbaCriterionExpr = (deptCode, code) => `(SELECT id FROM nba_criteria WHERE department_id = ${sub.dept(deptCode)} AND code = ${esc(code)})`;
  const evidenceItems = ['Vision-Mission document approved by BoS', 'PEOs mapped to program curriculum', 'Stakeholder feedback records for PEO review'];
  for (const [idx, label] of evidenceItems.entries()) {
    insertGuardedExpr(
      'nba_evidence_items', ['criterion_id', 'label', 'done', 'updated_by_user_id'],
      [nbaCriterionExpr('CS', 'CR1'), esc(label), boolSql(idx < 2), sub.userByEmail(csHod2.email)],
      `criterion_id = ${nbaCriterionExpr('CS', 'CR1')} AND label = ${esc(label)}`
    );
  }
}
blank();

line('COMMIT;');

process.stdout.write(out.join('\n') + '\n');
