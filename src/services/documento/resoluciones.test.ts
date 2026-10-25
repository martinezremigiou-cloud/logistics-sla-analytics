import { describe, it, expect } from 'vitest';
import {
  extensionDe,
  rutaBannerMarca,
  resolverImagen,
  resolverAgrupacion,
  resumenDeAgrupacion,
  resolverFirmante,
  type AgrupacionResuelta,
} from './resoluciones';

/** Lo que el generador de PDF sabe empotrar. El de XLSX no empota nada: enlaza. */
const PDF = ['png', 'jpg', 'jpeg'] as const;
const GENERICO = 'marca/logo-principal.png';

describe('extensionDe', () => {
  it('saca la extension en minusculas, sin punto', () => {
    expect(extensionDe('https://x/y/abc.PNG')).toBe('png');
    expect(extensionDe('abc.jpeg')).toBe('jpeg');
  });

  it('ignora query string y fragmento (Storage puede firmarlas algun dia)', () => {
    expect(extensionDe('https://x/y/abc.png?token=1&v=2')).toBe('png');
    expect(extensionDe('https://x/y/abc.png#frag')).toBe('png');
  });

  it('sin extension determinable → cadena vacia, nunca lanza', () => {
    expect(extensionDe('https://x/y/abc')).toBe('');
    expect(extensionDe('https://x/y/abc.')).toBe('');
    expect(extensionDe('')).toBe('');
    expect(extensionDe('https://x/y.z/abc')).toBe('');
  });

  it('un punto que abre el nombre no es extension (.gitignore)', () => {
    expect(extensionDe('/ruta/.gitignore')).toBe('');
  });
});

describe('rutaBannerMarca (el mecanismo que activa la capa 2 sola)', () => {
  it('es determinista y no depende de que el archivo exista', () => {
    expect(rutaBannerMarca('BRAND1')).toBe('marca/banners/brand1.png');
    expect(rutaBannerMarca('BRAND1')).toBe(rutaBannerMarca('BRAND1'));
  });

  it('aguanta nombres de marca de varias palabras, con espacios', () => {
    // `BRAND 6` es una marca de dos palabras: el slug las une con guion.
    expect(rutaBannerMarca('BRAND 6')).toBe('marca/banners/brand-6.png');
  });

  it('quita acentos en vez de dejarlos en la ruta', () => {
    expect(rutaBannerMarca('SEGURIDAD ÓPTICA')).toBe('marca/banners/seguridad-optica.png');
  });

  it('no deja guiones colgando en los bordes', () => {
    expect(rutaBannerMarca('  ¡MARCA!  ')).toBe('marca/banners/marca.png');
  });
});

