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

// Asegura que existan las dos tablas del modelo actual: los datos de cada
// persona se guardan una sola vez en Alumnos y cada marca va en Asistencias.
async function initializeDatabase() {
    // Define el esquema esperado para instalaciones nuevas; IF NOT EXISTS
    // permite ejecutar la inicialización repetidamente sin recrear la tabla.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS Alumnos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            apellido TEXT NOT NULL,
            dni TEXT NOT NULL UNIQUE
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS Asistencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alumno_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            hora TEXT NOT NULL,
            CONSTRAINT fk_alumno
                FOREIGN KEY (alumno_id) REFERENCES Alumnos(id),
            CONSTRAINT uq_asistencia
                UNIQUE (alumno_id, fecha)
        )
    `);

    // CREATE TABLE IF NOT EXISTS no modifica una tabla que ya existía. Verifica
    // que su columna id sea una clave primaria INTEGER autogenerada, porque
    // Asistencias.alumno_id depende de ese valor para relacionar ambas tablas.
    const alumnoSchema = await db.execute("PRAGMA table_info('Alumnos')");
    const alumnoIdColumn = alumnoSchema.rows.find((column) => column.name === 'id');
    if (
        !alumnoIdColumn ||
        String(alumnoIdColumn.type).toUpperCase() !== 'INTEGER' ||
        Number(alumnoIdColumn.pk) !== 1
    ) {
        throw new Error(
            'Esquema incompatible: Alumnos.id debe ser INTEGER PRIMARY KEY (autogenerada). ' +
            'La tabla existente no se modifica automáticamente; corrige su esquema en Turso.'
        );
    }
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
        // El registro siempre usa el reloj del servidor en Argentina. El cliente
        // no puede cambiar el día para registrar otra asistencia o evitar el límite diario.
        const { fecha, hora } = getArgentinaDateTime();

        // Las tres operaciones se ejecutan juntas para no dejar un alumno creado
        // sin asistencia si el segundo INSERT falla. Los parámetros SQL evitan
        // concatenar valores de usuario dentro de las consultas.
        const transaction = await db.transaction('write');
        let asistenciaId;
        try {
            // Si el DNI ya existe, reutiliza ese alumno; si no, crea su ficha.
            await transaction.execute({
                sql: `
                    INSERT INTO Alumnos (nombre, apellido, dni)
                    VALUES (?, ?, ?)
                    ON CONFLICT(dni) DO NOTHING
                `,
                args: [nombre, apellido, dni]
            });

            const alumnoResult = await transaction.execute({
                sql: 'SELECT id FROM Alumnos WHERE dni = ?',
                args: [dni]
            });
            const alumnoId = alumnoResult.rows[0]?.id;
            if (alumnoId === undefined || alumnoId === null) {
                throw new Error(
                    'No se obtuvo un Alumnos.id válido para este DNI. ' +
                    'Verifica que Alumnos.id sea INTEGER PRIMARY KEY AUTOINCREMENT.'
                );
            }

            const asistenciaResult = await transaction.execute({
                sql: `
                    INSERT INTO Asistencias (alumno_id, fecha, hora)
                    VALUES (?, ?, ?)
                `,
                args: [alumnoId, fecha, hora]
            });
            asistenciaId = asistenciaResult.lastInsertRowid;

            await transaction.commit();
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Error al revertir la transacción de asistencia:', rollbackError);
            }
            throw error;
        }

        // Devuelve el identificador generado para que el cliente confirme el registro.
        res.json({
            mensaje: 'Asistencia registrada con éxito',
            id: String(asistenciaId)
        });
    } catch (error) {
        // La restricción única de Asistencias produce este error si el alumno
        // ya tiene una marca para la fecha solicitada.
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
        if (errorMessage.includes('unique')) {
            return res.status(409).json({ error: 'DNI ya registrado hoy.' });
        }

        console.error('Error al registrar asistencia:', error);
        res.status(500).json({ error: 'Error al registrar la asistencia.' });
    }
});

// Permite comprobar desde Render que la aplicación está conectada a la base
// configurada y que esa base contiene las columnas usadas por este servidor.
app.get('/api/health', async (req, res) => {
    try {
        await db.execute('SELECT 1');

        const [alumnosSchema, asistenciasSchema] = await Promise.all([
            db.execute("PRAGMA table_info('Alumnos')"),
            db.execute("PRAGMA table_info('Asistencias')")
        ]);
        const alumnoId = alumnosSchema.rows.find((column) => column.name === 'id');
        const asistenciaAlumnoId = asistenciasSchema.rows.find(
            (column) => column.name === 'alumno_id'
        );
        const schemaIsCompatible = (
            ['id', 'nombre', 'apellido', 'dni'].every((name) =>
                alumnosSchema.rows.some((column) => column.name === name)
            ) &&
            ['id', 'alumno_id', 'fecha', 'hora'].every((name) =>
                asistenciasSchema.rows.some((column) => column.name === name)
            ) &&
            String(alumnoId?.type).toUpperCase() === 'INTEGER' &&
            Number(alumnoId?.pk) === 1 &&
            String(asistenciaAlumnoId?.type).toUpperCase() === 'INTEGER'
        );

        if (!schemaIsCompatible) {
            return res.status(503).json({
                status: 'error',
                database: 'connected',
                schema: 'incompatible'
            });
        }

        res.json({ status: 'ok', database: 'connected', schema: 'compatible' });
    } catch (error) {
        console.error('Error al comprobar la conexión con Turso:', error);
        res.status(503).json({ status: 'error', database: 'unavailable' });
    }
});

// Devuelve todas las asistencias ordenadas desde la más reciente a la antigua.
app.get('/api/asistencias', async (req, res) => {
    try {
        // El servidor determina "hoy" con el mismo reloj que usa al registrar.
        // Sin filtro se conserva la consulta del historial completo.
        const soloHoy = req.query.fecha === 'hoy';
        if (req.query.fecha !== undefined && !soloHoy) {
            return res.status(400).json({ error: 'Filtro de fecha no válido. Usa fecha=hoy.' });
        }
        // Une cada marca con el alumno para mantener el formato que consume el
        // frontend y exportar nombres junto con la fecha y la hora.
        const result = await db.execute({ sql: `
            SELECT
                Asistencias.id AS id,
                Asistencias.alumno_id AS alumno_id,
                Alumnos.nombre AS nombre,
                Alumnos.apellido AS apellido,
                Alumnos.dni AS dni,
                Asistencias.fecha AS fecha,
                Asistencias.hora AS hora
            FROM Asistencias
            INNER JOIN Alumnos ON Alumnos.id = Asistencias.alumno_id
            ${soloHoy ? 'WHERE Asistencias.fecha = ?' : ''}
            ORDER BY Asistencias.id DESC
        `, args: soloHoy ? [getArgentinaDateTime().fecha] : [] });
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
// las tablas requeridas existen o pudieron crearse correctamente.
initializeDatabase()
    .then(() => {
        // Espera la creación/migración de la base antes de aceptar peticiones.
        app.listen(PORT, () => {
            const databaseHost = new URL(process.env.TURSO_DATABASE_URL).hostname;
            console.log(`Servidor corriendo en el puerto ${PORT}`);
            console.log(`Base Turso configurada: ${databaseHost}`);
        });
    })
    .catch((error) => {
        console.error('Error al inicializar la base de datos Turso:', error);
        process.exit(1);
    });
