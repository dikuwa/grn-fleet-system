const FILLER_WORDS = new Set(['and', 'of', 'the', 'for', 'at', 'in']);

export function normaliseOrganisationCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function suggestOrganisationCode(name: string, kind: 'office' | 'department') {
  const words = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !FILLER_WORDS.has(word.toLowerCase()) && (kind === 'office' || word.toLowerCase() !== 'office'));
  const withoutGenericOffice = kind === 'office'
    ? meaningful.filter((word) => !['constituency', 'settlement', 'regional', 'satellite'].includes(word.toLowerCase()))
    : meaningful;
  const source = withoutGenericOffice.length > 0 ? withoutGenericOffice : meaningful;
  const initials = source.map((word) => word[0]).join('').toUpperCase();
  if (kind === 'office') {
    if (source.length === 2 && source[1].toLowerCase() === 'office') {
      const location = source[0].toUpperCase();
      const second = location.slice(1).match(/[BCDFGHJKLMNPQRSTVWXYZ]/)?.[0] || location[1] || '';
      return normaliseOrganisationCode(`${location[0]}${second}O`);
    }
    const sourceIncludesOffice = source.some((word) => word.toLowerCase() === 'office');
    const officeSuffix = words.some((word) => word.toLowerCase() === 'office') && !sourceIncludesOffice ? 'O' : '';
    return normaliseOrganisationCode(`${initials.slice(0, 3)}${officeSuffix}`).slice(0, 4);
  }
  return normaliseOrganisationCode(initials.length >= 2 ? initials : (source[0] ?? '').slice(0, 3));
}
