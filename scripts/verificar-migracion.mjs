#!/usr/bin/env node
// ============================================================
// verificar-migracion.mjs — Verificador ESTATICO de migraciones SQL/plpgsql
//
// POR QUE EXISTE
// --------------
// La migracion 0011_taxo.sql se verifico cifra por cifra contra la BD viva
// con SELECTs read-only... y aun asi abortó completa al aplicarla:
//
//     RAISE EXCEPTION 'sku % inexistente en productos' USING errcode = 'P0002';
//                              ^ marcador sin argumento
//     ERROR 42601: too few parameters specified for RAISE
//
// Postgres COMPILA el cuerpo plpgsql al crear la funcion, asi que un
// desbalance entre los marcadores '%' de un RAISE y sus argumentos tumba la
// transaccion entera. La leccion: "una migracion verificada que nunca se
// compilo es una cifra sin query".
//
// Esta puerta replica, sin dependencias y sin Postgres, la comprobacion
// check_raise_parameters() de pl_gram.y: cuenta los '%' de la cadena de
// formato (ignorando '%%') y los compara con los argumentos de formato
// REALES, que son las expresiones separadas por coma de NIVEL SUPERIOR entre
// el fin de la cadena y lo que llegue primero: la clausula USING de nivel
// superior o el ';' que cierra la sentencia.
//
// Las expresiones de USING (errcode =, hint =, detail =, ...) NO son
// argumentos de formato. Contarlas es el error obvio y daria VERDE sobre el
// bug real.
//
// USO
//   node scripts/verificar-migracion.mjs [ruta.sql ...]
//   (sin argumentos barre supabase/migrations/*.sql)
//   exit 0 = limpio · exit 1 = hallazgos · exit 2 = error de invocacion
//
// LIMITE DECLARADO (patron P5): esto es un analizador ESTATICO. NO sustituye
// a compilar contra Postgres. Ver la seccion "QUE NO CAZA" al final.
// ============================================================

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const DIR_MIGRACIONES = join(RAIZ, 'supabase', 'migrations');

const NIVELES_RAISE = new Set(['debug', 'log', 'info', 'notice', 'warning', 'exception']);
const PROFUNDIDAD_MAX = 12;
const CHARS_OPERADOR = '+-*/<>=~!@#^&|`?%';

// ------------------------------------------------------------
// REGLA 4 (P21) · funciones de catalogo que RENDERIZAN TEXTO y que por eso
// no se deben comparar contra un literal.
//
// `pg_get_function_identity_arguments()` devuelve la lista de identidad CON
// el nombre de cada parametro: para `ingest_snapshot(payload jsonb)` devuelve
// `payload jsonb`, no `jsonb`. Comparar su salida contra una cadena es un
// contrato con el FORMATEADOR del catalogo, no con el catalogo.
//
// El conjunto es de UNO a proposito, y crecerlo no es gratis: las dos
// ubicaciones congeladas que hoy reporta el barrido del repo estan CLAVADAS
// en scripts/verificar-migracion.test.ts. Agregar otra funcion aqui obliga a
// volver a medir esa lista, que es exactamente lo que se quiere que pase.
const FUNCIONES_CATALOGO_TEXTUALES = new Set(['pg_get_function_identity_arguments']);
const OPS_IGUALDAD = new Set(['=', '<>', '!=']);
const PALABRAS_LIKE = new Set(['like', 'ilike']);

// Nombres de condicion de Postgres (Apendice A) de uso realista.
// Sirven para distinguir `RAISE unique_violation;` (valido) de
// `RAISE EXCEPTION v_mi_variable;` (que COMPILA MAL: plpgsql lee un
// nombre de condicion, no una variable -> "unrecognized exception
// condition"). La lista es PARCIAL a proposito: lo que no esta se
// reporta como AMBIGUO, no como correcto (fail-closed).
const CONDICIONES_PG = new Set([
  'successful_completion', 'warning', 'no_data', 'sql_statement_not_yet_complete',
  'connection_exception', 'connection_does_not_exist', 'connection_failure',
  'protocol_violation', 'triggered_action_exception', 'feature_not_supported',
  'invalid_transaction_initiation', 'locator_exception', 'invalid_grantor',
  'invalid_grant_operation', 'invalid_role_specification', 'diagnostics_exception',
  'stacked_diagnostics_accessed_without_active_handler', 'case_not_found',
  'cardinality_violation', 'data_exception', 'array_subscript_error',
  'character_not_in_repertoire', 'datetime_field_overflow', 'division_by_zero',
  'error_in_assignment', 'escape_character_conflict', 'indicator_overflow',
  'interval_field_overflow', 'invalid_argument_for_logarithm',
  'invalid_argument_for_power_function', 'invalid_character_value_for_cast',
  'invalid_datetime_format', 'invalid_escape_character', 'invalid_escape_sequence',
  'invalid_indicator_parameter_value', 'invalid_parameter_value',
  'invalid_regular_expression', 'invalid_time_zone_displacement_value',
  'invalid_use_of_escape_character', 'most_specific_type_mismatch',
  'null_value_not_allowed', 'null_value_no_indicator_parameter',
  'numeric_value_out_of_range', 'sequence_generator_limit_exceeded',
  'string_data_length_mismatch', 'string_data_right_truncation', 'substring_error',
  'trim_error', 'zero_length_character_string', 'floating_point_exception',
  'invalid_text_representation', 'invalid_binary_representation',
  'bad_copy_file_format', 'untranslatable_character', 'invalid_json_text',
  'integrity_constraint_violation', 'restrict_violation', 'not_null_violation',
  'foreign_key_violation', 'unique_violation', 'check_violation',
  'exclusion_violation', 'invalid_cursor_state', 'invalid_transaction_state',
  'active_sql_transaction', 'read_only_sql_transaction', 'no_active_sql_transaction',
  'in_failed_sql_transaction', 'idle_in_transaction_session_timeout',
  'invalid_sql_statement_name', 'triggered_data_change_violation',
  'invalid_authorization_specification', 'invalid_password',
  'dependent_objects_still_exist', 'invalid_transaction_termination',
  'sql_routine_exception', 'function_executed_no_return_statement',
  'modifying_sql_data_not_permitted', 'prohibited_sql_statement_attempted',
  'reading_sql_data_not_permitted', 'invalid_cursor_name',
  'external_routine_exception', 'external_routine_invocation_exception',
  'trigger_protocol_violated', 'srf_protocol_violated', 'savepoint_exception',
  'invalid_savepoint_specification', 'invalid_catalog_name', 'invalid_schema_name',
  'transaction_rollback', 'transaction_integrity_constraint_violation',
  'serialization_failure', 'statement_completion_unknown', 'deadlock_detected',
  'syntax_error_or_access_rule_violation', 'syntax_error', 'insufficient_privilege',
  'cannot_coerce', 'grouping_error', 'windowing_error', 'invalid_recursion',
  'invalid_foreign_key', 'invalid_name', 'name_too_long', 'reserved_name',
  'datatype_mismatch', 'indeterminate_datatype', 'collation_mismatch',
  'indeterminate_collation', 'wrong_object_type', 'generated_always',
  'undefined_column', 'undefined_function', 'undefined_table', 'undefined_parameter',
  'undefined_object', 'duplicate_column', 'duplicate_cursor', 'duplicate_database',
  'duplicate_function', 'duplicate_prepared_statement', 'duplicate_schema',
  'duplicate_table', 'duplicate_alias', 'duplicate_object', 'ambiguous_column',
  'ambiguous_function', 'ambiguous_parameter', 'ambiguous_alias',
  'invalid_column_reference', 'invalid_column_definition', 'invalid_cursor_definition',
  'invalid_database_definition', 'invalid_function_definition',
  'invalid_prepared_statement_definition', 'invalid_schema_definition',
  'invalid_table_definition', 'invalid_object_definition',
  'with_check_option_violation', 'insufficient_resources', 'disk_full',
  'out_of_memory', 'too_many_connections', 'configuration_limit_exceeded',
  'program_limit_exceeded', 'statement_too_complex', 'too_many_columns',
  'too_many_arguments', 'object_not_in_prerequisite_state', 'object_in_use',
  'cant_change_runtime_param', 'lock_not_available', 'unsafe_new_enum_value_usage',
  'operator_intervention', 'query_canceled', 'admin_shutdown', 'crash_shutdown',
  'cannot_connect_now', 'database_dropped', 'idle_session_timeout', 'system_error',
  'io_error', 'undefined_file', 'duplicate_file', 'snapshot_too_old',
  'config_file_error', 'lock_file_exists', 'fdw_error', 'plpgsql_error',
  'raise_exception', 'no_data_found', 'too_many_rows', 'assert_failure',
  'internal_error', 'data_corrupted', 'index_corrupted',
]);

