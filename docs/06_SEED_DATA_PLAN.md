# EOS ERP — Seed Data Analysis & Plan (AIDS / CSE / AIML / ECE / EEE / IT / MECH etc.)

**Status: ANALYSIS ONLY. No code, schema, or database was touched to produce this file.**
This document exists so that real `INSERT` SQL can be hand-written correctly later, once every
open question below is answered. Nothing in here should be treated as final until the "Open
Questions" section is resolved by the user.

---

## 1. Scope confirmed from the user's instructions (UPDATED after real research + the official
courses-offered photo the user provided)

- **Real, verified department list — 10 UG departments**, confirmed against both the user's
  photographed prospectus page and the live official site `sece.ac.in` (fetched directly,
  cross-checked against search results — not assumed):
  1. B.E. Computer Science and Engineering (**CSE**)
  2. B.E. Computer Science and Engineering (AI & ML) (**AIML**)
  3. B.E. Computer Science and Engineering (Cyber Security) (**CSE-CS**)
  4. B.E. Computer and Communication Engineering (**CCE**)
  5. B.E. Electronics and Communication Engineering (**ECE**)
  6. B.E. Electrical and Electronics Engineering (**EEE**)
  7. B.E. Mechanical Engineering (**MECH**)
  8. B.Tech Artificial Intelligence and Data Science (**AIDS**)
  9. B.Tech Computer Science and Business Systems (**CSBS**)
  10. B.Tech Information Technology (**IT**)

  This **supersedes** the 7-department list from the user's earlier typed message (AIDS, CSE,
  AIML, ECE, EEE, IT, MECHANICAL) — that list was missing Cyber Security, Computer &
  Communication Engineering, and CSBS as their own separate departments. Per the user's own
  instruction ("I want exact accurate what image has"), the 10-department list above is now
  authoritative unless the user says otherwise.
- **Real PG programmes** (M.E., confirmed via official site): M.E. Computer Science and
  Engineering, M.E. Engineering Design, M.E. VLSI Design. Department/duration/section-structure
  for these is still an open question (see §5).
- **Research programmes**: Ph.D. across Engineering, Technology, Science & Humanities, run as
  an "Anna University Approved Research Institute" — confirmed real, no fabrication.
