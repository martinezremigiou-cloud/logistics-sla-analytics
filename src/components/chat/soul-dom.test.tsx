// ============================================================
// [CHAT-B2] LOS DOS GATES QUE **NO SE PUEDEN AFIRMAR SIN DOM**.
//
// GATE 4 · el verbatim está en el DOM y NO visible por omisión. Se afirma en las
//          DOS direcciones a propósito: sólo «no visible» lo cumpliría también
//          un componente que lo borró, y borrarlo desactiva la garantía de
//          contención sin que nada se ponga rojo.
//
// GATE 6 · el hilo sobrevive EN LA INTERFAZ. Es la lección que este bloque
//          costó: `chat:vivo` pasó el criterio #1 de CHAT-B1 y la interfaz no,
//          porque el arnés construía su propia entrada. **Un arnés que fabrica
//          la entrada no prueba el camino que la deriva.** Esto renderiza la
//          burbuja de verdad y mira lo que SALE por `fetch`.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TarjetaChat } from './tarjeta-chat';
import { BurbujaChat } from './burbuja-chat';
import type { Tarjeta } from '@/lib/chat/tarjeta';
import { MARCADOR_ENTRADA } from '@/lib/chat/voz';

const VERBATIM = 'CONTENIDO VERBATIM DEL DOCUMENTO QUE TIENE QUE SEGUIR EN EL DOM';

const tarjetaCon = (conProsa: boolean): Tarjeta => ({
  intencion: 'documental',
  titulo: 'Ficha de PRUEBA',
  datos: [{ etiqueta: 'Familia', valor: 'PRUEBA' }],
  lista: [{ principal: 'Seccion A', secundario: '' }],
  nota: 'La asociación entre la familia y esta ficha es una propuesta automática.',
  aviso: null,
  fuentes: [{ tag: 'Ficha técnica', code: 'prueba.pdf' }],
  cortes: [],
  texto: VERBATIM,
  respuesta: conProsa
    ? {
        frases: ['El equipo pesa 3.2 kg.'],
        ruta: '20_Seguridad/prueba.md',
        titulo: 'Ficha de prueba',
        fuentePdf: 'prueba.pdf',
        camino: 'completo',
        seccionesLeidas: 1,
        seccionesTotales: 1,
      }
    : null,
});

afterEach(() => cleanup());

// Marcador del contrato: SOUL-§8-4
describe('[CHAT-B2] SOUL-§8-4 · el verbatim, en las DOS direcciones', () => {
  it('CON prosa: está EN EL DOM', () => {
    const { container } = render(<TarjetaChat tarjeta={tarjetaCon(true)} />);
    // La garantía de contención vive aquí: la única forma de comprobar que la
    // prosa no inventó es tener el texto de origen al lado.
    expect(container.textContent).toContain(VERBATIM);
  });

  it('CON prosa: y NO visible por omisión — el `<details>` está cerrado', () => {
    const { container } = render(<TarjetaChat tarjeta={tarjetaCon(true)} />);
    const det = container.querySelector('details');
    expect(det).not.toBeNull();
    expect(det!.hasAttribute('open')).toBe(false);
  });

  it('CON prosa: lo visible es la RESPUESTA y su cita de UNA línea', () => {
    const { container } = render(<TarjetaChat tarjeta={tarjetaCon(true)} />);
    expect(container.textContent).toContain('El equipo pesa 3.2 kg.');
    expect(container.textContent).toContain('Ficha de prueba');
    // El andamiaje sigue en el DOM pero dentro del detalle, no suelto arriba.
    expect(container.querySelector('details')!.textContent).toContain('Familia');
  });

  it('⭐ CONTROL POSITIVO · SIN el verbatim, el DOM NO lo tiene', () => {
    // Sin esto, «no visible» lo cumpliría también un componente que lo borró —
    // y borrarlo desactiva la garantía sin que ninguna prueba se ponga roja.
    const t = { ...tarjetaCon(true), texto: undefined };
    const { container } = render(<TarjetaChat tarjeta={t} />);
    expect(container.textContent).not.toContain(VERBATIM);
  });

  it('⭐ CONTROL POSITIVO · SIN prosa el detalle va ABIERTO, como antes del bloque', () => {
    const { container } = render(<TarjetaChat tarjeta={tarjetaCon(false)} />);
    expect(container.querySelector('details')!.hasAttribute('open')).toBe(true);
    expect(container.textContent).toContain(VERBATIM);
  });
});

