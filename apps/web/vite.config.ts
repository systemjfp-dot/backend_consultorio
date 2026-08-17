import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Escucha en todas las interfaces, no solo en la de bucle local.
    //
    // Resuelve dos cosas: por defecto Vite se ata a IPv6 y algunos navegadores
    // resuelven `localhost` a IPv4, con lo que la página no carga; y permite
    // abrir la aplicación desde una tablet o un teléfono de la misma red, que
    // es la única forma de comprobar de verdad un diseño mobile-first.
    host: true,
    // Todas las llamadas a /api se redirigen al backend en desarrollo.
    // Así el frontend usa rutas relativas y no necesita saber el puerto de la API.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