describe('resolverImagen (cadena D2)', () => {
  it('capa 1: el SKU tiene foto en un formato empotrable', () => {
    const r = resolverImagen({ imagenSku: 'https://x/a.png', bannerGenerico: GENERICO, formatosEmpotrables: PDF });
    // La forma crecio en [INV-B8.1]: la cadena ahora expone tambien el HECHO
    // crudo (`fotoDelSku`), para que un renderizador que ENLACE en vez de
    // pintar no dependa de la capa resuelta. Ver `ImagenResuelta`.
    expect(r).toEqual({
      fuente: 'https://x/a.png',
      capa: 'sku',
      motivos: [],
      fotoDelSku: { url: 'https://x/a.png', formato: 'png' },
    });
  });

  it('capa 3 HOY: sin foto y sin banner de marca — es el caso normal, no un error', () => {
    // Sin banner de marca y sin foto del SKU: es el caso normal, no un error.
    const r = resolverImagen({ imagenSku: null, bannerGenerico: GENERICO, formatosEmpotrables: PDF });
    expect(r.capa).toBe('generico');
    expect(r.fuente).toBe(GENERICO);
    expect(r.motivos).toEqual(['sin_foto_del_sku', 'sin_banner_de_marca']);
  });

  it('capa 2: el dia que exista el banner, gana SIN tocar codigo', () => {
    const r = resolverImagen({
      imagenSku: null,
      bannerMarca: 'marca/banners/brand1.png',
      bannerGenerico: GENERICO,
      formatosEmpotrables: PDF,
    });
    expect(r.capa).toBe('marca');
    expect(r.motivos).toEqual(['sin_foto_del_sku']);
  });

  it('webp: el SKU SI tiene foto, y el motivo dice que el problema es nuestro', () => {
    // Una foto .webp es valida. Ningun generador de PDF sin
    // navegador la empota. Sin este motivo el documento pareceria decir
    // "este SKU no tiene foto", que es falso.
    const r = resolverImagen({
      imagenSku: 'https://x/a8541c618b2e855f8ae40d58eca736e5.webp',
      bannerGenerico: GENERICO,
      formatosEmpotrables: PDF,
    });
    expect(r.capa).toBe('generico');
    expect(r.motivos).toEqual(['formato_no_empotrable', 'sin_banner_de_marca']);
  });

  it('webp CON banner de marca → cae solo una capa, no dos', () => {
    const r = resolverImagen({
      imagenSku: 'https://x/a.webp',
      bannerMarca: 'marca/banners/brand1.png',
      bannerGenerico: GENERICO,
      formatosEmpotrables: PDF,
    });
    expect(r.capa).toBe('marca');
    expect(r.motivos).toEqual(['formato_no_empotrable']);
  });

  it('renderizador que no empota nada (XLSX) → siempre cae, y lo declara', () => {
    const r = resolverImagen({ imagenSku: 'https://x/a.png', bannerGenerico: GENERICO, formatosEmpotrables: [] });
    expect(r.capa).toBe('generico');
    expect(r.motivos).toEqual(['formato_no_empotrable', 'sin_banner_de_marca']);
  });

  it('INVARIANTE: la ultima capa nunca falla, con cualquier entrada basura', () => {
    for (const imagenSku of [null, undefined, '', 'sin-extension', 'x.webp', 'x.PNG']) {
      for (const bannerMarca of [null, undefined, '']) {
        const r = resolverImagen({ imagenSku, bannerMarca, bannerGenerico: GENERICO, formatosEmpotrables: PDF });
        expect(typeof r.fuente).toBe('string');
        expect(r.fuente.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('resolverAgrupacion (cadena D5)', () => {
  it('capa 2 HOY: la tecnologia es la unica que puede ganar', () => {
    expect(resolverAgrupacion({ tecnologia: 'BRAND1' })).toEqual({ banda: 'BRAND1', eje: 'tecnologia' });
  });

  it('capa 1: si algun dia existe una categoria, gana sin cambiar esta funcion', () => {
    expect(resolverAgrupacion({ categoria: 'ACCES CONTROL', tecnologia: 'BRAND1' })).toEqual({
      banda: 'ACCES CONTROL',
      eje: 'categoria',
    });
  });

  it('los 28 SKU sin tecnologia no revientan: caen a sin_banda', () => {
    expect(resolverAgrupacion({ tecnologia: null })).toEqual({ banda: null, eje: 'sin_banda' });
    expect(resolverAgrupacion({})).toEqual({ banda: null, eje: 'sin_banda' });
  });

  it('un valor de solo espacios cuenta como ausente, no como banda en blanco', () => {
    expect(resolverAgrupacion({ tecnologia: '   ' })).toEqual({ banda: null, eje: 'sin_banda' });
    expect(resolverAgrupacion({ categoria: '  ', tecnologia: 'EAS' }).eje).toBe('tecnologia');
  });

  it('recorta el valor que si gana', () => {
    expect(resolverAgrupacion({ tecnologia: '  EAS  ' }).banda).toBe('EAS');
  });
});

describe('resumenDeAgrupacion (el documento declara POR QUE eje agrupo)', () => {
  const porTec: AgrupacionResuelta = { banda: 'BRAND1', eje: 'tecnologia' };
  const sinBanda: AgrupacionResuelta = { banda: null, eje: 'sin_banda' };
  const porCat: AgrupacionResuelta = { banda: 'ACCES CONTROL', eje: 'categoria' };

  it('todo por tecnologia', () => {
    expect(resumenDeAgrupacion([porTec, porTec])).toEqual({ eje: 'tecnologia', sinBanda: 0 });
  });

  it('cuenta las partidas sin banda en vez de esconderlas', () => {
    expect(resumenDeAgrupacion([porTec, sinBanda, sinBanda])).toEqual({ eje: 'tecnologia', sinBanda: 2 });
  });

  it('el eje es el MEJOR que produjo banda, no el mas frecuente', () => {
    expect(resumenDeAgrupacion([porCat, porTec, porTec, porTec])).toEqual({ eje: 'categoria', sinBanda: 0 });
  });

  it('proyecto vacio, o todo sin banda → sin_banda, sin lanzar', () => {
    expect(resumenDeAgrupacion([])).toEqual({ eje: 'sin_banda', sinBanda: 0 });
    expect(resumenDeAgrupacion([sinBanda])).toEqual({ eje: 'sin_banda', sinBanda: 1 });
  });
});

describe('resolverFirmante (cadena D3)', () => {
  const base = { cuenta: '00000000-0000-4000-8000-000000000001', entorno: 'produccion' };

  it('capa 2 HOY: ninguna cuenta tiene nombre, todas firman con correo', () => {
    const r = resolverFirmante({ ...base, correo: 'lmertlbazim@example.test' });
    expect(r).toEqual({
      etiqueta: 'lmertlbazim@example.test',
      correo: 'lmertlbazim@example.test',
      entorno: 'produccion',
      capa: 'correo',
    });
  });

  it('capa 1: el dia que exista un nombre, gana sola', () => {
    const r = resolverFirmante({ ...base, nombre: 'Ivan Ruiz', correo: 'u@example.test' });
    expect(r.etiqueta).toBe('Ivan Ruiz');
    expect(r.capa).toBe('nombre');
    expect(r.correo).toBe('u@example.test');
  });

  it('sin nombre NI correo → la cuenta. Verdadero, feo, y nunca inventado', () => {
    const r = resolverFirmante({ ...base, nombre: null, correo: null });
    expect(r.etiqueta).toBe(base.cuenta);
    expect(r.capa).toBe('cuenta');
    expect(r.correo).toBeNull();
  });

  it('nombre o correo de solo espacios no cuentan como valor', () => {
    expect(resolverFirmante({ ...base, nombre: '   ', correo: 'a@example.test' }).capa).toBe('correo');
    expect(resolverFirmante({ ...base, correo: '  ' }).capa).toBe('cuenta');
  });

  it('el entorno viaja siempre, gane la capa que gane', () => {
    for (const entorno of ['produccion', 'desarrollo', 'vista previa']) {
      expect(resolverFirmante({ ...base, entorno, correo: 'a@example.test' }).entorno).toBe(entorno);
    }
  });
});

describe('INVARIANTE TRANSVERSAL · el SKU pobre sale igual de bien que el mejor del catalogo', () => {
  it('sin foto, sin clase, sin tecnologia y recien creado: las 3 cadenas responden', () => {
    const imagen = resolverImagen({ imagenSku: null, bannerMarca: null, bannerGenerico: GENERICO, formatosEmpotrables: PDF });
    const agrupacion = resolverAgrupacion({ categoria: null, tecnologia: null });
    const firmante = resolverFirmante({ cuenta: 'uid-1', correo: null, nombre: null, entorno: 'produccion' });

    expect(imagen.fuente).toBe(GENERICO);
    expect(agrupacion.banda).toBeNull();
    expect(firmante.etiqueta).toBe('uid-1');

    // Y cada una dice POR QUE quedo asi — que es la diferencia entre un
    // documento explicable y un cuadro gris.
    expect(imagen.motivos).toEqual(['sin_foto_del_sku', 'sin_banner_de_marca']);
    expect(agrupacion.eje).toBe('sin_banda');
    expect(firmante.capa).toBe('cuenta');
  });
});
