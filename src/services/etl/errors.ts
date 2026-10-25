// ============================================================
// Bloque 2 · ETL · errors.ts  (PURO)
// Errores tipados del ETL. EtlContractError = violación del contrato
// de datasets por fuente (p.ej. 'stock' sin sus 3 hojas). El route
// puede mapearlo a 400; runEtl NUNCA persiste un snapshot vacío ni
// genera BAJA masiva por datasets ausentes.
//
// UniversoReducidoError = [REPRODUCIBILIDAD · S7-A] la guarda de
// universo entrante (`computeSnapshot`, `runEtl.ts` — ver la cabecera de
// ese módulo para la medición completa) rechazó un snapshot cuyo
// universo de filas se derrumbó contra el vigente anterior de la MISMA
// fuente. Las dos rutas de ingesta (`/api/refresh` y
// `/api/refresh/archivo`) lo mapean a HTTP 409 `universo_reducido`,
// NUNCA 500: es una decisión de negocio accionable (forzar con las tres
// cabeceras del escape hatch, o revisar el archivo), no un fallo del
// servidor.
// ============================================================
export class EtlContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EtlContractError';
  }
}

export interface UniversoReducidoParams {
  /** 'stock' | 'aduana' (ver `fuenteOf` en runEtl.ts). */
  fuente: string;
  filasPrevias: number;
  filasEntrantes: number;
  /** 0..1 (p.ej. 0.5 para 50%). SIEMPRE el mismo valor que evaluó la guarda — nunca recalculado aquí. */
  umbral: number;
}

/**
 * El mensaje trae, a propósito, TODO lo que Enmienda 2(a) exige:
 * fuente, filas previas, filas entrantes, porcentaje con un decimal,
 * umbral, y las tres cabeceras EXACTAS para forzar. Nada de "universo
 * reducido" a secas — un operador de Power Automate o del CLI tiene que
 * poder actuar sobre este mensaje sin ir a leer el código.
 */
export class UniversoReducidoError extends Error {
  readonly fuente: string;
  readonly filasPrevias: number;
  readonly filasEntrantes: number;
  /** Porcentaje 0..100 (filasEntrantes/filasPrevias · 100). */
  readonly porcentaje: number;
  /** Umbral 0..1 con el que se evaluó (el mismo que recibió `computeSnapshot`). */
  readonly umbral: number;

  constructor({ fuente, filasPrevias, filasEntrantes, umbral }: UniversoReducidoParams) {
    const porcentaje = filasPrevias === 0 ? 0 : (filasEntrantes / filasPrevias) * 100;
    const umbralPct = (umbral * 100).toFixed(1);
    const message =
      `Universo reducido: la fuente "${fuente}" trae ${filasEntrantes} filas contra ${filasPrevias} previas ` +
      `(${porcentaje.toFixed(1)}% del universo vigente, mínimo ${umbralPct}%). Rechazado para evitar un ` +
      `vaciado accidental. Para forzar la carga, manda las tres cabeceras juntas: ` +
      `"x-forzar-universo-reducido: si", "x-forzar-motivo: <12..300 caracteres>" y ` +
      `"x-forzar-por: <3..120 caracteres>".`;
    super(message);
    this.name = 'UniversoReducidoError';
    this.fuente = fuente;
    this.filasPrevias = filasPrevias;
    this.filasEntrantes = filasEntrantes;
    this.porcentaje = porcentaje;
    this.umbral = umbral;
  }
}

/**
 * [ING-B1 · O-1] El RPC `ingest_snapshot` rechazó el INSERT porque ese
 * `hash` YA ESTÁ en `snapshots` (constraint `snapshots_hash_unique`).
 *
 * NO es un fallo del servidor: es **el portal recibiendo un contenido que ya
 * tiene**. Antes caía al `internalError` de las dos rutas como un `Error`
 * pelado y se respondía **500**, y el flujo programado de Power Automate quedaba
 * en rojo en cada corrida por eso.
 *
 * ⚠ SE CLASIFICA SÓLO ESTA RESTRICCIÓN, POR NOMBRE. Cualquier otro fallo del
 * RPC sigue siendo 500: atrapar «cualquier error de `ingest_snapshot`» y
 * responder 200 convertiría este arreglo en el silencio que vino a quitar.
 *
 * Y `causaProbable` existe porque **el mismo síntoma tiene dos causas**:
 *   'archivo_repetido'  → el archivo no cambió desde la última ingesta
 *   'receta_del_hash'   → el archivo SÍ cambió, pero en campos que ESTA
 *                         versión del código no mete en el hash
 * La segunda es la que está pasando hoy y es indistinguible desde el HTTP:
 * se nombra en el cuerpo para que un humano pueda separarlas sin leer código.
 */
export class SnapshotDuplicadoError extends Error {
  readonly hash: string;
  readonly constraint: string;
  constructor(hash: string, constraint: string, detalle: string) {
    super(
      `El contenido de este archivo ya está registrado: el hash ${hash.slice(0, 16)}… ya existe en snapshots ` +
        `(${constraint}). No se escribió nada y no hay nada que escribir. Detalle del RPC: ${detalle}`,
    );
    this.name = 'SnapshotDuplicadoError';
    this.hash = hash;
    this.constraint = constraint;
  }
}

/** Nombre EXACTO de la restricción — se compara por nombre, nunca por substring del mensaje. */
export const CONSTRAINT_HASH_UNICO = 'snapshots_hash_unique';
