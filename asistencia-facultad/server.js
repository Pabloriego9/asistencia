import { createClient } from '@libsql/client';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// Estas constantes permiten trabajar con rutas absolutas aunque el servidor se
// inicie desde una carpeta diferente a la raíz del proyecto.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

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
        await db.execute('ALTER TABLE asistencias ADD COLUMN fecha_hora TEXT');
        await db.execute("UPDATE asistencias SET fecha_hora = datetime('now', 'localtime') WHERE fecha_hora IS NULL");
    }

    if (!columnNames.has('fecha')) {
        await db.execute('ALTER TABLE asistencias ADD COLUMN fecha TEXT');
    }

    if (!columnNames.has('hora')) {
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
        // Extraemos los datos enviados por el formulario y, opcionalmente, una
        // fecha y hora proporcionadas por otro cliente de la API.
        const { nombre, apellido, dni, fecha: fechaRecibida, hora: horaRecibida } = req.body;

        // Sin estos tres datos no se puede crear un registro válido.
        if (!nombre || !apellido || !dni) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
        }

        // Si el cliente no envía fecha u hora, se generan usando el reloj local
        // del servidor y se formatean como YYYY-MM-DD y HH:mm:ss.
        const ahora = new Date();
        const fecha = fechaRecibida || [
            ahora.getFullYear(),
            String(ahora.getMonth() + 1).padStart(2, '0'),
            String(ahora.getDate()).padStart(2, '0')
        ].join('-');
        const hora = horaRecibida || [
            String(ahora.getHours()).padStart(2, '0'),
            String(ahora.getMinutes()).padStart(2, '0'),
            String(ahora.getSeconds()).padStart(2, '0')
        ].join(':');

        // Los signos ? y args separan los valores de la consulta SQL y ayudan
        // a evitar inyecciones SQL.
        const result = await db.execute({
            sql: `
                INSERT INTO asistencias (nombre, apellido, dni, fecha, hora)
                VALUES (?, ?, ?, ?, ?)
            `,
            args: [nombre, apellido, dni, fecha, hora]
        });

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
    res.status(404).json({ error: 'Endpoint API no encontrado' });
});

// Publica los archivos del frontend ubicados en la carpeta public.
app.use(express.static(path.join(__dirname, 'public')));

// Para cualquier otra ruta GET de la aplicación se entrega la página principal
// y el navegador se encarga de mostrar la interfaz.
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

// La aplicación solo comienza a escuchar peticiones después de comprobar que
// la base de datos fue creada y migrada correctamente.
initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Servidor corriendo en http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error al inicializar la base de datos Turso:', error);
        process.exit(1);
    });
