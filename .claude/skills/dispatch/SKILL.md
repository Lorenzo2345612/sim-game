---
name: dispatch
description: Execute task specs from tasks/ with cheap worker models via scripts/ai/worker.py (coder on GLM flash, tester on Qwen flash, reviewer on Kimi), loop on review findings and escalate when they fail. Use when the user asks to implement, build, run, execute or continue tasks.
---

# dispatch (solo para Claude, el planificador)

Claude no edita `src/`, `tests/` ni `tools/` (un hook lo bloquea). Todo el código lo escriben los workers. Claude solo lanza workers, lee sus reportes cortos, decide y corrige las specs.

## Comandos

```
python3 scripts/ai/worker.py ping                                  # comprobar proveedores
python3 scripts/ai/worker.py coder    --task tasks/NNN-x.md        # GLM flash
python3 scripts/ai/worker.py tester   --task tasks/NNN-x.md        # Qwen flash
python3 scripts/ai/worker.py reviewer --task tasks/NNN-x.md        # Kimi
python3 scripts/ai/worker.py fixer    --task tasks/NNN-x.md --note "..."   # DeepSeek flash (segunda opinión)
# añadir --heavy para el modelo grande del rol
# --provider mimo (o SIMGAME_PROVIDER=mimo) fuerza Xiaomi MiMo
```

Si un proveedor responde con error de cuota o saldo (429/402), `worker.py` reintenta solo con MiMo (`fallback` en `ai/providers.json`). Si el reporte dice `error de cuota` también en MiMo, para y avisa al usuario: no hay más proveedores.

Los workers tardan minutos: lánzalos con Bash en `run_in_background` y espera la notificación. Timeout del Bash: 600000 ms.

## Pipeline por tarea

1. Comprueba que las dependencias de la tarea están `hecha` en `tasks/README.md`. Marca la tarea `en curso`.
2. `coder`. Si `ESTADO: BLOQUEADO`, lee el motivo: casi siempre es una spec ambigua o incompleta → corrige la spec (no el código) y relanza.
3. `tester`. Si `FALLA`, pasa los fallos al coder: `coder --task ... --note "<FALLOS del tester>"`.
4. `reviewer`. Si `CAMBIOS` o `RECHAZADO`, pasa solo los hallazgos BLOQUEANTE al coder con `--note`. Ignora MENOR salvo que sean baratos; las DUDA las decides tú leyendo el código citado.
5. Repite 3-4 hasta `APROBADO` con tests pasando.
6. Marca la tarea `hecha` en la spec y en `tasks/README.md`. Resume al usuario en 2-3 líneas.

## Escalado (para no gastar en bucles)

- 2 rondas fallidas con el modelo flash → misma ronda con `--heavy`.
- 1 ronda fallida con `--heavy` → `fixer` (otro proveedor y otra familia de modelo) con todos los hallazgos en `--note`.
- Si sigue fallando: el problema es la spec. Re-divide la tarea o reescríbela con más detalle (firmas, pseudocódigo). Avisa al usuario.
- Nunca escribas tú el código para desbloquear.

## Paralelo

Tareas marcadas como paralelizables en `tasks/README.md` (sin archivos en común) pueden lanzarse a la vez con varios Bash en segundo plano. Nunca dos workers sobre la misma tarea o los mismos archivos.

## Ahorro de contexto

- Lee solo el reporte que imprime `worker.py`. Los logs completos de `.ai/runs/` solo si el reporte no basta para decidir, y con `tail`/`grep`, nunca enteros.
- Para revisar código usa `git diff --stat` y lee solo los fragmentos citados por el reviewer.
