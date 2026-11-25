-- Editable front page.
--
-- One row (`id = 'home'`) holds the copy the shop owner changes most often:
-- the banner kicker, heading, subheading, the two buttons and up to four trust
-- points. Categories, featured products and new arrivals stay derived from the
-- catalogue, so the home page cannot contradict the shop.
--
-- No row is inserted here on purpose: the storefront falls back to the shipped
-- defaults, so a fresh deployment is complete before anyone opens the editor.

-- CreateTable
CREATE TABLE "storefront_home" (
    "id" TEXT NOT NULL DEFAULT 'home',
    "kicker" TEXT NOT NULL DEFAULT 'বাংলাদেশে ডেলিভারি',
    "heading" TEXT NOT NULL,
    "subheading" TEXT NOT NULL,
    "primaryLabel" TEXT NOT NULL DEFAULT 'Start shopping',
    "primaryHref" TEXT NOT NULL DEFAULT '/shop',
    "secondaryLabel" TEXT NOT NULL DEFAULT 'Track an order',
    "secondaryHref" TEXT NOT NULL DEFAULT '/track',
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_home_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "storefront_home" ADD CONSTRAINT "storefront_home_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
