-- ============================================================
-- 0024 · [INV-B8] Proyectos — el TERCER CARRIL de propiedad.
--
-- QUÉ ES NUEVO AQUÍ, y no es la tabla. Hasta hoy este esquema tenía dos
-- clases de dato: el INGERIDO (`productos`, `stock_por_almacen`,
-- `reservas`, `embarques` — nace del Excel, la app no lo posee y por eso
-- no lo borra) y el CURADO POR ADMIN (`familias`, `clasificacion_v2`,
-- `productos_override` — lo escribe una persona con rol admin, y `is_admin()`
-- es toda la autorización que hace falta). `proyectos` es el tercero: **dato
-- de un usuario, propiedad de ese usuario**, donde la pregunta no es "¿eres
-- admin?" sino "¿es tuyo?". Es la primera vez que este esquema la hace.
--
-- De ahí salen las tres cosas que esta migración estrena, y conviene que
-- estén juntas y a la vista:
--   · La primera RLS por PROPIETARIO con las cuatro operaciones (hasta hoy
--     el único molde de propiedad era `perfiles_select_own_or_admin`, y solo
--     cubría el SELECT).
--   · La primera policy `FOR DELETE` de todo `public`. La doctrina escrita
--     ("la capa no borra", `0018:117`) se redactó sobre dato INGERIDO: sobre
--     hechos que el portal no produjo y no puede reponer. Una partida no es
--     un hecho del libro: es un renglón de trabajo que su dueño escribió y
--     puede desescribir. **Decisión de producto, tomada con esta distinción
--     enfrente (STOP&ASK del bloque, 2026-08-12).**
--   · El primer `.delete()` que va a existir en `src/` (hoy el grep solo
--     encuentra `URLSearchParams.delete` y `Set.delete`).
--
-- LO QUE ESTA MIGRACIÓN CIERRA DE OTRA. La 0020 dejó escrito, textualmente,
-- lo que su propia guarda NO podía comprobar:
--
--     «que una tabla creada MÁS ADELANTE nazca sin TRUNCATE. Esta guarda lee
--      el catálogo de defaults, no crea una tabla de prueba para medir el ACL
--      con el que nace. […] El EFECTO en una tabla futura solo lo puede
--      comprobar la migración que la cree.»
--
-- Ésta es esa migración, y la comprueba: la guarda final exige
-- `has_table_privilege(...,'TRUNCATE') = false` sobre las dos tablas recién
-- creadas y ABORTA si no. No se hereda la promesa de la 0020: se mide el
-- efecto. Además se revoca explícitamente, porque el default de
-- `supabase_admin` sigue concediendo la `D` (medido:
-- `anon=arwdDxtm/supabase_admin`) y este archivo no puede saber qué rol lo
-- estará ejecutando.
--
-- POR QUÉ NO HAY FUNCIÓN NUEVA. El primer diseño llevaba un helper
-- `es_visitante()` `SECURITY DEFINER` al molde de `is_admin()`. Se descartó:
-- la investigación 2.0 (§R4) midió una fuga viva causada exactamente por eso
-- —`contar_pendientes()`, `SECURITY DEFINER` sin guarda, con EXECUTE para
-- `authenticated`— y cada función privilegiada nueva es superficie nueva. El
-- predicado se resuelve con un `EXISTS` sobre `perfiles`, que ya es legible
-- por su dueño gracias a `perfiles_select_own_or_admin` (0012:874-879). Cero
-- privilegio nuevo, misma regla, y falsificable leyendo la policy.
--
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo que no se pueda reconstruir
--      con una re-ingesta ni con otra migración?
--      **NO.** Cero DELETE, cero UPDATE, cero TRUNCATE sobre dato existente.
--      Todo es creación (2 tablas, 1 secuencia, 3 índices, 8 policies, 1
--      función y 1 trigger) más GRANT/REVOKE de privilegios. Revertir es
--      `DROP TABLE public.proyecto_partidas; DROP TABLE public.proyectos;
--      DROP FUNCTION public.tocar_actualizado_en();` — la secuencia se va
--      sola con la tabla porque queda `OWNED BY proyectos.numero`, y el
--      trigger con ella. Como las tablas nacen vacías en esta transacción,
--      revertir en el acto no pierde ni una fila.
--
--   2. ¿Tiene tope de radio de impacto que aborte si toca más de lo previsto?
--      **Sí, por construcción:** las únicas tablas nombradas son las dos que
--      esta migración crea. No hay una sola sentencia que escriba en una
--      tabla preexistente. La guarda final lo verifica contando filas.
--
--   3. ¿Qué NO puede comprobar este archivo desde SQL?
--      Que las rutas de `/api/proyectos` respondan; que el visitante no vea
--      la entrada del menú; que dos KAMs no se lean entre sí a través de
--      PostgREST con un JWT real. Eso lo miden `scripts/rls-negativas.mjs` y
--      el gate de seguridad del bloque, por HTTP y con sesiones reales.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) FOTO DEL ANTES — control anti-vacuidad.
--
--     Sin esto, correr la migración dos veces daría "verde" la segunda,
--     y ese verde no probaría nada: las tablas ya existirían. Los valores
--     viajan a la guarda final en GUCs LOCALES (`is_local := true`), que
--     mueren con el COMMIT o el ROLLBACK.
-- ------------------------------------------------------------
DO $antes0024$
DECLARE
  v_tablas_antes integer;
