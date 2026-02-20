-- 1. Create product_files table for storing uploaded images/PDFs per product
create table public.product_files (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references public.products(id) on delete cascade not null,
  file_name text not null,
  file_path text not null,
  file_url text not null,
  file_type text not null,
  file_size integer,
  ai_analysis text,
  sort_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Add ai_description column to products (synthesized from all file analyses)
alter table public.products add column if not exists ai_description text;

-- 3. RLS for product_files (permissive for MVP)
alter table public.product_files enable row level security;
create policy "Enable all access" on public.product_files
  for all using (true) with check (true);

-- 4. Create storage bucket for product files
insert into storage.buckets (id, name, public)
values ('product-files', 'product-files', true)
on conflict (id) do nothing;

-- 5. Storage policies
create policy "Public read product files" on storage.objects
  for select using (bucket_id = 'product-files');

create policy "Allow upload product files" on storage.objects
  for insert with check (bucket_id = 'product-files');

create policy "Allow delete product files" on storage.objects
  for delete using (bucket_id = 'product-files');
