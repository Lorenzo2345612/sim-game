import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTrackStyle } from '../../../src/track/trackStyle';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TRACKS = `${ROOT}public/tracks/`;

const readJson = (name: string): unknown => JSON.parse(readFileSync(TRACKS + name, 'utf8'));
const PALETTES_PATH = `${ROOT}public/flags/palettes.json`;

interface IndexEntry { id: string; country: string }
interface RunoffRange { pattern?: string; colors?: string[] }
interface RunoffPaint { pattern?: string; colors?: string[]; ranges?: RunoffRange[] }
interface StyleFile { runoffPaint?: RunoffPaint }

const index = readJson('index.json') as IndexEntry[];
const palettes = (existsSync(PALETTES_PATH)
  ? JSON.parse(readFileSync(PALETTES_PATH, 'utf8')) as Record<string, string[]>
  : {}) as Record<string, string[]>;

const countryOf = (id: string): string | undefined => index.find((e) => e.id === id)?.country;
const paletteFor = (id: string): string[] | undefined => {
  const country = countryOf(id);
  return country !== undefined ? palettes[country] : undefined;
};
const idOf = (file: string): string => file.replace(/\.style\.json$/, '');

const styleFiles = readdirSync(TRACKS)
  .filter((f) => f.endsWith('.style.json') && (readJson(f) as StyleFile).runoffPaint !== undefined)
  .sort();

const runoffOf = (file: string): RunoffPaint => (readJson(file) as StyleFile).runoffPaint as RunoffPaint;

function stripRunoffColors(raw: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(raw)) as StyleFile;
  if (copy.runoffPaint) {
    delete (copy.runoffPaint as Record<string, unknown>).colors;
    for (const r of copy.runoffPaint.ranges ?? []) delete (r as Record<string, unknown>).colors;
  }
  return copy;
}