// ------------------------------------------------------------
// Utilidades de posicion
// ------------------------------------------------------------
function indiceDeLineas(txt) {
  const arr = [0];
  for (let i = 0; i < txt.length; i++) if (txt.charCodeAt(i) === 10) arr.push(i + 1);
  return arr;
}

function lineaCol(ctx, pos) {
  const a = ctx.lineas;
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { linea: lo + 1, col: pos - a[lo] + 1 };
}

function hallazgo(ctx, pos, codigo, mensaje, severidad = 'ERROR') {
  const { linea, col } = lineaCol(ctx, pos);
  ctx.hallazgos.push({ archivo: ctx.archivo, linea, col, codigo, mensaje, severidad });
}

// ------------------------------------------------------------
// Caracteres
// ------------------------------------------------------------
// Espejo de scan.l (Postgres):
//   ident_start [A-Za-z\200-\377_]      ident_cont [A-Za-z\200-\377_0-9$]
//   dolq_start  [A-Za-z\200-\377_]      dolq_cont  [A-Za-z\200-\377_0-9]
// Se comparan CODE POINTS a proposito: nada de clases de caracteres con
// escapes, que es justo donde se cuela un backslash mal escapado.
const CP_A = 65, CP_Z = 90, CP_a = 97, CP_z = 122, CP_0 = 48, CP_9 = 57;
const CP_GUION_BAJO = 95, CP_DOLAR = 36, CP_ALTO = 128;

function esInicioIdent(ch) {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= CP_A && c <= CP_Z) || (c >= CP_a && c <= CP_z) || c === CP_GUION_BAJO || c >= CP_ALTO;
}
function esContIdent(ch) {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return esInicioIdent(ch) || (c >= CP_0 && c <= CP_9) || c === CP_DOLAR;
}
function esContTagDolar(ch) {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return esInicioIdent(ch) || (c >= CP_0 && c <= CP_9); // el tag NO admite '$'
}
const esDigito = (ch) => ch >= '0' && ch <= '9';
const esEspacio = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v';

// ------------------------------------------------------------
// Comentarios. Devuelve la posicion tras el comentario, o -1 si no habia.
// Los bloques /* */ ANIDAN en Postgres.
// ------------------------------------------------------------
function saltarComentario(ctx, i, fin) {
  const s = ctx.src;
  if (s[i] === '-' && s[i + 1] === '-') {
    let j = i + 2;
    while (j < fin && s[j] !== '\n') j++;
    return j;
  }
  if (s[i] === '/' && s[i + 1] === '*') {
    let j = i + 2;
    let nivel = 1;
    while (j < fin) {
      if (s[j] === '/' && s[j + 1] === '*') { nivel++; j += 2; continue; }
      if (s[j] === '*' && s[j + 1] === '/') { nivel--; j += 2; if (nivel === 0) return j; continue; }
      j++;
    }
    hallazgo(ctx, i, 'LEX_COMENTARIO_ABIERTO',
      'comentario de bloque /* ... */ sin cerrar (anidamiento pendiente: ' + nivel + '). Postgres no podria parsear el archivo.');
    ctx.abortarScope = true;
    return fin;
  }
  return -1;
}

// ------------------------------------------------------------
// Cadena entre comillas simples, con:
//   · '' escapado
//   · prefijo E'...' (escapes con backslash)
//   · continuacion estandar SQL: dos literales separados por un SALTO DE
//     LINEA se concatenan ('abc'\n'def' == 'abcdef'). En la MISMA linea
//     Postgres da error de sintaxis -> se marca AMBIGUO (fail-closed).
// Devuelve { valor, fin, ambiguo }
// ------------------------------------------------------------
function decodificarEscapes(crudo) {
  let out = '';
  for (let i = 0; i < crudo.length; i++) {
    const c = crudo[i];
    if (c !== '\\') { out += c; continue; }
    const n = crudo[++i];
    if (n === undefined) { out += '\\'; break; }
    if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n >= '0' && n <= '7') {
      let oct = n;
      while (oct.length < 3 && crudo[i + 1] >= '0' && crudo[i + 1] <= '7') oct += crudo[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === 'x') {
      let hex = '';
      while (hex.length < 2 && /[0-9a-fA-F]/.test(crudo[i + 1] || '')) hex += crudo[++i];
      out += hex ? String.fromCharCode(parseInt(hex, 16)) : 'x';
    } else if (n === 'u' || n === 'U') {
      const largo = n === 'u' ? 4 : 8;
      let hex = '';
      while (hex.length < largo && /[0-9a-fA-F]/.test(crudo[i + 1] || '')) hex += crudo[++i];
      out += hex.length === largo ? String.fromCodePoint(parseInt(hex, 16)) : n;
    } else out += n; // cualquier otro caracter tras backslash va literal
  }
  return out;
}

function leerCadena(ctx, i, fin) {
  const s = ctx.src;
  let ambiguo = null;
  let valor = '';
  let pos = i;
  let primeraVuelta = true;

  for (;;) {
    // prefijo E'' / e''  (escape string) o U&'' (unicode, no soportado)
    let escapada = false;
    if ((s[pos] === 'E' || s[pos] === 'e') && s[pos + 1] === "'") {
      const antes = pos > 0 ? s[pos - 1] : ' ';
      if (!esContIdent(antes)) { escapada = true; pos++; }
    }
    if ((s[pos] === 'U' || s[pos] === 'u') && s[pos + 1] === '&' && s[pos + 2] === "'") {
      ambiguo = ambiguo || 'literal Unicode U&\'...\': el verificador no decodifica \\XXXX de U& — revision humana';
      pos += 2;
    }
    if (s[pos] !== "'") break;

    let j = pos + 1;
    let crudo = '';
    let cerrada = false;
    while (j < fin) {
      if (s[j] === "'") {
        if (s[j + 1] === "'") { crudo += "'"; j += 2; continue; }
        j++; cerrada = true; break;
      }
      if (escapada && s[j] === '\\') { crudo += s[j] + (s[j + 1] ?? ''); j += 2; continue; }
      crudo += s[j]; j++;
    }
    if (!cerrada) {
      hallazgo(ctx, pos, 'LEX_CADENA_ABIERTA', "literal de texto ' ... ' sin cerrar. Postgres no podria parsear el archivo.");
      ctx.abortarScope = true;
      return { valor, fin: fin, ambiguo };
    }
    valor += escapada ? decodificarEscapes(crudo) : crudo;
    pos = j;
    primeraVuelta = false;

    // ¿continuacion? whitespace/comentarios y otro literal
    let k = pos;
    let hayNuevaLinea = false;
    for (;;) {
      if (k < fin && esEspacio(s[k])) { if (s[k] === '\n') hayNuevaLinea = true; k++; continue; }
      const tras = k < fin ? saltarComentario(ctx, k, fin) : -1;
      if (tras !== -1) { if (s.slice(k, tras).includes('\n')) hayNuevaLinea = true; k = tras; continue; }
      break;
    }
    const siguienteEsLiteral =
      k < fin && (s[k] === "'" ||
        ((s[k] === 'E' || s[k] === 'e') && s[k + 1] === "'" && !esContIdent(s[k - 1] ?? ' ')));
    if (!siguienteEsLiteral) break;
    if (!hayNuevaLinea) {
      ambiguo = ambiguo || 'dos literales adyacentes SIN salto de linea entre ellos: Postgres exige el salto para concatenar (aqui daria error de sintaxis) — revision humana';
    }
    pos = k;
  }
  void primeraVuelta;
  return { valor, fin: pos, ambiguo };
}

