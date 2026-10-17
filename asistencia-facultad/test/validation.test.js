import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAttendanceInput } from '../validation.js';

// Caso válido: confirma que el acento, los espacios y los ceros iniciales del DNI se conservan.
test('accepts an 8-digit DNI and Spanish names with accents', () => {
    assert.deepEqual(
        validateAttendanceInput({ nombre: 'María José', apellido: 'Muñoz', dni: '00123456' }),
        { data: { nombre: 'María José', apellido: 'Muñoz', dni: '00123456' } }
    );
});

// Casos inválidos de longitud, caracteres no numéricos y tipo JSON incorrecto.
test('rejects a DNI that is not exactly 8 ASCII digits', () => {
    for (const dni of ['1234567', '123456789', '1234a678', '1234-678', 12345678]) {
        assert.match(
            validateAttendanceInput({ nombre: 'Ana', apellido: 'Pérez', dni }).error,
            /DNI/
        );
    }
});

// Comprueba que no se acepten nombres cortos, largos, con cifras o con contenido de ataque.
test('rejects names outside the allowed character or length limits', () => {
    for (const nombre of [
        'A',
        'Nombre1',
        "<script>alert('XSS')</script>",
        "' OR '1'=",
        'A'.repeat(51)
    ]) {
        assert.match(
            validateAttendanceInput({ nombre, apellido: 'Pérez', dni: '12345678' }).error,
            /nombre/i
        );
    }
});

// Asegura que el resultado contenga nombres sin espacios externos y normalizados en Unicode.
test('trims and normalizes names before returning the validated values', () => {
    assert.deepEqual(
        validateAttendanceInput({ nombre: '  Jose\u0301  ', apellido: '  Núñez  ', dni: '12345678' }),
        { data: { nombre: 'José', apellido: 'Núñez', dni: '12345678' } }
    );
});
