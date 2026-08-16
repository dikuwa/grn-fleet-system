const NAMIBIA_TIME_ZONE = 'Africa/Windhoek';

export function currentNamibiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAMIBIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Unable to resolve the current Namibia date');
  }

  return `${year}-${month}-${day}`;
}

export function validateMaintenanceServiceDate(serviceDate: string, now = new Date()) {
  if (serviceDate > currentNamibiaDate(now)) {
    return 'Service date cannot be in the future';
  }
  return null;
}

export function validateNextServiceOdometer(input: {
  nextServiceOdometer: number | null;
  serviceOdometer: number | null;
  currentVehicleOdometer: number;
}) {
  if (input.nextServiceOdometer === null) return null;

  const baseline = input.serviceOdometer ?? input.currentVehicleOdometer;
  if (input.nextServiceOdometer < baseline) {
    return input.serviceOdometer === null
      ? 'Next service odometer cannot be below the current vehicle odometer'
      : 'Next service odometer cannot be below the service odometer';
  }

  return null;
}
