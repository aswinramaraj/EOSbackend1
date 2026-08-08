# Module 1 — Auth
**Base URL prefix:** `/api/v1/auth`
**Rate limit on login:** 5 requests / 60 seconds per IP

---

## Endpoint 1: User Login

### 1. Endpoint Information

| Field | Value |
|---|---|
| **Module** | Auth |
| **API Name** | User Login |
| **HTTP Method** | POST |
| **URL** | `/api/v1/auth/login` |
| **Purpose** | Authenticate user and issue a signed JWT |
| **Auth Required** | No |
| **Roles** | Public |
| **Rate Limit** | 5 / 60 s per IP |

---

### 2. Request
**Headers:**
| Header | Required | Value |
|--------|----------|-------|
| `Content-Type` | Yes | `application/json` |

**Request Body:**
| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `email` | string | Yes | Valid email, max 255 | Must match a `users.email` row |
| `password` | string | Yes | Min 6 chars | Compared against `users.password_hash` |

**Example:**
```json
{
  "email": "admin@eos.test",
  "password": "EOS@test123"
}
```

---

### 3. Success Response — 200 OK
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "email": "admin@eos.test",
      "role": "admin",
      "roleId": 1
    }
  },
  "timestamp": "2026-07-26T08:00:00.000Z"
}
```

Token expires in **8 hours** (configurable via `JWT_EXPIRES_IN` env).

---

### 4. Error Responses

| Status | errorCode | Cause |
|--------|-----------|-------|
| 400 | `VALIDATION_ERROR` | Missing / malformed `email` or `password` |
| 401 | `INVALID_CREDENTIALS` | Email not found OR password wrong |
| 403 | `ACCOUNT_INACTIVE` | Correct credentials but `users.status ≠ 'active'` |
| 429 | `RATE_LIMIT_EXCEEDED` | > 5 attempts in 60 s from same IP |
| 500 | `INTERNAL_ERROR` | DB failure, JWT signing error |

> **Security note:** 401 returns the same message for both "email not found" and "wrong password" — intentional, prevents user enumeration.

---

### 5. Processing Flow

```
Client → POST /auth/login
  → LoginDto validation (email format, password min-length)
  → AuthService.login()
  → prisma.users.findUnique({ where: { email } })
  → [Not found] → 401 INVALID_CREDENTIALS
  → [status ≠ 'active'] → 403 ACCOUNT_INACTIVE
  → SHA-256 hash comparison against password_hash
  → [Mismatch] → 401 INVALID_CREDENTIALS
  → jwt.sign({ sub, email, role, roleId }) → accessToken
  → 200 OK { accessToken, user }
```

---

### 6. Business Rules

- Email lookup is **case-insensitive** (stored as lowercase).
- Accounts are created by Admin only — no self-registration via this endpoint.
- Password is **never** logged or returned in any response.
- JWT payload: `{ sub: userId, email, role, roleId, iat, exp }`.

---

## Endpoint 2: Get Current User Profile

### 1. Endpoint Information

| Field | Value |
|---|---|
| **Module** | Auth |
| **API Name** | Get My Profile |
| **HTTP Method** | GET |
| **URL** | `/api/v1/auth/me` |
| **Purpose** | Return authenticated user's profile with role & linked entity (faculty/student) |
| **Auth Required** | Yes — Bearer token |
| **Roles** | All authenticated roles |
| **Rate Limit** | Default (100 / 60 s) |

---

### 2. Request

**Headers:**
| Header | Required | Value |
|--------|----------|-------|
| `Authorization` | Yes | `Bearer <accessToken>` |

No request body. No query params.

---

### 3. Success Response — 200 OK

```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "admin@eos.test",
    "phone": null,
    "status": "active",
    "created_at": "2026-07-26T06:24:44.000Z",
    "roles": {
      "id": 1,
      "name": "admin",
      "description": "System Administrator – full access"
    },
    "faculty": null,
    "students": null
  }
}
```

`faculty` is populated if the user is linked to a faculty record.
`students` is populated if the user is linked to a student record.

---

### 4. Error Responses

| Status | errorCode | Cause |
|--------|-----------|-------|
| 401 | `UNAUTHORIZED` | No token, expired token, or invalid signature |
| 500 | `INTERNAL_ERROR` | DB failure |

---

### 5. Security

- Token is verified by `JwtAuthGuard` before the handler runs.
- Password hash is **never** included in this response.
- `RolesGuard` is not applied — all valid token holders can call this.
