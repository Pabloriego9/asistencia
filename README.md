# Asistencia Facultad

## Cómo se organiza la aplicación

- `server.js`: inicia Express, asegura las tablas `Alumnos` y `Asistencias` en Turso, publica los archivos de `public/` y define los endpoints de la API.
- `validation.js`: concentra las reglas de validación del endpoint de registro.
- `public/index.html`: define el formulario, sus restricciones de navegador y los controles para exportar.
- `public/script.js`: envía el formulario a la API, muestra el resultado y prepara la exportación a Excel.
- `public/style.css`: define la presentación visual de la página y los estados de los mensajes.
- `test/validation.test.js`: comprueba las reglas de entrada con casos válidos e inválidos.
- `package.json`: declara las dependencias y los comandos `npm start`, `npm run dev` y `npm test`. JSON no admite comentarios; esta sección documenta su propósito.

## Recorrido de un registro

1. El usuario completa el formulario; los atributos HTML ofrecen validación inmediata en el navegador.
2. `public/script.js` detiene la recarga y envía nombre, apellido y DNI como JSON a `POST /api/asistencia`.
3. `server.js` pasa el cuerpo a `validateAttendanceInput`. Si hay errores, responde HTTP `400` y no intenta guardar nada.
4. Si los datos son válidos, el servidor usa la fecha y hora de Argentina por defecto (o los valores opcionales `fecha` y `hora` recibidos por la API) y ejecuta una inserción con parámetros SQL.
5. El servidor reutiliza o crea el alumno por DNI y agrega una asistencia relacionada mediante `alumno_id`, todo dentro de una transacción.
6. La base impide registros duplicados del mismo alumno para una fecha; el servidor responde con éxito o con un error HTTP apropiado.
7. El navegador muestra el resultado como texto, sin interpretarlo como HTML.

## Instalación y configuración

No se agregaron dependencias para las validaciones ni para las pruebas: se usan funciones de JavaScript y el test runner integrado de Node.js. Para instalar las dependencias de la aplicación, desde esta carpeta ejecuta:

```sh
npm install
```

La aplicación requiere una versión de Node.js que soporte módulos ES y `node:test` (Node.js 18 o posterior). Configura estas variables de entorno antes de iniciar el servidor:

```env
TURSO_DATABASE_URL=libsql://tu-base-de-datos.turso.io
TURSO_AUTH_TOKEN=tu-token-de-turso
PORT=3000
```

`PORT` es opcional; si no se define, el servidor usa `3000`. Las credenciales de Turso no deben incluirse en el repositorio. Puedes establecerlas en el entorno o en un archivo `.env` local, que está excluido de Git.

## Iniciar y probar

Inicia la aplicación desde la carpeta `asistencia-facultad`:

```sh
npm start
# Para desarrollo con recarga automática:
npm run dev
```

Ejecuta las pruebas de validación:

```sh
npm test
```

El comando comprueba que se acepten nombres con tildes y `ñ`, que el DNI conserve ceros iniciales y tenga exactamente 8 dígitos, que se rechacen entradas inválidas (incluidos intentos de XSS/SQLi en los campos de nombre) y que los nombres se recorten y normalicen.

## Probar la API

Puedes usar `curl.exe` en PowerShell o `curl` en cmd/bash:

```bash
# Registrar asistencia (DNI enviado como texto para conservar ceros iniciales)
curl.exe -X POST http://localhost:3000/api/asistencia -H "Content-Type: application/json" -d '{"nombre":"Juan","apellido":"Pérez","dni":"12345678"}'

# Consultar las asistencias
curl.exe http://localhost:3000/api/asistencias
```

Notas:
- En PowerShell usa `curl.exe` o `Invoke-RestMethod` para evitar el alias `curl`.
- El servidor necesita `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` para conectarse a Turso.
- `GET /api/health` comprueba que el servidor desplegado puede conectarse a la base y que encuentra las columnas esperadas.

## Conectar Render con la base correcta de Turso

En Render, abre el servicio de la aplicación y ve a **Environment**. Configura estas variables con los valores de la misma base de datos que estás viendo en Turso:

- `TURSO_DATABASE_URL`: copia la URL de conexión de Turso, con formato `libsql://...turso.io`.
- `TURSO_AUTH_TOKEN`: crea o copia un token válido para esa misma base. Guárdalo como variable secreta; no lo pegues en el código, en el navegador ni en mensajes.

