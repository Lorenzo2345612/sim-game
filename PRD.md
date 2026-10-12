# PRD — Simulador web de monoplazas (nombre provisional: "Apex Web")

| Campo | Valor |
|---|---|
| Versión | 0.2 (borrador) |
| Fecha | 2026-10-11 |
| Estado | En definición |
| Plataforma | Navegador web (escritorio primero) |

---

## 1. Visión

Simulador de carreras de monoplazas (categorías tipo F4/F3/F2/F1, sin licencia de ninguna de ellas), jugable en el navegador sin instalación, que reproduce con fidelidad el trazado de circuitos reales del calendario de F1. El objetivo es un punto intermedio entre arcade y simulación ("sim-cade"): física creíble, sensación de velocidad alta, controles accesibles con teclado y mando, y ayudas configurables para subir la exigencia.

Estilo visual: **semi-realista estilizado** (PBR simplificado, colores limpios, iluminación cuidada), priorizando legibilidad y rendimiento sobre el fotorrealismo.

Modelo de proyecto: **gratuito y sin ánimo de lucro** (proyecto personal / portfolio).

## 2. Objetivos

1. Conducir un monoplaza en circuitos con trazado geográficamente fiel (posición de curvas, longitudes y desnivel aproximado).
2. Entorno visual atractivo: asfalto, pianos, escapatorias, muros, vallas, gradas, árboles y vegetación, cielo dinámico.
3. Rendimiento estable: 60 FPS en un portátil medio con GPU integrada reciente, en calidad "media".
4. Carga inicial rápida: menos de 10 s hasta poder conducir con conexión de 50 Mbps.
5. Arquitectura que permita añadir circuitos nuevos con un pipeline semiautomático (datos → malla → escena).

### No objetivos (v1)

- Licencias oficiales de F1, equipos, pilotos o patrocinadores.
- Multijugador en tiempo real (se plantea para fases posteriores).
- Daños físicos complejos, meteorología cambiante durante la carrera, estrategia de neumáticos completa.
- Soporte móvil completo (solo verificación de que no rompe).

## 3. Público objetivo

- Aficionados a la F1 que quieren probar circuitos reales sin comprar un simulador.
- Jugadores casuales de navegador (teclado).
- Jugadores con mando o volante (Gamepad API) que buscan algo más exigente.

## 4. Consideraciones legales (bloqueante)

- "Formula 1", "F1", "Grand Prix" con marca, logotipos, nombres de equipos, pilotos y libreas son marcas registradas. **No se usarán.** El coche será un monoplaza genérico con libreas propias.
- Los nombres oficiales de algunos circuitos son marcas. **Decisión:** se usa el nombre de la ciudad/región ("Monza", "Spa", "Silverstone"), sin denominaciones comerciales completas.
- **Licencias de assets válidas** (proyecto sin ánimo de lucro, presupuesto 0): CC0, CC-BY, CC-BY-SA, MIT/BSD y **CC-BY-NC** (al no haber monetización). No se usan assets "solo uso personal" ni "editorial". Si en el futuro se monetiza, todos los assets NC deben sustituirse, así que cada asset NC se marca como tal.
- CC-BY-SA / GPL en assets: obligan a publicar los derivados con la misma licencia. Aceptable si el repositorio de assets es abierto.
- Se mantendrá un registro `ASSETS_LICENSES.md` con origen, autor, licencia, URL y marca NC de cada asset, y una pantalla de créditos en el juego (requisito de CC-BY).
- Modelos de coches con logos de patrocinadores o libreas reales: se reutilizan solo tras **eliminar marcas** y repintar texturas.

## 5. Stack técnico

### 5.1 Motor de render — decisión: **Three.js**

| Opción | Pros | Contras |
|---|---|---|
| **Three.js** (elegido) | Ecosistema enorme, ligero, control total, WebGPU renderer disponible, buen soporte glTF | Hay que construir más piezas (editor, LOD, etc.) |
| Babylon.js | Motor más "completo" (físicas integradas, inspector, editor) | Más pesado, menos ejemplos de racing |
| PlayCanvas | Editor visual, muy optimizado | Editor en la nube, menos control del pipeline |

**Decisión:** TypeScript puro + HTML/CSS para UI y HUD. Sin React.

