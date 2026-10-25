// ============================================================
// [2.0.1-A] O0 · layout-check · veredicto.ts (100% PURO)
//
// La agregación caso→veredicto, separada del arnés para que el exit code
// — que es EL contrato («una corrida no se juzga por su última línea: se
// juzga por $?») — quede bajo tsc y vitest. Aquí viven las reglas que
// hacen que un verde no pueda ser vacuo:
//
//   exit 0 · midió TODO, el control plantado fue denunciado (cada marca
//            por SU aserción, P25-C), y no hay violaciones reales.
//   exit 1 · hay violaciones reales (el instrumento estaba sano: el
//            control se denunció). Los casos sin medir, si los hay, se
//            reportan — un rojo con huecos sigue siendo rojo.
//   exit 2 · SIN VEREDICTO: no se puede afirmar ni verde ni rojo — la
//            derivación perdió rutas (P17: el universo se compara contra
//            el piso de archivos), hubo 0 casos, algún caso quedó SIN
//            MEDIR con cero violaciones reales, o EL CONTROL NO FUE
//            DENUNCIADO (un instrumento que no denuncia lo plantado no
//            puede absolver nada: «0 desbordes» sería el troceador que
//            no troceaba).
//
// JERARQUÍA, y por qué: el fallo del control o de la derivación DOMINA
// (exit 2 aunque haya violaciones) — un instrumento inválido tampoco es
// confiable para acusar. Con instrumento sano, el rojo domina sobre los
// huecos: una violación medida es accionable aunque otra página no se
// haya podido abrir.
// ============================================================
import type { Medicion, TipoViolacion, Violacion } from './predicados';

export interface ResultadoCaso {
  ruta: string;
  url: string | null;
  estado: string;
  ancho: number;
  alto: number;
  resultado: 'MEDIDO' | 'SIN_MEDIR';
  motivoSinMedir?: string;
  medicion?: Medicion;
}

export interface PlantadoEsperado {
  /** Valor de `data-plantado` en la página de control. */
  marca: string;
  /** La aserción que DEBE denunciarlo — «cae por SU razón», no por otra. */
  tipo: TipoViolacion;
  /**
   * [C-DASH·13] Si está, el plantado tiene DOS contratos: **denunciado en todos
   * los estados MENOS éste, donde tiene que CALLAR.** La segunda mitad es la que
   * importa — sin ella, un predicado que denunciara SIEMPRE pasaría el control
   * con nota.
   *
   * Existe porque el eje del sidebar tiene dos regímenes y el defecto que su
   * aserción caza solo puede existir en uno: el plantado mide `460px` menos el
   * ancho del `<aside>`, así que con el sidebar EXPANDIDO recorta su enlace y
   * colapsado no. Un plantado universal no podría representar eso.
   *
   * **Y su propia vacuidad está vigilada:** si la corrida nunca midió el control
   * en el estado callado —o nunca lo midió en ningún OTRO—, el contrato no se
   * ejerció en las dos direcciones y el veredicto es SIN VEREDICTO. Una
   * condición que jamás dio los dos resultados está redactada, no comprobada.
   */
  calladoEnEstado?: string;
}

export interface OpcionesVeredicto {
  archivosPagina: number;
  rutasDerivadas: number;
  rutaControl: string;
  /** Nombres registrados de solape permitido. Un nombre hallado fuera de esta lista es un hallazgo (permiso sin registrar). */
  nombresSolapeConocidos: string[];
  plantadosEsperados: PlantadoEsperado[];
  /** Nombre del solape permitido plantado en el control (prueba de que la excepción está ACOTADA y se ejerció). */
  solapePermitidoDelControl: string;
  /**
   * Marcas plantadas con CONTRATO INVERTIDO: el control las pone ahí para que
   * NO se denuncien. Si alguna aparece en las violaciones, el que falló es el
   * INSTRUMENTO (mide de más), no el producto — y un instrumento que acusa de
   * más tampoco puede absolver: SIN VEREDICTO, nunca rojo.
   *
   * Nació del defecto que este bloque se encontró a sí mismo: dos de los tres
   * solapes que el layout-check reportó en su estreno eran controles
   * scrolleados fuera de vista (rect geométrico, área tocable inexistente).
   * `plantadosEsperados` vigila que el instrumento no deje de ver; esto vigila
   * que no empiece a ver de más.
   */
  plantadosSilenciosos: string[];
}

