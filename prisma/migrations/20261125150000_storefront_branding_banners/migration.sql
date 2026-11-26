-- Storefront brand mark and the six-slide banner carousel.
--
-- Slide 1 keeps using the copy already stored in `storefront_home`; it only
-- gains an optional background photo. Slides 2–6 live in `storefront_banners`,
-- one row per fixed slot. Fixed slots are what cap the carousel at six: there is
-- no counter to drift and no way to add a seventh banner.
--
-- A cleared slot keeps its row with `isActive = false` — the same no-hard-delete
-- rule the rest of the system follows. No rows are inserted here: an empty slot
-- simply does not rotate, and the shop still renders the hero copy.

-- AlterTable
ALTER TABLE "storefront_home" ADD COLUMN     "heroImageAssetId" TEXT,
ADD COLUMN     "logoAssetId" TEXT,
ADD COLUMN     "logoText" TEXT NOT NULL DEFAULT 'bgd26';

-- CreateTable
CREATE TABLE "storefront_banners" (
    "id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "imageAssetId" TEXT,
    "linkLabel" TEXT NOT NULL DEFAULT '',
    "linkHref" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_banners_pkey" PRIMARY KEY ("id"),
    -- Even a manual insert cannot invent a seventh banner.
    CONSTRAINT "storefront_banners_slot_range" CHECK ("slot" BETWEEN 2 AND 6)
);

-- CreateIndex
CREATE UNIQUE INDEX "storefront_banners_slot_key" ON "storefront_banners"("slot");

-- AddForeignKey
ALTER TABLE "storefront_home" ADD CONSTRAINT "storefront_home_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_home" ADD CONSTRAINT "storefront_home_heroImageAssetId_fkey" FOREIGN KEY ("heroImageAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_banners" ADD CONSTRAINT "storefront_banners_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_banners" ADD CONSTRAINT "storefront_banners_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
