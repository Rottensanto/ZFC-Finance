insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-documents',
  'team-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
)
on conflict (id) do update set public = false, file_size_limit = 20971520,
  allowed_mime_types = excluded.allowed_mime_types;

create policy team_documents_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'team-documents'
    and public.can_access_team((storage.foldername(name))[1]::uuid)
  );

create policy team_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-documents'
    and public.can_access_team((storage.foldername(name))[1]::uuid)
  );

create policy team_documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'team-documents'
    and public.can_access_team((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'team-documents'
    and public.can_access_team((storage.foldername(name))[1]::uuid)
  );

create policy team_documents_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-documents' and public.is_finance_staff());

grant insert on public.team_documents to authenticated;