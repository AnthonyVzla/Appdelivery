-- Execute in the Supabase SQL Editor before publishing the app.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  full_name text not null,
  phone text not null,
  role text check (role in ('motorizado', 'soporte', 'administracion', 'aliado')),
  approved boolean not null default false,
  suspended boolean not null default false,
  online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create table if not exists public.allies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location_url text,
  created_at timestamptz not null default now()
);
alter table public.allies add column if not exists location_url text;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('motorizado', 'soporte', 'administracion', 'aliado'));
alter table public.profiles add column if not exists ally_id uuid references public.allies(id) on delete set null;
alter table public.profiles add column if not exists earnings_percentage numeric(5,2) not null default 70 check (earnings_percentage between 0 and 100);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  ally_id uuid not null references public.allies(id) on delete restrict,
  client_name text not null,
  client_phone text not null,
  description text not null default '',
  address text,
  maps_url text check (maps_url is null or btrim(maps_url) = '' or maps_url ~* '^https?://'),
  delivery_fee numeric(12, 2) not null check (delivery_fee >= 0),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'at_store', 'in_transit', 'delivered', 'cancelled')),
  courier_id uuid constraint orders_courier_id_fkey references public.profiles(id) on delete set null,
  courier_name text,
  released boolean not null default true,
  created_by uuid constraint orders_created_by_fkey references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  at_store_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz
);
alter table public.orders alter column address drop not null;
alter table public.orders alter column maps_url drop not null;
alter table public.orders drop constraint if exists orders_maps_url_check;
alter table public.orders add constraint orders_maps_url_check
  check (maps_url is null or btrim(maps_url) = '' or maps_url ~* '^https?://[^[:space:]]+$');
update public.orders set maps_url = null where btrim(coalesce(maps_url, '')) = '';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending', 'assigned', 'at_store', 'in_transit', 'delivered', 'cancelled'));
alter table public.orders add column if not exists cancellation_reason text;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists creator_name text;
alter table public.orders add column if not exists description text;
update public.orders set description = 'Sin descripción' where description is null or btrim(description) = '';
alter table public.orders alter column description set default 'Sin descripción';
alter table public.orders alter column description set not null;
alter table public.orders add column if not exists released boolean not null default true;
update public.orders o
set creator_name = p.full_name
from public.profiles p
where o.creator_name is null and o.created_by = p.id;
create index if not exists orders_status_created_idx on public.orders(status, created_at desc);
create index if not exists orders_courier_status_idx on public.orders(courier_id, status);
create index if not exists orders_delivered_at_idx on public.orders(delivered_at desc) where status = 'delivered';