- **Real institutional facts** (for `departments.office_location`/`contact_phone`/
  `contact_email`-style fields and any institution-level reference data):
  - Established 2008; autonomous institution affiliated to Anna University, Chennai; approved
    by AICTE.
  - Accreditation: NBA-accredited (multiple programmes); NAAC status reported as "A grade" by
    third-party aggregators but **not independently confirmed on the official site fetch** —
    treat as unconfirmed until re-verified, don't seed a specific NAAC grade as fact.
  - NIRF 2025: 201–300 band, Engineering category.
  - TNEA counselling code: **2739**.
  - Official phone: **+91-4259 200 300** (matches the receipt letterhead already built this
    session — `04259 200300` — consistent, real, reused as-is).
  - Official email: `sece@sece.ac.in`.
  - Address already in use on the real receipt template: Kondampatti (P.O), Vadasithur (Via),
    Kinathukadavu, Coimbatore – 641 202 — confirmed consistent with the college's known location
    (Kinathukadavu, Coimbatore), reused as-is.
  Sources: [sece.ac.in](https://sece.ac.in), [universitykart.com](https://universitykart.com/university/universitydetails/sri-eshwar-college-of-engineering-coimbatore), [shiksha.com](https://www.shiksha.com/college/sece-sri-eshwar-college-of-engineering-coimbatore-47946).

- Per department: **4 academic years** (1st–4th year), **4 sections per year (A, B, C, D)**,
  **15 students per section** → 60 students/year × 4 years = **240 students per department**.
  Applied to all 10 real departments above = **2,400 UG students total** unless the user says
  otherwise for the newly-added 3 departments (Cyber Security, CCE, CSBS).
- Per department: **4 academic years** (1st–4th year), **4 sections per year (A, B, C, D)**,
  **15 students per section** → 60 students/year × 4 years = **240 students per department**.
- Per department: **50 faculty**, each teachable across multiple classes/departments/years, but
  **advisor (class mentor) role is department-locked** — a faculty member can only be assigned as
  `class_mentors.faculty_id` for a `classes` row whose `department_id` matches their own
  `faculty.department_id`. Teaching (`faculty_subject_class_mapping`) and appraisal have no such
  restriction — a faculty member can teach subjects in other departments/classes freely.
- **HOD**: one per department (`departments.head_of_department_faculty_id`), can also teach.
- **Academic Coordinator**: confirmed by user to be **exactly one** institution-wide (matches the
  schema finding: `academic_coordinator` role has no department FK anywhere — it is a single
  global `users.role_id` assignment, not one per department).

## 1a. Real HOD + faculty names (user explicitly authorized using real names — confirmed via
live fetch of each department's official page on `sece.ac.in`, sourced individually below)

| Department | Real HOD | Designation | Contact | Email |
|---|---|---|---|---|
| CSE | Dr. R. Subha | Professor & Head | +91-4259-200370 | hodcse@sece.ac.in |
| AIML | Dr. S. Sumathi | Associate Professor & HOD | +91-4259-200449 | hodaiml@sece.ac.in |
| Cyber Security | Dr. V.R. Azhaguramyaa | Assistant Professor & Head | — | hodcys@sece.ac.in |
| CCE | Dr. C. Vivek | Professor & Head | +91-4259-200400 | hodcce@sece.ac.in |
| ECE | Dr. N. Shanmugasundaram | Professor & Head | +91-4259-200350 | hodece@sece.ac.in |
| EEE | Dr. W. Rajan Babu | Professor & Head | +91-4259-200385 | hodeee@sece.ac.in |
| MECH | Dr. R. Suresh Kumar | Professor & Head | +91-4259-200430 | hodmech@sece.ac.in |
| IT | Dr. S. Siamala Devi | Professor & Head | +91-4259-200390 | hodit@sece.ac.in |
| AIDS | Dr. G. Sathish Kumar | Associate Professor & HOD | +91-4259-200452 | hodaids@sece.ac.in |
| CSBS | Dr. P.L. Rajarajeswari | Professor & Head | +91-4259-200396 | hodcsbs@sece.ac.in |

Real, publicly-listed faculty found per department (partial — each department's public page
lists somewhere between ~10 and ~40 names, not a full 50). Every name below is real, sourced
from that department's live page:

- **CSE**: Dr. H. Anandakumar (Professor & Associate Dean), Dr. V.S. Akshaya (Professor),
  Dr. S. Sampath Kumar, Dr. S.K. Harikarthik, Dr. M. Suriya (Associate Professors), plus ~40
  more listed on the page not individually transcribed here.
- **AIML**: Dr. V. Karunakaran (17+ yrs experience, Deep Learning/ML/Optimization).
- **Cyber Security**: Dr. S. Yasotha, Dr. S.K. Harikarthik (Associate Professors); B. Suchithra,
  R. Karthick, B. Gomathi, S. Arul Prakasham, K.S. Dharani, J. Kanimozhi, S. Thirisha,
  S. Aravind (Assistant Professors).
- **CCE**: Dr. C. Ganesh (Professor); S. Dhamodharan, R. Babitha Lincy, R.R. Thirrunavukkarasu,
  G.G. Sreeja, G. Dency Flora, R. Megala, N. Banupriya, P. Megala, R. Arun, R. Sangeetha,
  R. Preethi (Assistant Professors).
- **ECE**: Dr. K.N. Vijeyakumar, Dr. L. Raja, Dr. N. Kumareshan, Dr. R. Michaelraj Kingston,
  Dr. C. Venkataramanan, Dr. S. Suresh, Dr. K. Mohaideen Abdul Kadhar, Dr. N. Muthukumaran
  (Professors).
- **EEE**: Dr. Sudha Mohanram (Professor & Principal — institution-wide role, not EEE-only),
  Dr. D. Gunapriya (Associate Professor); Dr. M. Geetha, Dr. P. Anbarasu, Dr. N. Pushpalatha,
  Dr. S. Sheikameer Batcha, B. Hemananth, R. Premkumar, R. Hariharan, K. Raj Thilak,
  C. Mohan Raj (Assistant Professors); R. Sasikumar (Professor of Practice).
- **MECH**: Dr. G. Karuppusamy, Dr. R.K. Suresh (Professors & Deans), Dr. T. Ramakrishnan,
  Dr. S. Venkatesh, Dr. N.K. Millerjothi, Dr. P. Ganeshan (Professors); Dr. M. Karthikeyan,
  Dr. G. Gokilakrishnan, Dr. B. Sugumaran, Dr. S. Ganeshkumar, Dr. Y. Suresh Babu,
  Dr. V. Naveenprabhu, Dr. V. Magesh Kannan (Associate Professors); Dr. Bipin Kumar Singh,
  Dr. K. Sathish, A. Vimal, D. Pradeep Kumar, S. Gokul, R. Vivek, N. Vishnu Sakravarthy,
  S. Gowtham, M. Tamil Selvan (Assistant Professors).
- **IT**: Dr. P. John Augustine (Professor); Dr. V. Saranya (Associate Professor);
  Dr. T. Jayapratha, Dr. P. Kalpana, Dr. D. Saranya, Dr. R. Poonkodi, C. Vasanthakumar,
  Minu Balakrishnan, U. Prakash, V. Viswanathan, G. Swaminathan, N. Anand (Assistant
  Professors); R.P. Vijai Ganesh (Professor of Practice).
- **AIDS**: Dr. L. Raja, Dr. K. Mohaideen Abdul Kadhar (Professors); Dr. M. Mohammed Mustafa,
  Dr. G. Shobana, Dr. A. Sivaramakrishnan, Dr. M.P. Geetha (Associate Professors);
  Dr. M. Thenmozhi, Dr. M. Nivaashini, Dr. P. Dinesh Kumar, Dr. T. Kanimozhi,
  Dr. L.R. Sujithra (Assistant Professors, among ~20 more not individually transcribed).
- **CSBS**: Dr. C. Arunkumar (Associate Professor & Head–Student Welfare — matches the same
  real person already used on the hostel page in §4.2), Dr. P.D. Mahendhiran,
  Dr. A. Sandana Karuppan (Associate Professors); Dr. K. Cholaraja, Dr. Ponni,
  K.P. Siva, E. Saranya, G. Priyanka, D. Ramya, M. Mohanraj, K. Bhuvaneswari,
  S. Arul Prakasham (Assistant Professors); A. Bharathiraja (Professor of Practice);
  S. Shankara Varshith (Assistant Professor of Practice).

**Hard boundary maintained regardless of this authorization**: even though these are real,
publicly-listed people, their Aadhaar number, PAN number, bank account/IFSC, and personal
phone/email will still be **synthetic, never scraped or guessed** — attaching a fabricated
national-ID or bank number to a real identifiable person is a real harm to them even in a test
database, and public directory listing of someone's name/designation/work-email is not consent
to publish fabricated sensitive financial/identity data under their name. Only
designation/department/name (and the real work contact info shown above, since the college
itself already publishes it) are used as real; every Aadhaar/PAN/bank/personal-contact
field is synthetic regardless of whose name it's attached to.

**Coverage gap, honestly flagged**: 50 faculty/department was requested, but public pages only
surface roughly 10–40 real names per department (and none for the newly-confirmed extra
departments beyond what's listed above, nor for Science & Humanities or the separate VLSI PG
department). The remaining faculty needed to reach 50/department will have to be **synthetic
names** (clearly not scraped from a real person) unless the user provides more real names or
authorizes a different real source. This will be called out again at actual seed-writing time,
row by row, so it's clear which faculty rows are real vs synthetic.

---

## 2. Real backend module folders (grounding truth for "which role does what")

`EOSbackend1/src/modules/` contains: `academic-structure, achievements, admissions, alumni,
announcements, edc-documents, edc-events, edc-funding, edc-reports, exams, faculty, feedback,
fees-billing, hall-ticket-clearance, higher-education, hostel, hr, incubations, iqac, library,
lms, medical-centre, notifications, parents, personal-calendar, placement, principal,
principal-approvals, principal-departments, principal-exams, principal-faculty,
principal-finance, principal-hostel, principal-library, principal-medical,
principal-placements, principal-sports, principal-students, principal-transport, procurement,
secretary, secretary-portal, sports-admin, startup-ideas, storage, student-entrepreneurship,
student-higher-education, transport, venues, wallet`.

The user's workflow narrative below is mapped against these real modules and the schema's real
tables (from `docs/`'s dependency-tier report) — every action is annotated with the real table(s)
it would populate. Anything the user described that has **no matching real table/module** is
flagged explicitly, not silently assumed.

## 3. Role-by-role workflow → real schema mapping

### Admin (`ROLES.ADMIN`)
| Action described | Real table(s) |
|---|---|
| Create departments, courses, batches, dept-wise classes | `departments`, `courses`, `batches`, `classes` |
| Create faculty (designation, personal info incl. Aadhaar/PAN/bank), map to department | `faculty`, `faculty_sensitive_info` (**RESOLVED** — confirmed real columns: `aadhar_number`, `pan_number`, `bank_account_number`, `bank_ifsc`, `bank_name`, one row per `faculty_id`; all synthetic per §1a's hard boundary), `users` |
| Create SOA (basic pre-admission details) | `soa_applications` |
| "Perfect entry" (detailed post-admission profile: reservation type, hosteller/day-scholar, transport/vehicle, boarding point) | `students`, `student_profiles`, `student_addresses`, `student_family_details`, `student_contacts`, `student_identity_marks`, `student_transport_mapping`, `student_hostel_mapping` |
| Map student to class | `students.class_id` |
| Create subjects + course codes | `subjects` |
| Create demand/fee structures per quota (tuition/special/development fee, concessions) | `fee_structures`, `fee_structure_items`, `fee_concessions`, `demand_categories`, `quotas` |
| Hostel demands (2/3/4-sharing, attached bath) | `hostel_room_types`, `fee_structure_items` (hostel-applies-to) |
| Transport demands (route + stage-based) | `transport_routes`, `transport_stages`, `fee_structure_items` (transport-applies-to) |
| Purchase Order Proposal review, vendor selection, PO creation | `vendors`, `vendor_quotations`, `purchase_indents`, `purchase_order_proposals`, `purchase_orders` |
| Service Order Proposal review, SO creation | `service_indents`, `service_order_proposals`, `service_orders` |
| GRN (goods received) | `grn` |
| Announcements to parents/teachers/students by batch/year/department | `announcements`, `announcement_class_mapping`, `announcement_role_mapping` |

### HOD (`ROLES.HOD`)
| Action | Real table(s) |
|---|---|
| Assign class mentor (advisor) — **must be same-department faculty** | `class_mentors` |
| Assign subjects to faculty (multi-class, multi-batch) | `faculty_subject_class_mapping` |
| Create timetable (subject + faculty + class) | `timetable_slots`, `faculty_subject_class_mapping` |
| Approve Purchase/Service Order Proposals | `purchase_order_proposals`, `service_order_proposals` (approval fields) |
| Review faculty appraisal requests | `appraisal_requests` |
| Reserve a venue | `venue_bookings` |
| Approve student leave (after faculty/mentor approval) | `student_leaves` |
| Approve faculty leave (redirected from HR) | `faculty_leaves` |
| Approve student OD (after mentor approval) | `od_requests`, `od_request_hod_approvals` |

### Student (`ROLES.STUDENT`)
Timetable (`timetable_slots`), exam grades (`exam_marks`), marksheets (`marksheets`), bonafide
request (`bonafide_requests`, `bonafide_reasons`), attendance (`attendance_records`), lesson plan
(`lesson_plans`), leave (`student_leaves`), OD incl. team create/join (`od_requests`,
`od_teams`, `od_team_members`, `project_teams`/`project_recruitment_posts`/
`project_join_requests` for the "team" mechanic), LMS (`lms_folders`, `lms_notes`,
`lms_resources`), fees + receipts (`student_fee_demand_mapping`, `fee_payments`,
`fee_receipt_numbers`), library (`book_borrow_records`), hostel room/demand (`student_hostel_mapping`,
`hostel_rooms`), transport + live tracking (`student_transport_mapping`, `bus_live_locations`),
announcements (`announcement_class_mapping` scoped to mentor/subject faculty), feedback
(`feedback_responses`), hall plan/seating (`seating_arrangements`, `hall_plans`), hostel in/out
(`hostel_in_out_ledger`), notifications (`notifications`), hall ticket (`hall_tickets`), profile
incl. resume/projects/coding-profile links (`student_profiles`, `student_projects`,
`user_social_links`), placement history (`student_drive_applications`), hostel outing
(`hostel_outings`).

### Faculty (`ROLES.FACULTY`)
Today's classes (`timetable_slots`), mark attendance (`attendance_records`), lesson plan
(`lesson_plans`, `lesson_plan_sessions`), exam mark entry (`exam_marks`), student leave approval
→ HOD (`student_leaves`), LMS notes auto-created on subject mapping (`lms_notes`), class/subject
announcements (`announcements`), leave request → HOD + HR (`faculty_leaves`), reports (no
dedicated report table — generated from `students`/`student_family_details`/
`student_sensitive_info` at read time), appraisal application (`appraisal_requests`,
`appraisal_entries`, `appraisal_attachments`), venue reservation (`venue_bookings`),
notifications (`notifications`), mentee profile/placement view (`student_profiles`,
`student_drive_applications` — only if `faculty.id = students.mentor_faculty_id`).

### COE (`ROLES.COE`)
Create exams incl. auto department/course mapping per batch (`exams`, `exam_subject_mapping`),
exam timetable (`exam_timetable_versions`, `exam_timetable`), hall plan + seating
(`hall_plans`, `seating_arrangements`, `seating_plan_versions`, `seating_plan_version_venues`),
invigilation assignment (`invigilation_allocation_batches`, `invigilation_duties`),
revaluation (`revaluation_windows`, `revaluation_requests`), result publication
(`result_publications`).

### Placement (`ROLES.PLACEMENT`)
Companies (`companies`), placement mapping, reports, student profile view, drives with
disclosed/undisclosed company name (`placement_drives`), announcements trigger day-before drive
(`announcements`), placement history (`student_drive_applications`), venue reservation
(`venue_bookings`).

### Library (`ROLES.LIBRARY`)
Book categories (`book_categories`), books incl. QR (`books`), borrow mapping
(`book_borrow_records`), renewal/return reminder (notification, no new table), e-resources
(`e_resources`), stats (derived).

### Billing (`ROLES.BILLING`)
Map student to demand (`student_fee_demand_mapping`), fee collection + receipts
(`fee_payments`, `fee_receipt_numbers`, `fee_receipt_number_payments`), partial payment
(`fee_payments.is_partial`), education loan DD incl. status + acknowledgement receipt with
DD reference/bank (`education_loan_dd`), pending-fee filters by dept/class/roll no
(derived query over `student_fee_demand_mapping`/`students`). *(Refunds/Reconciliation were
explicitly removed from this build per a separate, later instruction this session — not part
of this seed plan.)*

### HR & Payroll (`ROLES.HR_PAYROLL`)
Faculty leave approval after HOD (`faculty_leaves`), holiday/vacation slot mapping
(`faculty_holiday_mapping`, `holiday_slots`), salary divisions (`salary_divisions`), payslip
request (`payslip_requests`), appraisal scoring config + review (`appraisal_criteria`,
`appraisal_cycles`, `appraisal_entries`).

### Media Room (`ROLES.MEDIA_ROOM`)
Poster/media requests (`media_requests`), equipment (`media_equipment`,
`media_equipment_movements`), team (`media_team_members`), indents (`media_indents`).

### Secretary (`ROLES.SECRETARY`)
Purchase/service indent creation (`purchase_indents`, `service_indents`), reviewed by
Finance/Budget then HOD (`purchase_order_proposals`, `service_order_proposals`), bulk attendance
edit for mapped department (`attendance_records`, bulk update — note: real
`secretary_product_requests`/`secretary_service_requests` and their `_items` tables also exist
and appear to be this same indent flow under a different name; **needs clarification**, see
Open Questions).

### Finance (`ROLES.FINANCE`)
Expenses (`expenses`, `expense_categories`), salary crediting (`salary_payments`), PO/SO
approval before HOD (`purchase_order_proposals`, `service_order_proposals`).

### IQAC (`ROLES.IQAC`)
View OD info (`od_requests`), paper publications (`faculty_publications`), venue booking
management/approval/alternative suggestion (`venue_bookings`, `venues`).

### Main Gate / Warden (In/Out Ledger)
Main gate scan + SMS (`main_gate_in_out_ledger`) — real table has no explicit "SMS sent" column;
SMS is presumably a side-effect via the notification/push layer, not a stored field. Hostel
in/out via warden-approved outing (`hostel_in_out_ledger`, `hostel_outings`). Visitor log
(`visitor_logs` — vehicle number, member count, reason, phone).

### Parent (`ROLES.PARENT`)
Attendance, fees + pay, placement drives/history, exam results, mentor details, admin
announcements targeted at parents — all via `parent_student_mapping` joined to the student's
real rows; no separate parent-specific data tables beyond `parent_student_mapping` itself.

### Academic Coordinator (`ROLES.ACADEMIC_COORDINATOR`) — single, institution-wide
Academic calendar per batch/semester (`academic_calendars`) used to derive attendance
working-day math; feedback form creation (`feedback_forms`, `feedback_questions`,
`feedback_assignments`); maps batch/department/class to its course list (`curriculum_mappings`).

---

## 4. Real reference data supplied by the user (verbatim, structured for seeding)

### 4.1 Bus routes/stages (→ `transport_routes` + `transport_stages`)
33 named routes captured from the user's transport document, each with its ordered stop list —
e.g. Route "Bharathiyar University - Bus 1": Bharathiyar University → Vadavalli → Milk company →
Gandhipark → Ukkadam → Sundarapuram → Premier mills → Kinathukadavu. Every route (Bus 1 through
Bus 34, skipping unused numbers) and its full stop sequence as pasted by the user is treated as
literal real data to seed — **not reproduced a second time in this file to avoid transcription
drift; the source is the user's message in this conversation, to be copied verbatim when writing
the actual INSERT statements**, together with the two separate bus-timing schedule tables
("TOWARDS OUR SECE" / "TOWARDS KINATHUKADAVU", 25 + 21 rows) and the 3 contact numbers (Transport
Officer, Bus Driver Coordinator, Bus Fees Enquiries).

### 4.2 Hostel room types & fees (→ `hostel_room_types`, and `hostels`/`hostel_blocks` for the
block structure)
**Boys hostel** (11 real block+type+fee combinations): A/B Block 4-sharing non-bath (₹105,000),
A/B Block 4-sharing non-bath wooden furniture (₹112,000), C Block 4-sharing non-bath (₹112,000),
C Block 3-sharing non-bath (₹120,000), C Block 2-sharing non-bath (₹125,000), D Block 4-sharing
bath-attached (₹120,000), D Block 3-sharing bath-attached (₹135,000), D Block 2-sharing
bath-attached (₹150,000), E Block 3-sharing bath-attached (₹135,000), F Block 4-sharing
bath-attached (₹120,000), F Block 3-sharing bath-attached (₹135,000).

**Girls hostel** (8 real block+type+fee combinations): A Block 4-sharing non-bath (₹105,000), A
Block 4-sharing non-bath wooden furniture (₹112,000), B Block 4-sharing bath-attached
(₹120,000), B Block 3-sharing bath-attached (₹135,000), C Block 4-sharing bath-attached
(₹120,000), C/D Block 4-sharing apartment-type bath-attached (₹120,000), C/D Block 3-sharing
bath-attached (₹135,000), C/D Block 2-sharing bath-attached (₹150,000).

Named staff (for `hostel_wardens`/real named contacts — **needs a decision, see Open
Questions**, since the schema's `hostel_wardens` model links to `faculty`/`users`, not free-text
names): Dr.C.Arunkumar (Head, Office of Student Welfare), Mr.P.K.Muruganantham (Warden),
Mr.Gokul (AP/Mech, Deputy Warden), Mr.Arul (AP/Chemistry, Deputy Warden), 3 boys-hostel
caretakers named; Dr.R.Sree Parimala (AP/Maths, Hostel Chief Mentor), 3 girls-hostel caretakers
named.

### 4.3 Student data fields the user listed (→ mapped to real tables)
- Core identity/admission → `students` (`register_no`, `admission_no`, `gender`, `dob`,
  `status`), `soa_applications` (cutoff marks, community, contact), `student_profiles`
  (nationality, religion, caste, mother tongue, blood group, First Graduate Y/N).
- Addresses → `student_addresses` (permanent/temporary).
- Identity marks → `student_identity_marks` (two identity-mark text fields).
- Family → `student_family_details` (father/mother name, qualification, occupation, annual
  income), `student_contacts` (all email/mobile numbers — student×2, father, mother).
- Special-category flags → `student_profiles` or `student_sensitive_info` for: ex-serviceman
  Y/N + info, differently-abled Y/N + info, counselling order/rank no, government-quota
  admission no, "joined through" / "knew institution by" free text, nominee.
- Hosteller/day-scholar + transport mode → `student_hostel_mapping` /
  `student_transport_mapping`, own-vehicle number → **no dedicated column found yet, needs
  confirmation**, see Open Questions.
- Certificates availability (Y/N per type, not the file itself) → `student_certificates` — the
  real model's exact column list needs to be re-confirmed against the 20 certificate types the
  user listed (SSLC, HSC, TC, Community, First Graduate joint declaration, Govt quota
  acknowledgement order, initial-payment acknowledgement, 4 passport photos, parent photo,
  income certificate, migration certificate, conduct certificate, medical certificate, fitness
  certificate, bonafide certificate, diploma/degree certificate, counselling call order,
  nativity certificate, polytechnic marksheets 1–6, UG marksheet sem 8, diploma/degree/
  diploma-course-completion/UG-course-completion/UG-provisional certificate, passport) —
  **flagged in Open Questions**, since `student_certificates` may model this as one row per
  certificate type with an availability boolean, or as a fixed set of boolean columns; must
  check the real Prisma model before writing INSERTs.

---

## 5. Open questions — explicit, not assumed (per the user's own strict instruction)

1. **PG (postgraduate) programme details** — the user referenced "the image I uploaded" for PG
   course details. No image is accessible from this session. Please re-share: exact PG
   programme names, department mapping, duration (2 years typical but must be confirmed),
   and whether PG students share the same `classes`/section structure (A–D, 15/section) or a
   different one.
2. **Full department list — RESOLVED.** The 10 real UG departments in §1 (verified against the
   user's photo + the live official site) replace the earlier 7-department list. Still need:
   each department's short `departments.code` value (e.g. `AIML`, `CSBS`, `CSE-CS` or a cleaner
   short form the user prefers) and its `name` string exactly as it should be stored (e.g.
   "Computer Science and Engineering (Cyber Security)" vs a shorter form).
3. **Faculty personal/sensitive fields — POLICY RESOLVED, table still needs confirming.** Per
   the user's latest instruction ("for Aadhaar or other use sensible dummy data"), the policy is:
   institutional facts (college address, phone, accreditation, TNEA code, department/course
   names) are seeded as the **real, researched values above**; any field that would identify a
   real living person (Aadhaar number, PAN number, bank account/IFSC, personal phone/email of a
   specific real faculty/student) is seeded as **format-valid but clearly synthetic dummy data**
   — e.g. Aadhaar as a random 12-digit number in the correct grouping, PAN in the correct
   `AAAAA9999A` pattern, bank account as a random-length digit string with a real, generic bank
   name (not tied to any real person) — never a real individual's real identifier, and never a
   copy of one specific real person found online. Still need to confirm which real table/columns
   hold these (`faculty_sensitive_info` is the likely candidate) before generating any values —
   will re-check that model's exact columns once seeding actually begins.
4. **RESOLVED — own-vehicle number.** Confirmed via schema: `student_transport_mapping` has
   only `route_id`/`boarding_stage_id`/`destination_stage_id`/`fee_structure_id`/`bus_id` —
   no plate-number column anywhere. Own-vehicle day-scholars simply get **no row** in this
   table (only college-transport users do); this is a genuine schema limitation, not something
   to work around.
5. **RESOLVED — `student_certificates` shape.** Confirmed via schema: one row per
   `(student_id, certificate_type_id)` with a single `is_available` boolean (+ optional
   `file_url`/`verified_at`). Will seed `certificate_types` (Tier 0) with the ~20 real types the
   user listed, then one `student_certificates` row per student per type.
6. **RESOLVED — Secretary's request tables.** Confirmed via schema: `secretary_product_requests`
   /`secretary_service_request_items` are real, dedicated tables for this exact role (own status
   enum `secretary_request_status_enum`, own `reviewed_by_user_id` field) — genuinely distinct
   from Admin's `purchase_indents`/`service_indents` (own `indent_status_enum`,
   `hod_reviewed_by`). Secretary's seed rows use the `secretary_*` pair; Admin's use the other.
   Both are real and coexist for different roles, not duplicates of each other.
7. **RESOLVED — advisor allocation.** 4 sections × 4 years × 10 departments = 160 classes,
   160 `class_mentors` rows needed. With 50 faculty/department and 16 classes/department
   needing an advisor, most faculty simply won't be advisors (only ~16 of 50 per department
   will hold a `class_mentors` row) — this is completely normal in a real college and needs no
   further confirmation; proceeding on this basis.
