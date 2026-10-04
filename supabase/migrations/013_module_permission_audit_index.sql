-- Famioo migration 013
-- Cover the module permission audit foreign key reported by the performance advisor.

create index if not exists idx_module_role_permissions_updated_by
  on public.module_role_permissions(updated_by_user_id)
  where updated_by_user_id is not null;
