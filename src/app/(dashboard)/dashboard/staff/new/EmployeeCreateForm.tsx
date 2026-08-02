'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useToast } from '@/lib/use-toast';
import { Loader2 } from 'lucide-react';

interface Option { id: string; name: string }

export function EmployeeCreateForm({ offices, departments }: { offices: Option[]; departments: Option[] }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function submit(formData: FormData) {
    setBusy(true);
    const response = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return toast({ title: 'Employee not created', description: data.error, variant: 'error' });
    toast({ title: 'Employee created', variant: 'success' });
    router.push(`/dashboard/staff/${data.data.id}`);
  }
  return (
    <form action={submit} className="space-y-5 rounded-[10px] border border-border bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5"><Label>Employee number</Label><Input name="employeeNumber" placeholder="Leave blank to generate" /><p className="text-ink-500 text-xs">Optional. The system generates a tenant-scoped number when blank.</p></div>
        <div className="space-y-1.5"><Label>Title</Label><Input name="title" placeholder="Mr, Ms, Dr" /></div>
        <div className="space-y-1.5"><Label required>First name</Label><Input name="firstName" required /></div>
        <div className="space-y-1.5"><Label>Middle names</Label><Input name="middleName" /></div>
        <div className="space-y-1.5"><Label required>Surname</Label><Input name="lastName" required /></div>
        <div className="space-y-1.5"><Label>Gender</Label><StyledSelect name="gender" placeholder="Select gender"><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></StyledSelect></div>
        <div className="space-y-1.5"><Label>Preferred name</Label><Input name="preferredName" /></div>
        <div className="space-y-1.5"><Label>Email</Label><Input name="email" type="email" /></div>
        <div className="space-y-1.5"><Label>Mobile number</Label><Input name="phone" type="tel" /></div>
        <div className="space-y-1.5"><Label>Job title</Label><Input name="jobTitle" /></div>
        <div className="space-y-1.5"><Label>Substantive position</Label><Input name="substantivePosition" /></div>
        <div className="space-y-1.5"><Label>Office</Label><StyledSelect name="officeId" placeholder="Select office">{offices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</StyledSelect></div>
        <div className="space-y-1.5"><Label>Department</Label><StyledSelect name="departmentId" placeholder="Select department">{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</StyledSelect></div>
        <div className="space-y-1.5"><Label>Employment type</Label><StyledSelect name="employmentType" placeholder="Select type"><option value="permanent">Permanent</option><option value="contract">Contract</option><option value="temporary">Temporary</option><option value="intern">Intern</option></StyledSelect></div>
        <div className="space-y-1.5"><Label>Employment status</Label><StyledSelect name="employmentStatus" defaultValue="active"><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></StyledSelect></div>
        <div className="space-y-1.5"><Label>Availability</Label><StyledSelect name="availabilityStatus" defaultValue="available"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="leave">On Leave</option></StyledSelect></div>
        <div className="space-y-1.5"><Label>Employment start</Label><StyledDateInput name="employmentStartDate" type="date" /></div>
        <label className="border-border flex min-h-11 items-center gap-3 rounded-[8px] border px-3 text-sm"><input name="isDriver" type="checkbox" /><span><span className="text-ink-950 block font-medium">Driver</span><span className="text-ink-500 text-xs">Creates an incomplete profile requiring licence verification.</span></span></label>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create employee</Button></div>
    </form>
  );
}