create table if not exists public.courier_locations (
  courier_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision check (accuracy is null or accuracy >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists courier_locations_updated_at_idx on public.courier_locations(updated_at desc);

create or replace function public.clear_unavailable_courier_location()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from 'motorizado'
    or not new.approved
    or new.suspended
    or not new.online then
    delete from public.courier_locations where courier_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_unavailable_courier_location on public.profiles;
create trigger profiles_clear_unavailable_courier_location
after update of role, approved, suspended, online on public.profiles
for each row execute function public.clear_unavailable_courier_location();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved and not suspended
      and role in ('soporte', 'administracion')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and approved and not suspended and role = 'administracion'
  );
$$;

create or replace function public.bootstrap_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  metadata jsonb := new.raw_user_meta_data;
  account_name text := lower(trim(coalesce(metadata ->> 'username', '')));
begin
  if account_name !~ '^[a-z0-9_.-]{3,32}$' then
    raise exception 'El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.';
  end if;
  insert into public.profiles (id, username, full_name, phone)
  values (
    new.id,
    account_name,
    trim(coalesce(metadata ->> 'first_name', '') || ' ' || coalesce(metadata ->> 'last_name', '')),
    trim(coalesce(metadata ->> 'phone', ''))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.bootstrap_profile();

create or replace function public.protect_profile_changes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  elsif auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role
      or new.approved is distinct from old.approved
      or new.suspended is distinct from old.suspended
      or new.ally_id is distinct from old.ally_id
      or new.username is distinct from old.username
      or new.full_name is distinct from old.full_name
      or new.phone is distinct from old.phone
      or new.earnings_percentage is distinct from old.earnings_percentage then
      raise exception 'No puedes modificar roles ni datos de otros usuarios.';
    end if;
  elsif not public.is_admin() then
    raise exception 'Solo administración puede modificar perfiles.';
  end if;
  if public.is_admin()
    and old.role = 'administracion'
    and (new.role is distinct from old.role or not new.approved or new.suspended)
    and (select count(*) from public.profiles
         where role = 'administracion' and approved and not suspended) <= 1 then
    raise exception 'Debe permanecer al menos una cuenta de administración habilitada.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_changes on public.profiles;
create trigger profiles_protect_changes before update on public.profiles
for each row execute function public.protect_profile_changes();

alter table public.profiles enable row level security;
alter table public.allies enable row level security;
alter table public.orders enable row level security;
alter table public.courier_locations enable row level security;

drop policy if exists "courier_locations_read_staff" on public.courier_locations;
create policy "courier_locations_read_staff" on public.courier_locations
for select to authenticated using (
  public.is_staff()
  and updated_at > now() - interval '90 seconds'
  and exists (
    select 1 from public.profiles p
    where p.id = courier_locations.courier_id
      and p.role = 'motorizado' and p.approved and not p.suspended and p.online
      and p.last_seen_at > now() - interval '90 seconds'
  )
);

drop policy if exists "profiles_read_self_or_staff" on public.profiles;
create policy "profiles_read_self_or_staff" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_staff());
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "allies_read_staff" on public.allies;
create policy "allies_read_staff" on public.allies
for select to authenticated using (
  public.is_staff()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'aliado'
      and p.ally_id = allies.id and p.approved and not p.suspended
  )
  or exists (
    select 1
    from public.orders o
    where o.ally_id = allies.id
      and (
        (
          o.courier_id = auth.uid()
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'motorizado'
              and p.approved and not p.suspended
          )
        )
        or (
          o.status = 'pending'
          and o.released
          and exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'motorizado'
              and p.approved and not p.suspended and p.online
              and p.last_seen_at > now() - interval '90 seconds'
          )
        )
      )
  )
);
drop policy if exists "allies_admin_insert" on public.allies;
create policy "allies_admin_insert" on public.allies
for insert to authenticated with check (public.is_admin());
drop policy if exists "allies_admin_update" on public.allies;
create policy "allies_admin_update" on public.allies
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "allies_admin_delete" on public.allies;
create policy "allies_admin_delete" on public.allies
for delete to authenticated using (public.is_admin());

drop policy if exists "orders_read_staff_or_assigned_courier" on public.orders;
create policy "orders_read_staff_or_assigned_courier" on public.orders
for select to authenticated using (
  public.is_staff()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'aliado'
      and p.ally_id = orders.ally_id and p.approved and not p.suspended
  )
  or (
    courier_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'motorizado'
        and p.approved and not p.suspended
    )
  )
  or (
    status = 'pending'
    and released
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'motorizado'
        and p.approved and not p.suspended and p.online
        and p.last_seen_at > now() - interval '90 seconds'
    )
  )
);
drop policy if exists "orders_staff_insert" on public.orders;
create policy "orders_staff_insert" on public.orders
for insert to authenticated with check (public.is_staff() and created_by = auth.uid());

