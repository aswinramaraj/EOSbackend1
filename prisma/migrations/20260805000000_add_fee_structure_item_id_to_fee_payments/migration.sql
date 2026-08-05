-- AlterTable
ALTER TABLE "fee_payments" ADD COLUMN     "fee_structure_item_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_fee_payments_fee_structure_item" ON "fee_payments"("fee_structure_item_id");

-- AddForeignKey
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_fee_structure_item_id_fkey" FOREIGN KEY ("fee_structure_item_id") REFERENCES "fee_structure_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
