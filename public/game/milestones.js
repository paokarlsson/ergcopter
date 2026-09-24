// Standardmilstolpar: fjälltoppar från Jämtland och Härjedalen upp till Everest.
// Gallrade till ungefär 50–100 m mellanrum där de flesta pass slutar (800–2 500 m),
// glesare högre upp. Barn når typiskt drygt 1 000 m, otränade vuxna 1 500–2 000 m.
//
// Källor (hämtade och dubbelkollade mot Wikidata/Wikipedia 2026-09-24):
//   Jämtland/Härjedalen: vandrafotaleva.nu (höjder mot Lantmäteriets data),
//     sv.wikipedia.org/wiki/Helagsfjället, sv.wikipedia.org/wiki/Storsylen,
//     sv.wikipedia.org/wiki/Bunnerfjällen
//   Sverige: varldenshaftigaste.se/topplistor/sveriges-12-hogsta-berg
//   Norge: en.wikipedia.org/wiki/List_of_mountains_of_Norway_by_height
//   Europa och världen: vedertagna höjder (en.wikipedia.org)

export const DEFAULT_MILESTONES = [
  // Jämtland och Härjedalen
  { name: 'Suljätten', h: 845, area: 'Jämtland' },
  { name: 'Mullfjället', h: 1031, area: 'Jämtland' },
  { name: 'Drommen', h: 1140, area: 'Jämtland' },
  { name: 'Stor-Mittåkläppen', h: 1212, area: 'Härjedalen' },
  { name: 'Sonfjället', h: 1277, area: 'Härjedalen' },
  { name: 'Åreskutan', h: 1420, area: 'Jämtland' },
  { name: 'Östra Bunnerstöten', h: 1502, area: 'Jämtland' },
  { name: 'Stora Härjångsstöten', h: 1626, area: 'Jämtland' },
  // Toppen ligger ~90 m in i Norge; Jämtlands högsta punkt på svenska sidan är 1 743 m.
  { name: 'Storsylen', h: 1762, area: 'Sylarna, toppen i Norge' },
  { name: 'Helags', h: 1797, area: 'Härjedalens högsta' },

  // Sverige och Norge
  { name: 'Gaustatoppen', h: 1883, area: 'Norge' },
  { name: 'Kebnekaise', h: 2097, area: 'Sveriges högsta' },
  { name: 'Rondeslottet', h: 2178, area: 'Norge' },
  { name: 'Snøhetta', h: 2286, area: 'Norge' },
  { name: 'Galdhøpiggen', h: 2469, area: 'Norges högsta' },

  // Europa
  { name: 'Zugspitze', h: 2962, area: 'Tyskland' },
  { name: 'Mulhacén', h: 3479, area: 'Spanien' },
  { name: 'Eiger', h: 3967, area: 'Schweiz' },
  { name: 'Matterhorn', h: 4478, area: 'Schweiz/Italien' },
  { name: 'Mont Blanc', h: 4806, area: 'Alpernas högsta' },
  { name: 'Elbrus', h: 5642, area: 'Europas högsta' },

  // Världen
  { name: 'Fuji', h: 3776, area: 'Japan' },
  { name: 'Mount Kenya', h: 5199, area: 'Kenya' },
  { name: 'Kilimanjaro', h: 5895, area: 'Afrikas högsta' },
  { name: 'Denali', h: 6190, area: 'Nordamerikas högsta' },
  { name: 'Aconcagua', h: 6961, area: 'Sydamerikas högsta' },
  { name: 'Cho Oyu', h: 8188, area: 'Himalaya' },
  { name: 'K2', h: 8611, area: 'Karakoram' },
  { name: 'Mount Everest', h: 8849, area: 'Världens högsta' },
].sort((a, b) => a.h - b.h);

/** Den första standardlistan – sparade inställningar med exakt den uppgraderas. */
export const LEGACY_MILESTONES = [
  ['Åreskutan', 1420],
  ['Kebnekaise', 2097],
  ['Galdhøpiggen', 2469],
  ['Mont Blanc', 4806],
  ['Kilimanjaro', 5895],
  ['Mount Everest', 8849],
];