Renderizador: `WebGLRenderer` como base y `WebGPURenderer` como mejora progresiva cuando esté disponible.

### 5.2 Física — decisión: **Rapier (`@dimforge/rapier3d-compat`)**

- WASM, determinista, rápido.
- Incluye un *ray-cast vehicle controller* (port de `btRaycastVehicle` de Bullet) útil como base.
- Para monoplazas se implementará encima un **modelo de neumático propio** (curva tipo Pacejka simplificada) y aerodinámica (carga y resistencia proporcionales a v²), porque el controlador por defecto no da sensación de monoplaza.
- Paso de física fijo a 120 Hz (sub-stepping), render desacoplado con interpolación.
- Alternativas descartadas: cannon-es (sin mantenimiento activo, menos rendimiento), Ammo.js (pesado, API incómoda).

### 5.3 Resto del stack

| Área | Tecnología |
|---|---|
| Lenguaje | TypeScript |
| Build | Vite |
| Formato 3D | glTF 2.0 / `.glb` con compresión Draco o Meshopt + texturas KTX2 (Basis) |
| Optimización de assets | `gltf-transform` (CLI) en el pipeline |
| Audio | Web Audio API (síntesis/mezcla granular del motor según RPM) |
| Input | Teclado, Gamepad API (mando y volantes compatibles) |
| UI / HUD | HTML/CSS superpuesto, TypeScript puro |
| Persistencia local | IndexedDB / localStorage (mejores vueltas, ajustes) |
| Tests | Vitest (lógica, física), Playwright (smoke tests en navegador) |
| Hosting | Estático + CDN (Cloudflare Pages / Vercel / Netlify) |

## 6. Datos de circuitos

### 6.1 Fuente del trazado

- **Repositorio `bacinger/f1-circuits`** (licencia MIT): GeoJSON con la línea central de ~40 circuitos del calendario de F1 actual e histórico (Monza, Spa, Silverstone, Suzuka, Interlagos, Mónaco, Baku, Las Vegas, etc.). Incluye un fichero por circuito y año de trazado.
- Limitaciones: solo línea central en lat/lon; **no** trae ancho de pista, elevación por punto, pianos, pit lane ni entorno.

### 6.2 Datos complementarios

| Dato | Fuente propuesta |
|---|---|
| Elevación | Modelo digital de elevación (Copernicus GLO-30 o SRTM, 30 m) muestreado sobre la línea central y suavizado |
| Ancho de pista, pit lane, escapatorias | OpenStreetMap (`highway=raceway`, `width`, áreas `landuse`) con licencia ODbL (requiere atribución) + valores por defecto (12–15 m) + ajuste manual |
| Posición de gradas, edificios, árboles | OSM (`building`, `natural=tree`, `landuse=forest`) + colocación procedural + retoque manual |
| Imagen de referencia | Ortofoto solo como referencia para el diseñador, **no** se incluye en el juego salvo licencia explícita |

### 6.3 Pipeline de generación de circuito (herramienta offline, Node/TS)

1. Cargar GeoJSON → proyectar lat/lon a metros locales (proyección ENU/UTM centrada en el circuito).
2. Remuestrear la línea central a intervalos regulares (p. ej. 2 m) y suavizar con spline Catmull-Rom.
3. Añadir elevación desde el DEM y suavizar (sin escalones).
4. Generar malla de pista por extrusión: asfalto, líneas blancas, pianos en curvas (detección por curvatura), arcén, escapatoria (grava/asfalto), muros/barreras (Tecpro, guardarraíl, neumáticos).
5. Generar terreno circundante (heightmap) que se una a la pista sin huecos.
6. Colocar decoración: gradas, vallas, carteles genéricos, árboles (instanciados), edificios de boxes.
7. Generar datos de juego: línea de salida, parrilla, sectores, checkpoints, línea ideal (racing line) para IA y ayudas, zonas de DRS opcional.
8. Exportar `.glb` comprimido + `track.json` (metadatos).
9. Pasada manual en editor (Blender o editor propio in-game) para pulir zonas emblemáticas (Eau Rouge, curva de Mónaco, etc.).

Criterio de aceptación de fidelidad: la longitud total generada debe estar dentro de ±1 % de la longitud oficial del circuito.

## 7. Assets 3D

### 7.1 Monoplaza

