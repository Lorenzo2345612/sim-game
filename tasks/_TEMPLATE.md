# NNN — Título corto en infinitivo

Estado: pendiente | en curso | hecha | bloqueada
Fase: 0 | 1 | 2 | 3
Depende de: NNN, NNN (o "nada")
Roles: coder, tester, reviewer

## Objetivo

Una o dos frases: qué comportamiento existe al terminar que hoy no existe.

## Contexto

Lo mínimo que el worker necesita saber y no puede deducir del código: decisiones del PRD (cita la sección), convenciones, por qué se hace así. Guías a leer: `ai/guides/...`.

## Archivos

- `src/...` — crear | modificar — qué va en él
- `tests/...` — crear — qué prueba

## Qué hacer

Pasos numerados y concretos. Nombres de funciones, tipos y firmas cuando importen. Valores numéricos con unidades.

1. ...
2. ...

## Criterios de aceptación

Verificables por un test o un comando. Nada de "funciona bien".

- [ ] ...
- [ ] ...

## Verificación

```
npm run typecheck
npm run lint
npm test
```

## Fuera de alcance

- Cosas que el worker NO debe hacer aunque parezcan relacionadas.
