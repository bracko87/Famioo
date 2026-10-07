-- Famioo migration 067
-- Store a persistent visual preview extracted from imported digital tickets.

alter table public.ticket_wallet_entries
  add column if not exists preview_image_path text,
  add column if not exists preview_image_mime_type text;
