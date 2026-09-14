# Asistencia Facultad

Instrucciones rápidas:

1. Instalar dependencias:

```bash
npm install
```

2. Iniciar servidor:

```bash
npm start
# o en desarrollo (requiere nodemon):
npm run dev
```

3. Probar API con `curl.exe` (PowerShell) o `curl` (cmd/bash):

```bash
# Insertar
curl.exe -X POST http://localhost:3000/api/asistencia -H "Content-Type: application/json" -d '{"nombre":"Juan","apellido":"Pérez","dni":"12345678"}'

# Listar
curl.exe http://localhost:3000/api/asistencias
```

Notas:
- Ejecuta los comandos desde la carpeta `asistencia-facultad`.
- En PowerShell usa `curl.exe` o `Invoke-RestMethod` para evitar el alias `curl`.
- El servidor usa Turso. Configura `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`; si no defines la URL, usa la URL de Turso configurada por defecto en `server.js`.

Exportar asistencias
- En la interfaz web encontrarás opciones para exportar:
	- Marca `Solo asistencia de hoy` si quieres filtrar por fecha.
	- `Exportar a Excel (.xlsx)`: descarga un archivo `.xlsx` generado en el cliente.
	

Notas sobre Google Sheets:
- La aplicación no usa la API de Google (requiere OAuth). El flujo actual copia el CSV al portapapeles y abre una nueva hoja para que pegues los datos manualmente.

Restricción de un registro por día
- Ahora la aplicación evita que un mismo `DNI` registre asistencia más de una vez en el mismo día.
- Técnica aplicada:
	- Se añadió una columna `fecha` (solo la fecha) que se popula desde `fecha_hora`.
	- Se creó un índice único `idx_dni_fecha` sobre `(dni, fecha)` para prevenir duplicados a nivel de base de datos.
	- En el arranque el servidor ejecuta una migración segura que deduplica registros antiguos y pobla la columna `fecha` cuando sea necesario.
	- En caso de intentar registrar el mismo `DNI` el mismo día, la API responde con HTTP `409` y el mensaje `DNI ya registrado hoy.`


