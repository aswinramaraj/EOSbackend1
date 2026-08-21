# EOS ERP Backend Architecture

**Version:** 1.0

## Overview

EOS ERP follows a modular, scalable, and maintainable backend architecture based on Clean Architecture principles.

The system is built using NestJS, Prisma ORM, and PostgreSQL.

Every feature is implemented as an independent module while sharing common services and infrastructure.

## High-Level Architecture

```
                Client Applications
                       │
        ┌──────────────┼──────────────┐
        │              │              │
     Web App      Mobile App      Admin Portal
        │              │              │
        └──────────────┼──────────────┘
                       │
                  REST API (NestJS)
                       │
      ┌────────────────┴────────────────┐
      │                                 │
 Authentication                  Business Modules
      │                                 │
      └────────────────┬────────────────┘
                       │
                 Service Layer
                       │
                 Repository Layer
                       │
                    Prisma ORM
                       │
                PostgreSQL Database
```

## Request Lifecycle

Every request follows the same lifecycle.

```
Client
  ↓
Controller
  ↓
DTO Validation
  ↓
Authentication
  ↓
Authorization
  ↓
Service
  ↓
Repository
  ↓
Prisma
  ↓
PostgreSQL
  ↓
Response
```

## Layer Responsibilities

### Controller

Responsibilities:
- Receive HTTP requests
- Validate DTOs
- Extract route/query/body parameters
- Call service methods
- Return standardized responses

Controllers must NOT:
- Access Prisma
- Write SQL
- Contain business logic

### Service

Responsibilities:
- Business rules
- Validation beyond DTOs
- Transactions
- Workflow execution
- Permission checks
- Event publishing

Services coordinate multiple repositories when needed.

### Repository

Responsibilities:
- Database operations
- Prisma queries
- Pagination
- Filtering
- Search queries

Repositories must NOT:
- Perform business logic
- Send notifications
- Validate permissions

### Prisma

Responsibilities:
- Database mapping
- CRUD operations
- Relations
- Transactions

Prisma should never contain business logic.

### PostgreSQL

Responsibilities:
- Data persistence
- Constraints
- Foreign keys
- Indexes
- Cascade rules

Business workflows should remain in the application layer.

## Module Structure

Every module should follow the same structure.

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

## Shared Layer

Reusable components belong in shared modules.

Examples:
- Authentication
- Authorization
- Response helpers
- Pagination
- File upload
- Notifications
- Logging
- Utilities
- Exceptions

Avoid duplicating shared logic inside feature modules.

## Dependency Flow

**Allowed:**
```
Controller → Service → Repository → Prisma → Database
```

**Not Allowed:**
```
Controller → Prisma
Controller → Database
Repository → Service
```

## Module Communication

Modules communicate through services.

Example:
```
Team Module → Notification Service → Push Notification
```

Do not directly manipulate another module's database tables.

## Transactions

Use Prisma transactions whenever multiple tables are updated.

Examples:
- Team approval
- Fee payment
- Student admission
- Library issue/return
- Hostel allocation

## Event-Driven Design

Modules should publish events for cross-module actions.

Examples:
- StudentRegistered
- FeePaid
- TeamCreated
- TeamApproved
- NotificationCreated

Other modules listen for these events without tight coupling.

## Error Handling

All exceptions should be handled centrally.

Use:
- BadRequestException
- UnauthorizedException
- ForbiddenException
- NotFoundException
- ConflictException

Avoid returning raw database errors.

## Logging

Log important actions.

Examples:
- Login
- Team creation
- Team deletion
- Fee payment
- Attendance update

Avoid logging sensitive information.

## Scalability Principles

- Keep modules independent.
- Prefer composition over duplication.
- Use dependency injection.
- Use interfaces for abstractions.
- Design for future modules.

## AI Guidelines

When generating backend code:

- Follow the architecture exactly.
- Never bypass the service layer.
- Never access Prisma from controllers.
- Keep repositories focused on database access.
- Reuse shared services.
- Maintain consistent folder structure.
- Write modular and maintainable code.

*End of File*