BEGIN
  SELECT count(*) INTO v_tablas_antes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('proyectos', 'proyecto_partidas');

  PERFORM set_config('inv_b8.tablas_antes', v_tablas_antes::text, true);
END $antes0024$;

-- ------------------------------------------------------------
-- (1) LA SECUENCIA DEL FOLIO.
--
--     El folio es la identidad LEGIBLE (`PRJ-001`, literal de la maqueta);
--     `id` es la identidad ESTABLE. Son dos cosas distintas a propósito: el
--     folio se enseña, se dicta por teléfono y se pega en un correo; el uuid
--     viaja en las URLs y en las FKs. Colapsarlas obligaría a exponer un
--     uuid en el documento o a usar un texto como PK.
--
--     La secuencia NO es libre de huecos, y está bien: un INSERT que aborta
--     consume su número. Un folio con huecos es correcto; un folio que se
--     repite, no. `UNIQUE` protege lo segundo.
--
--     `OWNED BY` no es cosmético: sin él, un `DROP TABLE proyectos` deja la
--     secuencia huérfana y el rollback que promete la cabecera depende de
--     que alguien recuerde un tercer DROP. Con él, la secuencia muere con
--     su columna.
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.proyectos_folio_seq AS integer START 1;

-- ------------------------------------------------------------
-- (2) LAS DOS TABLAS.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proyectos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- El número consecutivo, crudo. Se guarda como INTEGER y no solo como
  -- texto dentro del folio: así se ordena y se audita sin parsear cadenas.
  numero       integer NOT NULL DEFAULT nextval('public.proyectos_folio_seq'),

  -- 'PRJ-' + AL MENOS 3 dígitos, DERIVADO de `numero`. Es columna generada
  -- y no un DEFAULT por dos razones, y la segunda es un bug evitado:
  --
  -- (1) El folio es una FUNCIÓN del número. Como generada, no puede
  --     desincronizarse ni siquiera con un UPDATE malicioso.
  -- (2) La expresión necesita el valor DOS veces (para medirlo y para
  --     rellenarlo). En un DEFAULT eso obligaría a `nextval` + `currval` en
  --     la misma expresión, y el orden de evaluación de los argumentos no
  --     está garantizado. Aquí `nextval` se llama UNA vez, en el DEFAULT de
  --     `numero`, y la generada lo lee de la fila.
  --
  -- El `greatest(3, length(...))` no es adorno defensivo: sin él esto es un
  -- bug con fecha de detonación. `lpad(t,3,'0')` **TRUNCA POR LA DERECHA**
  -- cuando `t` excede 3 caracteres — medido contra esta misma base:
  --     lpad('999',3,'0') = '999'   ·   lpad('1000',3,'0') = '100'
  --     lpad('1001',3,'0') = '100'  ·   lpad('99999',3,'0') = '999'
  -- Con la forma ingenua, el proyecto 1000 choca con el folio de `PRJ-100`
  -- (UNIQUE ⟹ 23505) y, al ser determinista, TODOS los siguientes hasta el
  -- 9999 producen la misma cadena: el alta quedaría muerta para siempre y
  -- reintentar no serviría. `to_char(n,'FM000')` —el remedio que parece
  -- obvio— tampoco sirve: da '###' para n ≥ 1000. También medido.
  -- La guarda final evalúa la expresión en 999/1000/1001 y aborta si dos
  -- coinciden.
  folio        text GENERATED ALWAYS AS
               ('PRJ-' || lpad(numero::text, greatest(3, length(numero::text)), '0')) STORED,

  titulo       text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 120),
  descripcion  text CHECK (descripcion IS NULL OR length(descripcion) <= 500),
  notas        text CHECK (notas IS NULL OR length(notas) <= 1000),

  -- Fecha de NEGOCIO del proyecto (la que pinta la maqueta), no la de
  -- creación. Su default es hoy EN MÉXICO, con la zona declarada en el
  -- dato — misma regla que `src/lib/fechas.ts`: la zona la fija el dato,
  -- nunca se hereda de dónde corra el proceso. `now()::date` a secas
  -- habría dado el día siguiente a partir de las 18:00 CDMX.
  fecha        date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date),

  -- Los dos chips de la maqueta ("Etapa A", "Etapa B", "Etapa C").
  -- TEXTO LIBRE ACOTADO, no un catálogo con CHECK: un CHECK sería un
  -- catálogo hardcodeado —justo lo que D5 prohíbe para el eje de
  -- agrupación— y obligaría a una migración para admitir un tipo nuevo.
  -- La UI ofrece los valores ya usados, leídos del dato real.
  tipo         text CHECK (tipo IS NULL OR length(btrim(tipo)) BETWEEN 1 AND 40),
  intencion    text CHECK (intencion IS NULL OR length(btrim(intencion)) BETWEEN 1 AND 40),

  -- El dueño es la CUENTA que lo creó (D3). No `kams`: los KAM del Excel
  -- son nombres de pila sin correo y no empatan con ninguna cuenta
  -- (investigación §R3-13). El DEFAULT lo llena la base, y la app NO envía
  -- esta columna en ningún INSERT: así no existe un camino de código donde
  -- el cliente elija de quién es el proyecto.
  --
  -- POR QUÉ ES NULLABLE, si el dueño es obligatorio. Porque `NOT NULL` aquí
  -- deja cuentas IMPOSIBLES DE BORRAR. La cadena: `perfiles.id → auth.users(id)
  -- ON DELETE CASCADE` (0010:128), así que borrar una cuenta intenta borrar
  -- su perfil; con una FK `NO ACTION` desde aquí, ese borrado se bloquea con
  -- 23503. No es hipotético: `scripts/rls-negativas.mjs` y
  -- los demás arneses de QA vivos FABRICAN Y DESTRUYEN cuentas efímeras en
  -- cada corrida (el primero además cuadra el saldo de `auth.users`) — una
  -- cuenta de arnés que llegara a crear un proyecto rompería la limpieza. Y en
  -- operación real, un KAM que se va dejaría una cuenta indestruible: ni él
  -- (ya no existe), ni el admin (las policies de escritura le niegan estos
  -- proyectos a propósito), ni el operador (la FK bloquea).
  --
  -- `ON DELETE SET NULL` es la única de las tres salidas que no destruye ni
  -- bloquea: `CASCADE` borraría el trabajo en silencio, `RESTRICT` deja el
  -- problema tal cual. El proyecto huérfano sobrevive y queda **visible solo
  -- para admin y no editable por nadie** — porque `NULL = auth.uid()` es NULL,
  -- que no es TRUE, así que todas las policies de propiedad lo excluyen y solo
  -- lo alcanza la rama `is_admin()` del SELECT. Es un estado final legible.
  --
  -- El fail-closed no se pierde al quitar `NOT NULL`: lo sostiene el
  -- `WITH CHECK (propietario = (SELECT auth.uid()))` de la policy de INSERT,
  -- que con `auth.uid()` NULL evalúa a NULL y RECHAZA. La garantía se mueve
  -- de la columna a la policy; no desaparece.
  propietario  uuid DEFAULT auth.uid() REFERENCES public.perfiles(id) ON DELETE SET NULL,

  creado_en      timestamptz NOT NULL DEFAULT now(),

  -- `docs/data-model.md` (invariants) declara como invariante del
  -- proyecto: "Concurrencia optimista (`updated_at`) en ediciones de app".
  -- Ésta es la PRIMERA tabla del repo con edición real de usuario, así que es
  -- la primera que puede honrarlo o incumplirlo. Lleva la columna Y su
  -- escritor: `familias.activo` estuvo 18 migraciones sin ninguno, y la 0020
  -- dejó escrito que una columna sin escritor es dato declarado, no bitácora.
  --
  -- HONESTIDAD SOBRE EL ALCANCE: esta columna registra CUÁNDO se editó por
  -- última vez. El compare-and-swap (rechazar un PATCH cuyo `actualizado_en`
  -- no coincide) NO está implementado en B8: dos pestañas del mismo dueño
  -- todavía se pisan. Queda con nombre en docs/known-limitations.md. La columna
  -- es el prerrequisito, no la solución.
  actualizado_en timestamptz NOT NULL DEFAULT now(),

  -- Va como constraint de tabla y no inline porque una columna generada no
  -- admite `UNIQUE` en su propia definición. Es lo que impide que el bug del
  -- folio (si alguien vuelve a la forma ingenua) pase inadvertido: con esto
  -- revienta con 23505; sin esto, dos proyectos distintos comparten folio y
  -- nadie se entera hasta que alguien dicta uno por teléfono.
  CONSTRAINT proyectos_folio_unico UNIQUE (folio)
);

