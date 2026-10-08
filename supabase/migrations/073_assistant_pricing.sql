-- Align the Famioo AI Assistant base plan with the agreed commercial price.
-- 150 included AI actions per billing period remain unchanged.

update public.billing_products
set first_purchase_price_eur = 1.49,
    followup_price_eur = 1.49,
    included_ai_requests = 150,
    updated_at = now()
where product_code = 'assistant_base'
  and module_code = 'assistant';