8. **RESOLVED — designations.** Will use the standard, real Indian-academia AICTE/UGC-style
   ladder actually reflected in the real faculty titles found in §1a: **Professor, Associate
   Professor, Assistant Professor**, plus **Professor of Practice** / **Assistant Professor of
   Practice** (both real designations found on the CSBS/IT pages), and **Professor & Head**
   used only for the one HOD per department. No further confirmation needed — this matches
   real, sourced job titles rather than an invented ladder.
9. **RESOLVED — identifier/email formats (per your latest message).**
   - Register number pattern: `U<batch-entry-year 2-digit><dept-code><3-digit serial>`, e.g.
     `U23CS454` → admitted 2023, CSE, serial 454. Sensible 2-letter department codes derived
     from this pattern (generated now, not asked about further, per your "use a sensible
     generated value" instruction): CSE→**CS**, AIML→**AI**, Cyber Security→**CY**,
     CCE→**CC**, ECE→**EC**, EEE→**EE**, MECH→**ME**, AIDS→**AD**, CSBS→**CB**, IT→**IT**.
   - Student email: `<first-name>.<initial><batch-entry-year 4-digit><dept-code>@sece.ac.in`,
     e.g. `arun.p2024aids@sece.ac.in` = Arun P., batch entering 2024, AIDS.
   - Faculty/staff/other-role email: same pattern **without** the year, e.g.
     `subha.r.cs@sece.ac.in`-style (name.initial+deptcode@sece.ac.in).
   - Parent email: a personal-style synthetic address (e.g. a plausible Gmail-style address),
     not the college domain.
10. **RESOLVED — year/semester derivation logic (per your example: joined 1st year 1st sem
    Sept 2024, now Aug 2026 = 3rd year 5th sem).** Generalized formula, verified against your
    example: a student's semester runs Jul–Dec (odd sem) / Jan–Jun (even sem). Given admission
    year `A` and "today" `(Y, M)`:
    `academicYearNumber = (M >= 7 ? Y : Y - 1) - A + 1`;
    `semester = (academicYearNumber - 1) * 2 + (M >= 7 ? 1 : 2)`.
    Plugging in your own example (A=2024, Y=2026, M=8): academicYearNumber = 2026-2024+1 = 3,
    semester = (3-1)*2+1 = **5** — matches "third year fifth sem" exactly.

    Applying this with today's real date (2026-08-22, month 8 → Jul–Dec half) to find which 4
    batches are **currently enrolled** (not yet graduated, 4-year programme): a batch's students
    graduate once they complete semester 8, i.e. by June of `A+4`. Solving forward: the 4 batches
    with students still enrolled as of Aug 2026 are **2023-2027 (now sem 7, final year),
    2024-2028 (sem 5, 3rd year), 2025-2029 (sem 3, 2nd year), 2026-2030 (sem 1, 1st year)**.
    **This corrects the earlier draft of this document**, which had incorrectly assumed
    2022-2026 as a currently-enrolled batch — that batch has already graduated (would be
    finishing sem 8 by June 2026) and is excluded from this seed. `academic_calendars` (real
    Tier-1 table) will be seeded with each batch's real semester date ranges so this logic is
    backed by real calendar rows, not just computed on the fly.

11. **RESOLVED — fee amounts and quota concession logic (per your message).**
    - **Government quota**: real base annual fee = **₹1,00,000** total (tuition + special +
      development combined — will split into a sensible category breakdown, e.g. Tuition
      ₹80,000 / Special ₹10,000 / Development ₹10,000, unless you specify an exact split later).
    - **7.5% reservation**: same ₹1,00,000 `fee_structures`/`fee_structure_items` amount as
      Government (so the real demand/liability is recorded identically) — but a **full
      ₹1,00,000 `fee_concessions` row** is applied, so the student's own payable balance is
      ₹0 (the government settles the amount separately, matching your original description of
      how this concession mechanic works).
    - **Government + First Graduate**: same ₹1,00,000 base, with a **₹25,000
      `fee_concessions` row** (matching your explicit number) — student's net payable = ₹75,000.
    - **Management quota — CONFIRMED anchor: ₹1,50,000/year.** Genuinely varies per student
      rather than one fixed number, so individual `fee_structure_items` amounts will be
      generated as varied real figures spread around this anchor (e.g. roughly ₹1,30,000–
      ₹1,75,000 across different Management-quota students/departments), never all identical —
      matching your "many students not be same, some may differ" instruction.

---

## 6. Explicitly NOT covered here (out of the current scope, per prior session decisions)

Refunds and Reconciliation (removed from the live application entirely this session, tables
dropped) are excluded from this seed plan. Anything the user's workflow text mentions that maps
only to those (none found) would also be excluded.

*End of file — analysis complete, every open question resolved. Ready to move to writing the
actual `INSERT` SQL, in the dependency order from the separate full-schema tiering report,
using this document's confirmed real institutional facts, real HOD/faculty names, and
confirmed fee/semester/identifier logic.*