drop function if exists public.create_order(uuid, text, text, text, text, numeric, uuid);
drop function if exists public.create_order(uuid, text, text, text, text, text, numeric, uuid);
create or replace function public.create_order(
  p_ally_id uuid,
  p_client_name text,
  p_client_phone text,
  p_description text,
  p_address text,
  p_maps_url text,
  p_delivery_fee numeric,
  p_courier_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  creator public.profiles%rowtype;
  courier public.profiles%rowtype;
  created_order_id uuid;
begin
  select * into creator
  from public.profiles
  where id = auth.uid() and approved and not suspended
    and role in ('soporte', 'administracion', 'aliado');
  if not found then
    raise exception 'La cuenta no tiene permisos para crear pedidos.';
  end if;
  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'Debe indicar una descripción del pedido.';
  end if;
  if creator.role = 'aliado' and (
    creator.ally_id is null
    or p_ally_id is distinct from creator.ally_id
    or p_courier_id is not null
  ) then
    raise exception 'El aliado solo puede crear pedidos para su comercio y no puede asignar motorizados.';
  end if;

  if p_courier_id is not null then
    select * into courier
    from public.profiles
    where id = p_courier_id
      and role = 'motorizado'
      and approved and not suspended and online
      and last_seen_at > now() - interval '90 seconds';
    if not found then
      raise exception 'El motorizado seleccionado ya no está activo. Actualiza la lista y vuelve a intentarlo.';
    end if;
  end if;

  insert into public.orders (
    ally_id, client_name, client_phone, description, address, maps_url, delivery_fee,
    status, courier_id, courier_name, assigned_at, released,
    created_by, creator_name
  )
  values (
    p_ally_id, trim(p_client_name), trim(p_client_phone), trim(p_description), nullif(trim(p_address), ''),
    nullif(trim(p_maps_url), ''), p_delivery_fee,
    case when p_courier_id is null then 'pending' else 'assigned' end,
    p_courier_id, case when p_courier_id is null then null else courier.full_name end,
    case when p_courier_id is null then null else now() end,
    creator.role <> 'aliado',
    creator.id, creator.full_name
  )
  returning id into created_order_id;

  return created_order_id;
end;
$$;

create or replace function public.cancel_order(order_id uuid, cancellation_reason text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo soporte o administración puede cancelar pedidos.';
  end if;
  if btrim(coalesce(cancellation_reason, '')) = '' then
    raise exception 'Debe indicar la razón de la cancelación.';
  end if;
  update public.orders
  set status = 'cancelled',
      released = false,
      courier_id = null,
      courier_name = null,
      cancellation_reason = btrim(cancellation_reason),
      cancelled_at = now(),
      cancelled_by = auth.uid()
  where id = order_id and status <> 'delivered' and status <> 'cancelled';
  if not found then
    raise exception 'El pedido ya fue entregado, cancelado o no existe.';
  end if;
end;
$$;

create or replace function public.release_order(order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Solo soporte o administración puede liberar pedidos.';
  end if;
  update public.orders
  set released = true,
      status = case when status = 'assigned' then 'pending' else status end,
      courier_id = case when status = 'assigned' then null else courier_id end,
      courier_name = case when status = 'assigned' then null else courier_name end
  where id = order_id
    and (
      (status = 'pending' and courier_id is null and not released)
      or (status = 'assigned' and courier_id is not null and at_store_at is null)
    );
  if not found then
    raise exception 'El pedido ya está liberado, asignado o no existe.';
  end if;
end;
$$;

create or replace function public.set_courier_online(is_online boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set online = is_online,
      last_seen_at = case when is_online then now() else null end
  where id = auth.uid() and role = 'motorizado' and approved and not suspended;
  if not found then
    raise exception 'Solo un motorizado aprobado puede cambiar su disponibilidad.';
  end if;
  if not is_online then
    delete from public.courier_locations where courier_id = auth.uid();
  end if;
end;
$$;

create or replace function public.update_courier_location(
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180
    or (p_accuracy is not null and p_accuracy < 0) then
    raise exception 'Las coordenadas de ubicación no son válidas.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'motorizado'
      and approved and not suspended and online
      and last_seen_at > now() - interval '90 seconds'
  ) then
    raise exception 'Debes estar activo como motorizado para compartir tu ubicación.';
  end if;
  insert into public.courier_locations (courier_id, latitude, longitude, accuracy, updated_at)
  values (auth.uid(), p_latitude, p_longitude, p_accuracy, now())
  on conflict (courier_id) do update
  set latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy = excluded.accuracy,
      updated_at = excluded.updated_at;
end;
$$;

create or replace function public.heartbeat_courier()
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and role = 'motorizado'
    and approved and not suspended and online;
end;
$$;

create or replace function public.claim_order(order_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid()
      and role = 'motorizado' and approved and not suspended and online
      and last_seen_at > now() - interval '90 seconds'
  ) then
    raise exception 'Actívate para poder tomar pedidos.';
  end if;
  update public.orders
  set courier_id = auth.uid(),
      courier_name = (select full_name from public.profiles where id = auth.uid()),
      status = 'assigned', assigned_at = coalesce(assigned_at, now())
  where id = order_id and status = 'pending'
    and courier_id is null and released;
  if not found then
    raise exception 'El pedido ya fue tomado o no está disponible.';
  end if;
end;
$$;

create or replace function public.advance_order(order_id uuid, next_status text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  current_status text;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid()
      and role = 'motorizado' and approved and not suspended
  ) then
    raise exception 'La cuenta no está habilitada para actualizar pedidos.';
  end if;
  select status into current_status from public.orders
  where id = order_id and courier_id = auth.uid() for update;
  if not found then
    raise exception 'Este pedido no está asignado a tu usuario.';
  end if;
  if (current_status, next_status) not in (
    ('assigned', 'at_store'),
    ('at_store', 'in_transit'),
    ('in_transit', 'delivered')
  ) then
    raise exception 'El estado solicitado no es la siguiente etapa válida.';
  end if;
  update public.orders
  set status = next_status,
      at_store_at = case when next_status = 'at_store' then now() else at_store_at end,
      in_transit_at = case when next_status = 'in_transit' then now() else in_transit_at end,
      delivered_at = case when next_status = 'delivered' then now() else delivered_at end
  where id = order_id;
end;
$$;

create or replace function public.assign_order(order_id uuid, target_courier uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para asignar pedidos.';
  end if;
  if not exists (
    select 1 from public.profiles where id = target_courier
      and role = 'motorizado' and approved and not suspended
  ) then
    raise exception 'El motorizado seleccionado no está habilitado.';
  end if;
  update public.orders
  set courier_id = target_courier,
      courier_name = (select full_name from public.profiles where id = target_courier),
      released = true,
      status = case when status = 'pending' then 'assigned' else status end,
      assigned_at = coalesce(assigned_at, now())
  where id = order_id
    and (
      status = 'pending'
      or (
        status = 'assigned'
        and at_store_at is null
        and exists (
          select 1 from public.profiles p
          where p.id = target_courier and p.online
            and p.last_seen_at > now() - interval '90 seconds'
        )
      )
    );
  if not found then
    raise exception 'El pedido no existe, ya llegó al comercio o ya fue entregado.';
  end if;
end;
$$;

create or replace function public.delete_user_account(target_user uuid)
returns void language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo administración puede eliminar usuarios.';
  end if;
  if target_user = auth.uid() then
    raise exception 'No puedes eliminar tu propia cuenta.';
  end if;
  delete from auth.users where id = target_user;
  if not found then
    raise exception 'El usuario no existe.';
  end if;
end;
$$;

revoke all on function public.set_courier_online(boolean) from public;
revoke all on function public.update_courier_location(double precision, double precision, double precision) from public;
revoke all on function public.create_order(uuid, text, text, text, text, text, numeric, uuid) from public;
revoke all on function public.cancel_order(uuid, text) from public;
revoke all on function public.release_order(uuid) from public;
revoke all on function public.heartbeat_courier() from public;
revoke all on function public.claim_order(uuid) from public;
revoke all on function public.advance_order(uuid, text) from public;
revoke all on function public.assign_order(uuid, uuid) from public;
revoke all on function public.delete_user_account(uuid) from public;
grant execute on function public.set_courier_online(boolean) to authenticated;
grant execute on function public.update_courier_location(double precision, double precision, double precision) to authenticated;
grant execute on function public.create_order(uuid, text, text, text, text, text, numeric, uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.release_order(uuid) to authenticated;
grant execute on function public.heartbeat_courier() to authenticated;
grant execute on function public.claim_order(uuid) to authenticated;
grant execute on function public.advance_order(uuid, text) to authenticated;
grant execute on function public.assign_order(uuid, uuid) to authenticated;
grant execute on function public.delete_user_account(uuid) to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant select on public.profiles, public.allies, public.orders to authenticated;
revoke all on public.courier_locations from anon, authenticated;
grant select on public.courier_locations to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.allies to authenticated;
revoke insert on public.orders from anon, authenticated;

-- Enable live order/profile updates for the dashboard (safe to re-run).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'courier_locations'
  ) then
    alter publication supabase_realtime add table public.courier_locations;
  end if;
end;
$$;

-- After registering your own account and applying this schema, promote that
-- account to the first administrator from the Supabase SQL Editor:
-- update public.profiles set role = 'administracion', approved = true
-- where username = 'tu_usuario';
