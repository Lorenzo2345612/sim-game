---
name: plan-feature
description: Break a feature or PRD phase of the racing sim into small task specs in tasks/ that cheap worker models (GLM/Kimi/Qwen flash) can implement without asking questions. Use when the user asks to plan, design, break down or start a feature, phase or milestone.
---

# plan-feature (solo para Claude, el planificador)

Claude planifica; no escribe código de producción. Las tareas las ejecutan modelos flash baratos, que siguen instrucciones literalmente, tienen poco criterio de diseño y se pierden con tareas grandes o ambiguas. Cada spec debe compensar eso.

## Proceso

1. Lee `PRD.md` (secciones relevantes), `CLAUDE.md` y lo que ya exista en `src/` y `tasks/`.
2. Si hay decisiones de producto abiertas que cambian el diseño, pregunta al usuario antes de escribir tareas.
3. Diseña tú la solución: módulos, tipos públicos, flujo de datos, fórmulas físicas con unidades. Las decisiones de arquitectura se toman aquí, no en el worker.
4. Divide en tareas siguiendo las reglas de tamaño. Numera con el siguiente número libre en `tasks/` (`001-`, `002-`…).
5. Escribe cada tarea copiando `tasks/_TEMPLATE.md`.
6. Si una tarea necesita conocimiento reutilizable (convenciones de Three.js, cómo usar Rapier, formato de `track.json`), escríbelo una vez en `ai/guides/<tema>.md` y cítalo desde las tareas.
7. Actualiza `tasks/README.md` (tabla: número, título, estado, depende de).
8. Resume al usuario el plan: lista de tareas, orden y qué se podrá ver/probar al terminar.

## Reglas de tamaño para modelos flash

- Una tarea = un comportamiento verificable. Máximo ~3 archivos de `src/` y ~300 líneas nuevas.
- Si necesitas la palabra "y" para describir el objetivo, probablemente son dos tareas.
- Los tipos e interfaces compartidos van en una tarea previa propia, para que las siguientes los importen y no los inventen.
- Da firmas exactas (`export function stepVehicle(state: VehicleState, input: DriverInput, dt: number): VehicleState`), constantes con unidades y fórmulas. No "implementa un modelo de neumático razonable".
- Criterios de aceptación comprobables con Vitest o un comando. Si un criterio es visual, define cómo comprobarlo (captura con Playwright, valor en el HUD, etc.).
- Lista explícita de "Fuera de alcance": los modelos flash tienden a añadir cosas.
- Tareas sin dependencias entre sí y sin archivos en común pueden ejecutarse en paralelo; márcalo en `tasks/README.md`.
