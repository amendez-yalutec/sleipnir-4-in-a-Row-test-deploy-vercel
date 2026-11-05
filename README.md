# Cuatro en línea 8×7 — demo visual

Demo estático (Vite + React + TypeScript) para probar el despliegue en Vercel.
Tablero de 8 columnas × 7 filas; jugador 1 naranja, jugador 2 azul. Modos: contra un bot sencillo o dos jugadores.

> En el proyecto real las reglas del juego viven en la API; aquí están en el cliente solo para el demo.

## Correr local

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

## Vercel

Vercel detecta Vite solo: Build Command `npm run build`, Output Directory `dist`.
