# GovFleet — Test Credential Inventory

> **Tenant:** Kavango East Regional Council  
> **Default password for all test accounts:** `changeme`  
> **Login accepts:** username or email (case-insensitive for email)  
> **Login URL:** `/login`  
> **Username uniqueness scope:** global (all usernames must be unique across tenants)  
> **Email uniqueness scope:** global

---

## Platform-Level Accounts

| Username | Email | Display Name | Role | Employee # |
|---|---|---|---|---|
| `platform-admin` | `platform.admin@grnfleet.test` | Paulus Platform | Platform Administrator | KERC014 |

These accounts can:
- Manage all tenants
- Create/configure tenant administrators
- Access platform analytics and audit logs

---

## Tenant-Level Accounts (Kavango East)

| Username | Email | Display Name | Role / Job Title | Employee # |
|---|---|---|---|---|
| `tenant-admin` | `admin@kavangoeast.gov.na` | Kandjimi Amupanda | Tenant Administrator | KERC001 |
| `transport-admin` | `transport.admin@kavangoeast.test` | Ndapewa Hamutenya | Transport Administrator | KERC011 |
| `requester` | `requester@kavangoeast.test` | Maria Shikongo | Programme Officer (Requester) | KERC002 |
| `supervisor` | `supervisor@kavangoeast.test` | Petrus Ndara | Supervisor (Authoriser) | KERC003 |
| `release-officer` | `release.officer@kavangoeast.test` | Erastus Hausiku | Control Administrative Officer | KERC004 |
| `regional-authoriser` | `regional.authoriser@kavangoeast.test` | Loide Kandjiri | Deputy Director | KERC005 |
| `national-release` | `national.release@kavangoeast.test` | Tomas Sikongo | Director | KERC006 |
| `national-authoriser` | `national.authoriser@kavangoeast.test` | Rafael Kasume | Chief Regional Officer | KERC007 |
| `driver` | `driver@kavangoeast.test` | Michael Mwala | Driver (Head Office) | KERC008 |
| `inspector` | `inspector@kavangoeast.test` | Tangeni Ndeitunga | Vehicle Inspector | KERC012 |
| `maintenance` | `maintenance@kavangoeast.test` | Hilma Nakashole | Maintenance Officer | KERC013 |
| `auditor` | `auditor@kavangoeast.test` | Johannes Shivute | Tenant Auditor | KERC010 |

---

## Workflow Assignment Map

| Step | Action | Assigned User | Regional | National |
|---|---|---|---|---|
| 1 | Supervisor Approval | Petrus Ndara (`supervisor`) | ✅ | ✅ |
| 2 | Transport Review | Ndapewa Hamutenya (`transport-admin`) | ✅ | ✅ |
| 3 | Administrative Release | Erastus Hausiku (`release-officer`) | ✅ | — |
| 3 | Director Release | Tomas Sikongo (`national-release`) | — | ✅ |
| 4 | Authorisation | Loide Kandjiri (`regional-authoriser`) | ✅ | — |
| 4 | CRO Authorisation | Rafael Kasume (`national-authoriser`) | — | ✅ |
| 5 | Driver Acknowledgement | Michael Mwala (`driver`) | ✅ | ✅ |

---

## End-to-End Test Flow

### Requester → Trip (Regional)

1. Sign in as `requester`
2. Create a transport request with activities, passengers, route
3. Submit the request
4. Sign out

### Authorise the Request

5. Sign in as `supervisor` → approve the request
6. Sign in as `transport-admin` → review and allocate a vehicle
7. Sign in as `release-officer` → release the allocation
8. Sign in as `regional-authoriser` → authorise the trip

### Driver Workflow

9. Sign in as `driver` → acknowledge the trip
10. Perform departure inspection
11. Complete the trip, add fuel record
12. Perform return inspection

### Close the Trip

13. Sign in as `transport-admin` → closure review → close the trip

### Maintenance

14. Sign in as `maintenance` → create/update maintenance record

### Profile & Avatar

15. Any user → navigate to Profile → upload a JPEG/PNG/WebP image → verify it updates immediately across all views

---

## Test Data

### Vehicles

| Licence | Make | Model | Status | Office |
|---|---|---|---|---|
| GRN-001-2024 | Toyota | Corolla | Available | Head Office |
| GRN-002-2024 | Nissan | Sentra | Available | Head Office |
| GRN-003-2024 | Toyota | Hilux Double Cab | Available | Head Office |
| GRN-004-2024 | Ford | Ranger Double Cab | In Maintenance | Head Office |
| GRN-005-2024 | Toyota | Hilux Double Cab | Available | Rundu Urban |

### Offices

Head Office — Rundu, Rundu Urban, Rundu Rural West, Rundu Rural East, Mukwe, Kapako, Mashare, Nkurenkuru

---

## Notes

- **Password security**: All accounts use `changeme`. Change this in production by setting `SEED_ADMIN_PASSWORD` env var before running `pnpm db:seed`.
- **Username login**: Uses the `custom-sign-in` API which resolves username or email to the user record.
- **First-login password change**: Supported via `requiresPasswordChange` flag on user profiles but disabled for all seed accounts.
- **Email login**: Also works — use any of the email addresses listed above.
