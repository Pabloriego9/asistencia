import { createClient } from '@libsql/client';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

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

    await db.execute("UPDATE asistencias SET fecha = date(fecha_hora, 'localtime') WHERE fecha IS NULL");
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_dni_fecha ON asistencias(dni, fecha)');
}

app.post(['/api/asistencia', '/api/asistencias'], async (req, res) => {
    try {
        const { nombre, apellido, dni, fecha: fechaRecibida, hora: horaRecibida } = req.body;

        if (!nombre || !apellido || !dni) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
        }

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
        console.error("Error en Turso:", error);
        if (error.message?.toLowerCase().includes('unique')) {
            return res.status(409).json({ error: 'DNI ya registrado hoy.' });
        }

        console.error('Error al registrar asistencia:', error);
        res.status(500).json({ error: 'Error al registrar la asistencia.' });
    }
});

app.get('/api/asistencias', async (req, res) => {
    try {
        const result = await db.execute('SELECT * FROM asistencias ORDER BY id DESC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener asistencias:', error);
        res.status(500).json({ error: 'Error al obtener las asistencias.' });
    }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint API no encontrado' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

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