// ⚠️ ÉSTE NO ES EL GATE 6 DEL SOUL, y llamarlo así fue el defecto B3-4: el 6
// del contrato es «la lista completa aparece sólo si se pide», y la
// renumeración lo dejó sin implementación tapando el hueco con un «8 de 8».
// Éste es propio del bloque y lleva numeración propia.
describe('[CHAT-B2] B2-HILO-EN-LA-INTERFAZ · el hilo sobrevive donde el usuario toca', () => {
  let cuerpos: Record<string, unknown>[] = [];

  beforeEach(() => {
    cuerpos = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        cuerpos.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tipo: 'tarjeta',
            tarjeta: tarjetaCon(true),
            // El servidor devuelve el sujeto que resolvió. El cliente sólo lo guarda.
            referente: { sku: null, termino: 'desactivador RF' },
          }),
        } as unknown as Response;
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  async function preguntar(texto: string, esperados: number) {
    const caja = screen.getByPlaceholderText(MARCADOR_ENTRADA) as HTMLInputElement;
    fireEvent.change(caja, { target: { value: texto } });
    // El envío es por `submit` del formulario, no por `keyDown`: conducirlo con
    // la tecla habría probado un camino que la burbuja no tiene.
    fireEvent.submit(caja.closest('form')!);

    // Se espera a que la RESPUESTA esté pintada, no sólo a que el `fetch` haya
    // salido. Esperar al `fetch` dispara el turno siguiente ANTES de que el
    // cliente haya guardado el referente que ese turno tiene que devolver — y
    // la prueba salía roja por su propia prisa, no por el código.
    //
    // En la app esto no puede pasar: `enviar` arranca con `if (pensando)
    // return;`, así que la burbuja no acepta un segundo envío mientras piensa.
    await waitFor(() => expect(cuerpos).toHaveLength(esperados));
    await waitFor(() => expect(screen.getAllByText(/El equipo pesa/).length).toBe(esperados));
  }

  it('el SEGUNDO turno lleva `hilo` Y `referente` — el primero no tiene qué llevar', async () => {
    render(<BurbujaChat inicial={{ abierta: true }} />);

    await preguntar('¿qué es el desactivador RF?', 1);
    expect(cuerpos[0].hilo).toBeUndefined();
    expect(cuerpos[0].referente).toBeUndefined();

    await preguntar('¿a qué frecuencia trabaja?', 2);

    // 🔴 ESTO ES LO QUE EL QA MANUAL ENCONTRÓ ROTO. Antes de B2 el cliente
    // guardaba los turnos y NUNCA los mandaba: cero menciones de `hilo` en todo
    // el cliente. El arnés pasaba porque construía su propia entrada.
    expect(cuerpos[1].hilo, 'el cliente no mandó el hilo').toBeDefined();
    expect(cuerpos[1].referente, 'el cliente no mandó el referente').toEqual({
      sku: null,
      termino: 'desactivador RF',
    });
  });

  it('el hilo que viaja lleva los dos lados de la conversación, y sólo TEXTO', async () => {
    render(<BurbujaChat inicial={{ abierta: true }} />);
    await preguntar('¿qué es el desactivador RF?', 1);
    await preguntar('¿a qué frecuencia trabaja?', 2);

    const hilo = cuerpos[1].hilo as { quien: string; texto: string }[];
    expect(hilo.some((t) => t.quien === 'usuario')).toBe(true);
    expect(hilo.some((t) => t.quien === 'asistente')).toBe(true);
    // Sólo texto: mandar la tarjeta entera habría cruzado el perímetro con las
    // cifras de inventario por la puerta de atrás.
    for (const t of hilo) expect(typeof t.texto).toBe('string');
  });
});

