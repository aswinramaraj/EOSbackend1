# EOS ERP Backend Development Guidelines

**Version:** 1.0

## Purpose

This document defines the backend development standards for EOS ERP.

Every module developed for EOS must follow these rules.

The goal is to ensure:
- Consistent code
- Maintainable architecture
- Reusable components
- Scalable design

## Backend Stack

- **Framework:** NestJS
- **Language:** TypeScript
- **ORM:** Prisma
- **Database:** PostgreSQL (Supabase)
- **Authentication:** JWT
- **Documentation:** Swagger
- **Validation:** class-validator, class-transformer

## Development Principles

Always follow:
- SOLID Principles
- DRY (Don't Repeat Yourself)
- KISS (Keep It Simple)
- Clean Architecture
- Repository Pattern
- Dependency Injection

## Module Structure

Every module should follow this structure.

```
src/modules/
  module-name/
    ├── controller/
    ├── service/
    ├── repository/
    ├── dto/
    ├── entities/
    ├── interfaces/
    ├── enums/
    ├── constants/
    ├── validators/
    ├── decorators/
    ├── guards/
    ├── events/
    ├── listeners/
    └── module.ts
```

## Controller Rules

Controllers should:
- ✓ Receive HTTP requests
- ✓ Validate DTO
- ✓ Call Service
- ✓ Return Response

Controllers must NEVER:
- ✗ Query Prisma
- ✗ Write SQL
- ✗ Access Database
- ✗ Contain Business Logic

**Good:**
```
Controller → Service
```

**Bad:**
```
Controller → Prisma
```

## Service Rules

Services contain:
- ✓ Business Logic
- ✓ Transactions
- ✓ Permission Checks
- ✓ Workflow Logic
- ✓ Validation
- ✓ Event Publishing

Services should coordinate repositories.

## Repository Rules

Repositories are responsible only for database access.

**Allowed:**
- ✓ Prisma Queries
- ✓ Pagination
- ✓ Filtering
- ✓ Search
- ✓ Transactions (called from Service)

**Not Allowed:**
- ✗ Business Logic
- ✗ Notifications
- ✗ Authorization

## DTO Rules

Every POST, PUT, PATCH endpoint must use DTOs.

Use class-validator. Examples:
- IsString
- IsEmail
- IsUUID
- IsInt
- IsOptional
- IsBoolean
- Min
- Max

Never accept raw request bodies.

## Validation

Validate:
- Body
- Query
- Params

Never trust frontend validation.

## Prisma Rules

Always use Prisma. Never write raw SQL unless necessary.

Use:
- include
- select
- transactions

Avoid unnecessary queries.

## Transactions

Operations involving multiple tables must use a Prisma Transaction.

Examples:
- Student Admission
- Team Approval
- Hostel Allocation
- Fee Payment

## Error Handling

Throw NestJS Exceptions. Use:
- BadRequestException
- UnauthorizedException
- ForbiddenException
- NotFoundException
- ConflictException
- InternalServerErrorException

Never expose raw database errors.

## API Response Format

**Success:**
```json
{ "success": true, "message": "Success", "data": {} }
```

**Failure:**
```json
{ "success": false, "message": "Error", "errors": [] }
```

Maintain this structure across all modules.

## Authentication

Use JWT Guard.

Protected APIs require `Authorization: Bearer <token>`.

Never trust client-provided user IDs. Always derive the authenticated user from the JWT.

## Authorization

Use RBAC.

Current Roles:
- Admin
- Student
- Faculty

Use Guards for authorization. Do not check roles inside controllers.

## Database Rules

Database should only handle:
- Foreign Keys
- Constraints
- Indexes
- Cascade Delete
- Timestamp Updates

Business workflows belong in Services.

## Logging

Log important events. Examples:
- Login
- Team Created
- Team Deleted
- Fee Paid
- Attendance Updated

Never log passwords or tokens.

## File Upload

Store files in Cloudflare R2. Only store metadata in PostgreSQL.

## Notifications

Use the centralized Notification Module.

Feature modules should never send push notifications directly. Publish events instead.

## Naming Conventions

- **Controllers:** `StudentController`
- **Services:** `StudentService`
- **Repositories:** `StudentRepository`
- **DTO:** `CreateStudentDto`, `UpdateStudentDto`
- **Entities:** `StudentEntity`
- **Enums:** `StudentStatus`
- **Interfaces:** `StudentResponse`

## Code Quality

Write:
- Small functions
- Reusable methods
- Readable code
- Descriptive names

Avoid:
- Duplicate logic
- Magic numbers
- Hardcoded strings
- Deep nesting

## AI Development Rules

When generating backend code:

**Always:**
- ✓ Follow Repository Pattern
- ✓ Use DTO Validation
- ✓ Use Dependency Injection
- ✓ Use Prisma
- ✓ Use Transactions
- ✓ Keep Services Clean
- ✓ Keep Controllers Thin

**Never:**
- ✗ Access Prisma from Controllers
- ✗ Put Business Logic in Repositories
- ✗ Duplicate Existing ERP Tables
- ✗ Use SQL Triggers for Business Logic

## Final Goal

Every backend module should be:
- Modular
- Testable
- Maintainable
- Scalable
- Consistent

The generated code should integrate seamlessly with the existing EOS ERP architecture.

*End of File*