Requisitos:
- Monoplaza **genérico** estilo era moderna (halo, alerones, ruedas descubiertas), sin marcas reales.
- Formato `.glb`, PBR (metal/rugosidad), 30–80 k triángulos en LOD0, con LOD1/LOD2.
- Ruedas como nodos separados (giro y dirección), volante separado (vista cockpit), alerones separables (opcional para animación DRS).
- Libreas intercambiables por textura/material (máscaras de color).

Categoría: no tiene que ser F1. Sirve cualquier monoplaza (F4, F3, F2, IndyCar, Fórmula E…) siempre que sea genérico, sin libreas ni nombres reales ("Tatuus", "Dallara", "IndyCar" no aparecen en el juego).

Candidatos verificados (2026-10-11, presupuesto 0, licencias en su ficha):

| Uso | Modelo | Autor | Licencia | Triángulos | Notas | URL |
|---|---|---|---|---|---|---|
| Placeholder (Fase 0) | Car Kit `race.glb`, `race-future.glb` | Kenney | CC0 | ~1,9k–2,1k | GLB, ruedas como nodos separados con nombre, sin logos | https://kenney.nl/assets/car-kit |
| Placeholder (Fase 0) | Racing Kit `raceCarRed/Green/Orange/White` | Kenney | CC0 | ~1,4k | GLB, ruedas separadas | https://kenney.nl/assets/racing-kit |
| **Coche principal (candidato 1)** | 2010 Indycar | CarlosCG31 (Sketchfab) | CC-BY 4.0 | 18,9k | Blanco liso, sin logos; sin PBR (se re-texturiza) | https://sketchfab.com/3d-models/2010-indycar-6d7384aab671492abc0da25359ff8f3a |
| **Coche principal (candidato 2)** | Generic F1 Car (~2010) | CarlosCG31 (Sketchfab) | CC-BY | 13,9k | Rojo liso; quitar texto "PIRATY" de neumáticos | https://sketchfab.com/3d-models/generic-f1-car-ae419541d43143fc80cf0c6e559e1bb2 |
| Alternativa | Generic 2022 F1 car | mpdevteam (Sketchfab) | CC-BY | 172k | Sin logos; requiere decimar a < 80k | https://sketchfab.com/3d-models/generic-2022-f1-car-885d67926c1f4397bebd4efd6b5a3f73 |
| Alternativa (con trabajo) | Formula 1 Car Midpoly | LWDream (Sketchfab) | CC-BY | 131k | PBR, "game-ready", pero **tiene logos reales**: re-texturizar obligatorio | https://sketchfab.com/3d-models/formula-1-car-midpoly-ca91852b29bb435d8d0278d9131aa775 |
| Alternativa (fórmula de base) | Speed Dreams `mp5-fmc` | Andrew Sumner | Free Art License (copyleft) | — | Estilo Formula Ford, con piloto y ruedas separadas; formato AC3D, convertir en Blender; derivados con la misma licencia | https://github.com/xy008areshsu/speed-dreams-2/tree/master/data/cars/models/mp5-fmc |

Descartados: modelos con libreas reales (Alpine, McLaren-Marlboro, Firestone), rips de otros juegos (Asphalt, mods de GP4) y todos los de pago (presupuesto 0; además las licencias "Standard"/"Royalty Free" de los marketplaces prohíben distribuir el archivo suelto, algo inevitable en web).

Plan:
1. Fase 0: Kenney `race.glb` (CC0) como placeholder.
2. Fase 1: CarlosCG31 "2010 Indycar" o "Generic F1 Car" → Blender: separar ruedas y volante si no lo están, limpiar topología, UV nuevas, materiales PBR propios con máscaras de librea, LODs, export `.glb` comprimido. Crédito CC-BY en pantalla de créditos.
3. Si ninguno convence tras la limpieza: generación asistida por IA como base (ver 7.4) + modelado propio.

### 7.2 Entorno

Investigación completa con licencias y URLs: `docs/research/assets-entorno.md`.

