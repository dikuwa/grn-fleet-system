/**
 * Driver Licence Document — React-PDF Component
 *
 * Renders a downloadable/printable driving licence summary with
 * tenant branding, licence details, verification QR, and authenticity footer.
 */

import React from 'react';
import { Document } from '@react-pdf/renderer';
import type { ResolvedTenantBranding } from '@/lib/tenant-branding';
import {
  DocumentPage,
  DocumentHeader,
  DocumentSection,
  DocumentFieldGrid,
  DocumentVerificationBlock,
  DocumentVerificationFooter,
} from './document-system';

export interface DriverLicenceData {
  /** Licence record id */
  licenceId: string;
  /** Driver / holder full name */
  holderName: string;
  /** e.g. B, EB, C1 */
  licenceClass: string;
  /** Licence number */
  licenceNumber: string;
  /** Issue date (ISO or display string) */
  issueDate: string;
  /** Expiry date (ISO or display string) */
  expiryDate: string;
  /** Driver restriction code e.g. "01" */
  driverRestrictionCode?: string;
  /** Issue number for the licence card */
  issueNumber?: string;
  /** Allowed vehicle categories */
  allowedVehicleCategories?: string;
  /** National ID number for the driver */
  nationalIdNumber?: string;
  /** Tenant details */
  tenantName?: string;
  branding?: ResolvedTenantBranding | null;
  /** Verification code for QR */
  verificationCode: string;
  /** Verification URL for QR */
  verificationUrl?: string;
  /** QR code as data-URI */
  qrCode?: string;
  /** Document version */
  documentVersion: number;
  /** Generation timestamp */
  generatedAt: string;
  /** Licence status */
  status: string;
}

export function DriverLicenceDocument({ data }: { data: DriverLicenceData }) {
  const {
    holderName,
    licenceClass,
    licenceNumber,
    issueDate,
    expiryDate,
    driverRestrictionCode,
    issueNumber,
    allowedVehicleCategories,
    nationalIdNumber,
    tenantName,
    branding,
    verificationCode,
    verificationUrl,
    qrCode,
    documentVersion,
    generatedAt,
    status,
  } = data;

  // Evaluate document status at generation time (deterministic — avoids
  // impure Date.now() calls during render).
  const generatedTime = new Date(generatedAt).getTime();
  const hasGeneratedTime = Number.isFinite(generatedTime);
  const expiryTime = new Date(expiryDate).getTime();
  const isExpired = hasGeneratedTime && expiryTime < generatedTime;
  const daysLeft = hasGeneratedTime
    ? Math.ceil((expiryTime - generatedTime) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <Document title={`Driving Licence — ${licenceNumber}`}>
      <DocumentPage status={status === 'draft' ? 'draft' : undefined}>
        {/* ===== HEADER ===== */}
        <DocumentHeader
          branding={branding}
          title="Driving Licence"
          reference={licenceNumber}
          version={documentVersion}
          status={isExpired ? 'EXPIRED' : daysLeft <= 30 ? 'EXPIRING' : 'VALID'}
          issueDate={generatedAt.split('T')[0]}
          qrCode={qrCode}
        />

        {/* ===== LICENCE DETAILS ===== */}
        <DocumentSection title="Licence Details">
          <DocumentFieldGrid
            fields={[
              { label: 'Holder Name', value: holderName },
              { label: 'Licence Number', value: licenceNumber },
              { label: 'Licence Class', value: licenceClass },
              { label: 'Issue Date', value: issueDate },
              { label: 'Expiry Date', value: expiryDate },
              { label: 'Status', value: isExpired ? 'Expired' : daysLeft <= 30 ? `Expiring (${daysLeft} days)` : 'Valid' },
              ...(issueNumber ? [{ label: 'Issue Number', value: issueNumber }] : []),
              ...(driverRestrictionCode ? [{ label: 'Restriction Code', value: driverRestrictionCode }] : []),
              ...(allowedVehicleCategories ? [{ label: 'Vehicle Categories', value: allowedVehicleCategories }] : []),
              ...(nationalIdNumber ? [{ label: 'National ID', value: `••••${nationalIdNumber.slice(-4)}` }] : []),
            ]}
          />
        </DocumentSection>

        {/* ===== ISSUING NOTES ===== */}
        <DocumentSection title="Issuing Information">
          <DocumentFieldGrid
            fields={[
              { label: 'Issuing Authority', value: branding?.organisationName || tenantName || 'Government of Namibia' },
              { label: 'Document Generated', value: generatedAt },
              { label: 'Version', value: String(documentVersion) },
            ]}
          />
        </DocumentSection>

        {/* ===== VERIFICATION ===== */}
        <DocumentVerificationBlock
          branding={branding}
          verificationCode={verificationCode}
          verificationUrl={verificationUrl}
          qrCode={qrCode}
        />

        {/* ===== FOOTER ===== */}
        <DocumentVerificationFooter
          branding={branding}
          verificationCode={verificationCode}
          verificationUrl={verificationUrl}
        />
      </DocumentPage>
    </Document>
  );
}
