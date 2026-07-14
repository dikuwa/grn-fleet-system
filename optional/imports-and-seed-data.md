# Imports and Seed Data

## Supported imports

- Employees/staff: CSV and XLSX
- Vehicles: CSV and XLSX
- Offices/departments: CSV and XLSX

## Import workflow

1. Upload private source file.
2. Select import type.
3. Detect sheet and header row.
4. Map source columns to system fields.
5. Normalise dates, names, gender, titles and office values.
6. Validate each row.
7. Detect duplicates and possible matches.
8. Review/correct rows.
9. Commit valid rows in a transaction or selected batches.
10. Produce import report and audit event.

## Staff-source warning

The supplied KERC list contains OCR/layout inconsistencies, including totals that do not visibly reconcile with the numbered list and committee heading. Do not silently seed all parsed values. Use it to test mapping/review and require a human to approve corrected rows.

## Staff fields

- employee number
- title
- first/middle/last names
- gender (optional/configurable)
- job title/grade
- department/directorate
- office
- email/phone
- employment status
- driver status

Import does not create a user account. Account activation is a separate authorised action.

## Vehicle fields

See `seed-data/vehicle-import-template.csv`.

## Local demo seed

Use fictional emails and clearly mark sample data. Include users for each workflow role, two tenants, vehicles with different states and sample requests at multiple stages. Never use a real password in documentation.