export interface Veredicto {
  codigo: 0 | 1 | 2;
  lineas: string[];
}

function esDelControl(caso: ResultadoCaso, rutaControl: string): boolean {
  return caso.ruta === rutaControl;
}

export function veredicto(casos: ResultadoCaso[], opts: OpcionesVeredicto): Veredicto {
  const lineas: string[] = [];
  const fallasInstrumento: string[] = [];
  const violacionesReales: Array<{ caso: ResultadoCaso; v: Violacion }> = [];
  const permisosDesconocidos: Array<{ caso: ResultadoCaso; nombre: string; detalle: string }> = [];
  const sinMedir: ResultadoCaso[] = [];
  const conocidos = new Set([...opts.nombresSolapeConocidos, 'dialogo-modal']);

  if (opts.rutasDerivadas !== opts.archivosPagina) {
    fallasInstrumento.push(
      `la derivación produjo ${opts.rutasDerivadas} ruta(s) desde ${opts.archivosPagina} archivo(s) page.tsx — el universo del gate no es el árbol real (P17)`,
    );
  }
  if (casos.length === 0) {
    fallasInstrumento.push('0 casos — no se midió nada');
  }

  let controlVisto = false;
  let controlEjercioExcepcion = false;
  // [C-DASH·13] Para la anti-vacuidad de los plantados acotados: qué estados del
  // control se llegaron a medir, y en cuáles se ejerció cada mitad del contrato.
  const estadosDelControl = new Set<string>();
  const marcasAcotadasEjercidas = new Set<string>();
  const marcasAcotadasCalladas = new Set<string>();

  for (const caso of casos) {
    const encabezado = `${caso.ruta} · ${caso.estado} · ${caso.ancho}×${caso.alto}`;
    if (caso.resultado === 'SIN_MEDIR') {
      sinMedir.push(caso);
      lineas.push(`[SIN MEDIR] ${encabezado} — ${caso.motivoSinMedir ?? 'sin motivo declarado'}`);
      continue;
    }
    const m = caso.medicion;
    if (!m) {
      sinMedir.push(caso);
      lineas.push(`[SIN MEDIR] ${encabezado} — caso MEDIDO sin medición adjunta (defecto del arnés)`);
      continue;
    }

    for (const p of m.solapesPermitidos) {
      if (!conocidos.has(p.nombre)) permisosDesconocidos.push({ caso, nombre: p.nombre, detalle: p.detalle });
    }

    if (esDelControl(caso, opts.rutaControl)) {
      controlVisto = true;
      const faltas: string[] = [];
      for (const v of m.violaciones) {
        if (v.plantado !== null && opts.plantadosSilenciosos.includes(v.plantado)) {
          faltas.push(
            `plantado SILENCIOSO «${v.plantado}» DENUNCIADO por ${v.tipo} — el instrumento mide de más (${v.detalle})`,
          );
        }
      }
      for (const esperado of opts.plantadosEsperados) {
        const denunciado = m.violaciones.some((v) => v.plantado === esperado.marca && v.tipo === esperado.tipo);
        // [C-DASH·13] Un plantado acotado a un estado tiene DOS contratos, no uno.
        const acotado = esperado.calladoEnEstado !== undefined;
        if (acotado) {
          estadosDelControl.add(caso.estado);
          if (caso.estado === esperado.calladoEnEstado) {
            // La mitad que hace al control no-vacuo: aquí tiene que CALLAR.
            const cualquiera = m.violaciones.find((v) => v.plantado === esperado.marca);
            if (cualquiera) {
              faltas.push(
                `plantado «${esperado.marca}» DENUNCIADO por ${cualquiera.tipo} en «${caso.estado}», que es donde debe callar — el instrumento mide de más`,
              );
            } else {
              marcasAcotadasCalladas.add(esperado.marca);
            }
            continue;
          }
          marcasAcotadasEjercidas.add(esperado.marca);
        }
        if (!denunciado) {
          const porOtra = m.violaciones.find((v) => v.plantado === esperado.marca);
          faltas.push(
            porOtra
              ? `plantado «${esperado.marca}» denunciado por ${porOtra.tipo}, no por SU aserción (${esperado.tipo})`
              : `plantado «${esperado.marca}» NO denunciado (esperaba ${esperado.tipo})`,
          );
        }
      }
      if (m.solapesPermitidos.some((p) => p.nombre === opts.solapePermitidoDelControl)) {
        controlEjercioExcepcion = true;
      }
      if (faltas.length > 0) {
        fallasInstrumento.push(`control ${encabezado}: ${faltas.join(' · ')}`);
        lineas.push(`[CONTROL ROTO] ${encabezado} — ${faltas.join(' · ')}`);
      } else {
        // [C-DASH·13] El rótulo dice lo que PASÓ, no cuántos se esperaban. Con un
        // plantado acotado, en su estado callado se denuncian N−1 y el renglón
        // decía «N denunciados» igual: un mensaje que afirma algo que no ocurrió,
        // que es justo la clase que este repo persigue. Ahora se cuentan los dos
        // grupos por separado y el callado se nombra.
        const acotadosCallados = opts.plantadosEsperados.filter(
          (p) => p.calladoEnEstado !== undefined && caso.estado === p.calladoEnEstado,
        );
        const denunciados = opts.plantadosEsperados.length - acotadosCallados.length;
        lineas.push(
          `[CONTROL OK] ${encabezado} — ${denunciados} plantados denunciados, cada uno por su aserción` +
            (acotadosCallados.length > 0
              ? ` · ${acotadosCallados.length} CALLADO(S) como toca en este estado: ${acotadosCallados.map((p) => p.marca).join(', ')}`
              : ''),
        );
      }
      continue;
    }

    if (m.violaciones.length > 0) {
      lineas.push(`[VIOLACIONES] ${encabezado} — ${m.violaciones.length}`);
      for (const v of m.violaciones) {
        violacionesReales.push({ caso, v });
        lineas.push(`    · ${v.tipo}: ${v.detalle}`);
      }
    } else {
      // ============================================================
      // EL RÓTULO NO DICE «OK», Y EL CAMBIO NO ES COSMÉTICO.
      //
      // Este renglón se imprimía cientos de veces en una corrida cuyo VEREDICTO era
      // SIN VEREDICTO, y así fue como esa corrida se narró —por quien la leyó y por
      // mí— como «todos medidos con 0 violaciones». «OK» es un juicio sobre el
      // caso; lo único que este renglón sabe es que **ninguna aserción
      // disparó**, que no es lo mismo: puede no haber disparado porque la
      // pantalla estaba limpia, o porque no había nada que aseverar.
      //
      // Y por eso viajan ahora los dos contadores que se calculaban y se
      // tiraban. `nodos` es el que separa una pantalla de verdad de una
      // TARJETA DE PERMISO: con rol insuficiente, `/proyectos` y `/carga`
      // devuelven un `Card` de ~10 nodos, y con los tres números de antes
      // —truncados, navs, flotantes, todos dominados por el shell— era
      // indistinguible de la pantalla real. una parte de los casos de la corrida
      // de verificación midieron eso, y el log no daba ni una pista.
      // ============================================================
      lineas.push(
        `[SIN VIOLACIONES] ${encabezado} — truncados legibles ${m.truncadosLegibles} · navs ${m.navsMedidos}/${m.navsVisibles} · flotantes ${m.flotantesMedidos} · recortados ${m.controlesRecortados} · A1c ${m.interactivosMedidosA1c} medidos/${m.asomanParcialmente} asoman/${m.recortadosPorCajaCero} en caja cero · A1a cajas cero ${m.cajasCeroA1a} · nodos ${m.elementosRecorridos}`,
      );
    }
  }

  if (!controlVisto && casos.length > 0) {
    fallasInstrumento.push(`ningún caso midió la ruta de control ${opts.rutaControl} — el instrumento corrió sin su control positivo`);
  }
  // [C-DASH·13] ANTI-VACUIDAD de los plantados acotados: el contrato tiene dos
  // mitades y las dos se tienen que haber EJERCIDO en esta corrida. Si el control
  // no se midió en el estado acotado, «denunciado ahí» no se comprobó; si no se
  // midió en ningún otro, «callado en los demás» tampoco. Las dos mitades sin
  // ejercer son una condición redactada, no comprobada (P21).
  for (const esperado of opts.plantadosEsperados) {
    if (esperado.calladoEnEstado === undefined) continue;
    if (!controlVisto) continue; // ya lo denuncia la falta de arriba
    if (!marcasAcotadasEjercidas.has(esperado.marca)) {
      fallasInstrumento.push(
        `plantado acotado «${esperado.marca}»: el control nunca se midió fuera de «${esperado.calladoEnEstado}» — la mitad «denunciado» no se ejerció`,
      );
    }
    if (!marcasAcotadasCalladas.has(esperado.marca)) {
      fallasInstrumento.push(
        `plantado acotado «${esperado.marca}»: el control nunca se midió en «${esperado.calladoEnEstado}» (vistos: ${Array.from(estadosDelControl).join(', ') || 'ninguno'}) — la mitad «callado» no se ejerció`,
      );
    }
  }
  if (controlVisto && !controlEjercioExcepcion) {
    fallasInstrumento.push(
      `la excepción de solape declarada («${opts.solapePermitidoDelControl}») nunca se ejerció en el control — la limitación declarada volvió a ser hipótesis (P25-B)`,
    );
  }
  for (const p of permisosDesconocidos) {
    violacionesReales.push({
      caso: p.caso,
      v: {
        tipo: 'a3_solape_flotantes',
        detalle: `solape con permiso NO REGISTRADO «${p.nombre}» (${p.detalle}) — todo data-solape-permitido nuevo se registra en el arnés`,
        plantado: null,
      },
    });
    lineas.push(`[VIOLACIONES] ${p.caso.ruta} · ${p.caso.estado} · ${p.caso.ancho}×${p.caso.alto} — permiso de solape no registrado «${p.nombre}»`);
  }

  lineas.push('');
  lineas.push(
    `casos: ${casos.length} · medidos: ${casos.length - sinMedir.length} · sin medir: ${sinMedir.length} · violaciones reales: ${violacionesReales.length}`,
  );

  let codigo: 0 | 1 | 2;
  if (fallasInstrumento.length > 0) {
    codigo = 2;
    lineas.push('VEREDICTO: SIN VEREDICTO — el instrumento no puede afirmar nada:');
    for (const f of fallasInstrumento) lineas.push(`  · ${f}`);
  } else if (violacionesReales.length > 0) {
    codigo = 1;
    lineas.push(
      `VEREDICTO: ROJO — ${violacionesReales.length} violación(es) real(es)${sinMedir.length > 0 ? ` (y ${sinMedir.length} caso(s) SIN MEDIR: el rojo es parcial además de rojo)` : ''}`,
    );
  } else if (sinMedir.length > 0) {
    codigo = 2;
    lineas.push(`VEREDICTO: SIN VEREDICTO — 0 violaciones pero ${sinMedir.length} caso(s) sin medir; cero y no-medido son valores distintos`);
  } else {
    codigo = 0;
    lineas.push('VEREDICTO: VERDE — todo medido, control denunciado, 0 violaciones');
  }
  return { codigo, lineas };
}
