// Shared download order for branch lines and urban services. Each country is
// its own request, and an oversized request can still be split into quarters.
const country = code => `ISO3166-1=${code}`;
const JP = country('JP'), KR = country('KR'), KP = country('KP'), TW = country('TW'), HK = country('HK'), MO = country('MO');
const CN = country('CN'), GD = 'ISO3166-2=CN-GD', RU = country('RU'), IN = country('IN'), KZ = country('KZ'), US = country('US'), CA = country('CA');
const europeBox = [30, -26, 82, 60];
const countries = codes => codes.map(code => ({area: country(code), box: europeBox}));
// Northern Cyprus and the British bases have separate OSM boundaries and no
// ISO country code. Fetch them with Cyprus using their boundary Wikidata tags.
const cyprusTerritories = ['wikidata=Q23681', 'wikidata=Q37362'];
const caucasus = [...['TR', 'CY', 'GE', 'AM', 'AZ'].map(country), ...cyprusTerritories];

export const EUROPE_STAGES = [
  {name: 'europe-a', label: 'Turkey, Cyprus and Caucasus', parts: [
    ...countries(['TR', 'CY']), ...cyprusTerritories.map(area => ({area, box: europeBox})), ...countries(['GE', 'AM', 'AZ'])]},
  {name: 'europe-b', label: 'Spain, Portugal, Andorra, UK and Ireland', parts: [
    {area: country('ES'), box: [27, -19, 44, 5]}, {area: country('PT'), box: [29, -32, 43, -6]}, ...countries(['AD', 'GB', 'IE', 'GI', 'GG', 'JE', 'IM'])]},
  {name: 'europe-c', label: 'Iceland, Denmark, Norway and Sweden', parts: countries(['IS', 'DK', 'NO', 'SE', 'FO', 'SJ'])},
  {name: 'europe-d', label: 'Finland, Baltic states, Belarus, Ukraine and Moldova', parts: countries(['FI', 'AX', 'EE', 'LV', 'LT', 'BY', 'UA', 'MD'])},
  {name: 'europe-e', label: 'Italy, former Yugoslavia, Greece, Bulgaria and Romania', parts: countries(['IT', 'SM', 'VA', 'MT', 'SI', 'HR', 'BA', 'ME', 'RS', 'XK', 'MK', 'GR', 'BG', 'RO'])},
  {name: 'europe-f', label: 'France and Benelux', parts: countries(['FR', 'MC', 'BE', 'NL', 'LU'])},
  {name: 'europe-g', label: 'Remaining Europe', parts: countries(['DE', 'PL', 'CZ', 'SK', 'AT', 'CH', 'LI', 'HU', 'AL'])},
];
export const EUROPE_STAGE_NAMES = EUROPE_STAGES.map(stage => stage.name);
export const CHANGED_DOWNLOAD_STAGES = ['europe-a', 'europe-b', 'europe-e', 'europe-f', 'europe-g', 'asia', 'world'];
export const fallbackStage = stage => stage === 'europe' ? stage : `europe:${stage}`;
export const isFallbackStage = stage => stage === 'europe' || stage?.startsWith('europe:');

export const STAGES = [
  {name: 'japan', label: 'Japan', parts: [{area: JP, box: [20, 122, 46, 154]}]},
  {name: 'east-asia', label: 'Koreas, Taiwan, Hong Kong, Macau and Guangdong', parts: [
    {area: KR, box: [33, 124, 39, 132]}, {area: KP, box: [37.5, 124, 43.1, 131]}, {area: TW, box: [21.5, 118, 26.5, 123]},
    {area: HK, box: [22.1, 113.8, 22.6, 114.5]}, {area: MO, box: [22.05, 113.5, 22.25, 113.65]}, {area: GD, box: [20, 109.5, 25.6, 117.4]}]},
  {name: 'china', label: 'Rest of China', parts: [{area: CN, box: [18, 73, 54, 135], exclude: [GD, HK, MO]}]},
  {name: 'russia', label: 'Russia', parts: [{area: RU, box: [41, 19, 82, 180]}, {area: RU, box: [60, -180, 72, -168]}]},
  ...EUROPE_STAGES,
  {name: 'india', label: 'India', parts: [{area: IN, box: [6, 68, 36, 98]}]},
  {name: 'asia', label: 'Rest of Asia', parts: [
    // Kazakhstan reaches north of the other Asia boxes' 55-degree limit.
    {area: KZ, box: [40, 45, 56, 88]},
    {box: [-11, 60, 55, 180], exclude: [JP, KR, KP, TW, HK, MO, CN, RU, IN, KZ, ...caucasus]},
    {box: [12, 26.5, 40.5, 60], exclude: [country('EG'), KZ, ...caucasus]},
    {box: [40.5, 45, 55, 60], exclude: [RU, KZ, ...caucasus]}]},
  {name: 'north-america', label: 'US and Canada', parts: [{area: US, box: [18, -180, 72, -66]}, {area: CA, box: [41, -141, 84, -52]}]},
  {name: 'americas', label: 'Rest of the Americas', parts: [{box: [-56, -120, 33, -30], exclude: [US]}]},
  {name: 'world', label: 'Rest of the world', parts: [
    {box: [-35, -20, 37.5, 52], exclude: caucasus}, {box: [-50, 110, -11, 180]}, {box: [-50, -180, 0, -150]}]},
];

