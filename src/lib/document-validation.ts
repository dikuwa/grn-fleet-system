/**
 * Document Snapshot Validation
 *
 * Validates document snapshot data against JSON Schema definitions
 * before storage, ensuring data integrity and preventing corrupt data
 * from entering the document store.
 *
 * Each document type has its own schema definition that defines the
 * expected shape, types, and required fields of the snapshot data.
 */

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  /** Mark this specific field as required */
  required?: boolean;
  /** For object fields, the nested schema */
  properties?: Record<string, SchemaField>;
  /** For array fields, the item schema */
  items?: SchemaField;
  /** Allow null in addition to the specified type */
  nullable?: boolean;
  /** Whether additional properties beyond `properties` are allowed */
  additionalProperties?: boolean;
  /** Custom validation function */
  validate?: (value: unknown) => string | null;
}

interface Schema {
  type: 'object';
  /** Top-level required field names (checked against schema properties) */
  required?: string[];
  properties: Record<string, SchemaField>;
  /** Whether additional properties beyond `properties` are allowed */
  additionalProperties?: boolean;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function validateField(value: unknown, fieldName: string, field: SchemaField, path: string): string[] {
  const errors: string[] = [];
  const currentPath = path ? `${path}.${fieldName}` : fieldName;

  // Handle null/undefined
  if (value === null || value === undefined) {
    if (field.required && !field.nullable) {
      errors.push(`${currentPath}: required field is missing or null`);
    }
    return errors;
  }

  // Type check
  const actualType = Array.isArray(value) ? 'array' : typeof value;

  if (actualType !== field.type) {
    // Allow nullable fields
    if (field.nullable && (value === null || value === undefined)) {
      return errors;
    }
    errors.push(`${currentPath}: expected type ${field.type}, got ${actualType}`);
    return errors;
  }

  // Object validation
  if (field.type === 'object' && field.properties && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const [key, propField] of Object.entries(field.properties)) {
      errors.push(...validateField(obj[key], key, propField, currentPath));
    }

    // Check for unexpected properties
    if (!field.additionalProperties) {
      for (const key of Object.keys(obj)) {
        if (!field.properties[key]) {
          errors.push(`${currentPath}.${key}: unexpected property`);
        }
      }
    }
  }

  // Array validation
  if (field.type === 'array' && field.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateField(value[i], `${fieldName}[${i}]`, field.items, path));
    }
  }

  // Custom validation
  if (field.validate) {
    const customError = field.validate(value);
    if (customError) {
      errors.push(`${currentPath}: ${customError}`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Document type schemas
// ---------------------------------------------------------------------------

const TRANSPORT_REQUEST_SCHEMA: Schema = {
  type: 'object',
  required: ['id', 'reference', 'scope', 'status'],
  properties: {
    id: { type: 'string', required: true },
    reference: { type: 'string', required: true },
    revision: { type: 'number' },
    scope: { type: 'string', required: true },
    status: { type: 'string', required: true },
    department: { type: 'string', nullable: true },
    purpose: { type: 'string', nullable: true },
    requester: { type: 'string' },
    totalAuthorisedKilometres: { type: 'number', nullable: true },
    specialAuthorityRequired: { type: 'boolean' },
    submittedAt: { type: 'string', nullable: true },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', required: true },
          venue: { type: 'string', nullable: true },
          startDate: { type: 'string', required: true },
          endDate: { type: 'string', required: true },
          estimatedKilometres: { type: 'number', nullable: true },
        },
      },
    },
    drivers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          driverType: { type: 'string', required: true },
          sortOrder: { type: 'number' },
        },
      },
    },
  },
};

const TRIP_AUTHORITY_SCHEMA: Schema = {
  type: 'object',
  required: ['allocationId', 'vehicle'],
  properties: {
    allocationId: { type: 'string', required: true },
    requestReference: { type: 'string' },
    scope: { type: 'string' },
    vehicle: {
      type: 'object',
      required: true,
      properties: {
        grnNumber: { type: 'string', required: true },
        registrationNumber: { type: 'string', nullable: true },
        make: { type: 'string' },
        model: { type: 'string' },
      },
    },
    startAt: { type: 'string', required: true },
    endAt: { type: 'string', required: true },
    state: { type: 'string' },
    allocatedByUserId: { type: 'string' },
  },
};

