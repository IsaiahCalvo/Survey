-- The public brand bucket (logos for emails and the site) had no size or type
-- limits. Only the service role writes to it (no storage.objects policy grants
-- it to anyone else), but a public bucket should still refuse anything that is
-- not a small image.
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
 WHERE id = 'brand';