| Asset | Fuente elegida | Licencia |
|---|---|---|
| Árboles (primer plano) | EZ-Tree, generador procedural para three.js con LODs (presets Oak, Ash, Aspen, Pine) | MIT |
| Árboles y arbustos (media distancia), hierba, helechos | Quaternius Stylized Nature MegaKit (Standard) | CC0 (guardar zip con License.txt) |
| Árboles lejanos / relleno | Kenney Nature Kit + impostores | CC0 |
| Coníferas y hayas extra (Spa) | LadyLionStudios Spruce / Beech Trees | CC-BY 4.0 |
| Texturas PBR (asfalto, grava, hierba, hojas) | Poly Haven, ambientCG | CC0 |
| Cielo / HDRI | Poly Haven + `Sky` de Three.js | CC0 |
| Gradas, boxes, pórticos, carteles, semáforo base | Kenney Racing Kit, retexturizado | CC0 |
| Público | Billboards instanciados generados desde Kenney Mini Characters / Low Poly Audience | CC0 / CC-BY 4.0 |
| Guardarraíl, vallas, pianos, muros, TecPro, barreras de neumáticos, gradas largas | Generados por código a lo largo de la spline del circuito | propio |
| Texturas de barreras y carteles de frenada | Race Track Assets Pack (Cherk) | CC-BY 4.0 |

Técnica: `@three.ez/instanced-mesh` (instancing con culling y LOD por instancia), impostores octaédricos a partir de 100–150 m, hierba en tarjetas con `alphaTest`. Presupuesto: < 3k tris por árbol de cerca, ~500 a media distancia.

Nota de estilo: estilo **semi-realista estilizado**. Se usan texturas PBR (Poly Haven, ambientCG) con saturación y detalle moderados, y vegetación de geometría media (Quaternius / Poly Haven) con materiales unificados. Los assets low-poly puros (Kenney) solo como placeholder o para objetos lejanos. Todos los assets pasan por una paleta y un ajuste de materiales comunes para que la escena quede coherente.

### 7.3 Presupuesto de rendimiento por escena (calidad media)

- < 300 draw calls (instancing obligatorio para árboles, gradas, conos, vallas).
- < 2 M triángulos visibles.
- Memoria de texturas < 512 MB (KTX2).
- Descarga por circuito < 40 MB; coche < 8 MB.

### 7.4 Generación de assets con IA (apoyo, no sustituto)

Investigación del 2026-10-11. Solo se usan herramientas cuyas salidas se puedan publicar en un juego web gratuito.

Herramientas aprobadas:

| Herramienta | Tipo | Licencia de salida | Coste | Uso previsto |
|---|---|---|---|---|
| TRELLIS.2 (Microsoft) | Image-to-3D abierto, PBR | MIT | Space gratis de HF (~5 min GPU/día) o local con ≥24 GB VRAM | Base de carrocería, props decorativos |
| Pixal3D (TencentARC) | Image-to-3D abierto, PBR | MIT | Space gratis de HF | Alternativa a TRELLIS.2 |
| SPAR3D / Stable Fast 3D (Stability) | Image-to-3D abierto | Stability Community (gratis < 1 M$ ingresos) | Local con 6–11 GB VRAM | Props, rocas; SPAR3D permite remesh a quads |
| TripoSG | Image-to-3D, solo geometría | MIT | Local con ≥8 GB VRAM | Geometría base |
| Meshy (plan Free) | Servicio web | CC BY 4.0 (crédito a "Meshy") | 10 descargas/mes (Meshy 6 Lite) | Complemento |
| FLUX.1-schnell / Qwen-Image | Texto a imagen | Apache 2.0 | Gratis | Imagen conceptual previa (image-to-3D supera a text-to-3D) |

Descartadas o pendientes:
- Hunyuan3D 2.0/2.1 (pesos abiertos): su licencia excluye UE, Reino Unido y Corea del Sur. El equipo está en **México**, así que generar con ella **está permitido**. Zona gris: la licencia también limita el uso de las salidas fuera del territorio, y un juego web se descarga en navegadores de la UE. Por eso Hunyuan3D se usa para bocetos y pruebas; los assets que se publican en el juego se generan preferentemente con herramientas MIT (TRELLIS.2, Pixal3D, TripoSG). Si se publica algún asset de Hunyuan3D: etiquetarlo como generado por IA y revisar la licencia antes de publicar.
- Tripo Free (salidas públicas y "no comercial", ToS sin verificar), Hunyuan Global (términos sin verificar): solo tras revisar términos.
- Sloyd Free (uso personal), Rodin Free (sin exportación útil), Spline, Kaedim, Alpha3D (sin plan gratis): descartadas.

