/** Mirrors PLATFORMS in the backend (src/types.ts). Unknown values in the URL are dropped, because the API rejects them with a 400. */
export const PLATFORM_LABELS: Record<string, string> = {
  recruitee: 'Recruitee', personio: 'Personio', teamtailor: 'Teamtailor', rippling: 'Rippling', bamboohr: 'BambooHR', gem: 'Gem',
  pinpoint: 'Pinpoint', jazzhr: 'JazzHR', jobvite: 'Jobvite', icims: 'iCIMS', taleo: 'Taleo', workday: 'Workday', yc: 'Y Combinator',
};
export const PLATFORMS = Object.keys(PLATFORM_LABELS);
export const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? p;