// ------------------------------------------------------------
// LEXER de un ambito [ini, fin). Devuelve tokens con posicion ABSOLUTA.
// tipos: palabra | cadena | dolar | ident | num | punt | op
// ------------------------------------------------------------
// Delimitador de dollar-quoting en la posicion i: dos '$' seguidos o $tag$.
// Devuelve el delimitador completo, o null si ese '$' no abre una cadena
// (p.ej. el parametro $1, o un '$' dentro de un identificador).
function delimitadorDolar(s, i, fin) {
  if (s[i] !== '$') return null;
  let j = i + 1;
  if (j < fin && s[j] !== '$') {
    if (!esInicioIdent(s[j])) return null;
    j++;
    while (j < fin && esContTagDolar(s[j])) j++;
  }
  if (j < fin && s[j] === '$') return s.slice(i, j + 1);
  return null;
}

function lexear(ctx, ini, fin) {
  const s = ctx.src;
  const toks = [];
  let i = ini;
  while (i < fin) {
    const c = s[i];
    if (esEspacio(c)) { i++; continue; }

    const tras = saltarComentario(ctx, i, fin);
    if (tras !== -1) { i = tras; if (ctx.abortarScope) break; continue; }

    // literal de texto (incluye prefijos E' y U&')
    if (c === "'" ||
        ((c === 'E' || c === 'e') && s[i + 1] === "'" && !esContIdent(s[i - 1] ?? ' ')) ||
        ((c === 'U' || c === 'u') && s[i + 1] === '&' && s[i + 2] === "'")) {
      const r = leerCadena(ctx, i, fin);
      if (ctx.abortarScope) break;
      toks.push({ tipo: 'cadena', valor: r.valor, pos: i, ambiguo: r.ambiguo });
      i = r.fin;
      continue;
    }

    // identificador entre comillas dobles
    if (c === '"') {
      let j = i + 1;
      let cerrada = false;
      while (j < fin) {
        if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } j++; cerrada = true; break; }
        j++;
      }
      if (!cerrada) {
        hallazgo(ctx, i, 'LEX_IDENT_ABIERTO', 'identificador entre comillas dobles sin cerrar.');
        ctx.abortarScope = true; break;
      }
      toks.push({ tipo: 'ident', valor: s.slice(i + 1, j - 1), pos: i });
      i = j;
      continue;
    }

    // dollar-quoting  $$ ... $$  /  $tag$ ... $tag$
    if (c === '$') {
      const delim = delimitadorDolar(s, i, fin);
      if (delim) {
        const iniCuerpo = i + delim.length;
        const cierre = s.indexOf(delim, iniCuerpo);
        if (cierre === -1 || cierre + delim.length > fin) {
          hallazgo(ctx, i, 'LEX_DOLAR_ABIERTO',
            'cadena con dollar-quoting ' + delim + ' sin su delimitador de cierre. Postgres no podria parsear el archivo.');
          ctx.abortarScope = true; break;
        }
        toks.push({ tipo: 'dolar', valor: delim, pos: i, iniCuerpo, finCuerpo: cierre });
        i = cierre + delim.length;
        continue;
      }
      // $1, $2 (parametros) u otro uso de $
      let j = i + 1;
      while (j < fin && esDigito(s[j])) j++;
      toks.push({ tipo: 'punt', valor: s.slice(i, j === i + 1 ? j : j), pos: i });
      i = j === i + 1 ? i + 1 : j;
      continue;
    }

    // identificador / palabra clave
    if (esInicioIdent(c)) {
      let j = i + 1;
      while (j < fin && esContIdent(s[j])) j++;
      toks.push({ tipo: 'palabra', valor: s.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // numero
    if (esDigito(c) || (c === '.' && esDigito(s[i + 1]))) {
      let j = i;
      while (j < fin && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        if (esDigito(s[k])) { j = k; while (j < fin && esDigito(s[j])) j++; }
      }
      toks.push({ tipo: 'num', valor: s.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // puntuacion estructural
    if (',;()[]{}:.'.includes(c)) {
      toks.push({ tipo: 'punt', valor: c, pos: i });
      i++;
      continue;
    }

    // operadores
    if (CHARS_OPERADOR.includes(c)) {
      let j = i;
      while (j < fin && CHARS_OPERADOR.includes(s[j])) {
        if (s[j] === '-' && s[j + 1] === '-') break;
        if (s[j] === '/' && s[j + 1] === '*') break;
        j++;
      }
      if (j === i) j = i + 1;
      toks.push({ tipo: 'op', valor: s.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // cualquier otra cosa: un caracter suelto
    toks.push({ tipo: 'punt', valor: c, pos: i });
    i++;
  }
  return toks;
}

// ------------------------------------------------------------
// check_raise_parameters(): cuenta '%' ignorando '%%'
// (copia fiel de src/pl/plpgsql/src/pl_gram.y)
// ------------------------------------------------------------
function contarMarcadores(msg) {
  let n = 0;
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '%') {
      if (msg[i + 1] === '%') i++;
      else n++;
    }
  }
  return n;
}

const esPunt = (t, v) => t && t.tipo === 'punt' && t.valor === v;
const esPalabra = (t, v) => t && t.tipo === 'palabra' && t.valor.toLowerCase() === v;

// Registro por RAISE para el modo --detalle: permite AUDITAR uno por uno
// (nivel, marcadores, argumentos) en vez de confiar en un "OK" global.
function anotar(ctx, pos, nivel, forma, marcadores, args) {
  if (!ctx.detalle) return;
  ctx.detalles.push({ linea: lineaCol(ctx, pos).linea, nivel, forma, marcadores, args });
}

// ------------------------------------------------------------
// REGLA 1 · Aridad de RAISE
// Gramatica (pl_gram.y, stmt_raise):
//   RAISE ;
//   RAISE [nivel] 'formato' [, expr ...] [USING opcion = expr, ...] ;
//   RAISE [nivel] nombre_condicion   [USING ...] ;
//   RAISE [nivel] SQLSTATE 'xxxxx'   [USING ...] ;
//   RAISE [nivel] USING opcion = expr, ... ;
// ------------------------------------------------------------
function revisarRaises(ctx, toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.tipo !== 'palabra' || t.valor.toLowerCase() !== 'raise') continue;
    ctx.raisesRevisados++;

    let j = i + 1;
    const sig = toks[j];
    if (!sig) {
      hallazgo(ctx, t.pos, 'RAISE_TRUNCADO', 'RAISE sin nada despues: sentencia incompleta.');
      continue;
    }
    if (esPunt(sig, ';')) { anotar(ctx, t.pos, '-', 're-lanza (RAISE;)', '-', '-'); continue; }

    let nivel = 'EXCEPTION'; // el nivel por omision de plpgsql
    if (sig.tipo === 'palabra' && NIVELES_RAISE.has(sig.valor.toLowerCase())) { nivel = sig.valor.toUpperCase(); j++; }

    const t2 = toks[j];
    if (!t2) {
      hallazgo(ctx, t.pos, 'RAISE_TRUNCADO', 'RAISE sin cuerpo: sentencia incompleta.');
      continue;
    }

    // Formas sin cadena de formato -> no hay aridad que verificar.
    if (esPalabra(t2, 'using')) { anotar(ctx, t.pos, nivel, 'solo USING', '-', '-'); continue; }
    if (esPalabra(t2, 'sqlstate')) { anotar(ctx, t.pos, nivel, 'SQLSTATE', '-', '-'); continue; }
    if (t2.tipo === 'palabra') {
      // Un bare word aqui es un NOMBRE DE CONDICION, no una variable.
      // `RAISE EXCEPTION v_algo;` compila mal ("unrecognized exception
      // condition"), y es un error facil de cometer. Fail-closed: si el
      // nombre no esta en la lista conocida, pido revision humana.
      if (!CONDICIONES_PG.has(t2.valor.toLowerCase())) {
        hallazgo(ctx, t2.pos, 'RAISE_CONDICION_DESCONOCIDA',
          '"' + t2.valor + '" esta en la posicion de un NOMBRE DE CONDICION de Postgres (no de una variable ni de una ' +
          'cadena de formato). Si es una variable, plpgsql falla al COMPILAR con "unrecognized exception condition"; ' +
          'lo que se queria escribir casi siempre es RAISE EXCEPTION \'%\', ' + t2.valor + '. Si de verdad es una ' +
          'condicion valida que no esta en la lista de este verificador, confirmala a mano. REVISION HUMANA.', 'AMBIGUO');
        continue;
      }
      anotar(ctx, t.pos, nivel, 'nombre de condicion', '-', '-');
      continue;
    }

    if (t2.tipo !== 'cadena') {
      hallazgo(ctx, t.pos, 'RAISE_AMBIGUO',
        'no reconozco la forma de este RAISE (tras el nivel viene un token ' + t2.tipo + ' "' + String(t2.valor).slice(0, 24) +
        '"). La cadena de formato de RAISE debe ser un literal de texto: ni una variable ni una concatenacion con ||. REVISION HUMANA.',
        'AMBIGUO');
      continue;
    }

    if (t2.ambiguo) {
      hallazgo(ctx, t2.pos, 'RAISE_AMBIGUO', 'cadena de formato ambigua: ' + t2.ambiguo, 'AMBIGUO');
      continue;
    }

    const esperados = contarMarcadores(t2.valor);

    // Recorrido hasta el ';' de nivel superior contando SOLO las comas de
    // nivel superior ANTERIORES al USING de nivel superior.
    let paren = 0;
    let comas = 0;
    let usando = false;
    let posUsing = -1;
    let cerrado = false;
    let tokensSegmento = 1; // la propia cadena de formato cuenta como segmento previo
    let corcheteTop = null;
    let vacioEn = null;

    const primero = toks[j + 1];
    if (!primero) {
      hallazgo(ctx, t.pos, 'RAISE_SIN_PUNTOYCOMA', 'RAISE sin el ";" que cierra la sentencia.');
      continue;
    }
    if (!(esPunt(primero, ';') || esPunt(primero, ',') || esPalabra(primero, 'using'))) {
      hallazgo(ctx, primero.pos, 'RAISE_SINTAXIS',
        'tras la cadena de formato de RAISE se esperaba "," , ";" o USING, y hay "' + String(primero.valor).slice(0, 24) +
        '". Postgres da: syntax error (42601).');
      continue;
    }

    for (let k = j + 1; k < toks.length; k++) {
      const tk = toks[k];
      if (tk.tipo === 'punt') {
        if (tk.valor === '(') { paren++; tokensSegmento++; continue; }
        if (tk.valor === ')') {
          paren--;
          if (paren < 0) {
            hallazgo(ctx, tk.pos, 'RAISE_PARENTESIS', 'parentesis ")" de mas dentro de la sentencia RAISE.');
            break;
          }
          tokensSegmento++; continue;
        }
        if (tk.valor === '[' && paren === 0 && !usando) { corcheteTop = corcheteTop ?? tk.pos; tokensSegmento++; continue; }
        if (tk.valor === ';' && paren === 0) { cerrado = true; if (!usando && comas > 0 && tokensSegmento === 0) vacioEn = tk.pos; break; }
        if (tk.valor === ',' && paren === 0 && !usando) {
          if (tokensSegmento === 0) vacioEn = vacioEn ?? tk.pos;
          comas++; tokensSegmento = 0; continue;
        }
        tokensSegmento++; continue;
      }
      if (tk.tipo === 'palabra' && paren === 0 && !usando && tk.valor.toLowerCase() === 'using') {
        usando = true; posUsing = tk.pos;
        if (comas > 0 && tokensSegmento === 0) vacioEn = vacioEn ?? tk.pos;
        continue;
      }
      tokensSegmento++;
    }

    if (!cerrado) {
      hallazgo(ctx, t.pos, 'RAISE_SIN_PUNTOYCOMA',
        'no encuentro el ";" de nivel superior que cierra este RAISE (parentesis abiertos: ' + paren + ').');
      continue;
    }
    if (vacioEn !== null) {
      hallazgo(ctx, vacioEn, 'RAISE_ARG_VACIO', 'argumento de formato vacio en la lista de RAISE (coma de mas).');
      continue;
    }
    if (corcheteTop !== null) {
      hallazgo(ctx, corcheteTop, 'RAISE_AMBIGUO',
        'hay un "[" de nivel superior entre los argumentos de RAISE. plpgsql solo equilibra PARENTESIS al separar argumentos, ' +
        'asi que una coma dentro de corchetes SI separa argumentos: no puedo afirmar la aridad. REVISION HUMANA.', 'AMBIGUO');
      continue;
    }

    anotar(ctx, t.pos, nivel, posUsing >= 0 ? 'formato + USING' : 'formato', esperados, comas);

    if (esperados !== comas) {
      const lugarUsing = posUsing >= 0 ? ' (la clausula USING de la linea ' + lineaCol(ctx, posUsing).linea + ' NO aporta argumentos de formato)' : '';
      hallazgo(ctx, t.pos, esperados > comas ? 'RAISE_POCOS_ARGS' : 'RAISE_MUCHOS_ARGS',
        'RAISE con ' + esperados + ' marcador(es) "%" en la cadena de formato y ' + comas + ' argumento(s) de formato' + lugarUsing +
        '. Postgres RECHAZA la funcion al COMPILARLA: ERROR 42601 "' +
        (esperados > comas ? 'too few' : 'too many') + ' parameters specified for RAISE". Formato: ' +
        JSON.stringify(t2.valor.length > 70 ? t2.valor.slice(0, 70) + '...' : t2.valor));
    }
  }
}

// ------------------------------------------------------------
// REGLA 2 · Parentesis equilibrados dentro del ambito
// ------------------------------------------------------------
function revisarParentesis(ctx, toks, etiqueta) {
  let paren = 0;
  let ultimoAbierto = null;
  for (const tk of toks) {
    if (tk.tipo !== 'punt') continue;
    if (tk.valor === '(') { paren++; ultimoAbierto = tk.pos; }
    else if (tk.valor === ')') {
      paren--;
      if (paren < 0) {
        hallazgo(ctx, tk.pos, 'PARENTESIS_SOBRAN', 'parentesis ")" sin su "(" en ' + etiqueta + '.');
        return;
      }
    }
  }
  if (paren > 0) {
    hallazgo(ctx, ultimoAbierto ?? 0, 'PARENTESIS_FALTAN',
      'quedan ' + paren + ' parentesis "(" sin cerrar en ' + etiqueta + '.');
  }
}

// ------------------------------------------------------------
// REGLA 3 · Transaccion equilibrada (solo NIVEL SUPERIOR del archivo).
// Un BEGIN; sin COMMIT; deja la migracion en transaccion abierta.
// ------------------------------------------------------------
function revisarTransaccion(ctx, toks) {
  let abierta = null;
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.tipo !== 'palabra') continue;
    const v = tk.valor.toLowerCase();
    const cierraSentencia = esPunt(toks[i + 1], ';');
    if ((v === 'begin' && cierraSentencia) || (v === 'start' && esPalabra(toks[i + 1], 'transaction'))) {
      if (abierta !== null) {
        hallazgo(ctx, tk.pos, 'TX_ANIDADA', 'segundo BEGIN de nivel superior sin COMMIT del primero (linea ' + lineaCol(ctx, abierta).linea + ').');
      }
      abierta = tk.pos;
    } else if ((v === 'commit' || v === 'rollback') && cierraSentencia) {
      if (abierta === null) {
        hallazgo(ctx, tk.pos, 'TX_SIN_BEGIN', v.toUpperCase() + '; de nivel superior sin un BEGIN; previo.');
      }
      abierta = null;
    }
  }
  if (abierta !== null) {
    hallazgo(ctx, abierta, 'TX_ABIERTA', 'BEGIN; de nivel superior sin su COMMIT;: la migracion quedaria en una transaccion abierta.');
  }
}

// ------------------------------------------------------------
// REGLA 4 · Comparacion LITERAL contra una funcion de catalogo que
// renderiza texto (patron P21, docs/engineering/failure-patterns.md).
//
// EL CASO QUE LA ORIGINA, medido. El replay completo 0001->0022 sobre
// un Postgres limpio encontro en `0022:421`:
//
//     AND pg_get_function_identity_arguments(p.oid) = 'jsonb'
//
// `pg_get_function_identity_arguments()` devuelve la lista de identidad CON
// el nombre del parametro -- `payload jsonb` -- asi que esa comparacion es
// FALSA SIEMPRE, en los dos lados (replica limpia Y produccion). La guarda
// NO PODIA PASAR: `v_oid` quedaba NULL y la migracion abortaba con
// "ingest_snapshot(jsonb) no quedo creada con la firma esperada", ACUSANDO A
// LA FUNCION, que estaba perfectamente creada. Es la cara B de P19: alla una
// condicion que no podia dar false, aqui una que no puede dar true. Misma
// raiz: nadie la ejercio contra un estado real.
//
// POR QUE ESTA REGLA USA EL LEXER Y NO UN grep. No es preferencia de estilo:
// el repo YA contiene el caso que rompe una regex cruda. La cadena
// `pg_get_function_identity_arguments(p.oid) = 'jsonb'` aparece en
// `supabase/migrations/0022_repro_registro_de_forzado.sql:421` DENTRO de un
// comentario `--` (la nota de correccion cita la linea vieja, a proposito) y
// ese comentario vive a su vez DENTRO de un cuerpo `$...$`. Un grep marcaria
// la 0022 -- estaria cazando un TEXTO, no un PREDICADO -- y el hallazgo
// mandaria a "corregir" una linea que ya esta corregida. Aqui el comentario
// no existe: `lexear()` lo salta antes de emitir un solo token, y
// `procesarAmbito()` recorre los cuerpos `$...$` (los dos sitios reales viven
// en bloques `DO`). El control negativo esta clavado como test.
//
// FAIL-CLOSED, igual que el resto del archivo: comparar contra algo que NO
// es un literal (una variable, una subconsulta) no se puede afirmar
// estaticamente -> AMBIGUO, revision humana, nunca ERROR.
//
// LAS DOS UBICACIONES EXENTAS, y son casos DISTINTOS:
//
//   0017:183 → true POR ACCIDENTE: el autor escribió los nombres de los parámetros
//              ('p_sku text, p_campo text, p_valor text') y por eso la cadena casa.
//              Nada lo garantiza; renombrar un parámetro rompe el predicado.
//              EXENTO por identidad byte a byte con lo aplicado.
//   0020:729 → true DE VERDAD: función SIN argumentos, cuya lista de identidad es la
//              cadena vacía. NO es un bug latente: es un FALSO POSITIVO de esta regla.
//              NO LO ARREGLES. Exento por lo mismo.
//
// La regla que gobierna esas exenciones (P21, docs/engineering/failure-patterns.md,
// tal como está escrita):
//
//   > La identidad byte a byte con lo aplicado es el DEFAULT. Se rompe solo
//   > cuando (1) romperla compra un invariante que no se puede obtener de
//   > otra forma, (2) el cambio es demostrablemente neutro respecto del
//   > estado resultante, y (3) esa neutralidad se DEMUESTRA, no se declara.
//
// Ninguno de los dos sitios pasa la condicion (1): los dos predicados salen
// true hoy, asi que corregirlos no compra ningun invariante. Por eso el
// barrido del repo sale en 1 de forma PERMANENTE por esas dos lineas
// (decision A de producto) y el test las afirma una por una, no las cuenta.
// ------------------------------------------------------------
const esPalabraEn = (t, conjunto) => !!t && t.tipo === 'palabra' && conjunto.has(t.valor.toLowerCase());

// `f(x)::text = 'lit'` -> el lexer da ':' ':' 'text'. Se salta el cast para
// no perder de vista la comparacion que viene detras.
function saltarCast(toks, k) {
  while (esPunt(toks[k], ':') && esPunt(toks[k + 1], ':')) {
    k += 2;
    if (toks[k] && (toks[k].tipo === 'palabra' || toks[k].tipo === 'ident')) k++;
  }
  return k;
}

function reportarComparacionCatalogo(ctx, pos, nombre, operador, operando) {
  const comoSeArregla =
    " La forma correcta resuelve por IDENTIDAD en vez de por texto: usa to_regprocedure('esquema.func(tipos)')" +
    ' y compara `p.oid` contra eso -- resuelve por FIRMA DE TIPOS, da NULL si no existe, y no se rompe si' +
    ' manana alguien renombra un parametro.';

  if (operando && operando.tipo === 'cadena') {
    hallazgo(ctx, pos, 'CATALOGO_COMPARACION_TEXTUAL',
      'comparacion LITERAL contra ' + nombre + '(): `' + operador + ' ' + JSON.stringify(operando.valor) + '`. ' +
      'Esa funcion RENDERIZA la lista de identidad CON el nombre de cada parametro ("payload jsonb", no ' +
      '"jsonb"), asi que esto es un contrato con el FORMATEADOR del catalogo, no con el catalogo. Patron ' +
      'P21: el predicado puede ser FALSO SIEMPRE y entonces la guarda aborta ACUSANDO al objeto que vigila ' +
      'de no existir (caso real de 0022, visto solo por el replay contra una base limpia).' + comoSeArregla);
    return;
  }
  hallazgo(ctx, pos, 'CATALOGO_COMPARACION_AMBIGUA',
    nombre + '() se compara contra algo que no es un literal de texto (token ' +
    (operando ? operando.tipo + ' "' + String(operando.valor).slice(0, 24) + '"' : 'ausente') +
    '), asi que no puedo afirmar estaticamente si el predicado es satisfacible. Comparar la salida de un ' +
    'pg_get_*() contra texto es el patron P21 aunque el texto venga de una variable.' + comoSeArregla +
    ' REVISION HUMANA.', 'AMBIGUO');
}

function revisarPredicadosDeCatalogo(ctx, toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.tipo !== 'palabra') continue;
    const nombre = t.valor.toLowerCase();
    if (!FUNCIONES_CATALOGO_TEXTUALES.has(nombre)) continue;
    if (!esPunt(toks[i + 1], '(')) continue; // mencion suelta, no una llamada
    ctx.predicadosCatalogo++;

    // Fin de la lista de argumentos, equilibrando parentesis.
    let k = i + 1;
    let paren = 0;
    let cerrado = false;
    for (; k < toks.length; k++) {
      if (esPunt(toks[k], '(')) paren++;
      else if (esPunt(toks[k], ')')) {
        paren--;
        if (paren === 0) { k++; cerrado = true; break; }
      }
    }
    if (!cerrado) continue; // parentesis sin cerrar: ya lo reporta revisarParentesis
    k = saltarCast(toks, k);

    // --- orden 1:  f(...) <op> 'literal'
    const td = toks[k];
    if (td && td.tipo === 'op' && OPS_IGUALDAD.has(td.valor)) {
      reportarComparacionCatalogo(ctx, t.pos, nombre, td.valor, toks[k + 1]);
      continue;
    }
    if (esPalabraEn(td, PALABRAS_LIKE)) {
      reportarComparacionCatalogo(ctx, t.pos, nombre, td.valor.toUpperCase(), toks[k + 1]);
      continue;
    }
    if (esPalabra(td, 'not') && esPalabraEn(toks[k + 1], PALABRAS_LIKE)) {
      reportarComparacionCatalogo(ctx, t.pos, nombre, 'NOT ' + toks[k + 1].valor.toUpperCase(), toks[k + 2]);
      continue;
    }

    // --- IN (...) / NOT IN (...): basta UN literal en la lista.
    let kIn = -1;
    let etiquetaIn = 'IN';
    if (esPalabra(td, 'in') && esPunt(toks[k + 1], '(')) kIn = k + 1;
    else if (esPalabra(td, 'not') && esPalabra(toks[k + 1], 'in') && esPunt(toks[k + 2], '(')) {
      kIn = k + 2;
      etiquetaIn = 'NOT IN';
    }
    if (kIn !== -1) {
      let p2 = 0;
      let primeraCadena = null;
      let primerNoCadena = null;
      for (let m = kIn; m < toks.length; m++) {
        if (esPunt(toks[m], '(')) { p2++; continue; }
        if (esPunt(toks[m], ')')) { p2--; if (p2 === 0) break; continue; }
        if (esPunt(toks[m], ',')) continue;
        if (toks[m].tipo === 'cadena') { primeraCadena = primeraCadena ?? toks[m]; continue; }
        primerNoCadena = primerNoCadena ?? toks[m];
      }
      reportarComparacionCatalogo(ctx, t.pos, nombre, etiquetaIn, primeraCadena ?? primerNoCadena);
      continue;
    }

    // --- orden 2:  'literal' <op> f(...)
    const ti = toks[i - 1];
    if (ti && ti.tipo === 'op' && OPS_IGUALDAD.has(ti.valor)) {
      reportarComparacionCatalogo(ctx, t.pos, nombre, ti.valor, toks[i - 2]);
      continue;
    }
    if (esPalabraEn(ti, PALABRAS_LIKE)) {
      // `'x' NOT LIKE f(...)`: el operando esta un token mas a la izquierda.
      const hayNot = esPalabra(toks[i - 2], 'not');
      reportarComparacionCatalogo(
        ctx, t.pos, nombre,
        (hayNot ? 'NOT ' : '') + ti.valor.toUpperCase(),
        toks[hayNot ? i - 3 : i - 2],
      );
      continue;
    }
  }
}