-- El escritor de `actualizado_en`. Único precedente de trigger propio de
-- tabla en el repo: `before_update_sku` (0001:469).
CREATE OR REPLACE FUNCTION public.tocar_actualizado_en()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $fn$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS before_update_proyecto ON public.proyectos;
CREATE TRIGGER before_update_proyecto
  BEFORE UPDATE ON public.proyectos
  FOR EACH ROW EXECUTE FUNCTION public.tocar_actualizado_en();

-- La secuencia muere con su columna (ver la pieza 1). Va aquí y no allá
-- porque `OWNED BY` exige que la tabla ya exista.
ALTER SEQUENCE public.proyectos_folio_seq OWNED BY public.proyectos.numero;

-- Índice para el filtro de RLS: toda lectura de un KAM es
-- `WHERE propietario = auth.uid()`.
CREATE INDEX IF NOT EXISTS idx_proyectos_propietario ON public.proyectos(propietario);

CREATE TABLE IF NOT EXISTS public.proyecto_partidas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id  uuid NOT NULL REFERENCES public.proyectos(id) ON DELETE CASCADE,

  -- FK a la LLAVE INMUTABLE. `productos.sku` no se borra nunca (verificado
  -- por triple vía en la investigación §R3-17: la ingesta solo hace
  -- `INSERT … ON CONFLICT (sku) DO UPDATE`, no hay `DELETE FROM productos`
  -- en ninguna migración, y no hay un solo `.delete()` en `src/`), y el
  -- trigger `before_update_sku` impide renombrarlo. Por eso esta FK NO
  -- puede quedar colgando: cuando un SKU sale del Excel deja de actualizar
  -- su `snapshot_id` y desaparece de las lecturas pinneadas, pero la fila
  -- sigue ahí. Ya pasó (medido). Eso es un problema
  -- de VISIBILIDAD, y se resuelve en lectura — no aquí.
  sku          text NOT NULL REFERENCES public.productos(sku),

  cantidad     integer NOT NULL CHECK (cantidad > 0),
  agregado_en  timestamptz NOT NULL DEFAULT now(),

  -- "piezas por SKU · sin duplicados", literal de la maqueta.
  UNIQUE (proyecto_id, sku)
);

