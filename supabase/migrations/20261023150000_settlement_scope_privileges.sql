-- The scope helper is only used inside settlement functions (which run as their owner).
-- It must not be callable directly by clients, which would reveal who may act on which object.
revoke all on function public.st_settlement_actor_scope(bigint, bigint) from public, anon, authenticated;
grant execute on function public.st_settlement_actor_scope(bigint, bigint) to service_role;
