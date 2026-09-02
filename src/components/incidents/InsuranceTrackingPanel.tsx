'use client';

import { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Textarea } from '@/components/ui/input';
import {
  Shield,
  Save,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface InsuranceData {
  insuranceClaimReference: string | null;
  insuranceNotified: boolean;
  insuranceNotifiedAt: string | null;
  policeReportFiled: boolean;
  thirdPartyInsuranceDetails: Record<string, unknown> | null;
}

interface Props {
  incidentId: string;
  data: InsuranceData;
  onUpdate: () => void;
}

const THIRD_PARTY_FIELD_GROUPS = {
  insurerName: ['insurerName', 'insurer'],
  insurerPhone: ['insurerPhone', 'phone'],
  policyNumber: ['policyNumber', 'policy'],
  details: ['details', 'description'],
} as const;

function firstDisplayValue(
  details: Record<string, unknown>,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = details[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }
  }
  return '';
}

function replaceFieldGroup(
  target: Record<string, unknown>,
  aliases: readonly string[],
  canonicalKey: string,
  value: string,
) {
  for (const alias of aliases) delete target[alias];
  if (value) target[canonicalKey] = value;
}

export function InsuranceTrackingPanel({ incidentId, data, onUpdate }: Props) {
  const { toast } = useToast();
  const storedThirdPartyDetails = data.thirdPartyInsuranceDetails || {};
  const initialTpInsurerName = firstDisplayValue(
    storedThirdPartyDetails,
    THIRD_PARTY_FIELD_GROUPS.insurerName,
  );
  const initialTpInsurerPhone = firstDisplayValue(
    storedThirdPartyDetails,
    THIRD_PARTY_FIELD_GROUPS.insurerPhone,
  );
  const initialTpInsurerPolicy = firstDisplayValue(
    storedThirdPartyDetails,
    THIRD_PARTY_FIELD_GROUPS.policyNumber,
  );
  const initialTpDetails = firstDisplayValue(
    storedThirdPartyDetails,
    THIRD_PARTY_FIELD_GROUPS.details,
  );

  const [claimRef, setClaimRef] = useState(data.insuranceClaimReference || '');
  const [notified, setNotified] = useState(data.insuranceNotified);
  const [policeFiled, setPoliceFiled] = useState(data.policeReportFiled);
  const [tpInsurerName, setTpInsurerName] = useState(initialTpInsurerName);
  const [tpInsurerPhone, setTpInsurerPhone] = useState(initialTpInsurerPhone);
  const [tpInsurerPolicy, setTpInsurerPolicy] = useState(initialTpInsurerPolicy);
  const [tpDetails, setTpDetails] = useState(initialTpDetails);
  const [saving, setSaving] = useState(false);

  const saveInsurance = useCallback(async () => {
    setSaving(true);
    try {
      const normalizedThirdPartyFields = {
        insurerName: tpInsurerName.trim(),
        insurerPhone: tpInsurerPhone.trim(),
        policyNumber: tpInsurerPolicy.trim(),
        details: tpDetails.trim(),
      };
      const changedFields = {
        insurerName: normalizedThirdPartyFields.insurerName !== initialTpInsurerName.trim(),
        insurerPhone: normalizedThirdPartyFields.insurerPhone !== initialTpInsurerPhone.trim(),
        policyNumber: normalizedThirdPartyFields.policyNumber !== initialTpInsurerPolicy.trim(),
        details: normalizedThirdPartyFields.details !== initialTpDetails.trim(),
      };
      const thirdPartyFieldsChanged = Object.values(changedFields).some(Boolean);

      const body: Record<string, unknown> = {
        insuranceClaimReference: claimRef.trim() || null,
        insuranceNotified: notified,
        policeReportFiled: policeFiled,
      };

      if (thirdPartyFieldsChanged) {
        const nextThirdPartyDetails: Record<string, unknown> = { ...storedThirdPartyDetails };

        if (changedFields.insurerName) {
          replaceFieldGroup(
            nextThirdPartyDetails,
            THIRD_PARTY_FIELD_GROUPS.insurerName,
            'insurerName',
            normalizedThirdPartyFields.insurerName,
          );
        }
        if (changedFields.insurerPhone) {
          replaceFieldGroup(
            nextThirdPartyDetails,
            THIRD_PARTY_FIELD_GROUPS.insurerPhone,
            'insurerPhone',
            normalizedThirdPartyFields.insurerPhone,
          );
        }
        if (changedFields.policyNumber) {
          replaceFieldGroup(
            nextThirdPartyDetails,
            THIRD_PARTY_FIELD_GROUPS.policyNumber,
            'policyNumber',
            normalizedThirdPartyFields.policyNumber,
          );
        }
        if (changedFields.details) {
          replaceFieldGroup(
            nextThirdPartyDetails,
            THIRD_PARTY_FIELD_GROUPS.details,
            'details',
            normalizedThirdPartyFields.details,
          );
        }

        body.thirdPartyInsuranceDetails = Object.keys(nextThirdPartyDetails).length
          ? nextThirdPartyDetails
          : null;
      }

      const res = await fetch(`/api/incidents/${incidentId}/insurance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      toast({ title: 'Insurance details updated', variant: 'success' });
      onUpdate();
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Update failed',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [
    incidentId,
    claimRef,
    notified,
    policeFiled,
    tpInsurerName,
    tpInsurerPhone,
    tpInsurerPolicy,
    tpDetails,
    initialTpInsurerName,
    initialTpInsurerPhone,
    initialTpInsurerPolicy,
    initialTpDetails,
    storedThirdPartyDetails,
    toast,
    onUpdate,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Shield className="h-4 w-4" />
          Insurance & Police
          {data.insuranceNotified && (
            <Badge variant="success" size="sm">Notified</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-700"
              checked={notified}
              onChange={(e) => setNotified(e.target.checked)}
            />
            <Shield className="h-4 w-4 text-ink-400" />
            Insurance company notified
          </label>
          {data.insuranceNotifiedAt && (
            <span className="text-xs text-ink-500">
              on {new Date(data.insuranceNotifiedAt).toLocaleDateString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-700"
              checked={policeFiled}
              onChange={(e) => setPoliceFiled(e.target.checked)}
            />
            <AlertTriangle className="h-4 w-4 text-ink-400" />
            Police report filed
          </label>
        </div>

        <div className="space-y-1">
          <Label className="text-sm font-medium">Claim reference</Label>
          <Input
            value={claimRef}
            onChange={(e) => setClaimRef(e.target.value)}
            placeholder="INS-2026-XXXX"
          />
        </div>

        <div className="border-t border-border pt-4 mt-4">
          <h4 className="text-sm font-semibold text-ink-700 mb-3">Third-party insurance</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Insurer name</Label>
              <Input
                value={tpInsurerName}
                onChange={(e) => setTpInsurerName(e.target.value)}
                placeholder="e.g. Old Mutual"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Insurer phone</Label>
              <Input
                value={tpInsurerPhone}
                onChange={(e) => setTpInsurerPhone(e.target.value)}
                placeholder="+264 61 XXX XXXX"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Policy number</Label>
              <Input
                value={tpInsurerPolicy}
                onChange={(e) => setTpInsurerPolicy(e.target.value)}
                placeholder="Policy number"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Additional details</Label>
              <Textarea
                value={tpDetails}
                onChange={(e) => setTpDetails(e.target.value)}
                placeholder="Vehicle details, registration, driver info..."
                rows={2}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="primary"
            size="compact"
            onClick={saveInsurance}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save insurance details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
