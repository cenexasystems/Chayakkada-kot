ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_show_qr" boolean DEFAULT true NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_show_copy" boolean DEFAULT true NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_show_phone" boolean DEFAULT true NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "pay_show_apps" boolean DEFAULT true NOT NULL;