const INSPECTION_REPORT_SCHEMA: Schema = {
  type: 'object',
  required: ['inspectionId', 'type', 'vehicle'],
  properties: {
    inspectionId: { type: 'string', required: true },
    type: { type: 'string', required: true },
    vehicle: {
      type: 'object',
      required: true,
      properties: {
        grnNumber: { type: 'string', required: true },
        registrationNumber: { type: 'string', nullable: true },
      },
    },
    odometerReading: { type: 'number', nullable: true },
    fuelLevel: { type: 'string', nullable: true },
    overallPass: { type: 'boolean', nullable: true },
    status: { type: 'string' },
    notes: { type: 'string', nullable: true },
    inspectedAt: { type: 'string' },
  },
};

const FUEL_SUMMARY_SCHEMA: Schema = {
  type: 'object',
  required: ['tripId', 'totalLitres', 'totalCost'],
  properties: {
    tripId: { type: 'string', required: true },
    totalLitres: { type: 'number', required: true },
    totalCost: { type: 'number', required: true },
    transactionCount: { type: 'number' },
    pendingReimbursements: { type: 'number' },
    actualKilometres: { type: 'number', nullable: true },
    kilometreVariance: { type: 'number', nullable: true },
  },
};

const TRIP_COMPLETION_SCHEMA: Schema = {
  type: 'object',
  required: ['tripId', 'status', 'vehicle'],
  properties: {
    tripId: { type: 'string', required: true },
    status: { type: 'string', required: true },
    vehicle: {
      type: 'object',
      required: true,
      properties: {
        grnNumber: { type: 'string', required: true },
        registrationNumber: { type: 'string', nullable: true },
      },
    },
    issuedAt: { type: 'string', nullable: true },
    startedAt: { type: 'string', nullable: true },
    returnedAt: { type: 'string', nullable: true },
    closedAt: { type: 'string', nullable: true },
    closure: {
      type: 'object',
      nullable: true,
      properties: {
        authorisedKm: { type: 'number', nullable: true },
        actualKm: { type: 'number', nullable: true },
        variance: { type: 'number', nullable: true },
        decision: { type: 'string' },
        notes: { type: 'string', nullable: true },
      },
    },
    fuelSummary: {
      type: 'object',
      nullable: true,
      properties: {
        tripId: { type: 'string' },
        totalLitres: { type: 'number' },
        totalCost: { type: 'number' },
        transactionCount: { type: 'number' },
        pendingReimbursements: { type: 'number' },
        actualKilometres: { type: 'number', nullable: true },
        kilometreVariance: { type: 'number', nullable: true },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

const SCHEMAS: Record<string, Schema> = {
  transport_request: TRANSPORT_REQUEST_SCHEMA,
  trip_authority: TRIP_AUTHORITY_SCHEMA,
  inspection_report: INSPECTION_REPORT_SCHEMA,
  fuel_summary: FUEL_SUMMARY_SCHEMA,
  trip_completion: TRIP_COMPLETION_SCHEMA,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate document snapshot data against its type schema.
 * Returns `{ valid: true/false, errors: string[], warnings: string[] }`.
 */
export function validateDocumentSnapshot(
  documentType: string,
  data: Record<string, unknown>,
): ValidationResult {
  const schema = SCHEMAS[documentType];

  if (!schema) {
    return {
      valid: false,
      errors: [`No validation schema defined for document type: ${documentType}`],
      warnings: [],
    };
  }

  const errors: string[] = [];

  // Check top-level required fields from schema.required array
  if (schema.required) {
    for (const key of schema.required) {
      if (data[key] === undefined || data[key] === null) {
        errors.push(`${key}: required top-level field is missing`);
      }
    }
  }

  // Validate each property against its field schema
  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    errors.push(...validateField(data[key], key, fieldSchema, ''));
  }

  // Check for unexpected top-level properties
  if (schema.additionalProperties !== undefined && !schema.additionalProperties) {
    for (const key of Object.keys(data)) {
      if (!schema.properties[key]) {
        errors.push(`${key}: unexpected top-level property`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

/**
 * Check if a schema exists for a given document type.
 */
export function hasSchema(documentType: string): boolean {
  return documentType in SCHEMAS;
}

/**
 * Get the list of supported document types with validation schemas.
 */
export function getSupportedDocumentTypes(): string[] {
  return Object.keys(SCHEMAS);
}