// ------------------------------------------------------------
// EXPORTADO para aplicar-migracion.mjs ([S5 · REPRODUCIBILIDAD], G3.1/G3.2).
//
// POR QUE EXISTE: aplicar-migracion.mjs decidia DONDE splicear su registro
// del ledger (y CUANTAS transacciones cuenta el archivo) con una regex
// cruda sobre el texto (`/^[ \t]*COMMIT[ \t]*;/im`). Esa regex no sabe de
// comentarios ni de dollar-quoting: un `COMMIT;` que aparezca a inicio de
// linea DENTRO de un `/* ... */` o de un cuerpo `$doc$...$doc$` (p.ej. un
// ejemplo de codigo dentro de un comentario de documentacion) se cuenta y
// se usa igual que uno real. El resultado: el INSERT de registro queda
// spliceado dentro del comentario/cuerpo -- texto inerte que nunca se
// ejecuta -- mientras la migracion aplica por la transaccion implicita y
// el script imprime "Ledger: registrada" sin que la fila exista. Hallazgo
// de la auditoria adversarial (docs/engineering/failure-patterns.md P16: la guarda
// que verifica el mecanismo -- "hay un COMMIT;" -- y asume el efecto).
//
// Esta funcion reusa el MISMO lexer de este archivo (que YA distingue
// comentarios/cadenas/dollar-quoting para las reglas de RAISE) en vez de
// que aplicar-migracion.mjs mantenga su propia nocion, distinta, de "nivel
// superior". `lexear(ctx, 0, sql.length)` por construccion SOLO devuelve
// tokens de profundidad 0 -- exactamente el mismo universo que usa
// revisarTransaccion() de arriba -- porque cada cuerpo `$...$` se colapsa a
// UN token opaco `dolar` en vez de expandirse en esta misma llamada.
//
// No repite la deteccion de ANOMALIAS de revisarTransaccion() (TX_ANIDADA/
// TX_SIN_BEGIN/TX_ABIERTA son para verificar-migracion.mjs); aqui solo hace
// falta el CONTEO y las POSICIONES de los COMMIT, que es lo que
// aplicar-migracion.mjs necesita para decidir DONDE splicear.
// ------------------------------------------------------------
export function transaccionesDeNivelSuperior(sql) {
  const ctx = {
    archivo: '(en memoria, desde aplicar-migracion.mjs)',
    src: sql,
    lineas: indiceDeLineas(sql),
    hallazgos: [],
    detalle: false,
    detalles: [],
    raisesRevisados: 0,
    cuerposDolar: 0,
    predicadosCatalogo: 0,
    abortarScope: false,
  };
  const toks = lexear(ctx, 0, sql.length);
  let nBegin = 0;
  let nCommit = 0;
  let nRollback = 0;
  const posicionesCommit = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.tipo !== 'palabra') continue;
    const v = tk.valor.toLowerCase();
    const cierraSentencia = esPunt(toks[i + 1], ';');
    if (v === 'begin' && cierraSentencia) nBegin++;
    else if (v === 'start' && esPalabra(toks[i + 1], 'transaction')) nBegin++;
    else if (v === 'commit' && cierraSentencia) {
      nCommit++;
      posicionesCommit.push(tk.pos);
    } else if (v === 'rollback' && cierraSentencia) nRollback++;
  }
  // roto: el lexer encontro algo sin cerrar (cadena/comentario/dollar-quote
  // abiertos) y no pudo terminar de tokenizar -- fail-closed, el conteo de
  // arriba no es confiable. aplicar-migracion.mjs debe negarse a splicear.
  return { nBegin, nCommit, nRollback, posicionesCommit, roto: ctx.abortarScope };
}

