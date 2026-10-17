// Solo permite letras Unicode (incluye tildes y ñ) y espacios en los nombres.
const NAME_PATTERN = /^[\p{L} ]+$/u;

// Exige exactamente ocho caracteres numéricos ASCII para el DNI.
const DNI_PATTERN = /^[0-9]{8}$/;

// Valida el cuerpo recibido por la API antes de guardar los datos.
export function validateAttendanceInput(body) {
    // Asegura que el cuerpo exista y sea un objeto JSON, no un arreglo ni otro tipo.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'El cuerpo de la solicitud no es válido.' };
    }

    // Conserva solo valores de texto; quita espacios externos y unifica Unicode
    // para que letras visualmente iguales se comparen de forma consistente.
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim().normalize('NFC') : '';
    const apellido = typeof body.apellido === 'string' ? body.apellido.trim().normalize('NFC') : '';

    // El DNI se conserva como texto para validar su formato y preservar ceros iniciales.
    const dni = body.dni;

    // Comprueba primero que estén presentes los tres campos requeridos.
    if (!nombre || !apellido || dni === undefined || dni === null || dni === '') {
        return { error: 'Todos los campos son obligatorios.' };
    }

    // Aplica a cada nombre el alfabeto permitido y los límites de longitud.
    const validName = (value) => (
        NAME_PATTERN.test(value) &&
        Array.from(value).length >= 2 &&
        Array.from(value).length <= 50
    );

    // Rechaza el nombre antes de continuar si no respeta las reglas.
    if (!validName(nombre)) {
        return { error: 'El nombre debe tener entre 2 y 50 letras o espacios.' };
    }

    // Aplica exactamente las mismas reglas al apellido.
    if (!validName(apellido)) {
        return { error: 'El apellido debe tener entre 2 y 50 letras o espacios.' };
    }

    // Requiere que el DNI llegue como texto con exactamente ocho dígitos.
    if (typeof dni !== 'string' || !DNI_PATTERN.test(dni)) {
        return { error: 'El DNI debe contener exactamente 8 dígitos numéricos.' };
    }

    // Solo devuelve los datos ya normalizados y validados para que el controlador
    // utilice este objeto al insertar en la base de datos.
    return { data: { nombre, apellido, dni } };
}