Los nombres deben coincidir exactamente con los que lee `server.js`. Guarda los cambios y ejecuta un nuevo deploy en Render. En los logs de arranque aparecerá el host de Turso configurado (nunca el token); compáralo con el host de la URL de la base abierta en Turso.

Después del deploy, abre `https://<tu-servicio>.onrender.com/api/health`. La respuesta esperada es:

```json
{"status":"ok","database":"connected","schema":"compatible"}
```

Si devuelve `database: "unavailable"`, comprueba la URL y el token en las variables de Render. Si devuelve `schema: "incompatible"`, ese servicio está consultando una base distinta o con tablas/columnas diferentes. La estructura de la captura es compatible con la aplicación y no necesita cambios. No vuelvas a ejecutar los comandos `DROP TABLE`: eliminan los datos existentes.

## Funciones y seguridad implementadas

### Validación de entradas

- Nombre y apellido: se recortan los espacios externos, se normalizan en Unicode y deben contener entre 2 y 50 caracteres, usando únicamente letras Unicode y espacios.
- DNI: debe llegar como texto con exactamente 8 dígitos ASCII (`0` a `9`). En el formulario se utiliza un campo de texto con teclado numérico para no perder ceros al inicio.
- El navegador valida para mejorar la experiencia, pero el backend aplica las reglas de nuevo: no se debe confiar en las restricciones HTML como medida de seguridad.
- Una entrada inválida recibe HTTP `400`; no se almacena en la base de datos.

### Protección contra SQL injection y XSS

- Las inserciones a la base de datos usan parámetros SQL (`?` y `args`); no concatenan los datos de usuario dentro de la consulta.
- Los mensajes en el navegador se muestran con `textContent`, por lo que se interpretan como texto y no como HTML. Si se agrega una vista que inserta datos dentro de HTML, se debe usar escape contextual o el escape automático del motor de plantillas.
- La parametrización SQL protege las consultas; el escape HTML protege el contexto de renderizado. Son medidas diferentes y no se sustituyen entre sí.
- No es necesario instalar una librería de sanitización adicional para este flujo. No se deben “limpiar” valores con reemplazos genéricos antes de guardarlos: valida su formato y aplica la protección adecuada en cada contexto.

### Modelo relacional y restricción de un registro por día

- `Alumnos` guarda `id`, `nombre`, `apellido` y `dni`; el DNI es único y permite localizar la ficha de una persona.
- `Asistencias` guarda `id`, `alumno_id`, `fecha` y `hora`. `alumno_id` referencia `Alumnos.id`.
- La restricción única `(alumno_id, fecha)` impide más de una asistencia diaria por alumno; la API responde HTTP `409` ante un duplicado.
- `POST /api/asistencia` y su alias `POST /api/asistencias` no cambian. El backend ahora registra/reutiliza primero el alumno y luego crea la asistencia en las dos tablas dentro de una transacción.
- `GET /api/asistencias` tampoco cambia. El backend hace un `JOIN` y devuelve los campos `id`, `alumno_id`, `nombre`, `apellido`, `dni`, `fecha` y `hora`, que permiten seguir usando la exportación.
- Al iniciar, el servidor crea ambas tablas solo si no existen. Si ya las creaste, deben tener los nombres y columnas indicados arriba, además de las restricciones `UNIQUE(dni)` y `UNIQUE(alumno_id, fecha)`.

### Diagnóstico de error `NOT NULL constraint failed: Asistencias.alumno_id`

Este error indica que el servidor no obtuvo un identificador válido de `Alumnos.id` antes de insertar la asistencia. En el editor SQL de Turso, ejecuta:

```sql
PRAGMA table_info('Alumnos');
```

La fila de `id` debe mostrar tipo `INTEGER` y `pk` igual a `1` (clave primaria autogenerada). `CREATE TABLE IF NOT EXISTS` no corrige una tabla existente con otra estructura; el servidor ahora informa explícitamente si detecta que `id` no cumple ese requisito. No elimines las tablas si contienen datos: primero respalda y migra las relaciones entre alumnos y asistencias.

## Exportar asistencias

- Marca `Solo la asistencia de hoy` para filtrar los registros del día actual.
- Pulsa `Exportar a Excel (.xlsx)` para descargar el archivo generado en el navegador.
- La exportación usa SheetJS desde un CDN, por lo que no requiere agregar un paquete npm; el navegador necesita acceso al CDN para cargar la librería.