const PRE_TASK_STYLES: Record<string, unknown> = {"bahrain.style.json":{"version":1,"palette":{"asphalt":"#55575A","grass":"#DAD8B8","gravel":"#B5B7B9"},"kerbs":{"colors":["#C8352F","#DADADA"]},"runoffPaint":{"pattern":"bands","stripeMeters":4,"ranges":[{"start":240,"end":330,"side":"left","pattern":"solid"}]},"barriers":{"concrete":{"color":"#DADADA"},"armco":{"color":"#9AA0A6"},"fence":{"heightMeters":4,"types":["armco","wall"],"color":"#7D8186"}},"pitBuilding":{"storeys":2,"heightMeters":10,"depthMeters":18,"facade":"#D9CFB8","roof":"#C9BFA8","doors":"#2A2A2C","accent":"#C8352F","roofStyle":"flat","glazing":0.2},"grandstands":{"structure":"#CFC8B8","roof":"#DADADA","seats":["#C8352F","#DADADA","#2A3C78"],"roofStyle":"sail"},"floodlights":{"style":"mast","heightMeters":28,"heads":8,"spacingMeters":60,"offsetMeters":12,"side":"both"},"props":[{"type":"tent","index":2550,"side":"right","offsetMeters":40,"lengthMeters":20,"heightMeters":6,"color":"#DADADA"},{"type":"tent","index":2610,"side":"right","offsetMeters":40,"lengthMeters":20,"heightMeters":6,"color":"#DADADA"},{"type":"tent","index":2670,"side":"right","offsetMeters":40,"lengthMeters":20,"heightMeters":6,"color":"#DADADA"},{"type":"tent","index":30,"side":"right","offsetMeters":40,"lengthMeters":20,"heightMeters":6,"color":"#DADADA"},{"type":"tent","index":90,"side":"right","offsetMeters":40,"lengthMeters":20,"heightMeters":6,"color":"#DADADA"}]},"baku.style.json":{"version":1,"palette":{"asphalt":"#4d4a47","grass":"#5a9a3a","gravel":"#cdb89a"},"edgeLines":{"color":"#dadada"},"kerbs":{"colors":["#c8312b","#dadada"],"outerStrip":"#dac200"},"runoffPaint":{"pattern":"none","ranges":[{"start":90,"end":500,"pattern":"bands","stripeMeters":3},{"start":2250,"end":2950,"pattern":"bands","stripeMeters":3}]},"barriers":{"concrete":{"color":"#d8cdb0","bandColor":"#dac200"},"armco":{"color":"#8a8f93"},"fence":{"heightMeters":4.5,"types":["armco","wall"],"color":"#8a8f93"}},"pitBuilding":{"storeys":2,"heightMeters":9,"depthMeters":15,"facade":"#dadada","roof":"#d9d9d9","doors":"#2a2a2c","accent":"#1f5a3a","roofStyle":"canopy","glazing":0.3},"grandstands":{"structure":"#b5b8bb","roof":"#dab030","seats":["#1f5a8f","#c8312b","#dadada"],"roofStyle":"flat"},"extraGrandstands":[{"start":20,"end":120,"side":"right","offsetMeters":15,"rows":12,"roof":true}],"props":[]},"daytona.style.json":{"version":1,"palette":{"asphalt":"#5A5C5E","grass":"#4FA03A","gravel":"#CDBB94"},"kerbs":{"colors":["#B02A2A","#DADADA"]},"runoffPaint":{"pattern":"none","ranges":[{"start":1845,"end":2045,"pattern":"stripes","stripeMeters":3},{"start":300,"end":700,"pattern":"bands","stripeMeters":2}]},"barriers":{"concrete":{"color":"#DADADA","bandColor":"#1F4FA0"},"armco":{"color":"#9AA0A6"},"fence":{"heightMeters":6.5,"types":["armco","wall"],"color":"#9AA0A6"}},"pitBuilding":{"storeys":2,"heightMeters":10,"depthMeters":18,"facade":"#C8CCD0","roof":"#9AA0A6","doors":"#1F4FA0","accent":"#1F4FA0","roofStyle":"flat","glazing":0.4},"grandstands":{"structure":"#9AA0A6","roof":"#C8CCD0","seats":["#2F5FA8","#B02A2A","#D9701C","#D4B020"],"roofStyle":"truss"},"extraGrandstands":[{"start":2800,"end":2881,"side":"right","offsetMeters":25,"rows":30,"roof":true},{"start":0,"end":95,"side":"right","offsetMeters":25,"rows":30,"roof":true}],"floodlights":{"style":"mast","heightMeters":28,"heads":8,"spacingMeters":100,"offsetMeters":20,"side":"right","ranges":[{"start":2800,"end":2881},{"start":0,"end":95}]},"props":[{"type":"tower","index":40,"side":"left","offsetMeters":12,"heightMeters":30,"color":"#B02A2A"}]},"detroit.style.json":{"version":1,"palette":{"asphalt":"#8E8E8C"},"kerbs":{"colors":["#A83C3C","#D2D2CE"]},"runoffPaint":{"pattern":"none"},"barriers":{"concrete":{"color":"#BDBDB8"},"armco":{"color":"#9A9EA0"},"fence":{"heightMeters":4,"types":["wall","armco"],"color":"#9A9EA0"}},"pitBuilding":{"storeys":2,"heightMeters":8,"depthMeters":14,"facade":"#C9C4BA","roof":"#8E9094","doors":"#3A3C3E","glazing":0.25},"grandstands":{"structure":"#9EA2A6","roof":"#C8CCCE","seats":["#2F5FA8","#D2D2CE","#8E9094"],"roofStyle":"truss"},"extraGrandstands":[{"start":380,"end":500,"side":"left","offsetMeters":18,"rows":14,"roof":true},{"start":690,"end":760,"side":"right","offsetMeters":16,"rows":16,"roof":false},{"start":960,"end":1080,"side":"left","offsetMeters":18,"rows":12,"roof":true}],"props":[{"type":"footbridge","index":450,"side":"left","offsetMeters":10,"lengthMeters":30,"heightMeters":7,"color":"#3A3C3E"},{"type":"footbridge","index":1000,"side":"left","offsetMeters":10,"lengthMeters":30,"heightMeters":7,"color":"#3A3C3E"}]},"lasvegas.style.json":{"version":1,"palette":{"asphalt":"#3a3c40","grass":"#b9a284","gravel":"#b9a284"},"edgeLines":{"color":"#4a78c8"},"kerbs":{"colors":["#cf2a2a","#dadada"]},"runoffPaint":{"pattern":"solid","ranges":[{"start":95,"end":160,"pattern":"solid"}]},"barriers":{"concrete":{"color":"#cfcfce","bandColor":"#2f9e5a"},"armco":{"color":"#8e9093"},"fence":{"heightMeters":4.5,"types":["armco","wall"],"color":"#8f949a"}},"pitBuilding":{"storeys":4,"heightMeters":20,"depthMeters":25,"facade":"#2b2d30","roof":"#3a3c40","doors":"#1c1c1e","accent":"#da3f9a","roofStyle":"folded","glazing":0.5},"grandstands":{"structure":"#3a3c40","roof":"#2a2c30","seats":["#dadada","#8e9093"],"roofStyle":"flat"},"extraGrandstands":[{"start":3030,"end":90,"side":"right","offsetMeters":15,"rows":14,"roof":true}],"floodlights":{"style":"arm","heightMeters":9,"heads":1,"spacingMeters":30,"offsetMeters":6,"side":"both"},"props":[{"type":"footbridge","index":2331,"side":"left","offsetMeters":0,"lengthMeters":40,"heightMeters":7,"color":"#9fd8da"},{"type":"footbridge","index":1992,"side":"left","offsetMeters":0,"lengthMeters":40,"heightMeters":7,"color":"#9fd8da"}]},"lusail.style.json":{"version":1,"palette":{"asphalt":"#4a4c4e","grass":"#cdb892","gravel":"#c9b38a"},"kerbs":{"colors":["#c8352f","#dadada"]},"runoffPaint":{"pattern":"none","ranges":[{"start":40,"end":200,"side":"right","pattern":"solid"},{"start":651,"end":725,"side":"right","pattern":"solid"},{"start":1432,"end":1516,"side":"left","pattern":"solid"},{"start":2146,"end":2211,"side":"right","pattern":"solid"},{"start":2547,"end":2627,"side":"right","pattern":"solid"}]},"barriers":{"concrete":{"color":"#dadada","bandColor":"#2a2a2c"},"armco":{"color":"#9aa0a6"},"fence":{"heightMeters":4.5,"types":["armco","wall"],"color":"#2f7f6a"}},"pitBuilding":{"storeys":2,"heightMeters":10,"depthMeters":18,"facade":"#dadada","roof":"#dadada","doors":"#2a2a2c","accent":"#7a1f2f","roofStyle":"folded","glazing":0.3},"grandstands":{"structure":"#c0c4c8","roof":"#dadada","seats":["#7a1f2f","#dadada"],"roofStyle":"truss"},"extraGrandstands":[{"start":2620,"end":90,"side":"left","offsetMeters":20,"rows":16,"roof":true}],"floodlights":{"style":"mast","heightMeters":28,"heads":6,"spacingMeters":50,"offsetMeters":10,"side":"both"},"props":[{"type":"tent","index":2650,"side":"right","offsetMeters":40,"lengthMeters":14,"heightMeters":3.5,"color":"#dadada"},{"type":"tent","index":2695,"side":"right","offsetMeters":40,"lengthMeters":14,"heightMeters":3.5,"color":"#dadada"},{"type":"tent","index":40,"side":"right","offsetMeters":40,"lengthMeters":14,"heightMeters":3.5,"color":"#dadada"}]},"mexico.style.json":{"version":1,"palette":{"asphalt":"#3E3E42","grass":"#6FA83A"},"kerbs":{"colors":["#C8201E","#DADADA"],"outerStrip":"#2FA060"},"runoffPaint":{"pattern":"none","stripeMeters":3,"ranges":[{"start":540,"end":745,"pattern":"stripes","stripeMeters":3},{"start":190,"end":290,"pattern":"stripes","stripeMeters":3}]},"barriers":{"concrete":{"color":"#3E8E4E"},"tyres":{"beltColor":"#2A2A2C"},"fence":{"heightMeters":4.5,"types":["armco","tyres","wall"],"color":"#8A8D90"}},"pitBuilding":{"storeys":3,"heightMeters":14,"depthMeters":20,"facade":"#B8BCC0","roof":"#8A8D90","doors":"#DADADA","accent":"#DAC020","roofStyle":"flat","glazing":0.4},"grandstands":{"structure":"#A8ACB0","roof":"#2A2A2E","seats":["#C8201E"],"roofStyle":"truss"},"extraGrandstands":[{"start":560,"end":640,"side":"left","offsetMeters":20,"rows":16,"roof":true},{"start":190,"end":290,"side":"left","offsetMeters":20,"rows":20,"roof":true},{"start":190,"end":290,"side":"right","offsetMeters":20,"rows":20,"roof":true}],"props":[{"type":"footbridge","index":60,"offsetMeters":12,"heightMeters":7,"color":"#8A8D90"},{"type":"tent","index":2120,"side":"right","offsetMeters":30,"color":"#DADADA"}]},"monza.style.json":{"version":1,"palette":{"asphalt":"#3A3A3C","grass":"#6E8B3D","gravel":"#CFC4A8"},"edgeLines":{"color":"#DADADA"},"kerbs":{"colors":["#C8201E","#DADADA"],"outerStrip":"#1F9A6A"},"runoffPaint":{"pattern":"none","stripeMeters":3,"ranges":[{"start":260,"end":360,"pattern":"bands","stripeMeters":3},{"start":1780,"end":1900,"pattern":"stripes","stripeMeters":3},{"start":2420,"end":2580,"pattern":"bands","stripeMeters":3}]},"barriers":{"concrete":{"color":"#B4B4B4","bandColor":"#1F9A6A"},"armco":{"color":"#B8BCC0"},"tyres":{"beltColor":"#2A2A2C"},"fence":{"heightMeters":4.5,"types":["armco","tyres","wall"],"color":"#8A8D90"},"ranges":[{"start":1790,"end":1900,"fenceHeightMeters":5}]},"pitBuilding":{"storeys":3,"heightMeters":15,"depthMeters":20,"facade":"#9AA3AA","roof":"#D6CDB0","doors":"#6A6E72","accent":"#4A6FA5","roofStyle":"canopy","glazing":0.5},"grandstands":{"structure":"#D8CFA8","roof":"#B0B4B8","seats":["#8A8D90"],"roofStyle":"truss"},"extraGrandstands":[{"start":0,"end":60,"side":"left","offsetMeters":20,"rows":16,"roof":true},{"start":280,"end":340,"side":"right","offsetMeters":18,"rows":10,"roof":false}],"props":[{"type":"footbridge","index":10,"offsetMeters":12,"heightMeters":7,"color":"#1F9A6A"},{"type":"marshalPost","index":290,"side":"right","offsetMeters":8,"color":"#D9701C"},{"type":"marshalPost","index":330,"side":"left","offsetMeters":8,"color":"#D9701C"},{"type":"marshalPost","index":890,"side":"right","offsetMeters":8,"color":"#D9701C"},{"type":"marshalPost","index":1810,"side":"left","offsetMeters":8,"color":"#D9701C"},{"type":"marshalPost","index":1860,"side":"right","offsetMeters":8,"color":"#D9701C"}]},"sepang.style.json":{"version":1,"palette":{"asphalt":"#4A4A4D","grass":"#6FA13A","gravel":"#C8CACC"},"edgeLines":{"color":"#2B5FB5"},"kerbs":{"colors":["#D8404A","#DADADA"]},"runoffPaint":{"pattern":"none","stripeMeters":3,"ranges":[{"start":2380,"end":2500,"pattern":"stripes","stripeMeters":3},{"start":115,"end":292,"pattern":"stripes","stripeMeters":3}]},"barriers":{"concrete":{"color":"#DADADA"},"armco":{"color":"#9AA0A6"},"fence":{"heightMeters":4,"types":["armco","wall"],"color":"#0A8F86"}},"pitBuilding":{"storeys":2,"heightMeters":10,"depthMeters":16,"facade":"#9A9EA2","roof":"#6F7478","doors":"#2A2A2C","accent":"#0A8F86","roofStyle":"flat","glazing":0.4},"grandstands":{"structure":"#A8ABAE","roof":"#DADADA","seats":["#D12B35","#DAC21F","#1E4F9F","#DADADA"],"roofStyle":"sail"},"extraGrandstands":[{"start":1449,"end":1667,"side":"left","offsetMeters":15,"rows":14,"roof":false}],"sky":{"hdri":"kloofendal_overcast_puresky"}},"silverstone.style.json":{"version":1,"palette":{"asphalt":"#4A4A4D","grass":"#6DA03A","gravel":"#7A6C5A"},"kerbs":{"colors":["#C8201E","#DADADA"],"ranges":[{"start":500,"end":700,"outerStrip":"#2EA06A"}]},"runoffPaint":{"pattern":"none","stripeMeters":2,"ranges":[{"start":880,"end":960,"pattern":"stripes","stripeMeters":2}]},"barriers":{"concrete":{"color":"#DADADA"},"armco":{"color":"#B8BCC0"},"tyres":{"beltColor":"#DA702A"},"fence":{"heightMeters":3.5,"types":["armco","tyres","wall"],"color":"#8A8D90"}},"pitBuilding":{"storeys":3,"heightMeters":18,"depthMeters":25,"facade":"#3A3D40","roof":"#5A5E62","doors":"#2A2A2E","accent":"#C8201E","roofStyle":"folded","glazing":0.5},"grandstands":{"structure":"#4A4E52","roof":"#DADADA","seats":["#2F5FA8"],"roofStyle":"sail"},"extraGrandstands":[{"start":880,"end":960,"side":"right","offsetMeters":20,"rows":14,"roof":true},{"start":2850,"end":2940,"side":"right","offsetMeters":25,"rows":14,"roof":true}],"props":[{"type":"footbridge","index":2900,"offsetMeters":12,"heightMeters":7,"color":"#8A8D90"},{"type":"footbridge","index":1200,"offsetMeters":12,"heightMeters":7,"color":"#8A8D90"},{"type":"scoreboard","index":1658,"side":"left","offsetMeters":15,"heightMeters":12,"color":"#4A4E52"}],"sky":{"hdri":"kloofendal_overcast_puresky"}},"singapore.style.json":{"version":1,"palette":{"asphalt":"#3a3b3d","grass":"#5a8a4a","gravel":"#9a9ea2"},"kerbs":{"colors":["#cf2a2a","#dadada"]},"runoffPaint":{"pattern":"none","stripeMeters":3,"ranges":[{"start":150,"end":330,"pattern":"stripes","stripeMeters":3},{"start":2100,"end":2370,"pattern":"stripes","stripeMeters":3}]},"barriers":{"concrete":{"color":"#dadada","bandColor":"#dac000"},"armco":{"color":"#b8babb"},"fence":{"heightMeters":4.5,"types":["armco","wall"],"color":"#9aa0a6"}},"pitBuilding":{"storeys":3,"heightMeters":16,"depthMeters":20,"facade":"#dadada","roof":"#5aa092","doors":"#3a3a3c","accent":"#dac000","roofStyle":"curved","glazing":0.4},"grandstands":{"structure":"#8d9195","roof":"#d0d4d6","seats":["#2f6fc2","#dab800"],"roofStyle":"truss"},"extraGrandstands":[{"start":1080,"end":1180,"side":"right","offsetMeters":18,"rows":16,"roof":true},{"start":1850,"end":1950,"side":"right","offsetMeters":16,"rows":14,"roof":true}],"floodlights":{"style":"arm","heightMeters":8,"heads":2,"spacingMeters":20,"offsetMeters":6,"side":"both"},"props":[]},"spa.style.json":{"version":1,"palette":{"asphalt":"#3B3B3E","grass":"#6A9A3A"},"kerbs":{"colors":["#C83030","#DADADA"],"outerStrip":"#2FB59A"},"runoffPaint":{"pattern":"none","ranges":[{"start":540,"end":640,"pattern":"stripes","stripeMeters":3},{"start":200,"end":260,"pattern":"solid"}]},"barriers":{"concrete":{"color":"#D0D0D0"},"armco":{"color":"#9A9EA2"},"tyres":{"beltColor":"#C83030"},"fence":{"heightMeters":4.5,"types":["armco","wall"],"color":"#3F6B3A"}},"pitBuilding":{"storeys":2,"heightMeters":10,"depthMeters":15,"facade":"#8A8D90","roof":"#D4D8DA","glazing":0.3},"grandstands":{"structure":"#B8BCC0","roof":"#DADADA","seats":["#2F5FA8"],"roofStyle":"flat"},"extraGrandstands":[{"start":600,"end":660,"side":"left","offsetMeters":20,"rows":14,"roof":true},{"start":220,"end":270,"side":"right","offsetMeters":18,"rows":10,"roof":true}],"props":[{"type":"marshalPost","index":300,"side":"left","offsetMeters":8,"color":"#D9701C"},{"type":"marshalPost","index":325,"side":"right","offsetMeters":8,"color":"#D9701C"}],"sky":{"hdri":"kloofendal_overcast_puresky"}},"spielberg.style.json":{"version":1,"palette":{"asphalt":"#424245","grass":"#6FA23A","gravel":"#D5C7A2"},"kerbs":{"colors":["#C8312C","#DADADA"],"outerStrip":"#2F8F5B","ranges":[{"start":1960,"end":2030,"side":"right","colors":["#C8312C","#DADADA"],"outerStrip":"#2F8F5B"}]},"runoffPaint":{"pattern":"none","stripeMeters":3,"ranges":[{"start":160,"end":245,"pattern":"stripes","stripeMeters":3}]},"barriers":{"concrete":{"color":"#B4B4B4"},"armco":{"color":"#B8BCC0"},"tyres":{"beltColor":"#DADADA"},"fence":{"heightMeters":3.5,"types":["armco","tyres","wall"],"color":"#4F6B3A"}},"pitBuilding":{"storeys":3,"heightMeters":11,"depthMeters":15,"facade":"#4B4E52","roof":"#DADADA","doors":"#DADADA","accent":"#C8312C","roofStyle":"flat","glazing":0.5},"grandstands":{"structure":"#B0B4B8","roof":"#8A8D90","seats":["#C8312C","#DADADA"],"roofStyle":"flat"},"extraGrandstands":[{"start":190,"end":250,"side":"left","offsetMeters":25,"rows":12,"roof":false},{"start":480,"end":540,"side":"left","offsetMeters":25,"rows":10,"roof":false},{"start":1100,"end":1160,"side":"right","offsetMeters":20,"rows":8,"roof":true}]}};