Recursos de cómputo disponibles:

| Recurso | Capacidad | Qué se ejecuta ahí |
|---|---|---|
| Portátil con RTX 5060 (8 GB VRAM, arquitectura Blackwell) | Gratis, ilimitado | SPAR3D (modo low-VRAM), Stable Fast 3D, TripoSG, Hunyuan3D-2mini (solo forma), FLUX.1-schnell cuantizado, EZ-Tree, Blender |
| RunPod (10 USD de saldo) | Horas de GPU de 24–48 GB (unas decenas de horas según la GPU elegida) | TRELLIS.2, Hunyuan3D-2.1 con textura PBR, Step1X-3D: lotes de generación planificados, no exploración |
| Spaces gratuitos de Hugging Face | ~5 min de GPU/día | Pruebas rápidas de TRELLIS.2, Pixal3D, Hunyuan3D-2.1 antes de gastar saldo |

Notas:
- La RTX 5060 (Blackwell, sm_120) necesita PyTorch con CUDA 12.8 o superior. Los repositorios con extensiones CUDA propias (nvdiffrast, spconv, flash-attn, rasterizadores) pueden requerir compilarlas desde código; verificar antes de dar un modelo por "funciona en local".
- Flujo de gasto en RunPod: preparar todas las imágenes conceptuales antes, probar en Spaces gratuitos, y lanzar un pod solo para el lote final. Apagar (no solo detener) el pod al terminar para no consumir saldo por almacenamiento.

Idoneidad por asset:
- **Monoplaza:** calidad baja-media. Ruedas fundidas con la suspensión, asimetría, alerones y halo rotos, topología caótica. Uso solo como base de volumen: cortar a la mitad + Mirror, ruedas y suspensión modeladas aparte, re-UV para libreas.
- **Ruedas:** siempre a mano (nodos separados para rotar).
- **Árboles:** mejor procedural con **EZ-Tree** (MIT, exporta GLB con LODs): https://github.com/dgreenheck/ez-tree
- **Rocas y terreno decorativo:** buena calidad, punto fuerte de la IA.
- **Gradas, boxes, barreras, vallas:** mejor modular en Blender, generadas por código o kits CC0.

Postproceso obligatorio de todo asset IA: decimate/remesh al presupuesto (coche 10–30k tris, props 200–2k), origen y escala correctos, re-UV, bake a atlas 1–2k, export glTF y `gltf-transform optimize` (meshopt/Draco + KTX2/WebP), LODs. Cada asset generado se registra en `ASSETS_LICENSES.md` con herramienta y licencia, y se etiqueta como generado por IA en los créditos.

## 8. Requisitos funcionales

### 8.1 Modos de juego

| ID | Modo | Prioridad |
|---|---|---|
| M1 | Práctica libre / contrarreloj (time trial) con fantasma de la mejor vuelta | P0 (MVP) |
| M2 | Carrera rápida contra IA (5–20 coches) | P1 |
| M3 | Fin de semana: clasificación + carrera | P2 |
| M4 | Multijugador online (fantasmas asíncronos primero, tiempo real después) | P3 |
| M5 | Campeonato con varios circuitos | P3 |

### 8.2 Conducción

- RF-01: Acelerador, freno, dirección analógicos (mando Xbox/PlayStation vía Gamepad API) y digitales con suavizado (teclado). **MVP: teclado + mando.** Volante: P2 (sin force feedback en web). Táctil/móvil: fuera de alcance.
- RF-02: Cambio automático y manual (levas/teclas), 8 marchas.
- RF-03: Ayudas configurables: control de tracción, ABS, dirección asistida, línea ideal con indicador de frenada, autofreno (modo casual).
- RF-04: Modelo físico: transferencia de pesos, carga aerodinámica dependiente de la velocidad, rebufo (slipstream), DRS en zonas definidas, desgaste de neumáticos simplificado (P2).
- RF-05: Superficies con distinto agarre: asfalto, piano, hierba, grava, (grava frena el coche).
- RF-06: Límites de pista: detección de las 4 ruedas fuera → aviso / vuelta invalidada en contrarreloj.
- RF-07: Reset del coche a la pista (tecla) con penalización de tiempo.
- RF-08: Colisiones con muros y otros coches (respuesta física, sin daños en v1).

