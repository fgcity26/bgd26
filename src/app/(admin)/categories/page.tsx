import type { Metadata } from "next";
import { setCategoryActiveAction } from "@/app/actions/categories";
import { CategoryForm } from "@/components/catalog/category-form";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Categories",
  robots: { index: false, follow: false },
};

export default async function CategoriesPage() {
  const session = await requirePagePermission("product.read");
  const canWrite = hasPermission(session, "product.write");

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      nameBn: true,
      code: true,
      slug: true,
      description: true,
      vatPercentage: true,
      parentId: true,
      sortOrder: true,
      isActive: true,
      parent: { select: { name: true } },
      _count: { select: { products: true } },
    },
  });

  const options = categories.map((category) => ({ id: category.id, name: category.name }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
        <p className="mt-1 text-sm text-ink-500">
          শ্রেণি ও ভ্যাট হার। বিক্রয়ের সময় হারটি কপি হয়ে যায়, তাই পরে বদলালেও পুরোনো হিসাব বদলায় না।
        </p>
      </header>

      {canWrite ? (
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold">Add a category</h2>
          <div className="mt-3">
            <CategoryForm mode="create" categories={options} />
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        {categories.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-ink-500 ring-1 ring-slate-200">
            No categories yet.
          </p>
        ) : (
          categories.map((category) => (
            <article key={category.id} className="rounded-2xl bg-white ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-900">{category.name}</h2>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                        category.isActive
                          ? "bg-brand-50 text-brand-700 ring-brand-200"
                          : "bg-slate-100 text-ink-500 ring-slate-200",
                      ].join(" ")}
                    >
                      {category.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-xs text-ink-500">{category.nameBn}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {category.code ? `${category.code} · ` : ""}
                    /{category.slug} · VAT {category.vatPercentage.toString()}% ·{" "}
                    {category._count.products} product(s)
                    {category.parent ? ` · under ${category.parent.name}` : ""}
                  </p>
                </div>

                {canWrite ? (
                  <form action={setCategoryActiveAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="active" value={category.isActive ? "false" : "true"} />
                    <button
                      type="submit"
                      className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-medium text-ink-700 hover:border-brand-300"
                    >
                      {category.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                ) : null}
              </div>

              {canWrite ? (
                <details className="border-t border-slate-100 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">
                    Edit category
                  </summary>
                  <div className="mt-3">
                    <CategoryForm
                      mode="edit"
                      categories={options}
                      category={{
                        id: category.id,
                        name: category.name,
                        nameBn: category.nameBn,
                        code: category.code,
                        slug: category.slug,
                        description: category.description,
                        vatPercentage: category.vatPercentage.toString(),
                        parentId: category.parentId,
                        sortOrder: category.sortOrder,
                      }}
                    />
                  </div>
                </details>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