const HEX_UPPER = /^#[0-9A-F]{6}$/;

describe('253 runoff flag colours', () => {
  it('AT1: every index country has a palette of 2-4 uppercase hex colours', () => {
    const countries = [...new Set(index.map((e) => e.country))];
    expect(countries.length).toBeGreaterThan(0);
    for (const country of countries) {
      const entry = palettes[country];
      expect(Array.isArray(entry), country).toBe(true);
      expect((entry as string[]).length, country).toBeGreaterThanOrEqual(2);
      expect((entry as string[]).length, country).toBeLessThanOrEqual(4);
      for (const c of entry as string[]) expect(c, `${country} ${c}`).toMatch(HEX_UPPER);
    }
  });

  it('AT2: every runoffPaint colour is in the track country flag palette', () => {
    for (const file of styleFiles) {
      const palette = paletteFor(idOf(file));
      expect(palette, file).toBeDefined();
      const allowed = new Set((palette as string[]).map((c) => c.toUpperCase()));
      const rp = runoffOf(file);
      const colours = [...(rp.colors ?? []), ...(rp.ranges ?? []).flatMap((r) => r.colors ?? [])];
      for (const c of colours) expect(allowed.has(c.toUpperCase()), `${file} ${c}`).toBe(true);
    }
  });

  it('AT3: stripes and bands entries use the full country palette in flag order', () => {
    for (const file of styleFiles) {
      const palette = paletteFor(idOf(file));
      expect(palette, file).toBeDefined();
      const rp = runoffOf(file);
      const topPattern = rp.pattern ?? 'none';
      const entries = [
        { label: 'runoffPaint', pattern: topPattern, colors: rp.colors },
        ...(rp.ranges ?? []).map((r, i) => ({
          label: `runoffPaint.ranges[${i}]`,
          pattern: r.pattern ?? topPattern,
          colors: r.colors ?? rp.colors,
        })),
      ];
      for (const e of entries) {
        if (e.pattern === 'stripes' || e.pattern === 'bands') {
          expect(e.colors, `${file} ${e.label}`).toEqual(palette);
        }
      }
    }
  });

  it('AT4: non-colour runoffPaint fields and every other field are unchanged', () => {
    for (const [file, fixture] of Object.entries(PRE_TASK_STYLES)) {
      expect(stripRunoffColors(readJson(file)), file).toEqual(fixture);
    }
  });

  it('AT5: each updated style file parses with no validation errors', () => {
    for (const file of styleFiles) {
      const track = readJson(`${idOf(file)}.json`) as { centerline: unknown[] };
      const parsed = parseTrackStyle(readJson(file), track.centerline.length);
      expect(parsed.errors, file).toEqual([]);
    }
  });

  it('AT7: no near-black palette colour; Belgium exact; Malaysia has no #FFCC00', () => {
    for (const [country, colours] of Object.entries(palettes)) {
      for (const c of colours) {
        const channels = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
        expect(Math.max(...channels), `${country} ${c}`).toBeGreaterThanOrEqual(0x40);
      }
    }
    const belgium = (palettes.Belgium ?? []).map((c) => c.toUpperCase());
    expect(belgium).toEqual(['#FDDA24', '#EF3340']);
    const malaysia = (palettes.Malaysia ?? []).map((c) => c.toUpperCase());
    expect(malaysia).not.toContain('#FFCC00');
  });

  it('AT8: flag-palettes equals exactly the 14 official palettes', () => {
    expect(palettes).toEqual({
      Italy: ['#008C45', '#F4F5F0', '#CD212A'],
      Belgium: ['#FDDA24', '#EF3340'],
      'United Kingdom': ['#00247D', '#FFFFFF', '#CF142B'],
      Mexico: ['#006747', '#FFFFFF', '#C8102E'],
      'United States': ['#B31942', '#FFFFFF', '#0A3161'],
      Qatar: ['#8A1538', '#FFFFFF'],
      Bahrain: ['#DA291C', '#FFFFFF'],
      Malaysia: ['#D50032', '#FFFFFF', '#071D49'],
      Azerbaijan: ['#00B5E2', '#EF3340', '#509E2F'],
      Hungary: ['#CE2939', '#FFFFFF', '#477050'],
      Singapore: ['#EF3340', '#FFFFFF'],
      Austria: ['#C8102E', '#FFFFFF'],
      Australia: ['#00008B', '#FFFFFF', '#E4002B'],
      'Saudi Arabia': ['#006C35', '#FFFFFF'],
    });
  });
});
