# sim-game

Simulador web de monoplazas en circuitos reales. Requisitos y decisiones en `PRD.md` (la tabla de decisiones está en la sección 14).

## Roles de modelos

| Quién | Modelo | Hace | No hace |
|---|---|---|---|
| Planificador | Claude (sesión principal) | Diseño, specs en `tasks/`, guías en `ai/guides/`, orquestación, decisiones | Escribir código en `src/`, `tests/`, `tools/` (bloqueado por hook) |
| coder | GLM `glm-5.3-flash` (pesado: `glm-5.3`) | Implementa una spec | Diseñar o ampliar alcance |
| tester | Qwen `qwen3.8-flash` (pesado: `qwen3.8-max`) | Tests de los criterios de aceptación | Editar `src/` |
| reviewer | Kimi `kimi-for-coding` (pesado: `k3-256k`) | Valida contra la spec, ejecuta checks | Editar archivos |
| fixer | DeepSeek `deepseek-v4.1-flash` vía Bailian | Segunda opinión cuando el coder se atasca | — |
| respaldo | Xiaomi MiMo `mimo-v2.6-flash` (pesado: `mimo-v2.6-pro`) | Sustituye a cualquier rol cuando su proveedor se queda sin cuota (automático) | — |

Para pasar todos los roles a MiMo: `SIMGAME_PROVIDER=mimo`. Para una sola ejecución: `--provider mimo`.

Configuración en `ai/providers.json`; lanzador en `scripts/ai/worker.py`. Flujo: skill `plan-feature` → skill `dispatch`.

## Stack

TypeScript estricto, Vite, Three.js, Rapier (`@dimforge/rapier3d-compat`), Vitest, Playwright. UI en HTML/CSS sin React. Gestor de paquetes: npm.

## Comandos

```
npm run dev         # servidor de desarrollo
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
npm run test:e2e    # playwright
```

## Estructura

```
src/core      loop de juego con paso fijo, eventos, estado
src/physics   Rapier, modelo de vehículo, neumáticos, aero
src/render    escena, cámaras, materiales, post-procesado, LOD
src/track     carga de track.json + .glb, checkpoints, superficies
src/input     teclado, gamepad
src/audio     motor y efectos
src/ui        HUD y menús (DOM)
tools/        pipelines offline (track-builder, asset-optimize)
tests/unit    Vitest
tests/e2e     Playwright
assets/       modelos y texturas; licencia de cada uno en ASSETS_LICENSES.md
tasks/        specs de tareas para workers
ai/           configuración de workers, prompts de rol y guías
```

## Convenciones

- Unidades SI en todo el código: metros, segundos, kilogramos, radianes, newtons. Conversión a km/h solo en la UI.
- Sistema de coordenadas: Y arriba, el coche mira hacia -Z en su espacio local.
- La simulación avanza con paso fijo (`FIXED_DT = 1/120` s) y no depende del framerate. El render interpola.
- La lógica de simulación no importa nada de `three` (debe poder ejecutarse en tests sin WebGL).
- Liberar con `dispose()` geometrías, materiales y texturas que se descarten. No crear objetos (`new Vector3`, arrays) dentro del loop por frame: reutilizar temporales.
- Código, identificadores y comentarios en inglés. Documentación y specs en español.
- Ningún asset entra en `assets/` sin su línea en `ASSETS_LICENSES.md`.
