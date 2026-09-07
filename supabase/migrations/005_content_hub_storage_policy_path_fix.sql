-- Fix Storage RLS path matching: qualify the outer storage.objects.name
-- column so PostgreSQL does not resolve "name" to the inner brands alias.

drop policy if exists "content hub media read" on storage.objects;
create policy "content hub media read" on storage.objects
for select to authenticated
using (bucket_id='content-media' and exists(
  select 1 from public.brands b
  where b.id::text=(storage.foldername(storage.objects.name))[1]
    and private.can_access_brand(b.id)
));

drop policy if exists "content hub media insert" on storage.objects;
create policy "content hub media insert" on storage.objects
for insert to authenticated
with check (bucket_id='content-media' and exists(
  select 1 from public.brands b
  where b.id::text=(storage.foldername(storage.objects.name))[1]
    and private.can_upload_brand(b.id)
));

drop policy if exists "content hub media update" on storage.objects;
create policy "content hub media update" on storage.objects
for update to authenticated
using (bucket_id='content-media' and exists(
  select 1 from public.brands b
  where b.id::text=(storage.foldername(storage.objects.name))[1]
    and private.can_edit_brand(b.id)
))
with check (bucket_id='content-media' and exists(
  select 1 from public.brands b
  where b.id::text=(storage.foldername(storage.objects.name))[1]
    and private.can_edit_brand(b.id)
));

drop policy if exists "content hub media delete" on storage.objects;
create policy "content hub media delete" on storage.objects
for delete to authenticated
using (bucket_id='content-media' and exists(
  select 1 from public.brands b
  where b.id::text=(storage.foldername(storage.objects.name))[1]
    and private.can_edit_brand(b.id)
));