### 8.3 Cámaras

- RF-10: Cámaras: exterior (persecución), cockpit (con halo), T-cam (sobre la caja de aire), morro, TV/repetición.
- RF-11: Efectos de velocidad: FOV dinámico, vibración leve, motion blur opcional.

### 8.4 HUD e interfaz

- RF-20: HUD: velocidad, marcha, RPM con luces de cambio, tiempo de vuelta, delta con mejor vuelta, sectores (morado/verde/amarillo), posición, minimapa.
- RF-21: Menú principal, selección de circuito (con mapa y datos: longitud, curvas), selección de librea, ajustes.
- RF-22: Ajustes: gráficos (presets + opciones), controles (remapeo), audio, ayudas, unidades (km/h, mph).
- RF-23: Pausa, reinicio de sesión, tabla de tiempos.

### 8.5 IA (P1)

- RF-30: Coches IA que siguen la línea ideal con variación, frenan según curvatura y adelantan/defienden de forma básica.
- RF-31: Niveles de dificultad (ajustando velocidad en curva y errores).

### 8.6 Repeticiones y fantasmas

- RF-40: Grabación de entradas/estados para fantasma de mejor vuelta (local).
- RF-41: Repetición de la sesión con cámaras TV (P2).
- RF-42: Exportar/importar fantasma como archivo (P2), base para tablas online.

### 8.7 Audio

- RF-50: Sonido de motor dependiente de RPM y carga (mezcla de muestras en bucle por rangos o síntesis granular).
- RF-51: Sonidos de neumáticos derrapando, piano, grava, viento, colisiones, cambio de marcha.
- RF-52: Audio espacial para coches IA.

### 8.8 Entorno visual

- RF-60: Iluminación con sol direccional + sombras en cascada (CSM) + HDRI ambiental.
- RF-61: Hora del día seleccionable (día / atardecer / noche para circuitos nocturnos como Singapur, Las Vegas, Yas Marina) — P2.
- RF-62: Post-procesado: tonemapping ACES/AgX, bloom suave, SSAO opcional, antialiasing (SMAA/TAA).
- RF-63: Marcas de neumáticos y partículas de humo/polvo/chispas.

## 9. Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | 60 FPS en calidad media en portátil con GPU integrada moderna (p. ej. Intel Iris Xe / Apple M1); 120+ FPS en GPU dedicada media |
| RNF-02 | Latencia input → respuesta visual < 50 ms |
| RNF-03 | Compatibilidad: Chrome, Edge, Firefox y Safari últimas 2 versiones (WebGL2 obligatorio) |
| RNF-04 | Carga: menú interactivo < 3 s; circuito jugable < 10 s (50 Mbps); carga progresiva (pista primero, decoración después) |
| RNF-05 | Física determinista con paso fijo (requisito para fantasmas y futuro multijugador) |
| RNF-06 | Accesibilidad: remapeo completo, opción de daltonismo para colores de sectores, subtítulos/indicadores visuales de avisos sonoros |
| RNF-07 | Funcionamiento offline tras primera carga (PWA + caché de assets) — P2 |
| RNF-08 | Sin backend obligatorio para el MVP |

## 10. Arquitectura (alto nivel)

```
src/
  core/        loop de juego (paso fijo), eventos, gestor de estado
  physics/     integración Rapier, modelo de vehículo, neumáticos, aero
  render/      escena, cámaras, materiales, post-procesado, LOD
  track/       carga de track.json + .glb, checkpoints, superficies
  ai/          seguimiento de línea ideal, comportamiento
  input/       teclado, gamepad, volante, mapeo
  audio/       motor, efectos, mezclador
  ui/          HUD, menús
  replay/      grabación y reproducción
tools/
  track-builder/   pipeline offline GeoJSON + DEM + OSM → .glb + track.json
  asset-optimize/  scripts gltf-transform (draco/meshopt, KTX2, LOD)
assets/
  cars/  tracks/  env/  audio/
```

Principios:
- Simulación separada del render (permite servidor autoritativo futuro).
- Assets de circuito cargados bajo demanda; un circuito = un paquete.
- Configuración del coche en datos (JSON): masa, potencia, curva de par, aero, neumáticos, para ajustar sin recompilar.

