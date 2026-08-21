# EOS ERP Business Workflows

**Version:** 1.0

## Purpose

This document defines the business workflows of EOS ERP.

Every module must follow these workflows.

When implementing a new feature, always extend existing workflows instead of creating new independent flows.

## Authentication Workflow

```
User → Login → JWT Authentication → Validate Credentials
  → Generate Access Token → Return User Details → Dashboard
```

Rules:
- Every protected API requires JWT.
- Authentication happens before authorization.
- Never trust client-provided user IDs.

## Student Workflow

```
Student Login → Dashboard → View Profile → Attendance → Fees
  → Hostel → Library → Team Recruitment → Notifications → Logout
```

## Faculty Workflow

```
Faculty Login → Dashboard → Manage Attendance → Manage Students
  → Approve Requests → View Reports → Notifications → Logout
```

## Admin Workflow

```
Admin Login → Dashboard → Manage Users → Manage Students → Manage Faculty
  → Manage Departments → Manage Courses → Manage Hostel → Manage Library
  → Reports → Logout
```

## Team Recruitment Workflow

### Create Team
```
Student → Create Team → Validation → Create project_team
  → Creator becomes Team Leader → Team Created
```

### Search Team
```
Student → Search → Filter → Sort → Open Team → View Recruitment Post
```

### Apply to Team
```
Student → Open Team → Click Apply → Create Join Request
  → Status = PENDING → Leader Notification
```

### Leader Reviews Application
```
Leader → View Requests → Review Student → Accept / Reject
```

### Accept Request
```
Leader → Accept → Transaction Begins → Update Request
  → Insert Team Member → Increase Current Members
  → If Team Full → Close Recruitment → Notify Student → Commit Transaction
```

### Reject Request
```
Leader → Reject → Update Request → Notify Student
```

## Attendance Workflow

```
Faculty → Select Class → Mark Attendance → Save
  → Attendance History Updated → Students Receive Notification (Optional)
```

## Library Workflow

### Borrow Book
```
Student → Search Book → Request Book → Librarian Approval
  → Issue Book → Update Inventory → Notification
```

### Return Book
```
Student → Return Book → Fine Calculation → Inventory Updated → History Updated
```

## Hostel Workflow

```
Student → Apply Hostel → Admin Review → Approve
  → Room Allocation → Notification
```

## Fee Payment Workflow

```
Student → View Fees → Select Payment → Gateway → Payment Success
  → Receipt Generated → Notification
```

## Notification Workflow

```
Module → Notification Service → Save Notification
  → Push Notification → User Reads → Mark Read
```

Every module uses the centralized Notification Module.

Never implement module-specific notification systems.

## File Upload Workflow

```
User → Upload File → Validation → Cloudflare R2
  → Store Metadata → Return File URL
```

Files are never stored inside PostgreSQL.

## Search Workflow

```
User → Search → Filters → Sorting → Pagination → Database Query → Results
```

Always support:
- Pagination
- Filtering
- Sorting

## Approval Workflow

Used by:
- Team Recruitment
- Hostel
- Leave
- OD
- Future Modules

```
User → Submit Request → Status = PENDING → Approver
  → Approve / Reject → Notification → History Updated
```

Never auto-approve requests.

## Transaction Workflow

```
Validate → Begin Transaction → Update Table A → Update Table B
  → Update Table C → Commit → Success
```

If any step fails: **Rollback**.

## Error Workflow

```
Request → Validation → Business Validation → Database
  → Success  OR  → Error Response
```

Never expose database errors directly.

## Audit Workflow

```
User Action → Audit Service → Store Log → Continue Request
```

Important actions:
- Login
- Create
- Update
- Delete
- Approvals
- Payments

## AI Rules

When generating workflows:

**Always:**
- ✓ Reuse existing modules
- ✓ Use Transactions
- ✓ Use Notification Service
- ✓ Use Audit Service
- ✓ Keep approval flows manual

**Never:**
- ✗ Auto approve
- ✗ Skip validation
- ✗ Duplicate workflows
- ✗ Duplicate notification systems

## Future Workflow Extensions

New modules should follow existing patterns.

Examples:
- Placement
- Club Management
- Sports
- Events
- Alumni
- Internship
- Research

Reuse existing approval, notification, authentication, and transaction workflows whenever possible.

## Final Goal

Every feature added to EOS ERP should integrate naturally with the existing workflows.

No module should operate independently when a shared workflow already exists.

*End of File*
