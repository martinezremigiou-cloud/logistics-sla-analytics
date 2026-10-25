-- ============================================================================
-- 0044 · [FIX-B1 · T2a] La tecnología se puede capturar en el portal, pero
--        SÓLO donde el Excel no la trae. «EL EXCEL GANA».
--
-- LAS TRES DECISIONES DE PRODUCTO QUE GOBIERNAN ESTE ARCHIVO (firmadas para FIX-B1)
--   (1) La tecnología se captura en el portal SÓLO para llenar huecos: si
--       `productos.tecnologia` —lo que trae el Excel— no está vacía, manda el
--       Excel y la captura se rechaza.
--   (2) La lista que se ofrece es EAS, BRAND2 e BRAND1. VERTICAL NO: ya no se
--       manejan verticales.
--   (3) El botón «Clasificar» de Configuración queda FUERA de este bloque.
--
-- ----------------------------------------------------------------------------
-- QUÉ HACE
--   (a) Amplía `productos_override_campo_check` de ('familia','descripcion') a
--       ('familia','descripcion','tecnologia').
--   (b) Crea `public.tecnologias_seleccionables()` — de SÓLO LECTURA, STABLE,
--       SECURITY INVOKER— que devuelve las tecnologías que se pueden elegir. Es
--       la ÚNICA fuente de esa lista: la usa `aplicar_override` (abajo) y la usa
--       la API. Si la lista viviera también en TypeScript, habría dos verdades
--       sobre lo mismo y divergirían —el patrón de la casa—.
--   (c) Reemplaza `public.aplicar_override(text,text,text)` conservando TODO su
--       comportamiento para `familia` y `descripcion`, y agregando `tecnologia`
--       con dos reglas que viven en la BASE y no sólo en la pantalla (P13: una
--       garantía que vive sólo en el cliente no es garantía; la RPC la alcanza
--       cualquier admin con sesión):
--         · MXTEC — el valor no está en `tecnologias_seleccionables()`.
--         · MXEXL — el Excel ya trae tecnología para ese SKU.
--       Quitar (p_valor NULL) se permite SIEMPRE.
--   (d) Crea el CANDADO DE TABLA: la función `public.productos_override_
--       tecnologia_excel_gana()` y el disparador del mismo nombre, BEFORE
--       INSERT OR UPDATE ON `productos_override`. Aplica las MISMAS dos reglas,
--       con los MISMOS códigos y mensajes, a CUALQUIER escritura que deje una
--       captura de tecnología ACTIVA —la de la RPC y la directa a la tabla—.
--
--       POR QUÉ (c) SOLA NO BASTABA, medido en producción por la
--       revisión de FIX-B1: `productos_override` le da INSERT y UPDATE de
--       TABLA a `authenticated` (relacl `authenticated=awdxtm`), sus policies
--       sólo piden `is_admin()` sin mirar campo ni valor, y la tabla NO tenía
--       disparadores. Con el CHECK de (a) admitiendo 'tecnologia', un admin con
--       sesión podía escribir DIRECTO en la tabla —por PostgREST, sin pasar por
--       la RPC— 'VERTICAL', un typo, o una captura sobre un SKU cuyo Excel ya
--       trae tecnología. «Las dos reglas viven en la BASE» era cierto sólo para
--       la RPC. Desde (d), la base las impone POR CUALQUIER CAMINO que escriba
--       la tabla, y la guarda (4)(g) lo prueba escribiendo directo.
--   (e) Le pide a PostgREST que recargue su caché de esquema (`NOTIFY pgrst`,
--       el mismo de la 0036): la API consume la RPC nueva de (b), y el
--       servicio LANZA si PostgREST no la encuentra (PGRST202). Ver (5).
--
-- ----------------------------------------------------------------------------
-- LO QUE ESTA MIGRACIÓN **NO** HACE, y no se re-interpreta
--   · NO toca «Clasificar» (decisión 3): ni `resolver_pendiente`, ni
--     `sincronizar_pendientes_tecnologia`, ni `ingest_snapshot`. Las dos
--     últimas corren dentro de CADA carga de inventario; tocarlas de pasada
--     sería tocar la ingesta, que es el flujo de mayor riesgo del sistema.
--     CONSECUENCIA QUE HAY QUE DECIR: capturar una tecnología aquí NO cierra el
--     pendiente `sku_sin_tecnologia` de la bandeja. Ese pendiente lo decide
--     `sincronizar_pendientes_tecnologia` leyendo `productos.tecnologia` y
--     `clasificacion_v2.tecnologia` (0038, «las dos capas») y NO lee
--     `productos_override`. El SKU seguirá en la bandeja aunque la ficha ya
--     muestre la tecnología capturada. Queda así por decisión, no por olvido.
--   · NO decide la LECTURA. «El Excel gana» tiene dos mitades y aquí vive sólo
--     la de ESCRITURA: la base impide CREAR la captura cuando el Excel trae
--     valor. NO puede impedir que el Excel llegue DESPUÉS: si una carga
--     posterior trae tecnología para un SKU que ya tenía captura activa, la
--     captura sigue `activo = true` en la tabla. La precedencia de lectura
--     para `tecnologia` es la INVERSA de familia/descripción —fuente no vacía
--     > captura— y la tiene que aplicar quien lee (`derivaciones.ts`, otra
--     tarea de este bloque). Sin esa mitad, esta migración es media función
--     (P24).
--   · NO desactiva capturas cuando el Excel se llena: eso exigiría tocar
--     `ingest_snapshot`, que está fuera.
--   · NO impide DOS capturas de tecnología ACTIVAS del mismo SKU escritas
--     directo en la tabla. El candado valida CADA una, pero no hay índice
--     único sobre (sku, campo) activo —`idx_productos_override_sku_activo`
--     (0001:414) no es único— y crearlo no está firmado. La RPC sí desactiva
--     la previa antes de insertar; el lector (`derivaciones.ts`) se queda con
--     la de mayor (editado_en, id).
--   · NO toca `tecnologias.activo`. VERTICAL sigue activa en el catálogo de
--     tecnologías; queda fuera de la lista por el DATO —ningún producto
--     visible la trae— y no por un UPDATE ni por una regla que la nombre (ver
--     «POR QUÉ LA LISTA SE DERIVA», abajo, y la deuda
--     `VERTICAL-FUERA-POR-EL-DATO`).
--   · NO restringe la captura a SKU visibles. Una ficha de una marca excluida
--     del catálogo acepta captura igual que hoy acepta familia y descripción.
--   · NO toca ningún GRANT de `aplicar_override`: `CREATE OR REPLACE` conserva
--     el dueño y los permisos de la función, y la guarda (4) lo MIDE —compara
--     `proacl` antes y después— en vez de volver a escribirlos de memoria.
--   · NO toca los GRANT ni las policies de `productos_override`. El candado
--     (d) es un disparador, no un cambio de permisos: quitarle a
--     `authenticated` el INSERT/UPDATE de tabla movería la matriz que audita
--     `scripts/rls-negativas.mjs`, y eso no está firmado. `authenticated` sigue
--     pudiendo escribir la tabla como hoy; lo que ya no puede es dejar en ella
--     una captura de tecnología que la RPC habría rechazado.
--
-- ----------------------------------------------------------------------------
-- DE QUÉ CUERPO PARTE `aplicar_override`, Y CON QUÉ HONESTIDAD
--
--   En el repo hay UN SOLO `CREATE ... FUNCTION public.aplicar_override`:
--   `0006_b5_dominio.sql:25-66`. Medido con
--       grep -n "aplicar_override" supabase/migrations/*.sql
--   -> 0011, 0012 y 0017 sólo la MENCIONAN en comentarios. El cuerpo de abajo
--   es el de la 0006 con cuatro hunks y ninguno más: las variables nuevas del
--   `DECLARE`, la lista de campos del `IF p_campo NOT IN`, el bloque de
--   `tecnologia` y el `VALUES` que inserta `v_valor` en vez de `p_valor`.
--
--   ✅ YA SE MIDIÓ EN PRODUCCIÓN (lectura de la revisión de
--   FIX-B1; no la hizo quien escribió el cuerpo, que no tenía la
--   herramienta de la base). Lo medido, tal como se reportó:
--       md5(pg_get_functiondef(aplicar_override)) = c2fedb55b036d2e8cce77c53322825af
--         -> ES la huella LF derivada abajo: el vivo es la 0006 byte a byte.
--       CHECK vivo  productos_override_campo_check  = ('familia','descripcion')
--       ACL vivo de aplicar_override = {postgres=X,authenticated=X,service_role=X}
--         (así vino en la cita, sin el otorgante; anon NO la ejecuta)
--       lista viva  (la regla de (b) sobre el dato vivo) = EAS, BRAND2, BRAND1
--       libro       supabase_migrations.schema_migrations termina en 0043
--   La guarda (0) NO se relaja por eso: la medición es de UN momento y el
--   COMMIT de esta migración es de otro. La guarda vuelve a medir AL APLICAR,
--   que es lo único que cubre un cambio entre esa lectura y este archivo.
--
--   Cómo se derivó la huella ANTES de poder medirla (se conserva porque es lo
--   que la guarda (0) acepta, y la variante CRLF sigue siendo la de un replay
--   hecho desde una copia de trabajo de Windows):
--
--     REPLAY LOCAL de 0001->0043 (blobs de git, LF) sobre PostgreSQL 16.10
--     desechable, con un esqueleto mínimo de Supabase (roles anon /
--     authenticated / service_role, esquema auth). No corrieron ahí 0007
--     (storage), 0030 (pgvector), 0032-0035 (dependen de la 0030) ni
--     0037-0038 (abortan sin carga de stock); ninguna de ellas toca
--     `aplicar_override`. Resultado para
--         md5(pg_get_functiondef('public.aplicar_override(text,text,text)'))
--       · cuerpo con finales LF   -> c2fedb55b036d2e8cce77c53322825af
--                                    (prosrc 1 207 bytes, md5 910f1bb3...)
--       · cuerpo con finales CRLF -> 6f8cbee9e5e22e6f296eac0790c1f636
--                                    (prosrc 1 242 bytes = 1 207 + 35 CR)
--     Las dos variantes existen porque una migración aplicada desde una copia
--     de trabajo de Windows viaja con CRLF (`core.eol=native`) y una transcrita
--     por el conector suele viajar con LF —la 0006 se aplicó por el
--     conector (0006:12); la lectura dice que viajó con LF—: el
--     mismo cuerpo, dos huellas. (Un segundo replay, con `postgres`
--     NO superusuario como en Supabase, volvió a dar c2fedb55… para la LF.)
--
--   La guarda (0) convierte esas dos huellas en una PRECONDICIÓN: si el cuerpo
--   vivo no tiene una de ellas, la migración ABORTA antes de pisar nada. Si la
--   guarda pasa, «partir del archivo 0006» y «partir del cuerpo vivo» son la
--   misma cosa byte a byte —y eso ya se vio en producción con la
--   LF—; si no pasa, alguien cambió la función después de esa lectura: se
--   lee el cuerpo vivo, se hace el diff contra 0006:25-66, y este archivo se
--   reescribe PARTIENDO DEL VIVO. La consulta para volver a medir:
--       SELECT md5(pg_get_functiondef(to_regprocedure(
--                'public.aplicar_override(text,text,text)')));
--
-- ----------------------------------------------------------------------------
-- EL CONTRATO QUE LA APLICACIÓN CONSUME (y que esta migración no puede ver)
--
--   public.tecnologias_seleccionables() RETURNS SETOF text
--     · STABLE, SECURITY INVOKER, EXECUTE para `authenticated`; `anon` NO.
--     · Un texto por tecnología: el nombre CANÓNICO de `public.tecnologias`,
--       ordenados por nombre. En SQL se lee con un alias de columna explícito
--       —`FROM public.tecnologias_seleccionables() AS s(nombre)`—, que es como
--       la usan esta migración y `aplicar_override`.
--     · Por PostgREST, `rpc('tecnologias_seleccionables')` debe dar un arreglo
--       plano `["EAS", "BRAND2", "BRAND1"]` (un conjunto de escalares se
--       serializa sin envoltura). ⚠ ESA FORMA NO SE MIDIÓ AQUÍ: no hay PostgREST
--       en la sonda de esta migración. Se eligió SETOF text y no TABLE(...)
--       porque es la forma que ya lee `listTecnologiasSeleccionables`
--       (`src/services/tecnologias.service.ts`, rama `typeof fila === 'string'`);
--       que la llamada real la devuelva así se comprueba con la app contra la
--       base, no con esta guarda.
--     · Sin carga de stock en la base devuelve CERO filas (no es error).
--
--   public.aplicar_override(p_sku text, p_campo text, p_valor text) RETURNS jsonb
--     · p_campo admite ahora 'tecnologia'. Fuera de los tres: 22023 'campo invalido'.
--     · Sin rol admin: 42501 'forbidden' (sin cambio).
--     · p_campo = 'tecnologia' y p_valor NO nulo, EN ESTE ORDEN:
--         1. SQLSTATE 'MXTEC', MESSAGE 'tecnologia_no_seleccionable' — el valor
--            no casa (upper(btrim())) con ninguna de la lista. DETAIL trae las
--            opciones vigentes, para diagnóstico; NO es contrato.
--         2. SQLSTATE 'MXEXL', MESSAGE 'excel_manda' — el Excel ya trae
--            tecnología para ese SKU. DETAIL trae el valor del Excel; NO es
--            contrato.
--         3. Si pasa: guarda el nombre CANÓNICO (no lo tecleado): «  brand1 » se
--            guarda como «BRAND1».
--       (Entre 1 y 2 hay un tercer rechazo que no es de negocio: 21000
--       'tecnologia_ambigua_en_catalogo' si dos nombres del catálogo casaran
--       igual tras upper(btrim()). Es un defecto del catálogo, no del usuario;
--       la app lo trata como error genérico.)
--     · p_campo = 'tecnologia' y p_valor NULO: quita la captura. Siempre se
--       permite, traiga o no traiga tecnología el Excel.
--     · El jsonb de salida es el mismo de siempre —el set ACTIVO del SKU— y
--       ahora puede traer elementos con "campo": "tecnologia".
--     · Por PostgREST los dos códigos llegan en `error.code` ('MXTEC' /
--       'MXEXL') y el texto en `error.message`. La app decide por el CÓDIGO.
--
--   public.productos_override_tecnologia_excel_gana() RETURNS trigger, y el
--   disparador del mismo nombre: BEFORE INSERT OR UPDATE, FOR EACH ROW.
--     · Actúa SÓLO si la fila QUEDA como captura de tecnología ACTIVA:
--       campo = 'tecnologia', activo = true y valor no nulo.
--         - familia y descripción pasan sin tocar;
--         - desactivar (activo = false) pasa SIEMPRE, traiga o no el Excel.
--           Es la forma en que `aplicar_override` «quita»: un UPDATE a
--           activo = false sin INSERT (ver su cuerpo, abajo). En la tabla no
--           hay «valor nulo» que quitar —`valor_editado` es NOT NULL (0001)—:
--           si llegara uno, el candado lo deja pasar para que lo rechace esa
--           restricción con SU código (23502), no con uno de negocio.
--         - un UPDATE que deja la MISMA captura (ya estaba activa, mismo SKU,
--           mismo valor) NO se revalida. A propósito: una captura hecha con el
--           Excel vacío es legítima y tiene que seguir siendo tocable el día
--           que el Excel se llene (ver «NO decide la LECTURA», arriba). No abre
--           hueco: toda captura activa pasó el candado al volverse activa, y
--           el disparador nace en la misma transacción que el CHECK que
--           admite 'tecnologia', así que no hay ninguna anterior sin revisar.
--     · Si actúa: MXTEC/tecnologia_no_seleccionable, 21000/tecnologia_ambigua_
--       en_catalogo, MXEXL/excel_manda —mismos códigos, mensajes, DETAIL y
--       orden que la RPC— y, si pasa, deja en la fila el nombre CANÓNICO.
--     · SECURITY INVOKER: ve lo que ve quien escribe. Hoy `productos`,
--       `snapshots`, `marcas` y `tecnologias` son USING (true) para
--       `authenticated`, así que ve lo mismo que la RPC (DEFINER); la guarda
--       (4)(g) lo ejerce COMO authenticated. Lo que eso deja abierto está en
--       el NOTICE final (7).
--     · Con la RPC es IDEMPOTENTE: la RPC ya inserta el canónico, que vuelve a
--       casar consigo mismo, y el resultado es la misma fila. Las reglas
--       quedan escritas DOS veces —en la RPC, que contesta primero, y en el
--       candado, que cubre todo lo demás—; lo que impide que diverjan en
--       silencio es que la guarda (4) las ejerce con las MISMAS entradas por
--       los dos caminos y exige el mismo código.
--     · Un POST/PATCH directo a /rest/v1/productos_override debería recibir
--       `error.code` 'MXTEC' / 'MXEXL' como la RPC (PostgREST propaga el
--       SQLSTATE). ⚠ NO MEDIDO: aquí no hay PostgREST.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ LA LISTA SE DERIVA Y NO SE ESCRIBE
--
--   «EAS, BRAND2, BRAND1» escrito como literal sería una guarda con testigo
--   concreto: caduca el día que el Excel traiga una cuarta, y al caducar
--   estorba. La regla que sí dura es la que se describió: se ofrece lo que
--   el catálogo MUESTRA. `tecnologias_seleccionables()` devuelve cada
--   tecnología ACTIVA de `public.tecnologias` que usa (por `productos.
--   tecnologia`, comparando upper(btrim())) al menos un producto VISIBLE:
--     · del snapshot de stock VIGENTE —el de mayor (created_at, id), el mismo
--       desempate que `vigente.service.ts` y que la 0038—, lo que deja fuera a
--       los REMANENTES;
--     · cuya marca NO está excluida del catálogo (`marcas.
--       excluida_del_catalogo`, la regla-dato de la 0039).
--
--   ⚠ Y HAY QUE DECIR POR QUÉ VERTICAL NO SALE HOY, porque no es por donde
--   parece (P25). La última cifra escrita en el repo es de septiembre,
--   contra el vigente del momento (`src/services/inventory.service.ts:108-116`):
--   `productos.tecnologia` estaba poblada en casi todos los productos del vigente
--   —BRAND1, EAS y BRAND2— y nula en el resto. O sea que ese día NINGÚN producto
--   del vigente traía «VERTICAL» en
--   la columna de tecnología: VERTICAL quedaba fuera por eso, NO porque el
--   filtro de marca excluida la quitara. El filtro está por la regla (lo que
--   no se ve no se ofrece) y probablemente hoy no mueve la lista. En su momento
--   la lista viva se midió (arriba): EAS, BRAND2, BRAND1 — VERTICAL fuera. Si
--   el filtro de marca la mueve o no, esa lectura no lo dice: la guarda (4)
--   imprime al aplicar la lista CON y SIN ese filtro, para que el log diga
--   cuál de las dos cosas pasó en vez de suponerlo.
--
--   VERTICAL QUEDA FUERA POR EL DATO, NO POR UNA REGLA — y se dice como deuda
--   con nombre: `VERTICAL-FUERA-POR-EL-DATO`. Ni la lista, ni la RPC, ni el
--   candado nombran VERTICAL. La decisión 2 de producto («VERTICAL no») se cumple
--   HOY porque ningún producto visible la trae. La guarda (4)(d) ABORTA si al
--   aplicar la lista la ofreciera, pero eso vale sólo en el instante del
--   COMMIT: el día que una carga del Excel traiga VERTICAL en
--   `productos.tecnologia` de un producto VISIBLE, la lista la ofrecerá y la
--   base la aceptará, sin que nada avise. El disparador de la deuda es esa
--   carga; qué hacer entonces —desactivarla en `public.tecnologias`,
--   excluirla por una regla que la nombre, o aceptarla— es decisión de producto,
--   no de esta migración.
--
-- ----------------------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. Amplía un CHECK (el conjunto sólo CRECE: toda fila viva ya lo
--      cumple), crea una función de lectura, reemplaza otra y crea un
--      disparador de validación con su función. Cero DROP de tabla, cero
--      TRUNCATE, y ningún UPDATE de filas de negocio que SOBREVIVA a la
--      transacción (el único que hay, abajo, se revierte siempre).
--      HAY INSERT, UPDATE y DELETE, y no se esconden: la guarda (4) EJERCE la
--      RPC contra SKU reales del vigente como un admin simulado (mismo molde
--      que 0020:762-800) y escribe a lo más DOS filas de sonda en
--      `productos_override`, con `editado_por = '0044:sonda'`, que borra POR
--      `id` en el mismo bloque. Antes y después compara la huella de TODA la
--      tabla (id + activo de cada fila): si la sonda dejara rastro o tocara
--      una fila real, aborta y la transacción se revierte.
--      Hay además dos INSERT que FALLAN a propósito —prueban el CHECK con un
--      SKU que no existe, dentro de un subbloque que se revierte—: no dejan
--      fila ni en el camino feliz ni en el infeliz.
--      Y la sonda del CANDADO (4)(g) escribe DIRECTO en `productos_override`
--      —es el camino que tiene que probar— y hace UN `UPDATE public.productos
--      SET tecnologia` sobre un SKU hueco, para simular una carga posterior
--      del Excel. Todo eso vive en subbloques que terminan SIEMPRE con un RAISE
--      centinela (MXSND), así que se revierte pase lo que pase; la huella de
--      `productos_override` y la `tecnologia` de esa fila de `productos` se
--      comparan antes y después, y si difieren la migración aborta.
--
--   2. ¿Se puede deshacer?
--      SÍ, con una condición. Volver atrás es `DROP TRIGGER
--      productos_override_tecnologia_excel_gana ON public.productos_override`,
--      `DROP FUNCTION public.productos_override_tecnologia_excel_gana()`,
--      re-aplicar el `CREATE OR
--      REPLACE` de 0006:25-66, `DROP FUNCTION public.tecnologias_seleccionables()`
--      y el CHECK de dos valores. La condición: ese CHECK sólo se puede volver
--      a poner si NINGUNA fila tiene `campo = 'tecnologia'`, así que deshacerlo
--      después de que alguien capture obliga a decidir qué pasa con esas
--      capturas —desactivarlas no basta: el CHECK mira TODAS las filas, no sólo
--      las activas—.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada. `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, `DROP TRIGGER IF
--      EXISTS` + `CREATE TRIGGER` y `CREATE OR REPLACE` son idempotentes, y la
--      guarda (0) reconoce sus propios cuerpos —el de `aplicar_override` y el
--      de la función del candado— por la marca `[FIX-B1 · 0044]` y lo dice en
--      vez de abortar. En esa rama imprime además la huella viva de
--      `aplicar_override` contra la de este archivo (7dbc59d1… LF,
--      0bae1819… CRLF, medidas en el replay local), sin abortar por ella.
--
--   Y las tres del aplicador (`scripts/aplicar-migracion.mjs`, S5):
--     · ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible? NO (arriba).
--     · ¿Radio de impacto acotado? SÍ: tres funciones (una de ellas de
--       disparador), un disparador y un CHECK; las únicas escrituras en filas
--       son las de sonda, con huella antes/después.
--     · ¿Decide algo por AUSENCIA de datos? NO. Sin carga de stock la sonda NO
--       corre y lo dice como «NO PROBADO»; no cierra ni desactiva nada.
--
-- CUÁNDO: fuera de una ventana de ingesta. No fija `lock_timeout`, el ALTER
-- TABLE de (1) toma ACCESS EXCLUSIVE sobre `productos_override` hasta el
-- COMMIT, y la sonda G2g escribe una fila de `productos` que la ingesta
-- también escribe. Detalle en el NOTICE final, (11).
--
-- Aplicar con:
--   node scripts/verificar-migracion.mjs supabase/migrations/0044_fixb1_tecnologia_editable_excel_gana.sql
--   node --env-file=.env.db scripts/aplicar-migracion.mjs \
--     supabase/migrations/0044_fixb1_tecnologia_editable_excel_gana.sql \
--     --irreversibilidad="No borra ni cierra nada: amplia un CHECK que solo
--       crece, crea una funcion de lectura, reemplaza aplicar_override y crea
--       un disparador de validacion en productos_override. La guarda (0)
--       ABORTA si el cuerpo vivo no tiene la huella de la 0006. La sonda de la
--       RPC escribe a lo mas dos filas con editado_por 0044:sonda y las borra
--       por id; la del candado escribe directo en subbloques que siempre se
--       revierten. Compara la huella de toda la tabla antes y despues."
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (0) PROCEDENCIA — ESTA GUARDA SÍ ABORTA, y es la diferencia con la 0038.
--
-- La 0038 sólo INFORMABA si el md5 no empataba, para no romper una
-- re-aplicación de sí misma (0038:214-216). Aquí la re-aplicación se reconoce
-- por la marca de esta migración, y lo que queda fuera de los dos casos
-- conocidos SÍ aborta, porque el riesgo es otro: el cuerpo de abajo se armó
-- desde el ARCHIVO 0006 y no desde el vivo (ver cabecera). Si alguien cambió
-- la función viva después de la 0006, este `CREATE OR REPLACE` borraría ese
-- cambio en silencio. Así que:
--   · huella LF o CRLF de la 0006  -> procede (es el punto de partida);
--   · ya trae la marca de la 0044  -> procede (re-aplicación, idempotente);
--   · cualquier otra cosa          -> ABORTA, y dice qué medir.
--
-- Además deja anotado en la transacción el ACL, el search_path y el
-- SECURITY DEFINER de ANTES, para que la guarda (4) compare contra lo que
-- había y no contra lo que uno cree que había.
-- ----------------------------------------------------------------------------
DO $procedencia0044$
DECLARE
  v_oid        oid;
  v_def        text;
  v_md5        text;
  v_esperado_lf   constant text := 'c2fedb55b036d2e8cce77c53322825af';
  v_esperado_crlf constant text := '6f8cbee9e5e22e6f296eac0790c1f636';
  -- La huella del cuerpo que ESTE archivo escribe, medida —no derivada— con
  -- md5(pg_get_functiondef(...)) tras aplicarlo en el replay local sobre
  -- PostgreSQL 16.10, con finales LF y con CRLF. Sólo se
  -- IMPRIME en la rama de re-aplicación: no aborta por ella (ver abajo).
  v_propio_lf     constant text := '7dbc59d14a1940ee6141eb9f4355e0cc';
  v_propio_crlf   constant text := '0bae1819a824c44f67fc2957823ecaf1';
  v_marca      constant text := '[FIX-B1 · 0044]';
  v_sel_oid    oid;
  v_trg_oid    oid;
  v_trg_n      integer;
  v_trg_nombres text;
  v_attnum     int2;
  v_checks     integer;
  v_check_nom  text;
  v_check_def  text;
BEGIN
  -- ---- aplicar_override: tiene que existir con esta firma de TIPOS.
  v_oid := to_regprocedure('public.aplicar_override(text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0044: no existe public.aplicar_override(text,text,text). Esta migracion REEMPLAZA un cuerpo existente (el de la 0006); crear uno nuevo sin que nadie lo decidiera es peor que no aplicar. Abortando.';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_md5 := md5(v_def);

  IF v_md5 = v_esperado_lf OR v_md5 = v_esperado_crlf THEN
    RAISE NOTICE '0044 - PROCEDENCIA: el cuerpo vivo de aplicar_override ES el de la 0006 (md5 %, finales %). Es el punto de partida declarado en la cabecera, medido aqui y no supuesto.',
      v_md5, CASE WHEN v_md5 = v_esperado_lf THEN 'LF' ELSE 'CRLF' END;
  ELSIF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE '0044 - PROCEDENCIA: el cuerpo vivo YA es el de esta migracion (trae la marca de la 0044, md5 %). Es una RE-APLICACION: se reemplaza por el mismo cuerpo.', v_md5;
    -- La marca dice QUIEN escribio el cuerpo, no que siga intacto: alguien
    -- pudo editarlo conservandola. Se coteja la huella viva contra la de este
    -- archivo y se DICE; no se aborta, porque la re-aplicacion es idempotente
    -- por diseno y porque la huella tambien cambia con los finales de linea
    -- (hay dos medidas) y solo se midio en la 16.10 local. Si dice NO
    -- COINCIDE, el CREATE OR REPLACE de abajo pisa esa diferencia igual, y
    -- este aviso es lo que queda en el log para que no se pierda en silencio.
    RAISE NOTICE '0044 - PROCEDENCIA (re-aplicacion): md5 vivo de aplicar_override % (% bytes) contra el del cuerpo de este archivo % [LF] / % [CRLF] -> %. Si NO COINCIDE, el vivo traia cambios que no son de este archivo y el CREATE OR REPLACE de abajo los PISA al hacer COMMIT: esta linea es la unica huella que queda de ellos.',
      v_md5, octet_length(v_def), v_propio_lf, v_propio_crlf,
      CASE WHEN v_md5 = v_propio_lf   THEN 'COINCIDE (LF)'
           WHEN v_md5 = v_propio_crlf THEN 'COINCIDE (CRLF)'
           ELSE 'NO COINCIDE' END;
  ELSE
    RAISE EXCEPTION '0044: el cuerpo VIVO de aplicar_override no es el de la 0006 ni el de la 0044 (md5 vivo %, esperados % [LF] o % [CRLF], % bytes). Alguien lo cambio despues de la 0006, o el conector lo transcribio distinto. NO se pisa: leer el vivo con pg_get_functiondef, hacer el diff contra 0006:25-66 y reescribir esta migracion PARTIENDO DEL VIVO. Abortando.',
      v_md5, v_esperado_lf, v_esperado_crlf, octet_length(v_def);
  END IF;

  -- Lo que CREATE OR REPLACE debe conservar, anotado para la guarda (4).
  -- Variables de transaccion con prefijo propio: mismo molde que la 0011
  -- (`demo.mig0011_universo_vacio`).
  PERFORM set_config('demo.mig0044_ao_acl',
                     coalesce((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_oid), '<null>'), true);
  PERFORM set_config('demo.mig0044_ao_config',
                     coalesce((SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = v_oid), '<null>'), true);
  PERFORM set_config('demo.mig0044_ao_secdef',
                     (SELECT p.prosecdef::text FROM pg_proc p WHERE p.oid = v_oid), true);

  -- ---- tecnologias_seleccionables: o no existe, o es la de esta migracion.
  v_sel_oid := to_regprocedure('public.tecnologias_seleccionables()');
  IF v_sel_oid IS NOT NULL
     AND position(v_marca IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_sel_oid)) = 0 THEN
    RAISE EXCEPTION '0044: ya existe public.tecnologias_seleccionables() y NO la creo esta migracion (no trae su marca). Reemplazarla borraria la definicion de alguien mas. Abortando.';
  END IF;

  -- ---- El candado (3-bis): su funcion, igual que la lista, o no existe o es
  -- la de esta migracion. Y los disparadores que la tabla ya tenga se dicen
  -- en el log: la medicion dice que NO habia ninguno, y si ahora
  -- hay, el orden de disparo (alfabetico entre los BEFORE) deja de ser trivial.
  v_trg_oid := to_regprocedure('public.productos_override_tecnologia_excel_gana()');
  IF v_trg_oid IS NOT NULL
     AND position(v_marca IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_trg_oid)) = 0 THEN
    RAISE EXCEPTION '0044: ya existe public.productos_override_tecnologia_excel_gana() y NO la creo esta migracion (no trae su marca). Reemplazarla borraria la definicion de alguien mas. Abortando.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.productos_override'::regclass
                AND NOT t.tgisinternal
                AND t.tgname = 'productos_override_tecnologia_excel_gana'
                AND t.tgfoid IS DISTINCT FROM v_trg_oid) THEN
    RAISE EXCEPTION '0044: ya hay un disparador productos_override_tecnologia_excel_gana en productos_override que NO llama a la funcion de esta migracion. El DROP TRIGGER IF EXISTS de abajo lo borraria. Abortando.';
  END IF;
  SELECT count(*), coalesce(string_agg(t.tgname, ', ' ORDER BY t.tgname), '(ninguno)')
    INTO v_trg_n, v_trg_nombres
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.productos_override'::regclass
     AND NOT t.tgisinternal;
  RAISE NOTICE '0044 - PROCEDENCIA: disparadores propios de productos_override ANTES de esta migracion: % (%)', v_trg_n, v_trg_nombres;

  -- Y los de public.productos: la sonda G2g de la guarda (4) le hace UN
  -- UPDATE a productos.tecnologia —en un subbloque que se revierte—, y ese
  -- UPDATE DISPARA lo que la tabla tenga. En el replay local 0001->0043 hay
  -- uno, before_update_sku (0001:468-472, protege el SKU). Si en la base
  -- donde se aplica hay otros, el log los nombra ANTES de que la sonda los
  -- dispare. Se imprime nombre -> funcion [tgenabled: O encendido, D apagado,
  -- R/A replica/siempre].
  SELECT count(*),
         coalesce(string_agg(t.tgname || ' -> ' || t.tgfoid::regproc::text || ' [' || t.tgenabled::text || ']',
                             ', ' ORDER BY t.tgname), '(ninguno)')
    INTO v_trg_n, v_trg_nombres
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.productos'::regclass
     AND NOT t.tgisinternal;
  RAISE NOTICE '0044 - PROCEDENCIA: disparadores propios de public.productos (si hay datos, la sonda G2g le hace un UPDATE que se revierte): % (%)', v_trg_n, v_trg_nombres;

  -- ---- El CHECK de `campo`: exactamente UNO, con el nombre de la 0001.
  -- Se localiza por la COLUMNA que restringe (conkey), no por el texto de su
  -- definicion: un LIKE sobre pg_get_constraintdef seria un contrato con el
  -- formateador del catalogo (P21). Si hubiera DOS checks sobre `campo`, el
  -- `DROP ... IF EXISTS` de abajo solo alcanzaria al que se llama asi y el otro
  -- seguiria rechazando 'tecnologia' desde la sombra (mismo razonamiento que
  -- la 0043 con `perfiles.rol`).
  SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
   WHERE a.attrelid = 'public.productos_override'::regclass AND a.attname = 'campo' AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RAISE EXCEPTION '0044: public.productos_override no tiene columna campo. Abortando.';
  END IF;

  SELECT count(*), min(c.conname), min(pg_get_constraintdef(c.oid))
    INTO v_checks, v_check_nom, v_check_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.productos_override'::regclass
     AND c.contype = 'c'
     AND c.conkey @> ARRAY[v_attnum];

  IF v_checks <> 1 OR v_check_nom IS DISTINCT FROM 'productos_override_campo_check' THEN
    RAISE EXCEPTION '0044: se esperaba EXACTAMENTE un CHECK sobre productos_override.campo, llamado productos_override_campo_check, y hay % (el primero por nombre: %). Reemplazar a ciegas dejaria otro CHECK rechazando tecnologia. Abortando.',
      v_checks, coalesce(v_check_nom, '(ninguno)');
  END IF;

  RAISE NOTICE '0044 - PROCEDENCIA: CHECK vivo de campo = %', v_check_def;
END $procedencia0044$;

-- ----------------------------------------------------------------------------
-- (1) EL CHECK. Se tira y se recrea —no se puede «añadir un valor» a un
--     CHECK—, igual que la 0043 con `perfiles_rol_check`. El re-escaneo de la
--     tabla es seguro: el conjunto sólo CRECE, así que toda fila viva lo cumple.
-- ----------------------------------------------------------------------------
ALTER TABLE public.productos_override DROP CONSTRAINT IF EXISTS productos_override_campo_check;
ALTER TABLE public.productos_override
  ADD CONSTRAINT productos_override_campo_check
  CHECK (campo IN ('familia','descripcion','tecnologia'));

COMMENT ON COLUMN public.productos_override.campo IS
  '[0001 · FIX-B1 0044] familia | descripcion | tecnologia. Para familia y descripcion la captura GANA sobre la fuente. Para tecnologia es AL REVES —«el Excel gana»—: una captura ACTIVA solo entra si productos.tecnologia del SKU esta vacia (MXEXL si no) y si el valor esta en tecnologias_seleccionables() (MXTEC si no). Lo imponen aplicar_override Y el disparador productos_override_tecnologia_excel_gana, asi que vale tambien para quien escriba la tabla directo. La base impide CREARLA con el Excel lleno, pero NO puede impedir que el Excel se llene despues: una captura puede quedar activa con el Excel ya poblado, y la LECTURA debe dar precedencia al Excel. Capturar tecnologia NO cierra el pendiente sku_sin_tecnologia (sincronizar_pendientes_tecnologia no lee esta tabla).';

-- ----------------------------------------------------------------------------
-- (2) LA LISTA — única fuente de «qué tecnologías se pueden elegir».
--
--     SECURITY INVOKER a propósito: la lee cualquier usuario con sesión con SUS
--     permisos, y todo lo que consulta (`snapshots`, `productos`, `marcas`,
--     `tecnologias`) ya lo lee hoy `authenticated` desde el portal. No hace
--     falta elevar privilegios para leer lo que ya es legible; la guarda (4)
--     lo comprueba LEYENDO como `authenticated`, no suponiéndolo —y si la
--     sesión que aplica no puede asumir ese rol, lo declara «NO PROBADO» en
--     vez de darlo por bueno—.
--
--     Dentro de `aplicar_override` (SECURITY DEFINER) la llama el dueño, así
--     que la RPC ve la misma lista que la API mientras la RLS de esas tablas
--     siga siendo `USING (true)` para `authenticated`.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tecnologias_seleccionables()
RETURNS SETOF text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  -- [FIX-B1 · 0044] Tecnologias que se pueden capturar en el portal: las
  -- ACTIVAS del catalogo que usa al menos un producto VISIBLE —del snapshot
  -- de stock vigente y de una marca no excluida del catalogo—. La comparacion
  -- es upper(btrim()) porque productos.tecnologia es texto CRUDO del Excel
  -- (0036) y el catalogo guarda el nombre canonico en mayusculas (0014).
  WITH vigente AS (
    SELECT s.id
      FROM public.snapshots s
     WHERE s.fuente = 'stock'
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 1
  )
  SELECT t.nombre
    FROM public.tecnologias t
   WHERE t.activo
     AND EXISTS (
           SELECT 1
             FROM public.productos p
             JOIN vigente v ON v.id = p.snapshot_id
             LEFT JOIN public.marcas m ON m.id = p.marca_id
            WHERE NOT coalesce(m.excluida_del_catalogo, false)
              AND upper(btrim(p.tecnologia)) = upper(btrim(t.nombre))
         )
   ORDER BY t.nombre;
$fn$;

-- Una funcion NUEVA nace abierta a `anon` por el `pg_default_acl` de Supabase,
-- que la nombra A EL; `REVOKE ... FROM PUBLIC` no lo toca. Por eso son dos
-- REVOKE y no uno (mismo molde que 0006:68-70).
REVOKE ALL    ON FUNCTION public.tecnologias_seleccionables() FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.tecnologias_seleccionables() FROM anon;
GRANT EXECUTE ON FUNCTION public.tecnologias_seleccionables() TO authenticated;

COMMENT ON FUNCTION public.tecnologias_seleccionables() IS
  '[FIX-B1 · 0044] UNICA fuente de la lista de tecnologias que se pueden capturar en el portal. Devuelve SETOF text (leer con AS s(nombre)), un nombre canonico por tecnologia ACTIVA de public.tecnologias que usa —por productos.tecnologia, upper(btrim())— al menos un producto VISIBLE: del snapshot de stock vigente (mayor created_at, id) y de una marca con excluida_del_catalogo = false. Sin carga de stock devuelve cero filas. La consume aplicar_override (MXTEC si el valor no esta aqui) y la API; no se copia en TypeScript.';

-- ----------------------------------------------------------------------------
-- (3) aplicar_override. Cuerpo de 0006:25-66 con cuatro hunks: las variables
--     nuevas del `DECLARE`, la lista de campos (se ve a simple vista:
--     'tecnologia' es el tercer valor), el bloque de tecnología y el `VALUES`
--     que inserta `v_valor`; los tres que no son la lista llevan la marca
--     `[FIX-B1 · 0044]`. Lo demás —la guarda `is_admin()`, el
--     22023 de campo inválido, la desactivación del activo previo, el «NULL =
--     quitar» y el jsonb del set activo— es el de la 0006 sin tocar.
--     Firma, SECURITY DEFINER y search_path idénticos: `CREATE OR REPLACE`
--     revierte a su valor por omisión todo atributo que no se escriba.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_override(
  p_sku text, p_campo text, p_valor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_result jsonb;
  -- [FIX-B1 · 0044] lo que se inserta: p_valor tal cual para familia y
  -- descripcion; el nombre CANONICO para tecnologia.
  v_valor    text := p_valor;
  v_canon    text;
  v_casan    integer;
  v_opciones text;
  v_excel    text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_campo NOT IN ('familia','descripcion','tecnologia') THEN
    RAISE EXCEPTION 'campo invalido' USING errcode = '22023';
  END IF;

  -- [FIX-B1 · 0044] TECNOLOGIA: la captura solo LLENA HUECOS («el Excel gana»).
  -- Dos rechazos, en este orden, con codigos propios para que la app decida
  -- por el CODIGO y no por el texto:
  --   MXTEC  el valor no esta en tecnologias_seleccionables() (VERTICAL, un
  --          typo, una tecnologia que ningun producto visible usa).
  --   MXEXL  el Excel ya trae tecnologia para este SKU.
  -- Quitar (p_valor NULL) no pasa por aqui: se permite siempre.
  -- Lo que esto NO cubre: que el Excel llegue DESPUES de la captura. Eso lo
  -- resuelve la LECTURA (fuente no vacia > captura), no esta funcion.
  IF p_campo = 'tecnologia' AND p_valor IS NOT NULL THEN
    SELECT min(s.nombre), count(*)
      INTO v_canon, v_casan
      FROM public.tecnologias_seleccionables() AS s(nombre)
     WHERE upper(btrim(s.nombre)) = upper(btrim(p_valor));

    IF v_casan = 0 THEN
      SELECT coalesce(string_agg(s.nombre, ', ' ORDER BY s.nombre), '(ninguna)')
        INTO v_opciones
        FROM public.tecnologias_seleccionables() AS s(nombre);
      RAISE EXCEPTION USING
        ERRCODE = 'MXTEC',
        MESSAGE = 'tecnologia_no_seleccionable',
        DETAIL  = 'Se puede elegir: ' || v_opciones;
    ELSIF v_casan > 1 THEN
      -- El indice unico de `tecnologias` es sobre lower(nombre), no sobre
      -- lower(btrim(nombre)): dos nombres que solo difieren en espacios
      -- casarian a la vez. No se elige uno al azar: es un defecto del
      -- catalogo y se dice como tal.
      RAISE EXCEPTION 'tecnologia_ambigua_en_catalogo' USING errcode = '21000';
    END IF;

    SELECT p.tecnologia INTO v_excel
      FROM public.productos p
     WHERE p.sku = p_sku;

    IF btrim(coalesce(v_excel, '')) <> '' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'MXEXL',
        MESSAGE = 'excel_manda',
        DETAIL  = 'El Excel ya trae la tecnologia de este SKU: ' || btrim(v_excel);
    END IF;

    v_valor := v_canon;
  END IF;

  UPDATE public.productos_override
     SET activo = false
   WHERE sku = p_sku AND campo = p_campo AND activo = true;

  -- p_valor NULL = "quitar override": solo desactiva (arriba); no inserta
  -- ningún registro nuevo, así el set activo que se regresa abajo queda SIN
  -- este campo y `efectivas()` cae de vuelta al valor de la fuente.
  IF p_valor IS NOT NULL THEN
    INSERT INTO public.productos_override
      (sku, campo, valor_editado, editado_por, activo)
    VALUES (p_sku, p_campo, v_valor, v_actor, true);  -- [FIX-B1 · 0044] v_valor
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id', o.id, 'sku', o.sku, 'campo', o.campo,
           'valor_editado', o.valor_editado,
           'editado_en', o.editado_en, 'activo', o.activo))
    INTO v_result
    FROM public.productos_override o
   WHERE o.sku = p_sku AND o.activo = true;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.aplicar_override(text,text,text) IS
  '[0006 · FIX-B1 0044] Captura atomica de familia, descripcion o tecnologia (solo admin). NULL = quitar. Para tecnologia: MXTEC/tecnologia_no_seleccionable si el valor no esta en tecnologias_seleccionables(); MXEXL/excel_manda si productos.tecnologia del SKU no esta vacia; si pasa, guarda el nombre canonico. Quitar siempre se permite.';

-- ----------------------------------------------------------------------------
-- (3-bis) EL CANDADO DE TABLA — las mismas dos reglas, por CUALQUIER camino.
--
--   La RPC de arriba no es el único camino a la tabla: `authenticated` tiene
--   INSERT y UPDATE de TABLA sobre `productos_override` y sus policies sólo
--   piden `is_admin()` (medido, ver cabecera). Sin esto, un
--   admin con sesión escribe por PostgREST 'VERTICAL' o una captura sobre un
--   SKU con Excel, y ninguna de las dos reglas lo ve.
--
--   Cuándo actúa, cuándo no y por qué: está en la cabecera, en el contrato de
--   esta función. En corto: sólo cuando la fila QUEDA como captura de
--   tecnología ACTIVA con valor; desactivar pasa siempre; y un UPDATE que
--   deja la misma captura no se revalida.
--
--   SECURITY INVOKER a propósito, como la lista: no necesita ver nada que
--   `authenticated` no vea ya. Y SIN EXECUTE para PUBLIC, anon ni
--   authenticated (el dueño y service_role lo conservan por el default ACL,
--   igual que con los disparadores de la 0006; da lo mismo, porque llamada
--   fuera de un disparador la función falla sola: «trigger functions can
--   only be called as triggers», medido). Un disparador no exige EXECUTE a
--   quien escribe la tabla —Postgres lo revisa al crear el disparador, no al
--   dispararlo—, así que revocarlo no apaga el candado; sólo impide llamarla
--   como función suelta (mismo molde que 0006:82-91). La
--   guarda (4)(g) lo comprueba escribiendo COMO authenticated sin ese
--   EXECUTE: si el candado dependiera de él, contestaría 42501 y no MXTEC.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.productos_override_tecnologia_excel_gana()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_canon    text;
  v_casan    integer;
  v_opciones text;
  v_excel    text;
BEGIN
  -- [FIX-B1 · 0044] Candado de tabla de «el Excel gana». Las MISMAS dos
  -- reglas que aplicar_override, con los mismos codigos, mensajes y orden.

  -- Familia y descripcion no son asunto de este candado.
  IF NEW.campo IS DISTINCT FROM 'tecnologia' THEN
    RETURN NEW;
  END IF;

  -- Desactivar pasa SIEMPRE: es como aplicar_override «quita» (UPDATE a
  -- activo = false, sin INSERT), y tiene que poder hacerse aunque el Excel
  -- ya traiga tecnologia. Un valor nulo tampoco se revisa aqui: valor_editado
  -- es NOT NULL (0001) y esa restriccion lo rechaza con su propio codigo.
  IF NOT coalesce(NEW.activo, false) OR NEW.valor_editado IS NULL THEN
    RETURN NEW;
  END IF;

  -- Un UPDATE que deja la MISMA captura activa (mismo SKU, mismo valor) no
  -- crea nada nuevo y no se revalida: una captura hecha con el Excel vacio
  -- es legitima y tiene que seguir siendo tocable cuando el Excel se llene.
  IF TG_OP = 'UPDATE'
     AND OLD.campo = 'tecnologia'
     AND OLD.activo
     AND OLD.sku = NEW.sku
     AND OLD.valor_editado = NEW.valor_editado THEN
    RETURN NEW;
  END IF;

  -- Regla 1 · MXTEC: el valor tiene que estar en la lista.
  SELECT min(s.nombre), count(*)
    INTO v_canon, v_casan
    FROM public.tecnologias_seleccionables() AS s(nombre)
   WHERE upper(btrim(s.nombre)) = upper(btrim(NEW.valor_editado));

  IF v_casan = 0 THEN
    SELECT coalesce(string_agg(s.nombre, ', ' ORDER BY s.nombre), '(ninguna)')
      INTO v_opciones
      FROM public.tecnologias_seleccionables() AS s(nombre);
    RAISE EXCEPTION USING
      ERRCODE = 'MXTEC',
      MESSAGE = 'tecnologia_no_seleccionable',
      DETAIL  = 'Se puede elegir: ' || v_opciones;
  ELSIF v_casan > 1 THEN
    RAISE EXCEPTION 'tecnologia_ambigua_en_catalogo' USING errcode = '21000';
  END IF;

  -- Regla 2 · MXEXL: si el Excel ya trae tecnologia para este SKU, manda el Excel.
  SELECT p.tecnologia INTO v_excel
    FROM public.productos p
   WHERE p.sku = NEW.sku;

  IF btrim(coalesce(v_excel, '')) <> '' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'MXEXL',
      MESSAGE = 'excel_manda',
      DETAIL  = 'El Excel ya trae la tecnologia de este SKU: ' || btrim(v_excel);
  END IF;

  -- Pasa: se guarda el nombre CANONICO, no lo tecleado. Si quien escribe es
  -- la RPC, ya viene canonico y esto no cambia nada (idempotente).
  NEW.valor_editado := v_canon;
  RETURN NEW;
END;
$fn$;

-- Nadie la llama como funcion: se dispara sola. Se revoca a PUBLIC, anon y
-- authenticated por el `pg_default_acl` de Supabase, que nombra a los dos
-- ultimos POR NOMBRE (0006:82-91, 0028:242).
REVOKE ALL ON FUNCTION public.productos_override_tecnologia_excel_gana() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.productos_override_tecnologia_excel_gana() FROM anon, authenticated;

COMMENT ON FUNCTION public.productos_override_tecnologia_excel_gana() IS
  '[FIX-B1 · 0044] Funcion del disparador productos_override_tecnologia_excel_gana. Si la fila queda como captura de tecnologia ACTIVA con valor, aplica las mismas dos reglas que aplicar_override —MXTEC/tecnologia_no_seleccionable contra tecnologias_seleccionables() y MXEXL/excel_manda si productos.tecnologia del SKU no esta vacia— y deja el nombre canonico. Desactivar pasa siempre; un UPDATE que deja la misma captura activa no se revalida. SECURITY INVOKER, sin EXECUTE para PUBLIC, anon ni authenticated (un disparador no lo necesita para dispararse).';

DROP TRIGGER IF EXISTS productos_override_tecnologia_excel_gana ON public.productos_override;
CREATE TRIGGER productos_override_tecnologia_excel_gana
  BEFORE INSERT OR UPDATE ON public.productos_override
  FOR EACH ROW EXECUTE FUNCTION public.productos_override_tecnologia_excel_gana();

COMMENT ON TRIGGER productos_override_tecnologia_excel_gana ON public.productos_override IS
  '[FIX-B1 · 0044] Candado de «el Excel gana» a nivel de TABLA: impone MXTEC y MXEXL a cualquier INSERT o UPDATE que deje una captura de tecnologia activa, venga de aplicar_override o de una escritura directa (authenticated tiene INSERT/UPDATE de tabla y las policies solo piden is_admin()). Desactivar siempre pasa.';

-- ----------------------------------------------------------------------------
-- (4) LA GUARDA — mide la COSA, no su historia.
--
--   (a) El CHECK quedó UNO, con 'tecnologia' dentro, y se comporta: acepta
--       'tecnologia' y rechaza 'marca' (probado con INSERT, sin datos).
--   (b) aplicar_override conservó ACL, search_path y SECURITY DEFINER —
--       comparados contra lo que la guarda (0) anotó ANTES—, trae los
--       fragmentos nuevos y los viejos, anon no la ejecuta y authenticated sí.
--   (c) tecnologias_seleccionables: STABLE, INVOKER, sin EXECUTE para anon ni
--       para PUBLIC, con EXECUTE para authenticated; y LEÍDA como
--       `authenticated` da lo mismo que leída por el dueño.
--   (d) La lista: se imprime con su denominador, CON y SIN el filtro de marca
--       excluida; VERTICAL no puede estar (decisión 2 de producto); se coteja con
--       su definición —nada inactivo, nada que ningún producto visible use, y
--       nada que falte—; y si hay productos en el vigente, no puede salir vacía.
--   (e) LA SONDA: la RPC se ejerce contra SKU REALES del vigente como un admin
--       simulado, y cada rechazo se comprueba por CÓDIGO y por MENSAJE. La
--       tabla termina con la misma huella con la que empezó. Lo que no se pudo
--       ejercer no se calla: suma al contador «NO PROBADO».
--   (g) EL CANDADO: el disparador existe con la forma declarada, y se ejerce
--       por el camino del hallazgo —escritura DIRECTA en la tabla, COMO
--       authenticated con sesión de admin— con las mismas entradas que (e)
--       le dio a la RPC: VERTICAL -> MXTEC, Excel lleno -> MXEXL, un hueco
--       pasa con el nombre canónico, y desactivar pasa aunque el Excel se
--       haya llenado después. Y el atajo de «misma captura» del candado se
--       ejerce cláusula por cláusula: cambiar el valor (G2e), reactivar
--       (G2f), moverla a otro SKU (G2h) y convertir en tecnología una fila de
--       otro campo (G2i) NO pueden colarse por él. La quinta cláusula,
--       `TG_OP = 'UPDATE'`, NO se ejerce, y es a propósito: su mutante es
--       EQUIVALENTE. En un INSERT, OLD es NULL (PG 11+; antes, leerlo en un
--       INSERT era un error), así que `OLD.campo = 'tecnologia'` ya da NULL
--       y el atajo no se toma con la cláusula ni sin ella; en un UPDATE la
--       cláusula es verdadera. Ninguna escritura distingue una función de la
--       otra, así que no hay prueba que pueda ponerla en rojo. Va antes de
--       (f) y después de (e) porque usa los SKU que (e) eligió.
--   (f) El NOTICE final: lo que esta migración no puede ver desde aquí.
-- ----------------------------------------------------------------------------
DO $guarda0044$
DECLARE
  v_marca        constant text := '[FIX-B1 · 0044]';
  v_actor_sonda  constant text := '0044:sonda';
  v_oid          oid;
  v_sel_oid      oid;
  v_src          text;
  v_f            text;
  v_frag_nuevos  text[] := ARRAY[
    '[FIX-B1 · 0044]',
    'public.tecnologias_seleccionables()',
    'MXTEC', 'tecnologia_no_seleccionable',
    'MXEXL', 'excel_manda',
    'v_valor := v_canon;',
    'VALUES (p_sku, p_campo, v_valor, v_actor, true)'
  ];
  -- Lo que la 0006 tenia y NO se puede haber perdido en el reemplazo.
  v_frag_viejos  text[] := ARRAY[
    'IF NOT public.is_admin() THEN',
    'RAISE EXCEPTION ''forbidden'' USING errcode = ''42501'';',
    'RAISE EXCEPTION ''campo invalido'' USING errcode = ''22023'';',
    'SET activo = false',
    'WHERE sku = p_sku AND campo = p_campo AND activo = true;',
    'IF p_valor IS NOT NULL THEN',
    'WHERE o.sku = p_sku AND o.activo = true;',
    'RETURN coalesce(v_result, ''[]''::jsonb);'
  ];
  v_attnum       int2;
  v_checks       integer;
  v_check_def    text;
  v_code         text;
  v_msg          text;
  v_lista        text;
  v_lista_auth   text;
  v_lista_sin_filtro text;
  v_snap         uuid;
  v_n_vigente    integer := 0;
  v_n_visibles   integer := 0;
  v_n_con_tec    integer := 0;
  v_n_excl_con_tec integer := 0;
  v_primera      text;
  v_admin        uuid;
  v_sku_excel    text;
  v_excel_valor  text;
  v_sku_hueco    text;
  v_claims_prev  text;
  v_claim_prev   text;
  v_sub_prev     text;
  v_huella_antes text;
  v_huella_desp  text;
  v_filas_antes  integer;
  v_filas_desp   integer;
  v_res          jsonb;
  v_ids_sonda    uuid[];
  v_borradas     integer;
  v_no_probado   integer := 0;
  -- (g) el candado
  v_puede_auth   boolean := false;
  v_trg_fn       oid;
  v_n            integer;
  v_obs          text;
  v_paso         integer;
  v_id_sonda     uuid;
  v_rol_inicial  text;
  v_tec_hueco_antes text;
  v_tec_hueco_desp  text;
  v_filas_carga  integer;
  v_tec_carga    text;
  v_det          text;
BEGIN
  -- ======================================================= (a) el CHECK
  SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
   WHERE a.attrelid = 'public.productos_override'::regclass AND a.attname = 'campo' AND NOT a.attisdropped;

  SELECT count(*), min(pg_get_constraintdef(c.oid)) INTO v_checks, v_check_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.productos_override'::regclass
     AND c.contype = 'c'
     AND c.conkey @> ARRAY[v_attnum];

  IF v_checks <> 1 THEN
    RAISE EXCEPTION '0044 (a): hay % CHECK(s) sobre productos_override.campo y deberia haber exactamente 1.', v_checks;
  END IF;

  -- COMPORTAMIENTO, no texto. El CHECK se evalua ANTES que la llave foranea
  -- (que es un disparador al final de la sentencia), asi que con un SKU que
  -- no existe:  23503 = el CHECK DEJO PASAR el campo;  23514 = lo rechazo.
  -- No necesita ningun dato: corre igual en una base vacia.
  -- La fila va con activo = false A PROPOSITO: con activo = true el candado
  -- (3-bis), que dispara ANTES que el CHECK, contestaria MXTEC y esta prueba
  -- dejaria de medir el CHECK. Con false, ademas, muestra que desactivar no
  -- pasa por el candado.
  v_code := NULL;
  BEGIN
    INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
    VALUES ('__sonda_0044_sin_sku__', 'tecnologia', 'x', v_actor_sonda, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '23503' THEN
    RAISE EXCEPTION '0044 (a): el CHECK nuevo NO deja pasar campo = tecnologia (sqlstate %, se esperaba 23503 de la llave foranea). Definicion viva: %', coalesce(v_code, 'sin error'), v_check_def;
  END IF;

  -- Anti-vacuidad del propio detector: si todo diera 23503, lo de arriba no
  -- distinguiria nada. Un campo fuera de la lista TIENE que dar 23514.
  v_code := NULL;
  BEGIN
    INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
    VALUES ('__sonda_0044_sin_sku__', 'marca', 'x', v_actor_sonda, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
  END;
  IF v_code IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION '0044 (a): el CHECK nuevo NO rechaza campo = marca (sqlstate %, se esperaba 23514). La prueba de arriba no esta distinguiendo nada. Definicion viva: %', coalesce(v_code, 'sin error'), v_check_def;
  END IF;

  -- ============================================ (b) aplicar_override
  v_oid := to_regprocedure('public.aplicar_override(text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0044 (b): aplicar_override(text,text,text) no existe despues del reemplazo.';
  END IF;

  IF coalesce((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_oid), '<null>')
       IS DISTINCT FROM current_setting('demo.mig0044_ao_acl', true) THEN
    RAISE EXCEPTION '0044 (b): el ACL de aplicar_override CAMBIO con el reemplazo. Antes: % · despues: %',
      current_setting('demo.mig0044_ao_acl', true), (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_oid);
  END IF;
  IF coalesce((SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = v_oid), '<null>')
       IS DISTINCT FROM current_setting('demo.mig0044_ao_config', true) THEN
    RAISE EXCEPTION '0044 (b): el search_path de aplicar_override CAMBIO. Antes: % · despues: %',
      current_setting('demo.mig0044_ao_config', true), (SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = v_oid);
  END IF;
  IF (SELECT p.prosecdef::text FROM pg_proc p WHERE p.oid = v_oid)
       IS DISTINCT FROM current_setting('demo.mig0044_ao_secdef', true) THEN
    RAISE EXCEPTION '0044 (b): aplicar_override cambio de SECURITY DEFINER/INVOKER con el reemplazo.';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION '0044 (b): aplicar_override NO es SECURITY DEFINER: correria como el usuario y chocaria con la RLS de productos_override.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (b): anon puede ejecutar aplicar_override. Esta migracion no toca su ACL (lo comprobo arriba), asi que YA estaba asi antes: medirlo, no es de este cambio.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (b): authenticated NO puede ejecutar aplicar_override: la ficha no podria guardar nada.';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
  FOREACH v_f IN ARRAY v_frag_nuevos LOOP
    IF position(v_f IN v_src) = 0 THEN
      RAISE EXCEPTION '0044 (b): el cuerpo vivo de aplicar_override NO trae el fragmento nuevo "%".', v_f;
    END IF;
  END LOOP;
  FOREACH v_f IN ARRAY v_frag_viejos LOOP
    IF position(v_f IN v_src) = 0 THEN
      RAISE EXCEPTION '0044 (b): el reemplazo PERDIO el fragmento de la 0006 "%". Un CREATE OR REPLACE sustituye la funcion entera.', v_f;
    END IF;
  END LOOP;
  -- Control anti-ceguera del detector (molde de la 0014).
  IF position('esta_cadena_no_existe_en_ninguna_funcion' IN v_src) <> 0 THEN
    RAISE EXCEPTION '0044 (b): el detector encuentra cadenas inexistentes; no esta comprobando nada.';
  END IF;

  -- ============================== (c) tecnologias_seleccionables: forma y permisos
  v_sel_oid := to_regprocedure('public.tecnologias_seleccionables()');
  IF v_sel_oid IS NULL THEN
    RAISE EXCEPTION '0044 (c): tecnologias_seleccionables() no quedo creada.';
  END IF;
  IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_sel_oid) <> 's' THEN
    RAISE EXCEPTION '0044 (c): tecnologias_seleccionables() no es STABLE.';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sel_oid) THEN
    RAISE EXCEPTION '0044 (c): tecnologias_seleccionables() es SECURITY DEFINER y debe ser INVOKER: solo lee lo que authenticated ya puede leer.';
  END IF;
  IF has_function_privilege('anon', v_sel_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (c): anon puede ejecutar tecnologias_seleccionables(). El REVOKE explicito no surtio efecto (pg_default_acl).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
              WHERE p.oid = v_sel_oid AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (c): PUBLIC conserva EXECUTE sobre tecnologias_seleccionables().';
  END IF;
  IF NOT has_function_privilege('authenticated', v_sel_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (c): authenticated NO puede ejecutar tecnologias_seleccionables(): la ficha no tendria lista.';
  END IF;

  -- ================================================ (d) la lista, con su denominador
  SELECT s.id INTO v_snap
    FROM public.snapshots s
   WHERE s.fuente = 'stock'
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT 1;

  IF v_snap IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE NOT coalesce(m.excluida_del_catalogo, false)),
           count(*) FILTER (WHERE NOT coalesce(m.excluida_del_catalogo, false)
                              AND btrim(coalesce(p.tecnologia, '')) <> ''),
           count(*) FILTER (WHERE coalesce(m.excluida_del_catalogo, false)
                              AND btrim(coalesce(p.tecnologia, '')) <> '')
      INTO v_n_vigente, v_n_visibles, v_n_con_tec, v_n_excl_con_tec
      FROM public.productos p
      LEFT JOIN public.marcas m ON m.id = p.marca_id
     WHERE p.snapshot_id = v_snap;
  END IF;

  SELECT string_agg(s.nombre, ', ' ORDER BY s.nombre), min(s.nombre)
    INTO v_lista, v_primera
    FROM public.tecnologias_seleccionables() AS s(nombre);

  -- La MISMA regla sin el filtro de marca excluida: sirve para que el log
  -- diga si ese filtro mueve la lista hoy o si VERTICAL queda fuera por otra
  -- razon (ver cabecera, P25).
  SELECT string_agg(t.nombre, ', ' ORDER BY t.nombre) INTO v_lista_sin_filtro
    FROM public.tecnologias t
   WHERE t.activo
     AND EXISTS (SELECT 1 FROM public.productos p
                  WHERE p.snapshot_id = v_snap
                    AND upper(btrim(p.tecnologia)) = upper(btrim(t.nombre)));

  RAISE NOTICE '0044 (d) · vigente de stock: % · productos del vigente: % · visibles (marca no excluida): % · visibles con tecnologia del Excel: % · de marca excluida con tecnologia: %',
    coalesce(v_snap::text, '(ninguno)'), v_n_vigente, v_n_visibles, v_n_con_tec, v_n_excl_con_tec;
  RAISE NOTICE '0044 (d) · lista seleccionable: [%] · la misma regla SIN el filtro de marca excluida: [%]',
    coalesce(v_lista, ''), coalesce(v_lista_sin_filtro, '');

  IF EXISTS (SELECT 1 FROM public.tecnologias_seleccionables() AS s(nombre) WHERE upper(btrim(s.nombre)) = 'VERTICAL') THEN
    RAISE EXCEPTION '0044 (d): la lista derivada OFRECE VERTICAL ([%]) y el PO firmo que no (decision 2 de FIX-B1). Algun producto VISIBLE trae VERTICAL como tecnologia en el Excel: hay que decidir con el PO antes de aplicar.', v_lista;
  END IF;

  -- La lista contra su DEFINICION, pieza por pieza. Las dos primeras son de
  -- SOLIDEZ (nada de lo que ofrece sobra) y la tercera de COMPLETITUD (no le
  -- falta nada). Existen porque la regla de VERTICAL de arriba y el aviso de
  -- abajo no ven, por ejemplo, que se colara una tecnologia INACTIVA: medido
  -- con un mutante que quitaba `t.activo`, la migracion aplicaba en verde.
  IF EXISTS (SELECT 1 FROM public.tecnologias_seleccionables() AS s(nombre)
              WHERE NOT EXISTS (SELECT 1 FROM public.tecnologias t
                                 WHERE t.nombre = s.nombre AND t.activo)) THEN
    RAISE EXCEPTION '0044 (d): la lista [%] ofrece una tecnologia que NO esta activa en public.tecnologias (o que no es su nombre canonico).', v_lista;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tecnologias_seleccionables() AS s(nombre)
              WHERE NOT EXISTS (SELECT 1 FROM public.productos p
                                  LEFT JOIN public.marcas m ON m.id = p.marca_id
                                 WHERE p.snapshot_id = v_snap
                                   AND NOT coalesce(m.excluida_del_catalogo, false)
                                   AND upper(btrim(p.tecnologia)) = upper(btrim(s.nombre)))) THEN
    RAISE EXCEPTION '0044 (d): la lista [%] ofrece una tecnologia que ningun producto VISIBLE del vigente usa (remanente, marca excluida o sin uso).', v_lista;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tecnologias t
              WHERE t.activo
                AND EXISTS (SELECT 1 FROM public.productos p
                              LEFT JOIN public.marcas m ON m.id = p.marca_id
                             WHERE p.snapshot_id = v_snap
                               AND NOT coalesce(m.excluida_del_catalogo, false)
                               AND upper(btrim(p.tecnologia)) = upper(btrim(t.nombre)))
                AND NOT EXISTS (SELECT 1 FROM public.tecnologias_seleccionables() AS s(nombre)
                                 WHERE s.nombre = t.nombre)) THEN
    RAISE EXCEPTION '0044 (d): a la lista [%] le FALTA una tecnologia activa que si usa un producto visible del vigente.', v_lista;
  END IF;

  IF v_n_vigente > 0 AND v_lista IS NULL THEN
    RAISE EXCEPTION '0044 (d): hay % productos en el vigente y la lista sale VACIA: toda captura daria MXTEC. O ningun producto visible trae tecnologia, o la comparacion con el catalogo no casa. Abortando.', v_n_vigente;
  END IF;

  -- Solo con datos: en una base vacia la lista vacia es lo esperado y avisar
  -- seria ruido.
  IF v_n_vigente > 0 AND v_lista IS DISTINCT FROM 'EAS, BRAND2, BRAND1' THEN
    RAISE NOTICE '0044 (d) · ⚠ la lista derivada [%] NO es la que el PO firmo (EAS, BRAND2, BRAND1). No se aborta: la regla es la derivada y el dato pudo moverse. Pero hay que ensenarselo al PO.', coalesce(v_lista, '');
  END IF;

  -- La API la lee con la sesion del usuario. Se lee aqui COMO authenticated y
  -- se exige lo mismo que ve el dueno: si la RLS o un permiso de columna de
  -- alguna de las cuatro tablas la recortara, la ficha ofreceria menos de lo
  -- que la RPC acepta.
  v_lista_auth := NULL;
  v_code := NULL;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_code IS NOT NULL THEN
    v_no_probado := v_no_probado + 1;
    RAISE NOTICE '0044 (c) · NO PROBADO: no se pudo asumir el rol authenticated desde esta sesion (% %). La lectura como usuario queda sin medir aqui.', v_code, v_msg;
  ELSE
    v_code := NULL;
    BEGIN
      SELECT string_agg(s.nombre, ', ' ORDER BY s.nombre) INTO v_lista_auth
        FROM public.tecnologias_seleccionables() AS s(nombre);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    EXECUTE 'RESET ROLE';
    IF v_code IS NOT NULL THEN
      RAISE EXCEPTION '0044 (c): authenticated NO puede leer tecnologias_seleccionables() (% %). La API recibiria un error.', v_code, v_msg;
    END IF;
    IF v_lista_auth IS DISTINCT FROM v_lista THEN
      RAISE EXCEPTION '0044 (c): leida como authenticated la lista es [%] y leida por el dueno es [%]. La ficha y la RPC verian listas distintas.', coalesce(v_lista_auth, ''), coalesce(v_lista, '');
    END IF;
    RAISE NOTICE '0044 (c) · leida como authenticated: [%] = la del dueno.', coalesce(v_lista_auth, '');
    v_puede_auth := true;   -- (g) escribe COMO authenticated solo si esto paso
  END IF;

  -- ======================================================== (e) LA SONDA
  -- Los SKU, el admin y la sesion previa se leen AQUI, fuera de las ramas,
  -- porque (g) —el candado— usa los mismos: las dos sondas le dan a los dos
  -- caminos las MISMAS entradas. Sin vigente, los SELECT no traen nada.
  --
  -- SKU del vigente, visibles y SIN ninguna captura activa (de ningun campo):
  -- asi ni la desactivacion previa de la RPC puede alcanzar una fila real.
  SELECT p.sku, p.tecnologia INTO v_sku_excel, v_excel_valor
    FROM public.productos p
    LEFT JOIN public.marcas m ON m.id = p.marca_id
   WHERE p.snapshot_id = v_snap
     AND NOT coalesce(m.excluida_del_catalogo, false)
     AND btrim(coalesce(p.tecnologia, '')) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.productos_override o WHERE o.sku = p.sku AND o.activo)
   ORDER BY p.sku
   LIMIT 1;

  SELECT p.sku INTO v_sku_hueco
    FROM public.productos p
    LEFT JOIN public.marcas m ON m.id = p.marca_id
   WHERE p.snapshot_id = v_snap
     AND NOT coalesce(m.excluida_del_catalogo, false)
     AND btrim(coalesce(p.tecnologia, '')) = ''
     AND NOT EXISTS (SELECT 1 FROM public.productos_override o WHERE o.sku = p.sku AND o.activo)
   ORDER BY p.sku
   LIMIT 1;

  SELECT pf.id INTO v_admin FROM public.perfiles pf WHERE pf.rol = 'admin' ORDER BY pf.id LIMIT 1;

  v_claims_prev := current_setting('request.jwt.claims', true);
  v_claim_prev  := current_setting('request.jwt.claim', true);
  v_sub_prev    := current_setting('request.jwt.claim.sub', true);

  IF v_n_vigente = 0 THEN
    v_no_probado := v_no_probado + 1;
    RAISE NOTICE '0044 (e) · NO PROBADO: no hay carga de stock con productos (replay sobre una base vacia). La sonda de MXTEC/MXEXL/captura/quitar NO corrio. El verde de esta corrida significa «no contradicho», no «probado».';
  ELSIF NOT has_function_privilege(current_user, v_oid, 'EXECUTE') THEN
    v_no_probado := v_no_probado + 1;
    RAISE NOTICE '0044 (e) · NO PROBADO: el rol de esta sesion (%) no puede ejecutar aplicar_override, asi que la sonda no puede ejercerla. Un 42501 aqui se habria leido como la guarda is_admin() — P25.', current_user;
  ELSE
    -- Huella de TODA la tabla: id + activo de cada fila. La sonda no puede
    -- cambiar ni una.
    SELECT count(*), md5(coalesce(string_agg(o.id::text || ':' || o.activo::text, ',' ORDER BY o.id), ''))
      INTO v_filas_antes, v_huella_antes
      FROM public.productos_override o;

    -- ---- R0 · sin sesion: la guarda is_admin() sigue siendo la PRIMERA.
    -- Se comprueba CODIGO y MENSAJE: un 42501 de «permission denied for
    -- function» tambien es 42501, y leerlo como la guarda seria P25.
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    v_code := NULL; v_msg := NULL;
    BEGIN
      PERFORM public.aplicar_override(coalesce(v_sku_excel, v_sku_hueco, '__sonda_0044_sin_sku__'), 'tecnologia', 'EAS');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM '42501' OR v_msg IS DISTINCT FROM 'forbidden' THEN
      RAISE EXCEPTION '0044 (e) R0: sin sesion se esperaba 42501/forbidden y salio %/%.', coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
    END IF;

    IF v_admin IS NULL THEN
      v_no_probado := v_no_probado + 1;
      RAISE NOTICE '0044 (e) · NO PROBADO: no hay ningun perfil admin, asi que las rondas con sesion (MXTEC, MXEXL, captura, quitar) no se pudieron ejercer.';
    ELSE
      -- Sesion de admin SIMULADA, local a esta transaccion: `auth.uid()` y
      -- `auth.jwt()` leen estas variables (molde 0020:762-800). El correo es
      -- el de la sonda para que `editado_por` no se le atribuya a una persona.
      PERFORM set_config('request.jwt.claims',
                         json_build_object('sub', v_admin::text, 'email', v_actor_sonda, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

      -- ---- R1 · campo fuera de la lista: 22023, sin cambio respecto de la 0006.
      v_code := NULL; v_msg := NULL;
      BEGIN
        PERFORM public.aplicar_override(coalesce(v_sku_excel, v_sku_hueco), 'marca', 'X');
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      END;
      IF v_code IS DISTINCT FROM '22023' OR v_msg IS DISTINCT FROM 'campo invalido' THEN
        RAISE EXCEPTION '0044 (e) R1: campo marca debia dar 22023/campo invalido y dio %/%.', coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
      END IF;

      IF v_sku_excel IS NULL THEN
        v_no_probado := v_no_probado + 1;
        RAISE NOTICE '0044 (e) · NO PROBADO: ningun SKU visible con tecnologia del Excel y sin capturas activas; MXEXL y el orden MXTEC-antes-que-MXEXL no se ejercieron.';
      ELSE
        -- ---- R2 · valor que no existe, sobre un SKU CON Excel: tiene que
        -- ganar MXTEC, porque la lista se revisa ANTES que el Excel.
        v_code := NULL; v_msg := NULL;
        BEGIN
          PERFORM public.aplicar_override(v_sku_excel, 'tecnologia', 'VALOR-QUE-NO-EXISTE-0044');
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        END;
        IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' THEN
          RAISE EXCEPTION '0044 (e) R2: valor inexistente sobre % debia dar MXTEC/tecnologia_no_seleccionable y dio %/%.', v_sku_excel, coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
        END IF;

        -- ---- R3 · VERTICAL: fuera de la lista (decision 2), MXTEC.
        v_code := NULL; v_msg := NULL;
        BEGIN
          PERFORM public.aplicar_override(v_sku_excel, 'tecnologia', 'vertical');
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        END;
        IF v_code IS DISTINCT FROM 'MXTEC' THEN
          RAISE EXCEPTION '0044 (e) R3: VERTICAL debia dar MXTEC y dio %/%.', coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
        END IF;

        -- ---- R4 · valor VALIDO sobre un SKU con Excel: MXEXL, «el Excel gana».
        v_code := NULL; v_msg := NULL;
        BEGIN
          PERFORM public.aplicar_override(v_sku_excel, 'tecnologia', lower(v_primera));
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        END;
        IF v_code IS DISTINCT FROM 'MXEXL' OR v_msg IS DISTINCT FROM 'excel_manda' THEN
          RAISE EXCEPTION '0044 (e) R4: % (Excel: %) con % debia dar MXEXL/excel_manda y dio %/%.', v_sku_excel, v_excel_valor, lower(v_primera), coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
        END IF;

        -- ---- R5 · quitar sobre un SKU con Excel: se permite siempre. No hay
        -- captura activa que quitar, asi que no toca nada (la huella lo mide).
        v_res := public.aplicar_override(v_sku_excel, 'tecnologia', NULL);
        IF jsonb_typeof(v_res) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION '0044 (e) R5: quitar sobre % no devolvio el set activo (%).', v_sku_excel, v_res;
        END IF;
      END IF;

      IF v_sku_hueco IS NULL THEN
        v_no_probado := v_no_probado + 1;
        RAISE NOTICE '0044 (e) · NO PROBADO: ningun SKU visible SIN tecnologia del Excel y sin capturas activas. Si el Excel ya las trae todas es buena noticia, pero la captura y el quitar no se ejercieron.';
      ELSE
        -- ---- R6 · captura en un HUECO, tecleada «mal»: se guarda el CANONICO.
        -- El INSERT de la RPC pasa TAMBIEN por el candado (3-bis): que la fila
        -- salga canonica y sin error prueba que las dos validaciones son
        -- idempotentes entre si (la RPC entrega el canonico y el candado lo
        -- vuelve a aceptar tal cual).
        v_res := public.aplicar_override(v_sku_hueco, 'tecnologia', '  ' || lower(v_primera) || ' ');
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e
                        WHERE e ->> 'campo' = 'tecnologia' AND e ->> 'valor_editado' = v_primera) THEN
          RAISE EXCEPTION '0044 (e) R6: la captura en % no devolvio tecnologia = % canonica. Devolvio: %', v_sku_hueco, v_primera, v_res;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.productos_override o
                        WHERE o.sku = v_sku_hueco AND o.campo = 'tecnologia' AND o.activo
                          AND o.valor_editado = v_primera AND o.editado_por = v_actor_sonda) THEN
          RAISE EXCEPTION '0044 (e) R6: la fila de la captura en % no quedo escrita con el nombre canonico y el actor de la sonda.', v_sku_hueco;
        END IF;

        -- ---- R7 · quitar esa captura: queda inactiva y fuera del set activo.
        v_res := public.aplicar_override(v_sku_hueco, 'tecnologia', NULL);
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e WHERE e ->> 'campo' = 'tecnologia') THEN
          RAISE EXCEPTION '0044 (e) R7: despues de quitar, el set activo de % sigue trayendo tecnologia: %', v_sku_hueco, v_res;
        END IF;

        -- ---- R8 · el camino VIEJO sigue igual: descripcion se captura y se quita.
        v_res := public.aplicar_override(v_sku_hueco, 'descripcion', 'sonda 0044');
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_res) e
                        WHERE e ->> 'campo' = 'descripcion' AND e ->> 'valor_editado' = 'sonda 0044') THEN
          RAISE EXCEPTION '0044 (e) R8: la captura de descripcion en % dejo de funcionar como en la 0006. Devolvio: %', v_sku_hueco, v_res;
        END IF;
        v_res := public.aplicar_override(v_sku_hueco, 'descripcion', NULL);
        IF v_res IS DISTINCT FROM '[]'::jsonb THEN
          RAISE EXCEPTION '0044 (e) R8: despues de quitar la descripcion, % no quedo sin capturas activas: %', v_sku_hueco, v_res;
        END IF;

        -- ---- Limpieza: POR ID, y solo lo que escribio esta sonda.
        SELECT array_agg(o.id) INTO v_ids_sonda
          FROM public.productos_override o
         WHERE o.sku = v_sku_hueco AND o.editado_por = v_actor_sonda;
        DELETE FROM public.productos_override o WHERE o.id = ANY (v_ids_sonda);
        GET DIAGNOSTICS v_borradas = ROW_COUNT;
        IF v_borradas <> 2 THEN
          RAISE EXCEPTION '0044 (e): la sonda debia dejar EXACTAMENTE 2 filas (tecnologia + descripcion) y borro %.', v_borradas;
        END IF;
      END IF;
    END IF;

    PERFORM set_config('request.jwt.claims', coalesce(v_claims_prev, ''), true);
    PERFORM set_config('request.jwt.claim', coalesce(v_claim_prev, ''), true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub_prev, ''), true);

    SELECT count(*), md5(coalesce(string_agg(o.id::text || ':' || o.activo::text, ',' ORDER BY o.id), ''))
      INTO v_filas_desp, v_huella_desp
      FROM public.productos_override o;
    IF v_filas_desp <> v_filas_antes OR v_huella_desp <> v_huella_antes THEN
      RAISE EXCEPTION '0044 (e): la sonda DEJO RASTRO en productos_override (filas % -> %, huella % -> %). Abortando: nada de esto se aplica.',
        v_filas_antes, v_filas_desp, v_huella_antes, v_huella_desp;
    END IF;

    RAISE NOTICE '0044 (e) · SONDA: sku con Excel = % (Excel: %) · sku hueco = % · admin simulado = % · productos_override: % filas, misma huella antes y despues.',
      coalesce(v_sku_excel, '(ninguno)'), coalesce(v_excel_valor, '-'), coalesce(v_sku_hueco, '(ninguno)'),
      coalesce(v_admin::text, '(ninguno)'), v_filas_desp;
  END IF;

  -- ================================================= (g) EL CANDADO DE TABLA
  -- (e) ejercio la RPC. Aqui se ejerce la TABLA, que es el camino del
  -- hallazgo: escribir productos_override DIRECTO, sin aplicar_override.
  --
  -- Cada prueba vive en un subbloque BEGIN ... EXCEPTION, que en plpgsql ES un
  -- SAVEPOINT con su ROLLBACK TO: un DO no admite escribir SAVEPOINT ni
  -- ROLLBACK TO, y el subbloque es el mismo mecanismo (una subtransaccion). Y
  -- cada subbloque TERMINA con un RAISE centinela (MXSND): asi se revierte
  -- SIEMPRE —haya contestado o no lo que se probaba—, y con el se revierten el
  -- SET LOCAL ROLE y el UPDATE de productos que haga adentro. Lo escrito no
  -- sobrevive, y las huellas de antes/despues lo MIDEN en vez de suponerlo.
  --
  -- Quien contesto es la mitad de la prueba (P25):
  --   MXTEC / MXEXL con su mensaje = contesto una regla de negocio;
  --   MXSND                        = TODO lo del subbloque paso;
  --   23503                        = el INSERT llego hasta la llave foranea:
  --                                  el candado no contesto;
  --   42501                        = contesto un permiso, no el candado.

  -- ---- G0 · la forma declarada.
  v_trg_fn := to_regprocedure('public.productos_override_tecnologia_excel_gana()');
  IF v_trg_fn IS NULL THEN
    RAISE EXCEPTION '0044 (g) G0: no existe public.productos_override_tecnologia_excel_gana().';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.productos_override'::regclass
     AND t.tgname = 'productos_override_tecnologia_excel_gana'
     AND NOT t.tgisinternal
     AND t.tgfoid = v_trg_fn
     AND t.tgenabled = 'O'          -- encendido (D = apagado)
     AND (t.tgtype & 23) = 23       -- ROW(1) + BEFORE(2) + INSERT(4) + UPDATE(16)
     AND (t.tgtype & 104) = 0       -- ni DELETE(8), ni TRUNCATE(32), ni INSTEAD(64)
     AND t.tgqual IS NULL           -- sin WHEN: el filtro vive en la funcion
     AND t.tgattr::text = '';       -- sin UPDATE OF: cualquier columna dispara
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0044 (g) G0: el disparador productos_override_tecnologia_excel_gana no quedo como se declara (BEFORE, ROW, INSERT y UPDATE, encendido, sin WHEN ni UPDATE OF, llamando a la funcion del candado). Coincidencias: %.', v_n;
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_trg_fn) THEN
    RAISE EXCEPTION '0044 (g) G0: la funcion del candado es SECURITY DEFINER y se declaro INVOKER.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c(cfg)
                  WHERE p.oid = v_trg_fn AND c.cfg LIKE 'search_path=%') THEN
    RAISE EXCEPTION '0044 (g) G0: la funcion del candado no tiene search_path fijo.';
  END IF;
  -- has_function_privilege cuenta tambien lo heredado de PUBLIC.
  IF has_function_privilege('anon', v_trg_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_trg_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '0044 (g) G0: anon o authenticated conservan EXECUTE sobre la funcion del candado (pg_default_acl o PUBLIC).';
  END IF;

  -- ---- G1 · SIN DATOS: corre siempre, incluso en una base vacia. SKU que
  -- no existe + VERTICAL activa: sin el candado, el INSERT llega a la llave
  -- foranea (23503).
  v_code := NULL; v_msg := NULL;
  BEGIN
    INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
    VALUES ('__sonda_0044_sin_sku__', 'tecnologia', 'VERTICAL', v_actor_sonda, true);
    RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' THEN
    RAISE EXCEPTION '0044 (g) G1: un INSERT directo de VERTICAL activa debia dar MXTEC/tecnologia_no_seleccionable y dio %/%. Un 23503 quiere decir que el candado NO contesto y el INSERT llego hasta la llave foranea.', coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
  END IF;

  -- ---- G2 · EL CAMINO DEL HALLAZGO, sobre SKU REALES: escritura directa
  -- COMO authenticated con sesion de admin, con las mismas entradas que (e)
  -- le dio a la RPC.
  IF v_n_vigente = 0 OR v_admin IS NULL OR v_primera IS NULL
     OR v_sku_excel IS NULL OR v_sku_hueco IS NULL THEN
    v_no_probado := v_no_probado + 1;
    RAISE NOTICE '0044 (g) · NO PROBADO: el candado sobre SKU reales necesita vigente con productos, un perfil admin, una tecnologia en la lista, un SKU con Excel y un SKU hueco (vigente=% · admin=% · primera de la lista=% · sku con Excel=% · sku hueco=%). Solo corrieron G0 y G1.',
      v_n_vigente, coalesce(v_admin::text, '-'), coalesce(v_primera, '-'), coalesce(v_sku_excel, '-'), coalesce(v_sku_hueco, '-');
  ELSE
    IF NOT v_puede_auth THEN
      v_no_probado := v_no_probado + 1;
      RAISE NOTICE '0044 (g) · NO PROBADO COMO authenticated: la sesion no pudo asumir el rol (ver (c)). G2 corre como % —el dueno de la tabla, que no pasa por la RLS—: prueba el candado, no el camino del hallazgo.', current_user;
    END IF;

    v_rol_inicial := current_user;
    SELECT count(*), md5(coalesce(string_agg(o.id::text || ':' || o.activo::text, ',' ORDER BY o.id), ''))
      INTO v_filas_antes, v_huella_antes
      FROM public.productos_override o;
    SELECT p.tecnologia INTO v_tec_hueco_antes FROM public.productos p WHERE p.sku = v_sku_hueco;

    -- La sesion de admin simulada vale para todo G2 (se restaura al final).
    -- El ROLE, en cambio, se asume DENTRO de cada subbloque, para que el
    -- centinela lo revierta y lo de afuera siga corriendo como el dueno.
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_admin::text, 'email', v_actor_sonda, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    -- G2a · VERTICAL sobre un SKU HUECO. Sin el candado, este INSERT de un
    -- admin PASA —el SKU existe y la policy solo pide is_admin()— y el
    -- subbloque terminaria en MXSND.
    v_code := NULL; v_msg := NULL;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'tecnologia', 'VERTICAL', v_actor_sonda, true);
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' THEN
      RAISE EXCEPTION '0044 (g) G2a: INSERT directo de VERTICAL sobre % (sin Excel) debia dar MXTEC/tecnologia_no_seleccionable y dio %/%. MXSND = el candado lo DEJO PASAR.', v_sku_hueco, coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
    END IF;

    -- G2b · el ORDEN, como R3 de (e): 'vertical' sobre un SKU CON Excel tiene
    -- que dar MXTEC y no MXEXL, porque la lista se revisa antes que el Excel.
    v_code := NULL; v_msg := NULL;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_excel, 'tecnologia', 'vertical', v_actor_sonda, true);
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' THEN
      RAISE EXCEPTION '0044 (g) G2b: INSERT directo de vertical sobre % (con Excel) debia dar MXTEC —la lista va antes que el Excel, igual que en la RPC— y dio %/%.', v_sku_excel, coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
    END IF;

    -- G2c · valor VALIDO sobre un SKU con Excel, como R4: MXEXL, «el Excel gana».
    v_code := NULL; v_msg := NULL;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_excel, 'tecnologia', lower(v_primera), v_actor_sonda, true);
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXEXL' OR v_msg IS DISTINCT FROM 'excel_manda' THEN
      RAISE EXCEPTION '0044 (g) G2c: INSERT directo de % sobre % (Excel: %) debia dar MXEXL/excel_manda y dio %/%. MXSND = el candado lo DEJO PASAR.', lower(v_primera), v_sku_excel, v_excel_valor, coalesce(v_code, 'sin error'), coalesce(v_msg, '-');
    END IF;

    -- G2d · ANTI-VACUIDAD, como R6: un valor valido, tecleado «mal», sobre un
    -- HUECO tiene que PASAR (MXSND) y quedar con el nombre CANONICO. Si el
    -- candado cerrara todo, G2a-G2c saldrian verdes igual; esto no.
    v_code := NULL; v_msg := NULL; v_obs := NULL;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'tecnologia', '  ' || lower(v_primera) || ' ', v_actor_sonda, true)
      RETURNING valor_editado INTO v_obs;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXSND' OR v_obs IS DISTINCT FROM v_primera THEN
      RAISE EXCEPTION '0044 (g) G2d: la captura directa de «  %  » en % (sin Excel) debia PASAR y quedar como % (canonico); salio %/% con valor %.', lower(v_primera), v_sku_hueco, v_primera, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), coalesce(v_obs, '(ninguno)');
    END IF;

    -- G2e · por UPDATE: una captura valida que se cambia a VERTICAL -> MXTEC.
    -- v_paso cuenta los pasos COMPLETADOS. El MXTEC tiene que llegar con
    -- v_paso = 1 —el INSERT ya paso—, o sea que lo contesto el UPDATE.
    v_code := NULL; v_msg := NULL; v_paso := 0;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'tecnologia', v_primera, v_actor_sonda, true)
      RETURNING id INTO v_id_sonda;
      v_paso := 1;
      UPDATE public.productos_override SET valor_editado = 'VERTICAL' WHERE id = v_id_sonda;
      v_paso := 2;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' OR v_paso <> 1 THEN
      RAISE EXCEPTION '0044 (g) G2e: cambiar por UPDATE una captura de % a VERTICAL debia dar MXTEC en el UPDATE (con 1 paso completado, el INSERT) y dio %/% con % paso(s) completado(s).', v_sku_hueco, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), v_paso;
    END IF;

    -- G2f · REACTIVAR sobre un SKU con Excel: insertarla INACTIVA pasa
    -- (desactivar siempre pasa: 1 paso completado) y volverla activa por
    -- UPDATE -> MXEXL.
    v_code := NULL; v_msg := NULL; v_paso := 0;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_excel, 'tecnologia', v_primera, v_actor_sonda, false)
      RETURNING id INTO v_id_sonda;
      v_paso := 1;
      UPDATE public.productos_override SET activo = true WHERE id = v_id_sonda;
      v_paso := 2;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXEXL' OR v_msg IS DISTINCT FROM 'excel_manda' OR v_paso <> 1 THEN
      RAISE EXCEPTION '0044 (g) G2f: reactivar por UPDATE una captura de % (Excel: %) debia dar MXEXL en el UPDATE (con 1 paso completado, el INSERT inactivo) y dio %/% con % paso(s) completado(s).', v_sku_excel, v_excel_valor, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), v_paso;
    END IF;

    -- G2g · EL EXCEL LLEGA DESPUES, que es el unico estado donde una captura
    -- activa convive con un Excel lleno —y es legitimo (cabecera, «NO decide
    -- la LECTURA»)—. Quitarla tiene que seguir pudiendose; si el candado lo
    -- impidiera, la captura quedaria varada para siempre. v_paso cuenta los
    -- pasos COMPLETADOS; el verde es MXSND con los 5:
    --   paso 1 · se captura en el hueco (como el dueno);
    --   paso 2 · se simula la carga: UPDATE productos.tecnologia del hueco,
    --            y SOLO cuenta si el valor leido de vuelta ya no esta vacio
    --            y el UPDATE toco UNA fila (ver abajo que mide cada una);
    --   paso 3 · como authenticated, un UPDATE que deja la MISMA captura pasa;
    --   paso 4 · como authenticated, «quitar» por la RPC —el camino de la
    --            ficha— pasa;
    --   paso 5 · la fila quedo inactiva.
    v_code := NULL; v_msg := NULL; v_det := NULL; v_paso := 0; v_obs := NULL;
    BEGIN
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'tecnologia', v_primera, v_actor_sonda, true)
      RETURNING id INTO v_id_sonda;
      v_paso := 1;
      UPDATE public.productos SET tecnologia = v_primera WHERE sku = v_sku_hueco;
      -- La carga simulada tiene que HABER ESCRITO. Si no, los pasos 3-5
      -- correrian contra un Excel todavia vacio —donde tocar y quitar pasan
      -- de todos modos— y el verde no diria nada del caso «Excel llegado
      -- despues». Eso lo mide la RELECTURA, y ella SOLA basta: el
      -- hueco se eligio con productos.tecnologia vacia, asi que un UPDATE
      -- que no casa (0 filas) y un `SET tecnologia = tecnologia` (1 fila,
      -- nada nuevo) la dejan vacia los dos, y los dos caen aqui. ROW_COUNT = 1
      -- NO protege la medicion: solo acota que se toco EXACTAMENTE esa fila y
      -- ninguna otra (un WHERE que tocara dos llenaria el hueco igual, y la
      -- relectura lo dejaria pasar con razon). Con el WHERE de arriba es
      -- redundante, porque productos.sku es la llave primaria (0001:154). Si
      -- algo falla, el mensaje nombra CUAL de las dos (o las dos) y se sale
      -- antes de marcar el paso 2 (el centinela ya no llega).
      GET DIAGNOSTICS v_filas_carga = ROW_COUNT;
      SELECT p.tecnologia INTO v_tec_carga FROM public.productos p WHERE p.sku = v_sku_hueco;
      IF btrim(coalesce(v_tec_carga, '')) = '' OR v_filas_carga <> 1 THEN
        RAISE EXCEPTION USING
          MESSAGE = CASE
                      WHEN btrim(coalesce(v_tec_carga, '')) = '' AND v_filas_carga <> 1
                        THEN 'sonda_0044_carga_simulada_no_lleno_ni_toco_una_fila'
                      WHEN btrim(coalesce(v_tec_carga, '')) = ''
                        THEN 'sonda_0044_carga_simulada_no_lleno'
                      ELSE 'sonda_0044_carga_simulada_no_toco_una_fila'
                    END,
          DETAIL  = format('UPDATE de productos.tecnologia de %s: %s fila(s) tocada(s), valor leido de vuelta %L',
                           v_sku_hueco, v_filas_carga, v_tec_carga);
      END IF;
      v_paso := 2;
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      UPDATE public.productos_override SET editado_en = editado_en WHERE id = v_id_sonda;
      v_paso := 3;
      PERFORM public.aplicar_override(v_sku_hueco, 'tecnologia', NULL);
      v_paso := 4;
      SELECT o.activo::text INTO v_obs FROM public.productos_override o WHERE o.id = v_id_sonda;
      IF v_obs = 'false' THEN
        v_paso := 5;
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_det = PG_EXCEPTION_DETAIL;
    END;
    IF v_code IS DISTINCT FROM 'MXSND' OR v_paso <> 5 THEN
      -- La ultima pieza nombra la condicion de la carga que fallo; si fallo
      -- otra cosa (el INSERT del paso 1, o el candado en los pasos 3-5),
      -- queda vacia y lo dicen el codigo, el mensaje y los pasos.
      RAISE EXCEPTION '0044 (g) G2g: con el Excel llegado DESPUES de la captura en %, tocarla sin cambiarla y quitarla debian pasar; salio %/% con % de 5 pasos completados (activo al final: %; detalle: %).%', v_sku_hueco, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), v_paso, coalesce(v_obs, '-'), coalesce(nullif(v_det, ''), '-'),
        CASE v_msg
          WHEN 'sonda_0044_carga_simulada_no_lleno'
            THEN ' Fallo la RELECTURA: la carga simulada NO lleno productos.tecnologia, asi que los pasos 3-5 habrian corrido contra un Excel vacio y la prueba no habria medido nada.'
          WHEN 'sonda_0044_carga_simulada_no_toco_una_fila'
            THEN ' Fallo ROW_COUNT = 1: la carga simulada SI lleno productos.tecnologia, pero el UPDATE no toco exactamente UNA fila (cuantas, en el detalle): su WHERE ya no acota a ese SKU, o productos.sku dejo de ser unico.'
          WHEN 'sonda_0044_carga_simulada_no_lleno_ni_toco_una_fila'
            THEN ' Fallaron las DOS: la relectura salio vacia —la carga simulada NO lleno productos.tecnologia y la prueba no habria medido nada— y el UPDATE no toco exactamente UNA fila (cuantas, en el detalle).'
          ELSE ''
        END;
    END IF;

    -- G2h · el atajo de «misma captura» exige el MISMO SKU. Una captura
    -- valida en el HUECO pasa (paso 1); moverla por UPDATE al SKU CON Excel
    -- deja el mismo campo, el mismo valor y la misma bandera activa —solo
    -- cambia el SKU—, asi que si el atajo no mirara `OLD.sku = NEW.sku` la
    -- dejaria pasar sin revalidar y el subbloque llegaria al centinela con 2
    -- pasos. El verde es MXEXL con 1 paso: lo contesto el UPDATE.
    v_code := NULL; v_msg := NULL; v_paso := 0;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'tecnologia', v_primera, v_actor_sonda, true)
      RETURNING id INTO v_id_sonda;
      v_paso := 1;
      UPDATE public.productos_override SET sku = v_sku_excel WHERE id = v_id_sonda;
      v_paso := 2;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXEXL' OR v_msg IS DISTINCT FROM 'excel_manda' OR v_paso <> 1 THEN
      RAISE EXCEPTION '0044 (g) G2h: mover por UPDATE una captura valida de % (sin Excel) a % (Excel: %) debia dar MXEXL/excel_manda en el UPDATE (con 1 paso completado, el INSERT) y dio %/% con % paso(s) completado(s). MXSND con 2 = el atajo de misma captura la dejo pasar sin mirar el SKU.', v_sku_hueco, v_sku_excel, v_excel_valor, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), v_paso;
    END IF;

    -- G2i · el atajo exige que la fila YA fuera de tecnologia. Una captura
    -- de FAMILIA activa con valor 'VERTICAL' pasa (el candado no mira
    -- familia: paso 1); convertirla por UPDATE en tecnologia deja el mismo
    -- SKU, el mismo valor y la misma bandera activa —solo cambia el campo—,
    -- asi que si el atajo no mirara `OLD.campo = 'tecnologia'`, VERTICAL
    -- entraria como tecnologia sin pasar por la lista. El verde es MXTEC con
    -- 1 paso: lo contesto el UPDATE.
    v_code := NULL; v_msg := NULL; v_paso := 0;
    BEGIN
      IF v_puede_auth THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
      INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
      VALUES (v_sku_hueco, 'familia', 'VERTICAL', v_actor_sonda, true)
      RETURNING id INTO v_id_sonda;
      v_paso := 1;
      UPDATE public.productos_override SET campo = 'tecnologia' WHERE id = v_id_sonda;
      v_paso := 2;
      RAISE EXCEPTION USING ERRCODE = 'MXSND', MESSAGE = 'sonda_0044_revertir';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_code IS DISTINCT FROM 'MXTEC' OR v_msg IS DISTINCT FROM 'tecnologia_no_seleccionable' OR v_paso <> 1 THEN
      RAISE EXCEPTION '0044 (g) G2i: convertir por UPDATE en tecnologia una captura de familia = VERTICAL en % debia dar MXTEC/tecnologia_no_seleccionable en el UPDATE (con 1 paso completado, el INSERT de familia) y dio %/% con % paso(s) completado(s). MXSND con 2 = el atajo de misma captura la dejo pasar sin mirar el campo de antes.', v_sku_hueco, coalesce(v_code, 'sin error'), coalesce(v_msg, '-'), v_paso;
    END IF;

    -- Todo G2 vuelve a como estaba: sesion, rol, tabla y la fila de productos.
    PERFORM set_config('request.jwt.claims', coalesce(v_claims_prev, ''), true);
    PERFORM set_config('request.jwt.claim', coalesce(v_claim_prev, ''), true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub_prev, ''), true);
    IF current_user IS DISTINCT FROM v_rol_inicial THEN
      RAISE EXCEPTION '0044 (g): despues de las sondas el rol es % y era %. Un SET LOCAL ROLE sobrevivio a su subbloque.', current_user, v_rol_inicial;
    END IF;
    SELECT count(*), md5(coalesce(string_agg(o.id::text || ':' || o.activo::text, ',' ORDER BY o.id), ''))
      INTO v_filas_desp, v_huella_desp
      FROM public.productos_override o;
    SELECT p.tecnologia INTO v_tec_hueco_desp FROM public.productos p WHERE p.sku = v_sku_hueco;
    IF v_filas_desp <> v_filas_antes OR v_huella_desp <> v_huella_antes
       OR v_tec_hueco_desp IS DISTINCT FROM v_tec_hueco_antes THEN
      RAISE EXCEPTION '0044 (g): la sonda del candado DEJO RASTRO (productos_override: filas % -> %, huella % -> %; productos.tecnologia de %: % -> %). Abortando: nada de esto se aplica.',
        v_filas_antes, v_filas_desp, v_huella_antes, v_huella_desp, v_sku_hueco, coalesce(v_tec_hueco_antes, '(nula)'), coalesce(v_tec_hueco_desp, '(nula)');
    END IF;

    RAISE NOTICE '0044 (g) · CANDADO, escribiendo directo como %: VERTICAL en % -> MXTEC · vertical en % (con Excel) -> MXTEC · % en % -> MXEXL · hueco -> pasa como % · UPDATE a VERTICAL -> MXTEC · reactivar con Excel -> MXEXL · Excel llegado despues (carga simulada comprobada): tocar y quitar pasan · mover la captura a % -> MXEXL · familia VERTICAL convertida en tecnologia -> MXTEC. Huellas intactas.',
      CASE WHEN v_puede_auth THEN 'authenticated (admin simulado)' ELSE v_rol_inicial END,
      v_sku_hueco, v_sku_excel, lower(v_primera), v_sku_excel, v_primera, v_sku_excel;
  END IF;

  -- ================================================ (f) lo que NO puede ver
  RAISE NOTICE '--- 0044 · FIX-B1 · lo que esta migracion NO puede comprobar desde donde esta ---';
  RAISE NOTICE '  rondas NO PROBADAS en esta corrida: % (0 = la sonda corrio completa)', v_no_probado;
  RAISE NOTICE '  (1) Que la APLICACION use los codigos. MXEXL/excel_manda y MXTEC/tecnologia_no_seleccionable';
  RAISE NOTICE '      viajan por PostgREST en error.code/error.message; que la ficha los traduzca a espanol';
  RAISE NOTICE '      llano, y que la ruta de captura acepte campo = tecnologia, es de la app y no se ve aqui.';
  RAISE NOTICE '  (2) La mitad de LECTURA de «el Excel gana». Esta funcion impide CREAR la captura con el';
  RAISE NOTICE '      Excel lleno; no puede impedir que una carga POSTERIOR lo llene. Esa captura seguira';
  RAISE NOTICE '      activa en la tabla, y quien lee (derivaciones.ts) tiene que dar precedencia al Excel.';
  RAISE NOTICE '  (3) Que la API lea la lista de tecnologias_seleccionables() y no de una copia en TypeScript.';
  RAISE NOTICE '  (4) La bandeja: capturar tecnologia NO cierra sku_sin_tecnologia. Clasificar quedo fuera';
  RAISE NOTICE '      por decision del PO; resolver_pendiente, sincronizar_pendientes_tecnologia e';
  RAISE NOTICE '      ingest_snapshot no se tocaron.';
  RAISE NOTICE '  (5) La lista se deriva del dato: si manana un producto visible trae otra tecnologia activa';
  RAISE NOTICE '      en el Excel, se ofrecera. VERTICAL sigue activa en public.tecnologias; esta fuera';
  RAISE NOTICE '      por el DATO —ningun producto visible la usa—, no por una regla ni porque se haya';
  RAISE NOTICE '      desactivado. La guarda (d) lo exige SOLO al aplicar: si una carga posterior trae';
  RAISE NOTICE '      VERTICAL en un producto visible, la lista la ofrecera y la base la aceptara sin aviso.';
  RAISE NOTICE '      Deuda con nombre VERTICAL-FUERA-POR-EL-DATO; que hacer entonces lo decide el PO.';
  RAISE NOTICE '  (6) La huella viva de aplicar_override se midio en produccion el 24-sep-2026 (c2fedb55...,';
  RAISE NOTICE '      la LF) y es la de la 0006. La guarda (0) la volvio a medir en ESTA corrida, que es lo';
  RAISE NOTICE '      unico que cubre un cambio entre aquella lectura y este COMMIT.';
  RAISE NOTICE '  (7) El candado de tabla es SECURITY INVOKER: ve lo que ve quien escribe. Hoy productos,';
  RAISE NOTICE '      snapshots, marcas y tecnologias son USING (true) para authenticated, asi que ve lo';
  RAISE NOTICE '      mismo que la RPC. Si alguien estrecha esa RLS, el MXEXL del candado dejaria de ver los';
  RAISE NOTICE '      SKU ocultos en una escritura DIRECTA (la RPC, DEFINER, los seguiria viendo). Nada lo';
  RAISE NOTICE '      vigila despues de este COMMIT: la sonda (g) solo podria notarlo al re-aplicar, y solo';
  RAISE NOTICE '      si el SKU con Excel que elige quedara entre los ocultos.';
  RAISE NOTICE '  (8) Para un NO admin que escriba la tabla directo, el candado contesta ANTES que la RLS';
  RAISE NOTICE '      (un BEFORE dispara antes del WITH CHECK): recibe MXTEC/MXEXL en vez de 42501, y el';
  RAISE NOTICE '      DETAIL le ensena la lista o el valor del Excel —ambos los lee hoy authenticated—. Si su';
  RAISE NOTICE '      captura pasara el candado, la RLS la rechaza igual.';
  RAISE NOTICE '  (9) El candado no cubre DELETE (authenticated no tiene policy de DELETE: la RLS lo niega)';
  RAISE NOTICE '      ni un UPDATE que deja la MISMA captura activa: ese no se revalida, a proposito, para';
  RAISE NOTICE '      que una captura hecha con el Excel vacio siga siendo tocable cuando el Excel se llene.';
  RAISE NOTICE '  (10) El candado valida CADA captura activa, pero NO impide que haya DOS activas de tecnologia';
  RAISE NOTICE '       para el mismo SKU escribiendo la tabla directo: no hay indice unico sobre (sku, campo)';
  RAISE NOTICE '       activo (idx_productos_override_sku_activo, 0001:414, no es unico). La RPC si desactiva';
  RAISE NOTICE '       la previa antes de insertar; el lector de derivaciones.ts se queda con la de mayor';
  RAISE NOTICE '       (editado_en, id). Que todos los lectores pasen por ahi no se ve desde aqui.';
  RAISE NOTICE '  (11) Conviene aplicarla FUERA de una ventana de ingesta. No fija lock_timeout: el ALTER TABLE';
  RAISE NOTICE '       de (1) toma ACCESS EXCLUSIVE sobre productos_override hasta el COMMIT (quien lea esa';
  RAISE NOTICE '       tabla espera, y el ALTER espera a quien ya la este leyendo), y G2g hace UPDATE de una';
  RAISE NOTICE '       fila de productos que ingest_snapshot tambien escribe (ON CONFLICT (sku) DO UPDATE):';
  RAISE NOTICE '       si coinciden, una transaccion espera a la otra. Quien lee esto ya obtuvo los candados:';
  RAISE NOTICE '       el aviso vale para la proxima aplicacion (esta misma, en otro entorno).';
  RAISE NOTICE '  (12) Vacio es btrim(), que quita SOLO espacios (U+0020). Un productos.tecnologia con solo';
  RAISE NOTICE '       un tabulador, un salto de linea o un espacio duro (U+00A0) cuenta como Excel CON';
  RAISE NOTICE '       valor -> MXEXL, y la comparacion upper(btrim()) con la lista tampoco los quita. Si la';
  RAISE NOTICE '       app decide vacio con otra regla, las dos discrepan en esos valores: al 24-sep-2026,';
  RAISE NOTICE '       textoPresente() de derivaciones.ts usa el trim() de JS, que SI quita los tres, asi que';
  RAISE NOTICE '       el lector veria un hueco donde esta base contesta MXEXL a la captura.';
END $guarda0044$;

-- ----------------------------------------------------------------------------
-- (5) PostgREST cachea el esquema. La RPC nueva `tecnologias_seleccionables`
--     la consume /api/tecnologias, y el servicio que la llama
--     (`src/services/tecnologias.service.ts`) LANZA ante cualquier error
--     —incluido PGRST202, «función no encontrada», que es lo que contesta
--     una caché vieja aunque la función ya exista—. Mismo NOTIFY que la 0036
--     (0036:343-351), que cita al event trigger `pgrst_ddl_watch` como el que
--     ya lo emite ante el DDL; aquí se repite explícito, igual que allá. Va
--     DESPUÉS de la guarda y dentro de la transacción: se entrega en el
--     COMMIT, así que si la guarda aborta no sale.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;
