import { createClient } from '@libsql/client';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { validateAttendanceInput } from './validation.js';

// Estas constantes permiten trabajar con rutas absolutas aunque el servidor se
// inicie desde una carpeta diferente a la raíz del proyecto.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// El puerto puede configurarse en el entorno de despliegue; 3000 es el valor local.
const PORT = process.env.PORT || 3000;

// Prepara una única instancia del formateador para usar la zona horaria de
// Argentina al construir fecha y hora con formato estable.
const argentinaDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

// Separa la fecha y hora actuales en el formato que espera la base de datos.
function getArgentinaDateTime() {
    const parts = Object.fromEntries(
        argentinaDateTimeFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value])
    );

    return {
        fecha: `${parts.year}-${parts.month}-${parts.day}`,
        hora: `${parts.hour}:${parts.minute}:${parts.second}`
    };
}

// Cliente de conexión a la base de datos Turso. Las credenciales se leen desde
// las variables de entorno para no escribirlas directamente en el código.
const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

// Middleware generales: CORS permite peticiones desde otros orígenes y
// express.json() convierte automáticamente los cuerpos JSON en req.body.
app.use(cors());
app.use(express.json());

// Middleware sencillo de registro: muestra en consola cada petición recibida.
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Crea la tabla si aún no existe y actualiza instalaciones antiguas agregando
// las columnas necesarias para guardar la fecha y la hora por separado.
async function initializeDatabase() {
    // Define el esquema esperado para instalaciones nuevas; IF NOT EXISTS
    // permite ejecutar la inicialización repetidamente sin recrear la tabla.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS asistencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            apellido TEXT NOT NULL,
            dni TEXT NOT NULL,
            fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
            fecha TEXT,
            hora TEXT
        )
    `);

    // Se consulta el esquema actual antes de aplicar migraciones para que el
    // servidor pueda actualizar una base existente sin perder información.
    const schemaResult = await db.execute('PRAGMA table_info(asistencias)');
    const columnNames = new Set(schemaResult.rows.map((column) => column.name));

    if (!columnNames.has('fecha_hora')) {
        // Compatibilidad con bases antiguas que todavía no tenían fecha y hora.
        await db.execute('ALTER TABLE asistencias ADD COLUMN fecha_hora TEXT');
        await db.execute("UPDATE asistencias SET fecha_hora = datetime('now', 'localtime') WHERE fecha_hora IS NULL");
    }

    if (!columnNames.has('fecha')) {
        // La columna independiente permite filtrar y restringir por día.
        await db.execute('ALTER TABLE asistencias ADD COLUMN fecha TEXT');
    }

    if (!columnNames.has('hora')) {
        // Conserva la hora separada para los clientes que la muestran por separado.
        await db.execute('ALTER TABLE asistencias ADD COLUMN hora TEXT');
    }

    // Completa la fecha de registros antiguos y evita duplicados del mismo DNI
    // durante un mismo día a nivel de base de datos.
    await db.execute("UPDATE asistencias SET fecha = date(fecha_hora, 'localtime') WHERE fecha IS NULL");
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_dni_fecha ON asistencias(dni, fecha)');
}

// Registra la asistencia de una persona. Se aceptan dos rutas para conservar
// compatibilidad con clientes que usen /api/asistencia o /api/asistencias.
app.post(['/api/asistencia', '/api/asistencias'], async (req, res) => {
    try {
        // El servidor vuelve a validar todos los datos: la validación del
        // navegador puede omitirse enviando solicitudes directamente a la API.
        const validation = validateAttendanceInput(req.body);
        if (validation.error) {
            return res.status(400).json({ error: validation.error });
        }
        const { nombre, apellido, dni } = validation.data;
        const { fecha: fechaRecibida, hora: horaRecibida } = req.body;

        // Se usa la zona horaria de Argentina, independientemente del servidor.
        const fechaHoraArgentina = getArgentinaDateTime();
        const fecha = fechaRecibida || fechaHoraArgentina.fecha;
        const hora = horaRecibida || fechaHoraArgentina.hora;

        // Los signos ? y args separan los valores de la consulta SQL y ayudan
        // a evitar inyecciones SQL.
        const result = await db.execute({
            sql: `
                INSERT INTO asistencias (nombre, apellido, dni, fecha_hora, fecha, hora)
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            args: [nombre, apellido, dni, `${fecha} ${hora}`, fecha, hora]
        });

        // Devuelve el identificador generado para que el cliente confirme el registro.
        res.json({
            mensaje: 'Asistencia registrada con éxito',
            id: String(result.lastInsertRowid)
        });
    } catch (error) {
        // Un índice único provoca este error cuando el DNI ya tiene asistencia
        // registrada para la misma fecha.
        console.error("Error en Turso:", error);
        if (error.message?.toLowerCase().includes('unique')) {
            return res.status(409).json({ error: 'DNI ya registrado hoy.' });
        }

        console.error('Error al registrar asistencia:', error);
        res.status(500).json({ error: 'Error al registrar la asistencia.' });
    }
});

// Devuelve todas las asistencias ordenadas desde la más reciente a la antigua.
app.get('/api/asistencias', async (req, res) => {
    try {
        // No se aceptan fragmentos SQL del cliente: la consulta es fija y de solo lectura.
        const result = await db.execute('SELECT * FROM asistencias ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener asistencias:', error);
        res.status(500).json({ error: 'Error al obtener las asistencias.' });
    }
});

// Responde de forma clara cuando se solicita una ruta que empieza por /api,
// pero no coincide con ninguno de los endpoints definidos arriba.
app.use('/api', (req, res) => {
    // Evita que las rutas API desconocidas terminen sirviendo el HTML de la aplicación.
    res.status(404).json({ error: 'Endpoint API no encontrado' });
});

// Publica los archivos del frontend ubicados en la carpeta public.
app.use(express.static(path.join(__dirname, 'public')));

// Para cualquier otra ruta GET de la aplicación se entrega la página principal
// y el navegador se encarga de mostrar la interfaz.
app.use((req, res, next) => {
    // La página principal es el fallback para navegación web, no para endpoints API.
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

// La aplicación solo comienza a escuchar peticiones después de comprobar que
// la base de datos fue creada y migrada correctamente.
initializeDatabase()
    .then(() => {
        // Espera la creación/migración de la base antes de aceptar peticiones.
        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error al inicializar la base de datos Turso:', error);
        process.exit(1);
    });
