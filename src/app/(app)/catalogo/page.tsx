import { Suspense } from "react";
import { CatalogoView } from "@/components/catalogo/catalogo-view";
import { CatalogoSkeleton } from "@/components/catalogo/catalogo-skeleton";

// Server shell delgado: solo el header estático. Todo el estado (filtros,
// paginación, vista) vive en `CatalogoView` (isla client) vía la URL —
// `useSearchParams` exige el `<Suspense>` de abajo.
export default function CatalogoPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Catálogo</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Catálogo</h1>
        {/* [CAT-B1·C] Cuatro niveles desde el 17-sep, no tres. Esta es la ÚNICA frase de la
            pantalla que le dice al usuario cómo navegar, así que describir tres mientras el
            árbol pinta cuatro es mentirle sobre el nivel que este tramo acaba de construir.
            El 4.º sólo existe bajo BRAND1 (los SKU con producto son los de BRAND1),
            y por eso se nombra como rama y no como escalón obligatorio. */}
        {/* [CAT-ITER-1 · O-1] LA SEGUNDA FRASE DECLARA UNA PROPIEDAD, NO ADORNA.
            El árbol es un ÍNDICE DE PERTENENCIA, no una partición: `familia` y
            `producto` son campos multi-valor separados por '/' (`separarFamilias`,
            `src/lib/familias.ts`), así que un SKU cuelga de tantas ramas como
            valores tenga y sumar los conteos de las ramas da MÁS que el total.

            Medido sobre el snapshot vigente, rama FAMILIA: en una marca las
            entradas del árbol casi coinciden con sus SKU, y en otras (con muchas
            familias compuestas) las superan de largo; y la rama PRODUCTO bajo
            BRAND1 también suma bastante más entradas que SKU.

            NO se cambia el reparto: forzar «un SKU, una rama» costaría
            cientos de apariciones sólo en EAS y rompería el ENCONTRAR, que es para lo que
            existe el árbol (la regla dura está en la cabecera de `familias.ts`:
            las familias sirven para encontrar, NUNCA para sumar piezas). Lo que
            faltaba no era el reparto: era decirlo donde se lee. El encabezado de
            resultados sigue mostrando el total real de SKU. */}
        <p className="text-[13.5px] text-muted-foreground">
          Navega tecnología → marca → familia, y producto dentro de brand1.
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Un SKU puede tener varias familias —y varios productos—, así que aparece en cada rama que le toca.{" "}
          <strong className="font-medium">Sumar los conteos de las ramas da más que el total:</strong> el total real es
          el que aparece arriba de los resultados.
        </p>
      </header>

      <Suspense fallback={<CatalogoSkeleton />}>
        <CatalogoView />
      </Suspense>
    </div>
  );
}