-- Postgres NO indexa las FKs solo. Sin éste, cualquier consulta por SKU
-- (y el chequeo de integridad referencial) haría barrido secuencial.
CREATE INDEX IF NOT EXISTS idx_proyecto_partidas_sku ON public.proyecto_partidas(sku);

-- ------------------------------------------------------------
-- (3) RLS — el molde de PROPIEDAD, completo.
--
--     `perfiles_select_own_or_admin` (0012:874-879) es el único precedente
--     de propiedad del repo y solo cubre el SELECT. Aquí hacen falta las
--     cuatro, y dos detalles que no se pueden copiar de él:
--
--     (a) El `UPDATE` lleva `USING` **Y** `WITH CHECK`. Con solo `USING`,
--         el dueño podría ejecutar `UPDATE proyectos SET propietario = <otro>`
--         sobre una fila que sí le pertenece: la fila pasa el filtro de
--         entrada y la nueva versión no se valida. Es regalar el proyecto —
--         o quedarse con el de otro si se combina con un INSERT. La
--         investigación lo marcó como "explotable" (§R3-16).
--     (b) El `(SELECT auth.uid())` va envuelto: el planificador lo trata
--         como InitPlan y lo evalúa UNA vez por consulta en vez de una vez
--         por fila. Optimización ya ratificada en este repo.
-- ------------------------------------------------------------
ALTER TABLE public.proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proyecto_partidas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proyectos_select_own_or_admin ON public.proyectos;
CREATE POLICY proyectos_select_own_or_admin ON public.proyectos
  FOR SELECT TO authenticated
  USING (propietario = (SELECT auth.uid()) OR public.is_admin());

-- El visitante no crea proyectos. Se comprueba con un EXISTS sobre su
-- PROPIO perfil (legible por `perfiles_select_own_or_admin`), no con una
-- función `SECURITY DEFINER` nueva — ver la cabecera.
--
-- Nótese que sin esta condición la regla igual se cumpliría "de hecho": un
-- visitante que no puede insertar tampoco tiene nada que leer. Pero eso es
-- una propiedad EMERGENTE, y una regla que solo existe como consecuencia no
-- se puede leer ni falsificar. Aquí está escrita.
DROP POLICY IF EXISTS proyectos_insert_own_no_visitante ON public.proyectos;
CREATE POLICY proyectos_insert_own_no_visitante ON public.proyectos
  FOR INSERT TO authenticated
  WITH CHECK (
    propietario = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.perfiles p
       WHERE p.id = (SELECT auth.uid()) AND p.rol <> 'visitante'
    )
  );

DROP POLICY IF EXISTS proyectos_update_own ON public.proyectos;
CREATE POLICY proyectos_update_own ON public.proyectos
  FOR UPDATE TO authenticated
  USING (propietario = (SELECT auth.uid()))
  WITH CHECK (propietario = (SELECT auth.uid()));

