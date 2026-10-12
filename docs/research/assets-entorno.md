# Investigación: vegetación, gradas y elementos de pista (2026-10-11)

Filtro: CC0, CC-BY, CC-BY-SA, MIT, CC-BY-NC. Estilo semi-realista estilizado. "Buscador" = licencia leída en el buscador de Sketchfab, no en la ficha (revisar antes de usar).

## Aviso de licencia Quaternius

Las páginas de pack dicen CC0, pero https://quaternius.com/license.html publica ahora la "Quaternius Asset License v1.0" (uso comercial, sin atribución, prohíbe redistribuir los assets sueltos, cambios no retroactivos). El zip del Stylized Nature MegaKit (Standard) de OpenGameArt trae `License.txt` con CC0 1.0: guardar ese zip con su licencia.

## Vegetación

| Recurso | Licencia | Tris | Encaje | URL |
|---|---|---|---|---|
| **EZ-Tree** (generador procedural three.js) | MIT | configurable, `generateLODs()` | Muy bueno; presets Oak, Ash, Aspen, Pine, Bush | https://github.com/dgreenheck/ez-tree |
| **Stylized Nature MegaKit** (Standard) | CC0 (zip) | CommonTree 6,3k · Pine 3,9k · Bush 900 · Grass 326 | El mejor de los packs; corteza con normal map | https://quaternius.com/packs/stylizednaturemegakit.html |
| Kenney Nature Kit | CC0 | 60–224 | Low-poly plano: LOD lejano / relleno | https://kenney.nl/assets/nature-kit |
| Oak / Beech / Spruce Trees FREE Low Poly (LadyLionStudios) | CC-BY 4.0 | 16k / 5k / 8k | Semi-realista, hojas alfa; necesita impostor | https://sketchfab.com/3d-models/7a689370f9ec46cea2cbc94641c225e6 |
| Oak Tree Variations With Low Poly Variants | CC-BY 4.0 | variantes low como LOD | Semi-realista | https://sketchfab.com/3d-models/a4c05606689d47b9b9ca56d563b27998 |
| Christmas tree low poly 4 lods | CC-BY (buscador) | 4 LOD | Abeto | https://sketchfab.com/3d-models/9d5502124c954756a347d7ab07557b93 |
| Setos Quaternius / Isa Lousberg (Poly Pizza) | CC0 | — | — | https://poly.pizza/m/df8uCl1YpK |
| ambientCG LeafSet / Foliage | CC0 | texturas | Tarjetas de hierba y setos | https://ambientcg.com/view?id=LeafSet010 |
| Tree-It (herramienta) | Freeware, salida tuya | LOD ajustable | Semi-realista | http://www.evolved-software.com/treeit/treeit |

Descartado: Poly Haven (millones de tris), Kenney/Quaternius "Ultimate Nature" low-poly plano (no encaja salvo lejos). No hay plátanos ni chopos low-poly con licencia válida: usar EZ-Tree (Aspen estirado = chopo; Oak/CommonTree = plátano).

## Gradas y público

| Recurso | Licencia | Tris | Notas | URL |
|---|---|---|---|---|
| Kenney Racing Kit: grandStand, grandStandCovered, …Round, Awning | CC0 | 128–1.302 | Bloque base a retexturizar | https://kenney.nl/assets/racing-kit |
| Low Poly Audience For Mobile Game | CC-BY 4.0 | 862, animado | Pensado para carreras | https://sketchfab.com/3d-models/c8cc901ed54b4fd0b24b88d8e0276947 |
| Kenney Mini Characters | CC0 | ~723 | Para generar atlas de billboards | https://kenney.nl/assets/mini-characters |
| Stands/Tribunes | CC-BY 4.0 | 8,8k sin texturas | — | https://sketchfab.com/3d-models/9745757584ef46b7be11235af84225a9 |
| Grandstand (Catholomew) | CC-BY-NC | 89k | Pesado; NC marcar | https://sketchfab.com/3d-models/b755d45da2d94050994a2fe907b4eb2d |

Rechazado: "Freebie – Lowpoly People" (CC-BY-NC-ND, no permite modificar). Público recomendado: billboards instanciados generados desde Mini Characters / Low Poly Audience con tinte aleatorio.

## Elementos de pista

| Recurso | Licencia | Notas | URL |
|---|---|---|---|
| Kenney Racing Kit (resto) | CC0 | boxes (pitsGarage/Office), overheadLights, pórticos, barreras, rail, vallas, carteles, banderas, puentes | https://kenney.nl/assets/racing-kit |
| Race Track Assets Pack (Cherk) | CC-BY 4.0 | PBR 2K, 563k tris: reducir; aprovechar texturas y carteles de frenada | https://sketchfab.com/3d-models/4a863e7005d647adb2f72775cf41e808 |
| TECPRO Barriers (DylanJade3D) | CC-BY (buscador) | 12k | https://sketchfab.com/3d-models/03701e54c27b418e9e1dfda73d69dc76 |
| Starting Lights | CC-BY (buscador) | 2,4k | https://sketchfab.com/3d-models/4f3bd911404a4952bedc5c9aa5f5d9e3 |
| Tire Stack | CC-BY (buscador) | 28 tris | https://sketchfab.com/3d-models/d6fe2865a37947f0b6661c14878242f1 |
| Concrete Barrier | CC-BY (buscador) | 780 | https://sketchfab.com/3d-models/1892932416e149e9931422d1bacb1e2d |

Descartado: VDrift, Stunt Rally, TORCS (GPL en el arte); SuperTuxKart y Speed Dreams solo revisando asset por asset.

**Generar por código** (extrusión a lo largo de la spline del borde): guardarraíl, valla de malla (postes instanciados + plano con alfa), pianos, muros, TecPro, barreras de neumáticos, líneas, gradas largas, pórticos publicitarios.
**Descargar o modelar**: edificio de boxes (base Kenney), torre de control, pasarelas, semáforo de salida, puestos de comisarios.

## Set por circuito

- **Monza:** EZ-Tree Oak/Ash + Aspen como chopo; CommonTree/TwistedTree del MegaKit a media distancia; Bush, Grass, Fern del MegaKit; impostores o Kenney lejos.
- **Spa:** Pine del MegaKit + EZ-Tree Pine; Spruce/Beech de LadyLionStudios; Kenney pineTall/pineRound en laderas lejanas.
- **Silverstone:** robles y fresnos aislados (EZ-Tree), setos procedurales con textura ambientCG, mucha hierba en tarjetas, pocos árboles.

## Técnica de render

- Instancing: `@three.ez/instanced-mesh` (MIT; culling y LOD por instancia), https://github.com/agargaro/instanced-mesh. Alternativas: `InstancedMesh` / `BatchedMesh` nativos.
- LOD: EZ-Tree `generateLODs()`, meshoptimizer/gltfpack (MIT), gltf-transform.
- Impostores: octahedral-impostor (MIT, en desarrollo, no en npm), https://github.com/agargaro/octahedral-impostor. Demo de ~200k árboles: malla < 15 u, simplificada 15–100 u, impostor > 100 u.
- Hierba: tarjetas instanciadas por bloques con `alphaTest` (no transparencia) y viento en vertex shader.
- Regla: < 3k tris de cerca, ~500 a media distancia, impostor desde 100–150 m.