// ============================================================
// [CHAT-B4] B4-1 · EL SALTO SE DECLARA DONDE SE LEE.
//
// EL HALLAZGO del QA manual sobre `:3002`, con «¿qué es el CLIP 3.0?»:
//
//     visible:  «Lo que encontré sobre «CLIP 3.0»»
//               «Clips 2.0 es la familia de sensores intercambiables…»
//               cita: Clips 2.0     ▸ ver detalle
//
//     medido:   /ficha específica|lo más cercano/   innerText → FALSE
//                                                   innerHTML → TRUE
//
// La frase existía. Vivía en `nota`, y `nota` está dentro del `<details>` que
// B2 cierra en cuanto hay prosa. **El KAM lee un título con CLIP 3.0 y debajo
// las specs del 2.0**, y puede ponerlas delante de un cliente creyendo que son
// del producto que preguntó.
//
// ⚖ `LA-GARANTIA-CORRECTA-EN-LA-SUPERFICIE-EQUIVOCADA` — una afirmación sólo
// cuenta donde el cliente la lee. Y explica el verde del reporte anterior sin
// culpar a nadie: se comprobó el OBJETO de respuesta, que sí la traía. **El
// objeto no es la pantalla.**
//
// ⚠️ LÍMITE DECLARADO DE ESTE GATE, porque no medirlo sería repetir el defecto:
// jsdom no calcula diseño, así que «visible» aquí significa **fuera del
// `<details>` plegable**, que es el mecanismo exacto del hallazgo y el mismo
// proxy que el gate SOUL-§8-4 de B2 ya usa. NO prueba contraste ni tamaño de
// letra; eso es del QA visual manual.
// ============================================================
describe('[CHAT-B4] B4-1 · el aviso se ve, no sólo existe', () => {
  const SALTO = 'No tengo una ficha específica de CLIP 3.0. Lo más cercano que tengo es Clips 2.0:';

  const conRelevo = (): Tarjeta => ({ ...tarjetaCon(true), aviso: SALTO });

  it('GATE 1 · con prosa, el salto está en el contenedor…', () => {
    const { container } = render(<TarjetaChat tarjeta={conRelevo()} />);
    expect(container.textContent).toContain(SALTO);
  });

  it('GATE 1 · …y FUERA del `<details>`, que es lo que lo hacía invisible', () => {
    const { container } = render(<TarjetaChat tarjeta={conRelevo()} />);
    const det = container.querySelector('details');
    expect(det).not.toBeNull();
    // Cerrado, como B2 lo dejó. Si esto cambiara, el gate de abajo dejaría de
    // significar nada y hay que enterarse.
    expect(det!.hasAttribute('open')).toBe(false);
    expect(det!.textContent ?? '').not.toContain(SALTO);
  });

  it('⭐ CONTROL POSITIVO · el detector SÍ enrojece: lo que va en `nota` queda dentro', () => {
    // Éste es el que da sentido al de arriba. Sin él, «está fuera del detalle»
    // lo cumpliría también un componente que no pinta nada, o un `<details>`
    // que ya no pliega. Aquí se mete la MISMA frase por el campo VIEJO y se
    // exige que el detector la encuentre plegada — o sea, que el gate de arriba
    // habría estado rojo antes del arreglo.
    const comoAntes: Tarjeta = { ...tarjetaCon(true), aviso: null, nota: SALTO };
    const { container } = render(<TarjetaChat tarjeta={comoAntes} />);
    expect(container.textContent).toContain(SALTO); // en el DOM, como se reportó en QA manual
    expect(container.querySelector('details')!.textContent ?? '').toContain(SALTO); // …y plegado
  });

  it('⭐ CONTROL POSITIVO · la familia que SÍ tiene su ficha no avisa de nada', () => {
    // Si el aviso saliera también en el camino exacto, estaría avisando de nada
    // y el KAM aprendería a ignorarlo — que es cómo muere una advertencia.
    const { container } = render(<TarjetaChat tarjeta={tarjetaCon(true)} />);
    expect(container.textContent).not.toContain('Lo más cercano que tengo');
    expect(container.textContent).not.toContain('No tengo una ficha específica');
  });

  it('SIN prosa el aviso sigue arriba: no depende de que el detalle esté plegado', () => {
    // El camino que peor contesta es el que más necesita el aviso, y es justo
    // el que no lleva prosa. Atar el aviso al `<details>` lo habría dejado
    // dependiendo de la rama equivocada.
    const { container } = render(<TarjetaChat tarjeta={{ ...tarjetaCon(false), aviso: SALTO }} />);
    expect(container.textContent).toContain(SALTO);
    expect(container.querySelector('details')!.textContent ?? '').not.toContain(SALTO);
  });

  it('⭐ y el aviso va ANTES de la prosa en el orden del documento', () => {
    // Leerlo después sería leerlo tarde: para entonces el KAM ya tomó las specs
    // como si fueran del producto que preguntó.
    const { container } = render(<TarjetaChat tarjeta={conRelevo()} />);
    const texto = container.textContent ?? '';
    expect(texto.indexOf(SALTO)).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf(SALTO)).toBeLessThan(texto.indexOf('El equipo pesa 3.2 kg.'));
  });
});
