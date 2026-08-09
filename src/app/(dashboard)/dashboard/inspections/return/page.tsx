import { redirect } from 'next/navigation';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReturnInspectionRedirect({ searchParams }: PageProps) {
  const values = await searchParams;
  const params = new URLSearchParams({ type: 'return' });
  if (typeof values.tripId === 'string') params.set('tripId', values.tripId);
  if (typeof values.vehicleId === 'string') params.set('vehicleId', values.vehicleId);
  redirect(`/dashboard/inspections/new?${params.toString()}`);
}