DROP POLICY IF EXISTS proyectos_delete_own ON public.proyectos;
CREATE POLICY proyectos_delete_own ON public.proyectos
  FOR DELETE TO authenticated
  USING (propietario = (SELECT auth.uid()));

-- Las partidas heredan la propiedad del proyecto padre. El `EXISTS` ve
-- `proyectos` a través de SU PROPIA RLS (las policies de una tabla también
-- se aplican dentro de la subconsulta de otra policy), así que la regla se
-- expresa una vez y se aplica dos veces sin poder divergir.
--
-- El admin NO entra en las de escritura, y es deliberado: puede LEER
-- cualquier proyecto (supervisión) pero no editar el trabajo de un KAM sin
-- que quede rastro de quién lo hizo. Esta tabla no tiene columna de autoría
-- por fila; dársela al admin sería permitir una edición anónima.
DROP POLICY IF EXISTS proyecto_partidas_select_own_or_admin ON public.proyecto_partidas;
CREATE POLICY proyecto_partidas_select_own_or_admin ON public.proyecto_partidas
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.proyectos p
     WHERE p.id = proyecto_id
       AND (p.propietario = (SELECT auth.uid()) OR public.is_admin())
  ));

DROP POLICY IF EXISTS proyecto_partidas_insert_own ON public.proyecto_partidas;
CREATE POLICY proyecto_partidas_insert_own ON public.proyecto_partidas
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.proyectos p
     WHERE p.id = proyecto_id AND p.propietario = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS proyecto_partidas_update_own ON public.proyecto_partidas;
CREATE POLICY proyecto_partidas_update_own ON public.proyecto_partidas
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.proyectos p
     WHERE p.id = proyecto_id AND p.propietario = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.proyectos p
     WHERE p.id = proyecto_id AND p.propietario = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS proyecto_partidas_delete_own ON public.proyecto_partidas;
CREATE POLICY proyecto_partidas_delete_own ON public.proyecto_partidas
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.proyectos p
     WHERE p.id = proyecto_id AND p.propietario = (SELECT auth.uid())
  ));

-- ------------------------------------------------------------
-- (4) PRIVILEGIOS.
--
--     La 0020 arregló el default de `postgres` (medido:
--     `anon=arwdxtm`, sin la `D`). El de `supabase_admin` SIGUE con ella
--     (`anon=arwdDxtm`). Cuál de los dos aplica depende de qué rol ejecute
--     esta migración, y este archivo no puede saberlo: `aplicar-migracion.mjs`
--     conecta como `postgres`, pero el mismo .sql aplicado desde el panel o
--     por MCP correría como otro. Por eso el REVOKE es incondicional y la
--     guarda final mide el EFECTO, no la intención.
--
--     `anon` pierde TODO. Hoy ya no puede hacer nada (ninguna policy lo
--     nombra, así que RLS lo niega), pero eso lo protege la RLS; esto lo
--     protege el privilegio. Son dos capas y esta tabla es la primera con
--     datos de una persona identificable.
-- ------------------------------------------------------------
REVOKE TRUNCATE ON public.proyectos, public.proyecto_partidas FROM anon, authenticated;
REVOKE ALL      ON public.proyectos, public.proyecto_partidas FROM anon;
REVOKE ALL      ON SEQUENCE public.proyectos_folio_seq FROM anon;

-- LOS GRANTS QUE FALTABAN, Y POR QUÉ SE ESCRIBEN AUNQUE HOY YA ESTÉN.
--
-- Sin ellos, todo este módulo depende de un DEFAULT ACL de plataforma que
-- esta migración no otorga: si ese default cambiara, las 8 policies serían
-- irrelevantes —42501 en producción— y la guarda de abajo saldría verde
-- igual, porque estaría midiendo algo que nadie prometió. Un GRANT
-- explícito convierte un privilegio HEREDADO en un privilegio DECLARADO, y
-- solo entonces tiene sentido verificarlo. Son idempotentes.
--
-- El de la SECUENCIA es el que de verdad muerde: sin `USAGE`, el DEFAULT de
-- `numero` falla con 42501 en CADA alta de un KAM, y ese fallo aparecería en
-- producción, no aquí.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proyectos, public.proyecto_partidas TO authenticated;
GRANT USAGE ON SEQUENCE public.proyectos_folio_seq TO authenticated;

-- ------------------------------------------------------------
-- (5) COMENTARIOS EN LA BASE.
--
--     Quien vaya a tirar una de estas columnas estará mirando el esquema,
--     no este archivo.
-- ------------------------------------------------------------
COMMENT ON TABLE  public.proyectos IS
  '[INV-B8] Proyectos del portal. TERCER CARRIL: dato originado por el usuario, no ingerido. La ingesta NUNCA lo toca — `ingest_snapshot` escribe una lista literal de 9 tablas y ninguna es ésta (verificado contra la función desplegada, 0022, el 2026-08-12). Propiedad por `propietario`, con RLS en las 4 operaciones.';
