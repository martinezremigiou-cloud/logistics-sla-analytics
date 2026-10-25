// ============================================================
// Constantes de los datos de muestra (helper de tests, NO es una suite).
//
// Las emite `scripts/generar-datos-muestra.mjs` en
// `fixtures/muestra/constantes.json` (versionado) y salen del MODELO del generador,
// no de los parsers: son cardinalidades «por construcción». Las pruebas comparan lo que
// un parser entrega contra estas constantes; ninguna cifra se teclea a mano.
// Si cambias el generador, corre `npm run datos:muestra` y commitea el JSON: la prueba
// `datos-muestra.test.ts` falla si el JSON versionado no coincide con el generador.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CifrasStock {
  productosInventario: number;
  stockInventario: number;
  westRows: number;
  westMatched: number;
  westNuevos: number;
  productosReconciliados: number;
  stockReconciliado: number;
  reservas: number;
  reservasMalformadas: number;
  reservasClienteVacio: number;
  reservasSinProducto: number;
  diagReservas: number;
  diagStock: number;
  enParidad: number;
  marcasNuevas: string[];
  familiasNuevas: string[];
  marcaBodega: number;
  productosNacional: number;
  kamsConReserva: string[];
}

export interface CifrasAduana {
  porHoja: { hoja: string; total: number; historial: boolean }[];
  total: number;
  fuera: number;
  historiales: number;
  activos: number;
  hojasTotales: number;
}

export interface ConstantesMuestra {
  semilla: number;
  anio: number;
  libros: { unificado: string; julio: string; aduana: string; cinco: string };
  dorados: {
    inventario: { sku: string; marca: string; familia: string; clase: string; descr: string; north: number };
    west: {
      sku: string;
      prov: string;
      fisico: number;
      descr: string;
      descrUnificado: string;
      tecnologiaUnificado: string;
      familiaUnificado: string;
      claseUnificado: string;
    };
  };
  westTestigos: { sku: string; prov: string; fisico: number; texto: string }[];
  westUnificadoSolo: {
    sku: string;
    marca: string;
    tecnologia: string;
    familia: string;
    clase: string | null;
    descr: string;
    fisico: number;
  };
  marcasNuevasTestigo: string[];
  familiaTestigo: string;
  kam: { sembrados: string[]; noSembrados: string[] };
  abril: CifrasStock & {
    inventarioFilas: number;
    westFilas: number;
    reservaFilas: number;
    reservaColumnas: number;
    embarques: CifrasAduana & { indiceHojaConEstatus: number; embarquesFueraDelUniverso: number; skuFuera: string[] };
  };
  julio: CifrasStock & {
    hojasStock: string[];
    hojasAduana: string[];
    aduana: CifrasAduana & { hojaNueva: string };
    columnasAusentes: { tecnologia: number; producto: number; familia: number; clase: number };
    filasPorHoja: { Inventario: number; Reserva: number; Compras: number; WEST: number };
  };
  unificado: CifrasStock & { hojasStock: string[] };
  cinco: {
    productos: number;
    conTecnologia: number;
    conProducto: number;
    sinTecnologia: number;
    sinProducto: number;
    filasVacias: number;
    tecnologiaConProducto: string;
    invarianteProductoImplicaTecnologia: boolean;
    testigo: { sku: string; familia: string; producto: string; tecnologia: string; marca: string };
  };
  edge: {
    inventario: {
      sinMarca: string;
      minuscula: string;
      miles: { sku: string; texto: string; valor: number };
      primero: { sku: string; north: number; tran: number; total: number; resv: number };
    };
    reserva: {
      sku: string;
      valida: { cliente: string; kam: string; cantidad: number; motivo: string; fecha: string };
      totalFuenteIgnorado: number;
    };
    embarques: {
      ocAbierta: { oc: string; sku: string };
      garantia: { sku: string };
      activo: { sku: string; estatus: string; piezas: number; fechaRecoleccion: string; eta: string };
      historico: { sku: string; estatus: string; oc: string };
    };
  };
}

export const RUTA_CONSTANTES_MUESTRA = join(
  process.cwd(),
  'src/services/etl/__tests__/fixtures/muestra/constantes.json',
);

export const MUESTRA = JSON.parse(readFileSync(RUTA_CONSTANTES_MUESTRA, 'utf8')) as ConstantesMuestra;