// ------------------------------------------------------------
// Recorrido recursivo: el ambito raiz + el cuerpo de cada dollar-quote
// (funciones plpgsql, bloques DO), donde vive el RAISE.
// ------------------------------------------------------------
function procesarAmbito(ctx, ini, fin, profundidad, etiqueta) {
  if (profundidad > PROFUNDIDAD_MAX) {
    hallazgo(ctx, ini, 'ANIDAMIENTO_PROFUNDO',
      'dollar-quoting anidado a mas de ' + PROFUNDIDAD_MAX + ' niveles: no sigo analizando. REVISION HUMANA.', 'AMBIGUO');
    return;
  }
  ctx.abortarScope = false;
  const toks = lexear(ctx, ini, fin);
  const roto = ctx.abortarScope;
  ctx.abortarScope = false;

  revisarRaises(ctx, toks);
  // REGLA 4 (P21) corre en TODAS las profundidades: los dos sitios reales del
  // repo (0017:183, 0020:729) viven dentro de bloques `DO $tag$ ... $tag$`, y
  // una regla que solo mirara el nivel superior no veria ninguno de los dos.
  revisarPredicadosDeCatalogo(ctx, toks);
  if (!roto) revisarParentesis(ctx, toks, etiqueta);
  if (profundidad === 0 && !roto) revisarTransaccion(ctx, toks);

  for (const tk of toks) {
    if (tk.tipo !== 'dolar') continue;
    ctx.cuerposDolar++;
    procesarAmbito(ctx, tk.iniCuerpo, tk.finCuerpo, profundidad + 1,
      'el cuerpo ' + tk.valor + ' que abre en la linea ' + lineaCol(ctx, tk.pos).linea);
  }
}

