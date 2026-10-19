import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t, setup) {
    const directory = await mkdtemp(path.join(tmpdir(), 'asistencia-test-'));
    const url = pathToFileURL(path.join(directory, 'test.db')).href;
    // Separate processes release native SQLite file handles reliably on Windows.
    const db = {
        async execute(statement) {
            const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
                import { createClient } from '@libsql/client';
                const db = createClient({ url: process.argv[1] });
                try { console.log(JSON.stringify(await db.execute(JSON.parse(process.argv[2])))); }
                finally { db.close(); }
            `, url, JSON.stringify(statement)], { cwd: root });
            const result = JSON.parse(stdout);
            result.rows = result.rows.map(row => Object.fromEntries(result.columns.map((name, i) => [name, row[i]])));
            return result;
        }
    };
    let child;
    t.after(async () => {
        if (child && child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    if (setup) await setup(db);
    child = spawn(process.execPath, ['server.js'], {
        cwd: root,
        env: { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: '', PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const base = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${logs}`)), 15000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Exit ${code}: ${logs}`)); });
        child.stdout.on('data', () => {
            const match = logs.match(/http:\/\/localhost:(\d+)/);
            if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
        });
    });
    const post = (body, route = '/api/asistencia') => fetch(`${base}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { db, base, post };
}

const person = { nombre: 'María José', apellido: 'Muñoz', dni: '00123456' };

test('API registers a related student, rejects duplicates and preserves export fields', async t => {
    const { db, base, post } = await fixture(t);
    const first = await post({ ...person, fecha: '2026-10-19', hora: '09:00:00' });
    assert.equal(first.status, 200);
    const { id } = await first.json();
    assert.match(id, /^\d+$/);
    const duplicate = await post({ ...person, fecha: '2026-10-19', hora: '10:00:00' });
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: 'DNI ya registrado hoy.' });
    const tomorrow = await post({ ...person, fecha: '2026-10-20', hora: '09:00:00' }, '/api/asistencias');
    assert.equal(tomorrow.status, 200);
    const response = await fetch(`${base}/api/asistencias`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], { id: Number(id), alumno_id: 1, ...person, fecha: '2026-10-19', hora: '09:00:00' });
    assert.equal((await db.execute('SELECT count(*) AS total FROM Alumnos')).rows[0].total, 1);
    assert.equal((await db.execute('PRAGMA foreign_key_check')).rows.length, 0);
});

test('API rolls back the student if attendance insertion fails and can recover', async t => {
    const { db, post } = await fixture(t);
    await db.execute(`CREATE TRIGGER fail_attendance BEFORE INSERT ON Asistencias
        BEGIN SELECT RAISE(ABORT, 'forced attendance failure'); END`);
    assert.equal((await post(person)).status, 500);
    assert.equal((await db.execute('SELECT count(*) AS total FROM Alumnos')).rows[0].total, 0);
    await db.execute('DROP TRIGGER fail_attendance');
    assert.equal((await post(person)).status, 200);
});

test('API rejects invalid input without writing and uses Argentina date by default', async t => {
    const { db, base, post } = await fixture(t);
    assert.equal((await post({ ...person, dni: '123' })).status, 400);
    assert.equal((await db.execute('SELECT count(*) AS total FROM Alumnos')).rows[0].total, 0);
    const before = new Date();
    assert.equal((await post(person)).status, 200);
    const after = new Date();
    const [row] = await (await fetch(`${base}/api/asistencias`)).json();
    const format = date => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
    assert.ok([format(before), format(after)].includes(row.fecha));
    assert.match(row.hora, /^\d{2}:\d{2}:\d{2}$/);
    assert.equal((await fetch(`${base}/api/missing`)).status, 404);
});

test('startup preserves existing students and attendance records', async t => {
    const { base, post } = await fixture(t, async db => {
        await db.execute(`CREATE TABLE Alumnos (id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL, apellido TEXT NOT NULL, dni TEXT NOT NULL UNIQUE)`);
        await db.execute(`CREATE TABLE Asistencias (id INTEGER PRIMARY KEY AUTOINCREMENT,
            alumno_id INTEGER NOT NULL REFERENCES Alumnos(id), fecha TEXT NOT NULL,
            hora TEXT NOT NULL, UNIQUE(alumno_id, fecha))`);
        await db.execute({ sql: 'INSERT INTO Alumnos VALUES (42, ?, ?, ?)', args: Object.values(person) });
        await db.execute("INSERT INTO Asistencias VALUES (75, 42, '2026-10-18', '08:30:00')");
    });
    assert.equal((await post({ ...person, fecha: '2026-10-19' })).status, 200);
    const rows = await (await fetch(`${base}/api/asistencias`)).json();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].alumno_id, 42);
    assert.deepEqual(rows[1], { id: 75, alumno_id: 42, ...person, fecha: '2026-10-18', hora: '08:30:00' });
});