COMMENT ON COLUMN public.proyectos.numero IS
  'Consecutivo crudo del folio. La secuencia admite huecos (un INSERT abortado consume su número) y eso es correcto; lo que no admite es repetirse.';
COMMENT ON COLUMN public.proyectos.folio IS
  'Identidad LEGIBLE (PRJ-001), para enseñar y dictar; la ESTABLE es `id`. GENERADA a partir de `numero`, así no puede desincronizarse. El relleno es `greatest(3, length(numero))`: con `lpad(n,3,''0'')` a secas, el proyecto 1000 producía PRJ-100 y colisionaba con el 100 — lpad TRUNCA por la derecha.';
COMMENT ON COLUMN public.proyectos.propietario IS
  'La CUENTA que lo creó (auth.uid()), no un KAM del Excel: `perfiles` y `kams` son dos universos sin puente y así se quedan (decisión D3 del bloque INV-B8). Lo llena el DEFAULT, no la app — no existe un camino de código donde el cliente elija dueño. NULLABLE con ON DELETE SET NULL para que borrar una cuenta sea posible: el proyecto huérfano sobrevive, visible SOLO para admin y no editable por nadie. El fail-closed del alta lo sostiene el WITH CHECK de la policy, no la columna.';
COMMENT ON COLUMN public.proyectos.actualizado_en IS
  'Última edición, escrita por el trigger `before_update_proyecto`. Honra el invariante de `docs/data-model.md`. OJO: registra CUÁNDO se editó; el compare-and-swap que evitaría que dos pestañas se pisen NO está implementado (deuda con nombre en docs/known-limitations.md).';
COMMENT ON COLUMN public.proyectos.fecha IS
  'Fecha de NEGOCIO del proyecto, elegible por el usuario. No es la de creación (ésa es `creado_en`). Su default es hoy en America/Mexico_City, con la zona declarada en el dato.';
COMMENT ON TABLE  public.proyecto_partidas IS
  '[INV-B8] Piezas por SKU de un proyecto, sin duplicados (UNIQUE proyecto_id,sku). NO guarda cifras de disponibilidad: se re-derivan en lectura con `derivarSku` sobre el snapshot vigente pinneado, para que documento y pantalla no puedan contradecirse en el mismo instante. La fecha de esas cifras la declara el documento.';
COMMENT ON COLUMN public.proyecto_partidas.sku IS
  'FK a la llave inmutable. Nunca queda colgando: `productos` no borra filas. Un SKU que sale del Excel deja de actualizar su `snapshot_id` y se vuelve invisible en las lecturas pinneadas — eso se resuelve en lectura (`fueraDelVigente`), no con una bandera aquí.';

-- ------------------------------------------------------------
-- (6) GUARDA FINAL — verifica por EFECTO, no por intención.
-- ------------------------------------------------------------
DO $guarda0024$
DECLARE
  v_antes        integer := coalesce(nullif(current_setting('inv_b8.tablas_antes', true), ''), '0')::integer;
  v_reservas     integer := 0;
  v_policies     integer;
  v_filas        integer;
  v_trunc_anon   boolean;
  v_trunc_auth   boolean;
  v_seq_usage    boolean;
  v_upd_sin_chk  integer;
  v_folio        text;