## 11. Alcance por fases

### Fase 0 — Prototipo técnico (2–3 semanas)
- Vite + Three.js + Rapier funcionando.
- Coche placeholder con física de vehículo básica.
- Un circuito generado desde GeoJSON: **Monza** (rápido y casi llano, buen caso de prueba) con malla de pista simple.
- Cámara de persecución, teclado, cronómetro.

### Fase 1 — MVP (6–8 semanas)
- Modelo físico de monoplaza afinado (aero, neumáticos, transferencia de pesos).
- Modelo de monoplaza definitivo o semidefinitivo.
- 3 circuitos completos con entorno: **Monza, Spa, Silverstone**.
- Contrarreloj con fantasma, HUD completo, cámaras, audio de motor, teclado + mando.
- Presets gráficos y objetivo de rendimiento cumplido.

### Fase 2 — Carrera
- IA, carrera rápida, parrilla, salida con semáforos.
- Más circuitos (objetivo 10), circuitos nocturnos, repeticiones.

### Fase 3 — Online
- Tablas de tiempos online con validación de fantasmas.
- Multijugador en tiempo real (WebRTC / WebSocket con servidor autoritativo).

## 12. Métricas de éxito

- FPS medio y percentil 1 % por preset (telemetría opcional anónima).
- Tiempo de carga real por circuito.
- Duración media de sesión > 15 min; % de jugadores que completan 5+ vueltas.
- Diferencia de longitud del circuito generado vs. oficial < 1 %.

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Marcas registradas (F1, circuitos, equipos) | Alto | Coche y libreas genéricos, revisión legal de nombres |
| Licencias de assets incompatibles con web | Alto | Registro de licencias, preferir CC0 / encargo propio |
| Física poco convincente | Alto | Modelo de neumático propio, iterar pronto con volante/mando, telemetría de depuración |
| Rendimiento en GPU integradas | Medio | Instancing, LOD, KTX2, presets, presupuesto por escena |
| Datos de circuito incompletos (ancho, elevación) | Medio | DEM + OSM + retoque manual; validación de longitud |
| Tiempo de producción por circuito | Medio | Pipeline automatizado, decoración procedural |
| Diferencias entre navegadores (Safari, Gamepad API) | Bajo | Matriz de pruebas, Playwright |

## 14. Decisiones tomadas y preguntas abiertas

### Decisiones (2026-10-11)

| Tema | Decisión |
|---|---|
| Estilo visual | Semi-realista estilizado |
| Nivel de simulación | Sim-cade con ayudas configurables |
| Monetización | Gratis, sin ánimo de lucro (CC-BY-NC permitido) |
| Presupuesto monoplaza | Solo modelos gratuitos |
| Nombres de circuitos | Ciudad/región |
| Circuitos MVP | Monza, Spa, Silverstone |
| UI | TypeScript puro + HTML/CSS |
| Controles MVP | Teclado y mando |
| Categoría del coche | Cualquier monoplaza (F4, F3, F2, Fórmula E, etc.), no necesariamente F1 |
| Ubicación del equipo | México (Hunyuan3D permitido para generar; assets publicados preferentemente con herramientas MIT) |
| Cómputo para IA | RTX 5060 portátil (8 GB) + 10 USD en RunPod + Spaces gratuitos |

### Preguntas abiertas

1. Modelo de monoplaza concreto: elegir entre "2010 Indycar" y "Generic F1 Car" de CarlosCG31 (ver 7.1) tras probarlos en el motor.
2. ¿Un solo coche o varias categorías (p. ej. F4 lento y monoplaza tipo F2 rápido) con físicas distintas?
3. ¿Hosting y dominio?

## 15. Referencias

- Trazados: https://github.com/bacinger/f1-circuits (MIT)
- Three.js: https://threejs.org
- Rapier: https://rapier.rs
- glTF Transform: https://gltf-transform.dev
- Poly Haven (CC0): https://polyhaven.com
- ambientCG (CC0): https://ambientcg.com
- Kenney (CC0): https://kenney.nl
- Quaternius (CC0): https://quaternius.com
- OpenStreetMap (ODbL): https://www.openstreetmap.org
- Copernicus DEM GLO-30: https://spacedata.copernicus.eu
