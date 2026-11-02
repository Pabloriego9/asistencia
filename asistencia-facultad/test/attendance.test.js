import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import vm from 'node:vm';
import net from 'node:net';

test('exports today separately and records only the server date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attendance-test-'));
    const dbUrl = pathToFileURL(join(dir, 'test.db')).href;
    const db = createClient({ url: dbUrl });
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const child = spawn(process.execPath, ['server.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, PORT: String(port), TURSO_DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
            child.stdout.on('data', chunk => {
                if (chunk.toString().includes('Servidor corriendo')) { clearTimeout(timer); resolve(); }
            });
            child.stderr.on('data', chunk => { clearTimeout(timer); reject(new Error(chunk.toString())); });
        });
        const base = `http://127.0.0.1:${port}`;
        const post = () => fetch(`${base}/api/asistencia`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: 'Alumno', apellido: 'Prueba', dni: '00000001',
                fecha: '2000-01-01', hora: '00:00:00' })
        });
        assert.equal((await post()).status, 200);
        assert.equal((await post()).status, 409);
        const allBefore = await (await fetch(`${base}/api/asistencias`)).json();
        assert.equal(allBefore.length, 1);
        const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date()).map(p => [p.type, p.value]));
        assert.equal(allBefore[0].fecha, `${todayParts.year}-${todayParts.month}-${todayParts.day}`);
        await db.execute({ sql: 'INSERT INTO Asistencias (alumno_id, fecha, hora) VALUES (?, ?, ?)',
            args: [allBefore[0].alumno_id, '2000-01-01', '12:00:00'] });
        const all = await (await fetch(`${base}/api/asistencias`)).json();
        const today = await (await fetch(`${base}/api/asistencias?fecha=hoy`)).json();
        assert.equal(all.length, 2);
        assert.equal(today.length, 1);
        assert.equal(today[0].id, allBefore[0].id);
        assert.equal((await fetch(`${base}/api/asistencias?fecha=invalid`)).status, 400);
        const html = await (await fetch(base)).text();
        assert.match(html, /id="soloHoy" checked/);
    } finally {
        child.kill();
        await new Promise(resolve => child.once('exit', resolve));
        db.close();
        await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});

test('Excel export requests today or history according to the checkbox', async () => {
    const handlers = {};
    const elements = {
        attendanceForm: { addEventListener() {} },
        exportExcelBtn: { addEventListener: (name, cb) => { handlers[name] = cb; } },
        soloHoy: { checked: true }
    };
    const requests = [], files = [], alerts = [];
    const context = vm.createContext({
        document: { getElementById: id => elements[id] },
        fetch: async url => { requests.push(url); return { ok: true, json: async () => [{ fecha: '2026-10-26' }] }; },
        alert: text => alerts.push(text),
        XLSX: { utils: { json_to_sheet: rows => rows, book_new: () => ({}), book_append_sheet() {} },
            writeFile: (wb, filename) => files.push(filename) }
    });
    vm.runInContext(await readFile(new URL('../public/script.js', import.meta.url), 'utf8'), context);
    await handlers.click();
    assert.equal(requests[0], '/api/asistencias?fecha=hoy');
    assert.equal(files[0], 'asistencias_hoy.xlsx');
    elements.soloHoy.checked = false;
    await handlers.click();
    assert.equal(requests[1], '/api/asistencias');
    assert.equal(files[1], 'asistencias_todas.xlsx');
    assert.deepEqual(alerts, []);
});
