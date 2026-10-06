-- Famioo migration 060
-- Rename the user-facing child health module while preserving the existing module code.

update public.modules
set name='Prevention',
    description='German child preventive health planner for vaccinations and U/J examinations'
where code='vaccinations';

update public.billing_products
set name='Prevention',
    updated_at=now()
where product_code='module_vaccinations';
