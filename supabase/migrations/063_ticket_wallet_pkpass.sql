-- Famioo migration 063
-- Allow original Apple Wallet pass files in the private Ticket Wallet bucket.

update storage.buckets
set allowed_mime_types=array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.apple.pkpass'
]
where id='ticket-wallet';
