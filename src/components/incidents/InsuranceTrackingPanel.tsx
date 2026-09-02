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

export function InsuranceTrackingPanel({ incidentId, data, onUpdate }: Props) {
  const { toast } = useToast();

  const [claimRef, setClaimRef] = useState(data.insuranceClaimReference || '');
  const [notified, setNotified] = useState(data.insuranceNotified);
  const [policeFiled, setPoliceFiled] = useState(data.policeReportFiled);
  const [tpInsurerName, setTpInsurerName] = useState(
    (data.thirdPartyInsuranceDetails as Record<string, string>)?.insurerName || '',
  );
  const [tpInsurerPhone, setTpInsurerPhone] = useState(
    (data.thirdPartyInsuranceDetails as Record<string, string>)?.insurerPhone || '',
  );
  const [tpInsurerPolicy, setTpInsurerPolicy] = useState(
    (data.thirdPartyInsuranceDetails as Record<string, string>)?.policyNumber || '',
  );
  const [tpDetails, setTpDetails] = useState(
    (data.thirdPartyInsuranceDetails as Record<string, string>)?.details || '',
  );
  const [saving, setSaving] = useState(false);

  const saveInsurance = useCallback(async () => {
    setSaving(true);
    try {
      const hasThirdPartyInsuranceDetails = Boolean(
        tpInsurerName.trim() ||
          tpInsurerPhone.trim() ||
          tpInsurerPolicy.trim() ||
          tpDetails.trim(),
      );
      const body: Record<string, unknown> = {
        insuranceClaimReference: claimRef.trim() || null,
        insuranceNotified: notified,
        policeReportFiled: policeFiled,
        thirdPartyInsuranceDetails: hasThirdPartyInsuranceDetails
          ? {
              insurerName: tpInsurerName.trim(),
              insurerPhone: tpInsurerPhone.trim(),
              policyNumber: tpInsurerPolicy.trim(),
              details: tpDetails.trim(),
            }
          : null,
      };

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
  }, [incidentId, claimRef, notified, policeFiled, tpInsurerName, tpInsurerPhone, tpInsurerPolicy, tpDetails, toast, onUpdate]);

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
