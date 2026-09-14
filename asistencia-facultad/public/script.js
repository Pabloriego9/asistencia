document.getElementById('attendanceForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const nombre = document.getElementById('nombre').value.trim();
    const apellido = document.getElementById('apellido').value.trim();
    const dni = document.getElementById('dni').value.trim();
    const mensajeDiv = document.getElementById('mensaje');

    try {
        const respuesta = await fetch('/api/asistencia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nombre, apellido, dni })
        });

        const resultado = await respuesta.json();

        if (respuesta.ok) {
            mensajeDiv.textContent = `¡Presente registrado correctamente!`;
            mensajeDiv.className = 'mensaje exito';
            document.getElementById('attendanceForm').reset();
        } else {
            mensajeDiv.textContent = resultado.error || 'Ocurrió un error.';
            mensajeDiv.className = 'mensaje error';
        }
    } catch (error) {
        mensajeDiv.textContent = 'Error al conectar con el servidor.';
        mensajeDiv.className = 'mensaje error';
    }
});

// Utilidades para export
async function fetchAsistencias() {
    const res = await fetch('/api/asistencias');
    if (!res.ok) throw new Error('Error al obtener asistencias');
    return res.json();
}

function fechaEsHoy(fechaHoraStr) {
    if (!fechaHoraStr) return false;
    const iso = fechaHoraStr.replace(' ', 'T');
    const d = new Date(iso);
    const hoy = new Date();
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

function hoyFechaISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Comprueba si una fila corresponde a hoy. Usa `fecha` si está disponible, si no caeback a `fecha_hora`.
function isRowToday(row) {
    if (!row) return false;
    const today = hoyFechaISO();
    if (row.fecha) return String(row.fecha) === today;
    if (row.fecha_hora) {
        return fechaEsHoy(row.fecha_hora);
    }
    return false;
}

async function exportExcel(rows, filename = 'asistencias.xlsx') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencias');
    XLSX.writeFile(wb, filename);
}


// Botones de export
document.getElementById('exportExcelBtn').addEventListener('click', async () => {
    const soloHoy = document.getElementById('soloHoy').checked;
    try {
        let rows = await fetchAsistencias();
        if (soloHoy) rows = rows.filter(r => isRowToday(r));
        if (rows.length === 0) return alert('No hay registros para exportar.');
        await exportExcel(rows, soloHoy ? 'asistencias_hoy.xlsx' : 'asistencias_todas.xlsx');
    } catch (e) {
        alert('Error al exportar: ' + e.message);
    }
});

