// Intercepta el envío para registrar la asistencia mediante fetch sin recargar
// la página completa.
document.getElementById('attendanceForm').addEventListener('submit', async function (e) {
    // Evita la navegación predeterminada para mostrar la respuesta sin recargar.
    e.preventDefault();

    // Leemos los campos y eliminamos espacios al principio y al final.
    const nombre = document.getElementById('nombre').value.trim();
    const apellido = document.getElementById('apellido').value.trim();
    const dni = document.getElementById('dni').value;
    const mensajeDiv = document.getElementById('mensaje');

    try {
        // La API valida de nuevo estos valores; la validación del navegador no
        // es una barrera de seguridad y puede ser evitada por un cliente externo.
        const respuesta = await fetch('/api/asistencia', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nombre, apellido, dni })
        });

        // El servidor devuelve un objeto JSON con el mensaje o el error.
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            // Una respuesta 2xx indica que el registro se guardó correctamente.
            // textContent inserta texto plano y evita interpretar contenido como HTML.
            mensajeDiv.textContent = `¡Presente registrado correctamente!`;
            mensajeDiv.className = 'mensaje exito';
            document.getElementById('attendanceForm').reset();
        } else {
            // Para respuestas 4xx o 5xx mostramos el mensaje enviado por la API.
            // Se usa textContent también para los mensajes recibidos del servidor.
            mensajeDiv.textContent = resultado.error || 'Ocurrió un error.';
            mensajeDiv.className = 'mensaje error';
        }
    } catch (error) {
        // Este bloque cubre errores de red, por ejemplo si el servidor está apagado.
        mensajeDiv.textContent = 'Error al conectar con el servidor.';
        mensajeDiv.className = 'mensaje error';
    }
});

// Solicita al servidor la lista completa de asistencias.
async function fetchAsistencias() {
    // Lanza un error ante respuestas fallidas para que el flujo de exportación lo informe.
    const res = await fetch('/api/asistencias');
    if (!res.ok) throw new Error('Error al obtener asistencias');
    return res.json();
}

// Convierte una fecha almacenada como "YYYY-MM-DD HH:mm:ss" en una fecha de
// JavaScript y comprueba si pertenece al día actual.
function fechaEsHoy(fechaHoraStr) {
    if (!fechaHoraStr) return false;
    // El formato de la base usa un espacio; Date interpreta el separador ISO "T".
    const iso = fechaHoraStr.replace(' ', 'T');
    const d = new Date(iso);
    const hoy = new Date();
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

// Devuelve la fecha local actual en el formato que usa la base de datos.
function hoyFechaISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Comprueba si una fila corresponde a hoy. Usa `fecha` si está disponible y, si
// no, recurre a la columna fecha_hora para mantener compatibilidad.
function isRowToday(row) {
    if (!row) return false;
    const today = hoyFechaISO();
    if (row.fecha) return String(row.fecha) === today;
    if (row.fecha_hora) {
        return fechaEsHoy(row.fecha_hora);
    }
    return false;
}

// Convierte las filas recibidas en una hoja de cálculo y la descarga como XLSX.
async function exportExcel(rows, filename = 'asistencias.xlsx') {
    // Omite la columna combinada fecha_hora porque fecha y hora ya se exportan separadas.
    const rowsForExport = rows.map(({ fecha_hora, ...row }) => row);
    // Convierte los objetos a hoja, la agrega a un libro y activa la descarga.
    const ws = XLSX.utils.json_to_sheet(rowsForExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencias');
    XLSX.writeFile(wb, filename);
}


// Al pulsar el botón, obtiene los registros, aplica el filtro opcional y exporta.
document.getElementById('exportExcelBtn').addEventListener('click', async () => {
    const soloHoy = document.getElementById('soloHoy').checked;
    try {
        let rows = await fetchAsistencias();
        // El checkbox limita la exportación a las filas de la fecha actual.
        if (soloHoy) rows = rows.filter(r => isRowToday(r));
        // Evita descargar una hoja vacía y elige un nombre que describa el filtro usado.
        if (rows.length === 0) return alert('No hay registros para exportar.');
        await exportExcel(rows, soloHoy ? 'asistencias_hoy.xlsx' : 'asistencias_todas.xlsx');
    } catch (e) {
        alert('Error al exportar: ' + e.message);
    }
});