// ------------------------------------------------------------
// Verificacion de un archivo
// ------------------------------------------------------------
function verificarArchivo(ruta, detalle = false) {
  let src = readFileSync(ruta, 'utf8');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const ctx = {
    archivo: ruta,
    src,
    lineas: indiceDeLineas(src),
    hallazgos: [],
    detalle,
    detalles: [],
    raisesRevisados: 0,
    cuerposDolar: 0,
    // Anti-silencio (P6), igual que raisesRevisados: si la regla 4 se muere
    // por dentro este contador se queda en 0 sobre archivos que SI tienen
    // llamadas, y el veredicto verde deja de ser creible. Se imprime siempre.
    predicadosCatalogo: 0,
    abortarScope: false,
  };
  procesarAmbito(ctx, 0, src.length, 0, 'el nivel superior del archivo');
  ctx.hallazgos.sort((a, b) => a.linea - b.linea || a.col - b.col);
  ctx.detalles.sort((a, b) => a.linea - b.linea);
  return ctx;
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------
function rutasPorDefecto() {
  if (!existsSync(DIR_MIGRACIONES)) {
    console.error('No existe ' + DIR_MIGRACIONES + ' y no se pasaron rutas.');
    process.exit(2);
  }
  return readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort()
    .map((f) => join(DIR_MIGRACIONES, f));
}

function expandir(args) {
  const out = [];
  for (const a of args) {
    const r = resolve(process.cwd(), a);
    if (!existsSync(r)) { console.error('No existe la ruta: ' + a); process.exit(2); }
    if (statSync(r).isDirectory()) {
      for (const f of readdirSync(r).filter((x) => x.toLowerCase().endsWith('.sql')).sort()) out.push(join(r, f));
    } else out.push(r);
  }
  return out;
}

function mostrar(ruta) {
  const rel = relative(process.cwd(), ruta);
  return rel && !rel.startsWith('..' + sep) ? rel.split(sep).join('/') : ruta;
}

function main() {
  const todos = process.argv.slice(2).filter((a) => a !== '--');
  if (todos.includes('-h') || todos.includes('--help')) {
    console.log('uso: node scripts/verificar-migracion.mjs [--detalle] [archivo.sql|directorio ...]');
    console.log('     sin rutas verifica supabase/migrations/*.sql');
    console.log('     --detalle  imprime CADA RAISE con su nivel, marcadores y argumentos');
    console.log('                (para auditar uno por uno, no solo el OK global)');
    process.exit(0);
  }
  const detalle = todos.includes('--detalle');
  const args = todos.filter((a) => a !== '--detalle');
  const rutas = args.length ? expandir(args) : rutasPorDefecto();

  let errores = 0;
  let ambiguos = 0;
  let raises = 0;
  let predicados = 0;

  console.log('VERIFICADOR ESTATICO DE MIGRACIONES · ' + rutas.length + ' archivo(s)');
  console.log('regla principal: aridad de RAISE (marcadores %% vs argumentos de formato; USING NO cuenta)');
  console.log('');

  for (const ruta of rutas) {
    const ctx = verificarArchivo(ruta, detalle);
    raises += ctx.raisesRevisados;
    predicados += ctx.predicadosCatalogo;
    const errs = ctx.hallazgos.filter((h) => h.severidad === 'ERROR');
    const ambs = ctx.hallazgos.filter((h) => h.severidad === 'AMBIGUO');
    errores += errs.length;
    ambiguos += ambs.length;

    const estado = ctx.hallazgos.length === 0 ? 'OK  ' : 'FALLA';
    console.log(estado + '  ' + mostrar(ruta) +
      '  [' + ctx.raisesRevisados + ' RAISE · ' + ctx.cuerposDolar + ' cuerpo(s) $...$ · ' +
      ctx.predicadosCatalogo + ' pg_get_*() textual(es)]');

    if (detalle && ctx.detalles.length) {
      console.log('       linea | nivel     | forma               | %  | args | veredicto');
      for (const d of ctx.detalles) {
        const veredicto = d.marcadores === '-' ? 'sin cadena de formato: nada que cuadrar'
          : (d.marcadores === d.args ? 'cuadra' : 'DESCUADRA');
        console.log('       ' + String(d.linea).padStart(5) + ' | ' + String(d.nivel).padEnd(9) +
          ' | ' + String(d.forma).padEnd(19) + ' | ' + String(d.marcadores).padStart(2) +
          ' | ' + String(d.args).padStart(4) + ' | ' + veredicto);
      }
    }

    for (const h of ctx.hallazgos) {
      console.log('       ' + mostrar(h.archivo) + ':' + h.linea + ':' + h.col +
        '  ' + h.severidad + ' ' + h.codigo);
      console.log('         ' + h.mensaje);
    }
  }

  console.log('');
  console.log('RESUMEN: ' + rutas.length + ' archivo(s) · ' + raises + ' RAISE analizados · ' +
    errores + ' error(es) · ' + ambiguos + ' ambiguedad(es) para revision humana');
  console.log('         ' + predicados + ' llamada(s) a pg_get_*() de las que renderizan texto, revisadas (P21)');
  if (errores + ambiguos === 0) {
    console.log('VERDE. (Limite declarado: analisis ESTATICO; NO sustituye a compilar contra Postgres.)');
    process.exit(0);
  }
  console.log('ROJO. Corrige lo anterior antes de aplicar la migracion.');
  process.exit(1);
}

// [S5 · REPRODUCIBILIDAD] Guarda de punto de entrada: main() SOLO corre
// cuando este archivo se EJECUTA directamente (`node verificar-migracion.mjs
// ...`), nunca cuando otro modulo lo `import`a. Sin esto, aplicar-migracion.mjs
// no podria reusar transaccionesDeNivelSuperior() de abajo: el mero `import`
// dispararia main() -> process.exit() y mataria el proceso que lo importo,
// ANTES de que su propia logica corriera. Equivalente al
// `if __name__ == '__main__':` de Python. No cambia nada del uso por CLI:
// cuando se ejecuta directo, process.argv[1] SI es este archivo.
const ESTE_ARCHIVO_ES_EL_PUNTO_DE_ENTRADA =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (ESTE_ARCHIVO_ES_EL_PUNTO_DE_ENTRADA) {
  main();
}

// ============================================================
// QUE CAZA
//   RAISE_POCOS_ARGS / RAISE_MUCHOS_ARGS  aridad de RAISE (el bug de 0011:395)
//   RAISE_ARG_VACIO                       coma de mas en la lista de argumentos
//   RAISE_SINTAXIS                        tras el formato no viene "," ";" ni USING
//                                         (p.ej. formato armado con || : plpgsql lo rechaza)
//   RAISE_SIN_PUNTOYCOMA / RAISE_TRUNCADO sentencia RAISE incompleta
//   RAISE_AMBIGUO                         forma de RAISE que no puedo afirmar -> revision humana
//                                         (corchete de nivel superior entre los argumentos,
//                                          literales adyacentes sin salto de linea, formato
//                                          que no es un literal...)
//   RAISE_CONDICION_DESCONOCIDA           bare word en posicion de nombre de condicion
//                                         (el clasico `RAISE EXCEPTION v_variable;`)
//   LEX_CADENA_ABIERTA / LEX_DOLAR_ABIERTO / LEX_COMENTARIO_ABIERTO / LEX_IDENT_ABIERTO
//   PARENTESIS_FALTAN / PARENTESIS_SOBRAN por ambito (archivo y cada cuerpo $...$)
//   TX_ABIERTA / TX_SIN_BEGIN / TX_ANIDADA BEGIN;/COMMIT; de nivel superior
//   CATALOGO_COMPARACION_TEXTUAL          [P21] la salida de
//                                         pg_get_function_identity_arguments()
//                                         comparada contra un LITERAL, en cualquier
//                                         orden y con = <> != LIKE ILIKE IN (...).
//                                         Es el bug de 0022:421: la funcion devuelve
//                                         "payload jsonb", no "jsonb", asi que el
//                                         predicado podia ser FALSO SIEMPRE.
//   CATALOGO_COMPARACION_AMBIGUA          la misma comparacion pero contra algo que
//                                         NO es literal (una variable): no se puede
//                                         afirmar estaticamente -> revision humana
//
// Con --detalle imprime CADA RAISE (linea, nivel, forma, % y argumentos) para
// poder auditarlos uno por uno en vez de confiar en el OK global.
//
// El resumen y cada linea de archivo imprimen TAMBIEN cuantas llamadas a esas
// funciones de catalogo se revisaron. Es anti-silencio (P6): si la regla 4 se
// muriera por dentro, ese contador se quedaria en 0 sobre archivos que si las
// tienen, y el verde dejaria de ser creible.
//
// QUE **NO** CAZA (limites explicitos, patron P5)
//   · Nombres de tablas/columnas/funciones inexistentes o mal escritos.
//   · Tipos incompatibles, casts imposibles, funciones con firma equivocada.
//   · Variables plpgsql no declaradas o mal tipadas (v_sku vs v_skus).
//   · Errores de la gramatica SQL fuera de RAISE (SELECT mal formado, ON
//     CONFLICT sin indice unico, GROUP BY invalido...).
//   · Que los ARGUMENTOS del RAISE sean expresiones validas: solo los CUENTA.
//   · Permisos, RLS, triggers, orden de dependencias entre migraciones.
//   · Cualquier fallo en tiempo de EJECUCION (constraints, datos, deadlocks).
//   · PREDICADOS DE CATALOGO EQUIVOCADOS — el caso de la 0022, y el que
//     mas caro sale, porque se lee perfecto. La 0022 preguntaba:
//
//         AND pg_get_function_identity_arguments(p.oid) = 'jsonb'
//
//     y esa comparacion es FALSA SIEMPRE: la funcion devuelve la lista CON
//     el nombre del parametro ('payload jsonb'). La guarda no podia PASAR
//     nunca, asi que la migracion abortaba acusando a `ingest_snapshot` de
//     no existir. Sintaxis impecable, aridad de RAISE impecable, dollar
//     quoting impecable: para este verificador es un SELECT mas.
//
//     Lo importante es COMO se encontro, porque define el limite de las
//     tres puertas de este repo:
//       - `--dry` de aplicar-migracion.mjs .... NO CONECTA
//       - la suite de vitest ................... NO CONECTA
//       - este verificador ..................... ES ESTATICO
//     NINGUNA de las tres puede ver un predicado de catalogo equivocado.
//     Lo vio el REPLAY completo 0001->0022 sobre un Postgres limpio, y solo
//     el. Si una migracion nueva consulta pg_proc/pg_class/pg_attribute/
//     pg_default_acl para decidir algo, el verde de aqui no dice nada sobre
//     esa consulta: hay que ejercerla contra una base real.
//
//     Forma preferida, que ademas sobrevive a que renombren un parametro:
//         AND p.oid = to_regprocedure('public.ingest_snapshot(jsonb)')
//     (resuelve por firma de TIPOS y da NULL si no existe).
//
//     ACTUALIZACION: la FORMA SINTACTICA de este caso concreto ya
//     SI se caza -- CATALOGO_COMPARACION_TEXTUAL, regla 4. Lo que sigue sin
//     cazarse, y es la parte importante, es el PREDICADO DE CATALOGO
//     EQUIVOCADO en general: un `proname` mal escrito, un `nspname` que no
//     existe, un `prokind` que nunca casa, una comparacion contra
//     `pg_get_functiondef()`/`pg_get_expr()` armada a mano, o cualquier
//     condicion que resulte insatisfacible contra el catalogo real. La regla
//     4 caza UNA forma conocida; no convierte a este verificador en un
//     evaluador de predicados. Sigue haciendo falta ejercer la migracion
//     contra una base real. Limites concretos de la regla 4:
//       - la llamada ENVUELTA en otra funcion (`lower(pg_get_...(oid)) = 'x'`)
//         no se marca: entre el `)` de la llamada y el operador hay un `)`
//         ajeno. Se prefirio no perseguirlo antes que arriesgar falsos
//         positivos, porque el barrido del repo esta CLAVADO por ubicacion.
//       - guardar la salida en una variable y compararla despues
//         (`SELECT pg_get_...(oid) INTO v; IF v = 'x'`) queda fuera de
//         alcance estatico.
//       - `= ANY (ARRAY[...])` no se reconoce como comparacion.
//
//   Verde aqui significa "el desbalance de RAISE no esta"; NO significa
//   "la migracion compila". Solo Postgres puede afirmar eso.
// ============================================================