BEGIN
  -- (a) Control anti-vacuidad: ¿esta corrida CREÓ las tablas, o llegó tarde?
  IF v_antes > 0 THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0024 · AVISO ANTI-VACUIDAD: % de las 2 tablas YA existían antes de esta migración. Su verde no prueba que este archivo las haya creado.', v_antes;
  ELSE
    RAISE NOTICE '0024 · Las 2 tablas no existían antes y existen ahora: la creación es de esta migración.';
  END IF;

  -- (b) EL CIERRE DE LO QUE LA 0020 DECLARÓ NO PODER COMPROBAR.
  --     No se hereda la promesa: se mide el privilegio real con el que
  --     nacieron las dos tablas.
  SELECT has_table_privilege('anon', 'public.proyectos', 'TRUNCATE'),
         has_table_privilege('authenticated', 'public.proyectos', 'TRUNCATE')
    INTO v_trunc_anon, v_trunc_auth;

  IF v_trunc_anon OR v_trunc_auth THEN
    RAISE EXCEPTION '0024: proyectos nació con TRUNCATE para anon=% / authenticated=% y el REVOKE de la pieza (4) no lo quitó. RLS no cubre TRUNCATE: esto vacía la tabla saltándose todas las policies. Abortando.', v_trunc_anon, v_trunc_auth;
  END IF;

  SELECT has_table_privilege('anon', 'public.proyecto_partidas', 'TRUNCATE'),
         has_table_privilege('authenticated', 'public.proyecto_partidas', 'TRUNCATE')
    INTO v_trunc_anon, v_trunc_auth;

  IF v_trunc_anon OR v_trunc_auth THEN
    RAISE EXCEPTION '0024: proyecto_partidas nació con TRUNCATE para anon=% / authenticated=%. Abortando.', v_trunc_anon, v_trunc_auth;
  END IF;

  RAISE NOTICE '0024 · TRUNCATE verificado POR EFECTO en las 2 tablas nuevas: anon=false, authenticated=false. Esto es lo que la 0020 dejó escrito que su guarda NO podía comprobar.';

  -- (c) Las 8 policies existen y ninguna de UPDATE se quedó sin WITH CHECK.
  --     Un UPDATE con USING pero sin WITH CHECK deja reasignar `propietario`.
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('proyectos', 'proyecto_partidas');

  IF v_policies <> 8 THEN
    RAISE EXCEPTION '0024: se esperaban 8 policies sobre las 2 tablas y hay %. Abortando.', v_policies;
  END IF;

  SELECT count(*) INTO v_upd_sin_chk
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('proyectos', 'proyecto_partidas')
     AND cmd = 'UPDATE' AND with_check IS NULL;

  IF v_upd_sin_chk > 0 THEN
    RAISE EXCEPTION '0024: % policy(s) de UPDATE sin WITH CHECK. Con solo USING, el dueño puede reasignar `propietario` y regalar (o apropiarse de) un proyecto. Abortando.', v_upd_sin_chk;
  END IF;

  RAISE NOTICE '0024 · 8 policies presentes; las 2 de UPDATE llevan USING y WITH CHECK.';

  -- (d) RLS de verdad ENCENDIDA. Crear policies sobre una tabla con RLS
  --     apagada las deja decorativas: no fallan, no se aplican.
  IF NOT (SELECT bool_and(c.relrowsecurity)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname IN ('proyectos', 'proyecto_partidas'))
  THEN
    RAISE EXCEPTION '0024: alguna de las 2 tablas quedó con RLS deshabilitada — sus policies serían decorativas. Abortando.';
  END IF;

  -- (e) LOS PRIVILEGIOS QUE EL MÓDULO NECESITA, en positivo.
  --
  --     La guarda de TRUNCATE de arriba verifica lo que debe estar AUSENTE.
  --     Ésta verifica lo que debe estar PRESENTE, que es la mitad que se
  --     olvida: sin ella, unas policies impecables sobre una tabla sin
  --     GRANT dan 42501 en producción con la migración en verde.
  IF NOT (
    has_table_privilege('authenticated', 'public.proyectos', 'SELECT') AND
    has_table_privilege('authenticated', 'public.proyectos', 'INSERT') AND
    has_table_privilege('authenticated', 'public.proyectos', 'UPDATE') AND
    has_table_privilege('authenticated', 'public.proyectos', 'DELETE') AND
    has_table_privilege('authenticated', 'public.proyecto_partidas', 'SELECT') AND
    has_table_privilege('authenticated', 'public.proyecto_partidas', 'INSERT') AND
    has_table_privilege('authenticated', 'public.proyecto_partidas', 'UPDATE') AND
    has_table_privilege('authenticated', 'public.proyecto_partidas', 'DELETE')
  ) THEN
    RAISE EXCEPTION '0024: `authenticated` no tiene los 4 verbos sobre las 2 tablas. Las policies serían irrelevantes y el módulo daría 42501. Abortando.';
  END IF;

  --     El DEFAULT de `numero` necesita USAGE sobre la secuencia para el rol
  --     que de verdad inserta. Sin él, cada alta de un KAM muere con 42501.
  SELECT has_sequence_privilege('authenticated', 'public.proyectos_folio_seq', 'USAGE')
    INTO v_seq_usage;

  IF NOT v_seq_usage THEN
    RAISE EXCEPTION '0024: `authenticated` no tiene USAGE sobre proyectos_folio_seq — el DEFAULT de `numero` fallaría con 42501 en cada alta. Abortando.';
  END IF;

  IF has_sequence_privilege('anon', 'public.proyectos_folio_seq', 'USAGE') THEN
    RAISE EXCEPTION '0024: `anon` conserva USAGE sobre proyectos_folio_seq pese al REVOKE. Abortando.';
  END IF;

  RAISE NOTICE '0024 · Privilegios verificados EN POSITIVO: authenticated tiene los 4 verbos sobre las 2 tablas y USAGE sobre la secuencia; anon no tiene nada.';

  -- (f) EL BUG DEL FOLIO 1000, cazado por la guarda en vez de por un cliente.
  --
  --     Se evalúa la MISMA expresión de la columna generada en los tres
  --     puntos donde la forma ingenua se rompe. Con `lpad(n,3,'0')` a secas,
  --     1000 y 1001 producían ambos 'PRJ-100' y colisionaban con el folio
  --     999+1. Esto lo detecta sin insertar una sola fila y sin consumir la
  --     secuencia.
  IF (SELECT count(DISTINCT f) FROM (
        SELECT 'PRJ-' || lpad(n::text, greatest(3, length(n::text)), '0') AS f
          FROM (VALUES (99), (100), (999), (1000), (1001), (99999)) AS v(n)
      ) s) <> 6
  THEN
    RAISE EXCEPTION '0024: la expresión del folio produce COLISIONES en los bordes (99/100/999/1000/1001/99999 no dan 6 valores distintos). Es el bug de lpad truncando por la derecha. Abortando.';
  END IF;

  SELECT 'PRJ-' || lpad(n::text, greatest(3, length(n::text)), '0') INTO v_folio
    FROM (VALUES (1000)) AS v(n);
  RAISE NOTICE '0024 · Folio verificado en los bordes: 6 valores distintos para 99/100/999/1000/1001/99999 (el 1000 da %). La secuencia NO se consumió: el primer proyecto real será PRJ-001.', v_folio;

  -- (f-bis) El escritor de `actualizado_en` existe. Una columna sin escritor
  --         es dato declarado, no bitácora — la lección de `familias.activo`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.proyectos'::regclass
       AND tgname = 'before_update_proyecto' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '0024: falta el trigger before_update_proyecto — actualizado_en no tendría escritor y mentiría desde el día uno. Abortando.';
  END IF;

  -- (f-ter) La FK del propietario debe ser SET NULL ('n'), no NO ACTION.
  --         Con NO ACTION, borrar una cuenta con proyectos es imposible para
  --         todos: dueño, admin y operador. Ver el comentario de la columna.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.proyectos'::regclass
       AND contype = 'f' AND confdeltype = 'n'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.proyectos'::regclass AND attname = 'propietario')]
  ) THEN
    RAISE EXCEPTION '0024: la FK de propietario no quedó con ON DELETE SET NULL. Con NO ACTION, una cuenta con proyectos no la puede borrar nadie (perfiles cascadea desde auth.users). Abortando.';
  END IF;

  -- (g) Radio de impacto: las tablas nacen vacías y ninguna otra se tocó.
  SELECT (SELECT count(*) FROM public.proyectos) + (SELECT count(*) FROM public.proyecto_partidas)
    INTO v_filas;

  IF v_filas <> 0 THEN
    RAISE EXCEPTION '0024: las tablas nuevas tienen % fila(s) y esta migración no escribe ninguna. Abortando.', v_filas;
  END IF;

  -- ==========================================================
  -- LO QUE ESTA GUARDA **NO** PUEDE COMPROBAR DESDE SQL
  -- ==========================================================
  RAISE NOTICE '0024 · NO COMPROBADO AQUÍ: que dos KAMs no se lean entre sí. Esta guarda lee `pg_policies`, no ejecuta las policies con dos JWT distintos. Lo mide el gate de seguridad del bloque por HTTP contra PostgREST, con sesiones reales.';
  RAISE NOTICE '0024 · NO COMPROBADO AQUÍ: que la ingesta no toque estas tablas. Se apoya en que `ingest_snapshot` escribe una lista literal de 9 tablas, sin SQL dinámico — verificado contra la función DESPLEGADA (0022) el 2026-08-12, no contra el disco. Pero `CREATE OR REPLACE` puede sustituirla y su guarda solo verifica MUST-CONTAIN: nada impide que una redefinición futura agregue un INSERT aquí, y al ser SECURITY DEFINER la RLS de estas tablas no la detendría. Es el riesgo R-2 de la investigación 2.0, y sigue abierto.';
  RAISE NOTICE '0024 · NO COMPROBADO AQUÍ: que PostgREST haya recargado su cache de esquema. Si la primera llamada a /api/proyectos diera 42P01 o 42703, es cache, no migración.';
  RAISE NOTICE '0024 · RESIDUAL CONOCIDO, no cerrado: el default ACL de `supabase_admin` en public sigue concediendo TRUNCATE a anon/authenticated. No afecta a estas dos tablas (el REVOKE de la pieza 4 se verificó por efecto arriba), pero la siguiente tabla que cree ese rol volvería a nacer con el hueco. El PO decidió no tocarlo (0020).';

  IF v_reservas = 0 THEN
    RAISE NOTICE '0024 · GUARDA VERDE: 2 tablas, 8 policies, TRUNCATE cerrado por efecto, 0 reservas.';
  ELSE
    RAISE NOTICE '0024 · GUARDA VERDE CON RESERVAS: % veredicto(s) salieron sobre un universo que ya estaba, así que "verde" aquí significa "no contradicho", no "probado".', v_reservas;
  END IF;
END $guarda0024$;

COMMIT;