// Country filters must survive automatic subdivision. Use the
// same selection construction for railway ways and urban route relations.
export function partSelection(part, box, select) {
  const excluded = (part.exclude || []).map(area => ({area}));
  const specs = [part, ...excluded], areas = [];
  const filters = specs.map(spec => {
    let filter = '';
    if (spec.area) {
      const [key, value] = spec.area.split('='), index = areas.length;
      areas.push(`area["${key}"="${value}"]->.a${index};`);
      filter += `(area.a${index})`;
    }
    return `${filter}(${box.join(',')})`;
  });
  const main = select(filters[0]), exclusions = filters.slice(1).map(select).join('');
  return {areas: areas.join(''), set: exclusions ? `((${main}); - (${exclusions});)` : `(${main})`};
}

// Layout changes do not change the data schema. Changed queues restart while
// their displayed data is held under the retired Europe parent until adopted.
// Unchanged stages and daily download history stay intact.
export function migrateDownloadStages(state) {
  if (state.downloadStages === 3) return false;
  state.stages ||= {};
  const europe = state.stages.europe;
  const changed = state.downloadStages === 2 ? CHANGED_DOWNLOAD_STAGES
    : ['asia', 'world'].filter(name => state.stages[name] && (europe || state.legacyEurope || state.stages[name].pending?.length));
  if (europe || state.legacyEurope || changed.length) {
    state.legacyEurope = {completed: europe?.completed || europe?.previousCompleted || state.legacyEurope?.completed || null, migrated: new Date().toISOString(), requireAsia: true};
    delete state.stages.europe;
    for (const name of changed) {
      const stage = state.stages[name];
      if (stage) Object.assign(stage, {previousCompleted: stage.completed || stage.previousCompleted || null, completed: null, pending: null, seen: []});
    }
  }
  for (const name of EUROPE_STAGE_NAMES) state.stages[name] ||= {completed: null, pending: null, seen: []};
  state.downloadStages = 3;
  return ['europe', ...changed];
}

export const europeComplete = state => EUROPE_STAGE_NAMES.every(name => state.stages[name]?.completed);

// The old boxes also reached northern Africa, and layout two placed part of
// Kazakhstan in Europe. Fresh world and Asia passes must adopt that coverage
// before unmatched fallback rows can be removed.
export const legacyEuropeReady = state => europeComplete(state)
  && Date.parse(state.stages.world?.started) >= Date.parse(state.legacyEurope?.migrated)
  && Date.parse(state.stages.world?.completed) >= Date.parse(state.legacyEurope?.migrated)
  && (!state.legacyEurope?.requireAsia || (Date.parse(state.stages.asia?.started) >= Date.parse(state.legacyEurope.migrated)
    && Date.parse(state.stages.asia?.completed) >= Date.parse(state.legacyEurope.migrated)));

// A way first downloaded by the former Europe stage, or by a later world
// stage, can now belong to its earlier, smaller Europe group.
export function branchStageOwner(previous, stage) {
  if (!previous || isFallbackStage(previous)) return stage;
  const before = STAGES.findIndex(item => item.name === previous), next = STAGES.findIndex(item => item.name === stage);
  return before >= 0 && next < before ? stage : previous;
}
