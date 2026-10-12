# Guía de tests

- Runner unitario: Vitest. Archivos `tests/unit/**/*.test.ts`.
- E2E: Playwright. Archivos `tests/e2e/**/*.spec.ts`. Solo para flujos que necesitan navegador (carga de escena, input, HUD).
- La física se prueba sin render: crear el mundo Rapier, avanzar N pasos fijos y comprobar estado (posición, velocidad, ángulo). Inicializar Rapier con `await RAPIER.init()` en `beforeAll`.
- Comparar floats con `toBeCloseTo(valor, decimales)`, nunca con `toBe`.
- Nada de `setTimeout` ni tiempo real: el loop de juego acepta un `dt` explícito.
- Datos de circuito de prueba: usar fixtures pequeños en `tests/fixtures/`, no los circuitos completos.
- Un test = un comportamiento. Nombre del test en inglés, describe el comportamiento esperado.
