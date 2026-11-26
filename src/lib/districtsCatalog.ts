export interface DistrictCatalogEntry {
  distrito: string;
  servicios: string[];
}

export const DISTRICTS_CATALOG: DistrictCatalogEntry[] = [
  {
    distrito: 'BENJAMIN ACEVAL',
    servicios: [
      'CS BENJAMIN ACEVAL',
      'PS LA VICTORIA',
      'PS MONTE LINDO',
      'USF RIO VERDE CERRITO',
      'USF MARIA AUXILIADORA',
      'USF MONTE SOCIEDAD',
      'PS MARIA MEDIANERA',
    ],
  },
  {
    distrito: 'JOSE FALCON',
    servicios: [
      'HD JOSE FALCON',
      'PS OLIVORIO TALAVERA',
      'USF FALCON SANTA ROSA',
    ],
  },
  {
    distrito: 'NUEVA ASUNCION',
    servicios: ["USF CHACO'I"],
  },
  {
    distrito: 'GRAL BRUGUEZ',
    servicios: ['PS CADETE PANDO', 'USF GRAL BRUGUEZ'],
  },
  {
    distrito: 'VILLA HAYES',
    servicios: [
      'HR VILLA HAYES',
      'USF RIO VERDE 325',
      'PS REMANSITO',
      'USF BOUVIER',
      'USF CIUDAD NUEVA',
      'USF SAN JORGE',
      'USF POZO COLORADO',
      'USF PAI ROBERTO',
    ],
  },
  {
    distrito: 'PINASCO',
    servicios: ['USF MEMON', 'USF PTO PINASCO'],
  },
  {
    distrito: 'NANAWA',
    servicios: ['CS NANAWA', 'PS GASPAR R DE FRANCIA'],
  },
  {
    distrito: 'IRALA FERNANDEZ',
    servicios: [
      'CS IRALA FERNANDEZ',
      'PROVADO PARATODO',
      'PS NUEVA VIDA',
      'PS SANTA AURELIA',
      'USF 1 PIONEROS',
      'USF 2 EL ESTRIBO',
      'USF 3 CONAMOCTOLOLAC',
      'USF CAMPO ACEVAL',
      'VAC PRIV IND PARATODO',
      'PRIVADO LOLITA',
      'PS 10 LEGUAS',
    ],
  },
  {
    distrito: 'ESTEBAN MARTINEZ',
    servicios: ['USF ESTEBAN MARTINEZ', 'USF LAGUNA ESCALANTE'],
  },
];

function normalizeKey(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function getServicesForDistrict(distrito: string): string[] {
  const norm = normalizeKey(distrito);
  const entry = DISTRICTS_CATALOG.find((d) => normalizeKey(d.distrito) === norm);
  return entry ? entry.servicios : [];
}

export function matchCatalogSelection(
  rawDistrito: string,
  rawServicio: string
): { distrito: string; servicio: string } {
  const dNorm = normalizeKey(rawDistrito);
  const sNorm = normalizeKey(rawServicio);

  const distEntry = DISTRICTS_CATALOG.find((d) => normalizeKey(d.distrito) === dNorm);
  if (distEntry) {
    const svcMatch = distEntry.servicios.find((s) => normalizeKey(s) === sNorm);
    return {
      distrito: distEntry.distrito,
      servicio: svcMatch || '',
    };
  }

  if (sNorm) {
    for (const d of DISTRICTS_CATALOG) {
      const svcMatch = d.servicios.find((s) => normalizeKey(s) === sNorm);
      if (svcMatch) {
        return { distrito: d.distrito, servicio: svcMatch };
      }
    }
  }

  return { distrito: '', servicio: '' };
}
