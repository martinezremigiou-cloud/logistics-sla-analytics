// ============================================================
// Bloque 2 · ETL · dates.ts  (PURO)
// Normaliza fechas a ISO 'YYYY-MM-DD' | null.
// Soporta: español dd-mmm-yy / dd mmm yy, serial Excel, ISO/Date.
// ============================================================
import type { Cell } from './types';

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
  // tolerancia a variantes en inglés que aparecen ocasionalmente
  apr: 4, aug: 8, dec: 12, jan: 1,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function fmt(y: number, m: number, d: number): string | null {
  if (!isValidYmd(y, m, d)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Serial de Excel/ODS → ISO. Base 1899-12-30 (compat. bug 1900 de Excel).
 * Rango razonable: 1..80000 (≈ 1900..2119).
 */
function fromExcelSerial(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
  const ms = Math.round(n) * 86400000;
  const base = Date.UTC(1899, 11, 30);
  const dt = new Date(base + ms);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Parsea una celda de fecha a 'YYYY-MM-DD' | null.
 *  - Date → ISO (UTC).
 *  - number → serial Excel.
 *  - 'dd-mmm-yy' / 'dd mmm yy' español (yy → 20yy).
 *  - ISO 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm:ss...'.
 *  - 'dd/mm/yyyy' o 'dd-mm-yyyy'.
 *  - '19 mar 264' (año inválido de 3 dígitos) → null.
 */
export function parseFecha(cell: Cell | Date): string | null {
  if (cell === null || cell === undefined) return null;

  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return null;
    return fmt(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  }

  if (typeof cell === 'number') return fromExcelSerial(cell);
  if (typeof cell === 'boolean') return null;

  const s = cell.trim();
  if (s === '') return null;

  // ISO con o sin hora
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?.*)?$/);
  if (iso) return fmt(+iso[1], +iso[2], +iso[3]);

  // español dd-mmm-yy / dd mmm yy / dd.mmm.yy  (separadores - espacio . /)
  const esp = s.match(/^(\d{1,2})[\s./-]+([A-Za-zÀ-ɏ]{3,})[\s./-]+(\d{2}|\d{4})$/);
  if (esp) {
    const d = +esp[1];
    const mesRaw = esp[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .slice(0, 3);
    const mm = MESES[mesRaw];
    if (mm === undefined) return null;
    let y = +esp[3];
    if (esp[3].length === 2) y = 2000 + y;
    return fmt(y, mm, d);
  }

  // numérico dd/mm/yyyy o dd-mm-yyyy (año de 4 dígitos)
  const num = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (num) return fmt(+num[3], +num[2], +num[1]);

  return null;
}
